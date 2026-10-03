"""Lecture d'un GLB rigge / anime SANS bibliotheque glTF (campagne 2026-10-02, suite) : maillages, squelette, poids, animations, calcul de peau (LBS) a un instant donne.
Sert a valider_rig2.py (mesures de qualite) et rendre_pose.py (rendu d'une pose). Tout en numpy ; aucun fichier n'est ecrit."""
import json, struct
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def quat_mat(q):
    x, y, z, w = q
    n = x * x + y * y + z * z + w * w
    s = 2.0 / n if n > 0 else 0.0
    return np.array([[1 - s * (y * y + z * z), s * (x * y - z * w), s * (x * z + y * w)],
                     [s * (x * y + z * w), 1 - s * (x * x + z * z), s * (y * z - x * w)],
                     [s * (x * z - y * w), s * (y * z + x * w), 1 - s * (x * x + y * y)]])


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0: b = -b; d = -d
    if d > 0.9995:
        r = a + t * (b - a); return r / np.linalg.norm(r)
    th = np.arccos(min(1.0, d)); s = np.sin(th)
    return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / s


class Rig:
    def __init__(self, path):
        data = open(path, 'rb').read()
        magic, ver, total = struct.unpack('<4sII', data[:12])
        if magic != b'glTF': raise ValueError('pas un GLB')
        off = 12; self.j = None; self.bin = b''
        while off < len(data):
            n, t = struct.unpack('<I4s', data[off:off + 8]); chunk = data[off + 8:off + 8 + n]; off += 8 + n
            if t == b'JSON': self.j = json.loads(chunk.decode('utf-8'))
            elif t.startswith(b'BIN'): self.bin = chunk
        j = self.j
        self.nodes = j.get('nodes', [])
        self.n = len(self.nodes)
        self.parent = [-1] * self.n
        for i, nd in enumerate(self.nodes):
            for c in nd.get('children', []): self.parent[c] = i
        self.names = [nd.get('name', 'n%d' % i) for i, nd in enumerate(self.nodes)]
        self.skins = j.get('skins', [])
        self.anims = j.get('animations', [])
        self._cache = {}

    # ---- accesseurs
    def acc(self, i):
        if i in self._cache: return self._cache[i]
        a = self.j['accessors'][i]
        dt = np.dtype(CT[a['componentType']]).newbyteorder('<'); nc = NC[a['type']]; count = a['count']
        if 'bufferView' not in a:
            arr = np.zeros((count, nc), dtype=dt)
        else:
            bv = self.j['bufferViews'][a['bufferView']]
            start = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0); esz = dt.itemsize * nc
            if stride and stride != esz:
                raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (count - 1) + esz, offset=start)
                arr = np.lib.stride_tricks.as_strided(raw, shape=(count, esz), strides=(stride, 1)).copy().view(dt).reshape(count, nc)
            else:
                arr = np.frombuffer(self.bin, dtype=dt, count=count * nc, offset=start).reshape(count, nc)
        if a.get('normalized') and a['componentType'] != 5126:
            arr = arr.astype(np.float32) / float(np.iinfo(CT[a['componentType']]).max)
        self._cache[i] = arr
        return arr

    # ---- maillages rigges : liste de dict(P, J, W, F, skin, nom)
    def prims(self):
        out = []
        for ni, nd in enumerate(self.nodes):
            if 'mesh' not in nd: continue
            sk = nd.get('skin')
            for pi, p in enumerate(self.j['meshes'][nd['mesh']].get('primitives', [])):
                at = p.get('attributes', {})
                if 'POSITION' not in at: continue
                P = np.asarray(self.acc(at['POSITION']), dtype=np.float64)
                if 'indices' in p: F = np.asarray(self.acc(p['indices']), dtype=np.int64).reshape(-1, 3)
                else: F = np.arange(len(P)).reshape(-1, 3)
                J = W = None
                if 'JOINTS_0' in at and 'WEIGHTS_0' in at:
                    Js = [np.asarray(self.acc(at['JOINTS_0']), dtype=np.int64)]; Ws = [np.asarray(self.acc(at['WEIGHTS_0']), dtype=np.float64)]
                    k = 1
                    while ('JOINTS_%d' % k) in at and ('WEIGHTS_%d' % k) in at:
                        Js.append(np.asarray(self.acc(at['JOINTS_%d' % k]), dtype=np.int64)); Ws.append(np.asarray(self.acc(at['WEIGHTS_%d' % k]), dtype=np.float64)); k += 1
                    J = np.hstack(Js); W = np.hstack(Ws)
                out.append({'P': P, 'J': J, 'W': W, 'F': F, 'skin': sk, 'node': ni, 'nom': '%s/%d' % (nd.get('name', ni), pi)})
        return out

    # ---- squelette
    def local_trs(self, i):
        nd = self.nodes[i]
        if 'matrix' in nd:
            m = np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T
            t = m[:3, 3]; sx = np.linalg.norm(m[:3, 0]); sy = np.linalg.norm(m[:3, 1]); sz = np.linalg.norm(m[:3, 2])
            r = m[:3, :3] / np.array([sx, sy, sz])
            # matrice -> quaternion
            tr = np.trace(r)
            if tr > 0:
                s = 0.5 / np.sqrt(tr + 1.0); q = np.array([(r[2, 1] - r[1, 2]) * s, (r[0, 2] - r[2, 0]) * s, (r[1, 0] - r[0, 1]) * s, 0.25 / s])
            else:
                q = np.array([0, 0, 0, 1.0])
            return t.copy(), q, np.array([sx, sy, sz])
        return (np.array(nd.get('translation', [0, 0, 0]), dtype=np.float64), np.array(nd.get('rotation', [0, 0, 0, 1]), dtype=np.float64), np.array(nd.get('scale', [1, 1, 1]), dtype=np.float64))

    def order(self):
        if hasattr(self, '_order'): return self._order
        seen = [False] * self.n; o = []
        def visit(i):
            if seen[i]: return
            if self.parent[i] >= 0: visit(self.parent[i])
            seen[i] = True; o.append(i)
        for i in range(self.n): visit(i)
        self._order = o; return o

    def world(self, pose=None):
        """pose : dict noeud -> (t, q, s) qui remplace la valeur par defaut. Rend un tableau (n,4,4) des matrices monde."""
        W = np.zeros((self.n, 4, 4)); loc = {}
        for i in self.order():
            t, q, s = (pose[i] if pose and i in pose else self.local_trs(i))
            m = np.eye(4); m[:3, :3] = quat_mat(q) * s[None, :]; m[:3, 3] = t
            W[i] = m if self.parent[i] < 0 else W[self.parent[i]] @ m
        return W

    def skin_mats(self, k, W):
        s = self.skins[k]; joints = s['joints']
        if 'inverseBindMatrices' in s: ibm = self.acc(s['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        else: ibm = np.tile(np.eye(4), (len(joints), 1, 1))
        return np.einsum('jab,jbc->jac', W[joints], ibm)

    def skinned(self, pr, W):
        """positions des sommets de la primitive pr, deformees par la pose W (matrices monde)."""
        if pr['J'] is None or pr['skin'] is None: return pr['P']
        JM = self.skin_mats(pr['skin'], W)
        P = pr['P']; out = np.zeros_like(P)
        for k in range(pr['J'].shape[1]):
            w = pr['W'][:, k]
            if not w.any(): continue
            m = JM[np.clip(pr['J'][:, k], 0, len(JM) - 1)]
            out += w[:, None] * (np.einsum('nij,nj->ni', m[:, :3, :3], P) + m[:, :3, 3])
        return out

    # ---- animations
    def anim_info(self, k):
        a = self.anims[k]; dur = 0.0; nkeys = 0
        for s in a.get('samplers', []):
            t = self.acc(s['input']);
            if len(t): dur = max(dur, float(t[-1, 0])); nkeys = max(nkeys, len(t))
        return dur, nkeys

    def anim_pose(self, k, t):
        a = self.anims[k]; pose = {}
        for ch in a.get('channels', []):
            tg = ch['target']; ni = tg.get('node'); path = tg.get('path')
            if ni is None or path not in ('translation', 'rotation', 'scale'): continue
            s = a['samplers'][ch['sampler']]; ts = self.acc(s['input'])[:, 0]; vs = self.acc(s['output']).astype(np.float64)
            interp = s.get('interpolation', 'LINEAR')
            if interp == 'CUBICSPLINE': vs = vs[1::3]
            if len(ts) == 0: continue
            if t <= ts[0]: v = vs[0]
            elif t >= ts[-1]: v = vs[-1]
            else:
                i = int(np.searchsorted(ts, t, side='right') - 1); f = (t - ts[i]) / max(ts[i + 1] - ts[i], 1e-9)
                if interp == 'STEP': v = vs[i]
                elif path == 'rotation': v = slerp(vs[i], vs[i + 1], f)
                else: v = vs[i] * (1 - f) + vs[i + 1] * f
            cur = pose.get(ni) or list(self.local_trs(ni))
            cur = list(cur)
            if path == 'translation': cur[0] = v
            elif path == 'rotation': cur[1] = v / (np.linalg.norm(v) or 1)
            else: cur[2] = v
            pose[ni] = tuple(cur)
        return pose


def triangle_stretch(P0, P1, F, eps_rel=1e-5):
    """rapport des longueurs d'aretes (pose / repos) sur toutes les faces."""
    size = float(np.linalg.norm(P0.max(0) - P0.min(0)))
    r = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        l0 = np.linalg.norm(P0[F[:, a]] - P0[F[:, b]], axis=1); l1 = np.linalg.norm(P1[F[:, a]] - P1[F[:, b]], axis=1)
        ok = l0 > size * eps_rel
        r.append(np.where(ok, l1 / np.maximum(l0, 1e-12), 1.0))
    return np.concatenate(r)
