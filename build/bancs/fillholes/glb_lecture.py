# -*- coding: utf-8 -*-
"""Lecteur GLB minimal (numpy seul) pour le banc de diagnostic de matiere (20/10/2026).

Pourquoi pas trimesh.load : (1) un GLB TRELLIS de 500 000 faces porte des textures 4K / 8K que trimesh decode ou garde en
memoire pour rien ici ; (2) le banc doit voir EXACTEMENT ce que voit un visualiseur : les indices de sommets tels
quels (les coutures d'UV dupliquent les sommets), l'ordre d'enroulement tel quel, les matrices de noeud appliquees
(un determinant negatif RENVERSE l'enroulement, regle de la specification glTF) et le drapeau doubleSided du materiau.

Ne lit que les primitives en triangles (mode 4) ; refuse Draco / meshopt (aucun GLB de l'appli n'en utilise).
"""
import json
import struct

import numpy as np

_DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


class Primitive:
    """Une primitive du GLB, deja passee dans le repere du monde."""
    __slots__ = ('V', 'F', 'UV', 'materiau', 'nom', 'renverse')

    def __init__(self, V, F, UV, materiau, nom, renverse):
        self.V, self.F, self.UV, self.materiau, self.nom, self.renverse = V, F, UV, materiau, nom, renverse


class Glb:
    def __init__(self, chemin):
        with open(chemin, 'rb') as f:
            brut = f.read()
        if brut[:4] != b'glTF':
            raise ValueError('pas un GLB : %s' % chemin)
        n, t = struct.unpack('<II', brut[12:20])
        self.json = json.loads(brut[20:20 + n])
        pos = 20 + n
        self.bin = b''
        while pos + 8 <= len(brut):
            n2, t2 = struct.unpack('<II', brut[pos:pos + 8])
            if t2 == 0x004E4942:
                self.bin = brut[pos + 8:pos + 8 + n2]
                break
            pos += 8 + n2
        exigees = set(self.json.get('extensionsRequired', []))
        if exigees & {'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization'}:
            raise ValueError('GLB compresse non gere : %s' % sorted(exigees))
        self.chemin = chemin
        self.taille = len(brut)

    # ------------------------------------------------------------------ acces
    def accesseur(self, i):
        a = self.json['accessors'][i]
        comp = _DTYPES[a['componentType']]
        nc = _NCOMP[a['type']]
        n = a['count']
        if 'bufferView' not in a:
            return np.zeros((n, nc), comp)
        bv = self.json['bufferViews'][a['bufferView']]
        deb = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        taille_el = np.dtype(comp).itemsize * nc
        pas = bv.get('byteStride') or taille_el
        if pas == taille_el:
            arr = np.frombuffer(self.bin, dtype=comp, count=n * nc, offset=deb).reshape(n, nc)
        else:
            tmp = np.frombuffer(self.bin, dtype=np.uint8, count=(n - 1) * pas + taille_el, offset=deb)
            arr = np.lib.stride_tricks.as_strided(tmp, shape=(n, taille_el), strides=(pas, 1))
            arr = np.ascontiguousarray(arr).view(comp).reshape(n, nc)
        if a.get('normalized') and comp != np.float32:
            arr = arr.astype(np.float32) / np.float32(np.iinfo(comp).max)
        return arr

    def octets_image(self, i):
        """Octets bruts de l'image i (PNG / WebP / JPEG) sans la decoder."""
        im = self.json['images'][i]
        if 'bufferView' in im:
            bv = self.json['bufferViews'][im['bufferView']]
            d = bv.get('byteOffset', 0)
            return self.bin[d:d + bv['byteLength']], im.get('mimeType', '')
        return None, im.get('uri', '')

    # ------------------------------------------------------------------ scene
    def _matrice_noeud(self, nd):
        if 'matrix' in nd:
            return np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T
        T = np.eye(4)
        if 'scale' in nd:
            S = np.diag(list(nd['scale']) + [1.0])
        else:
            S = np.eye(4)
        R = np.eye(4)
        if 'rotation' in nd:
            x, y, z, w = nd['rotation']
            R[:3, :3] = np.array([
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        if 'translation' in nd:
            T[:3, 3] = nd['translation']
        return T @ R @ S

    def primitives(self):
        """Liste de Primitive (monde). Les noeuds de scene sont parcourus ; sans scene, tous les maillages tels quels."""
        j = self.json
        noeuds = j.get('nodes', [])
        sorties = []

        def visite(i, M):
            nd = noeuds[i]
            Mw = M @ self._matrice_noeud(nd)
            if 'mesh' in nd:
                self._emet(nd['mesh'], Mw, nd.get('name', ''), sorties)
            for c in nd.get('children', []):
                visite(c, Mw)

        if noeuds and j.get('scenes'):
            racines = j['scenes'][j.get('scene', 0)].get('nodes', [])
            for r in racines:
                visite(r, np.eye(4))
        else:
            for k in range(len(j.get('meshes', []))):
                self._emet(k, np.eye(4), '', sorties)
        return sorties

    def _emet(self, k, M, nom, sorties):
        m = self.json['meshes'][k]
        det = np.linalg.det(M[:3, :3])
        for pi, pr in enumerate(m.get('primitives', [])):
            if pr.get('mode', 4) != 4:
                continue
            P = self.accesseur(pr['attributes']['POSITION']).astype(np.float64)
            V = P @ M[:3, :3].T + M[:3, 3]
            if 'indices' in pr:
                F = self.accesseur(pr['indices']).reshape(-1, 3).astype(np.int64)
            else:
                F = np.arange(len(V), dtype=np.int64).reshape(-1, 3)
            renverse = det < 0
            if renverse:
                F = F[:, [0, 2, 1]]
            UV = None
            if 'TEXCOORD_0' in pr['attributes']:
                UV = self.accesseur(pr['attributes']['TEXCOORD_0']).astype(np.float32)
            sorties.append(Primitive(V, F, UV, pr.get('material', -1), '%s/%s#%d' % (nom, m.get('name', k), pi), renverse))

    def materiaux(self):
        out = []
        for i, mt in enumerate(self.json.get('materials', [])):
            pbr = mt.get('pbrMetallicRoughness', {})
            tex = pbr.get('baseColorTexture')
            img = None
            if tex is not None:
                t = self.json['textures'][tex['index']]
                src = t.get('source')
                if src is None:
                    for ext in t.get('extensions', {}).values():
                        src = ext.get('source', src)
                img = src
            out.append({'index': i, 'nom': mt.get('name', ''), 'alphaMode': mt.get('alphaMode', 'OPAQUE'),
                        'doubleSided': bool(mt.get('doubleSided', False)),
                        'metallicFactor': pbr.get('metallicFactor', 1.0),
                        'roughnessFactor': pbr.get('roughnessFactor', 1.0),
                        'baseColorFactor': pbr.get('baseColorFactor', [1, 1, 1, 1]),
                        'image': img})
        return out


def fusionner(prims):
    """Concatene les primitives : (V, F, UV|None, materiau_par_face, primitive_par_face)."""
    Vs, Fs, mats, pids, UVs = [], [], [], [], []
    decal = 0
    tous_uv = all(p.UV is not None for p in prims)
    for pi, p in enumerate(prims):
        Vs.append(p.V)
        Fs.append(p.F + decal)
        mats.append(np.full(len(p.F), p.materiau, np.int32))
        pids.append(np.full(len(p.F), pi, np.int32))
        if tous_uv:
            UVs.append(p.UV)
        decal += len(p.V)
    V = np.concatenate(Vs) if Vs else np.zeros((0, 3))
    F = np.concatenate(Fs) if Fs else np.zeros((0, 3), np.int64)
    return (V, F, np.concatenate(UVs) if tous_uv and UVs else None,
            np.concatenate(mats) if mats else np.zeros(0, np.int32),
            np.concatenate(pids) if pids else np.zeros(0, np.int32))


def ecrire_glb(chemin, V, F, UV=None, png=None):
    """Ecrit un GLB (positions + indices, et si UV et png sont donnes : coordonnees de texture + image de couleur de
    base). Sert aux copies reduites et aux cas de test. `png` = octets d'une image PNG."""
    V = np.asarray(V, np.float32)
    F = np.asarray(F, np.uint32).reshape(-1, 3)
    morceaux = []

    def ajoute(b):
        d = sum(len(x) for x in morceaux)
        morceaux.append(b + b'\0' * ((-len(b)) % 4))
        return d, len(b)

    o_idx, n_idx = ajoute(F.tobytes())
    o_pos, n_pos = ajoute(V.tobytes())
    j = {
        'asset': {'version': '2.0', 'generator': 'diagnostic_matiere'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 1}, 'indices': 0, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.9}}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5125, 'count': int(F.size), 'type': 'SCALAR'},
            {'bufferView': 1, 'componentType': 5126, 'count': int(len(V)), 'type': 'VEC3',
             'min': V.min(0).tolist(), 'max': V.max(0).tolist()}],
        'bufferViews': [{'buffer': 0, 'byteOffset': o_idx, 'byteLength': n_idx},
                        {'buffer': 0, 'byteOffset': o_pos, 'byteLength': n_pos}]}
    if UV is not None and png is not None:
        UV = np.asarray(UV, np.float32)
        o_uv, n_uv = ajoute(UV.tobytes())
        o_im, n_im = ajoute(png)
        j['bufferViews'] += [{'buffer': 0, 'byteOffset': o_uv, 'byteLength': n_uv},
                             {'buffer': 0, 'byteOffset': o_im, 'byteLength': n_im}]
        j['accessors'].append({'bufferView': 2, 'componentType': 5126, 'count': int(len(UV)), 'type': 'VEC2'})
        j['meshes'][0]['primitives'][0]['attributes']['TEXCOORD_0'] = 2
        j['images'] = [{'bufferView': 3, 'mimeType': 'image/png'}]
        j['textures'] = [{'source': 0}]
        j['materials'][0]['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
    corps = b''.join(morceaux)
    j['buffers'] = [{'byteLength': len(corps)}]
    jb = json.dumps(j, separators=(',', ':')).encode()
    jb += b' ' * ((-len(jb)) % 4)
    total = 12 + 8 + len(jb) + 8 + len(corps)
    with open(chemin, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack('<II', len(corps), 0x004E4942) + corps)
