"""Symetrie de maillage cote Modal (outil « Symmetrize mesh »). Le noyau est la COPIE de scripts/symmetrize_mesh.py
(garde build/check-noyaux-partages.mjs, `--sync` pour la regenerer) : ne l'editer qu'a la source. Numpy + trimesh, CPU."""
import json
import os
import sys


# --- NOYAU PARTAGE : DEBUT (symetrie de maillage) ---
def refus_glb(octets):
    """Message de refus si le GLB est pese (peau), anime ou porte des cibles de morphose : la symetrie deplace les
    sommets, le rig ou l'animation deviendrait faux. None si le fichier peut etre symetrise."""
    try:
        import struct
        if len(octets) < 20 or octets[:4] != b'glTF':
            return None
        n = struct.unpack('<I', octets[12:16])[0]
        doc = json.loads(octets[20:20 + n].decode('utf-8'))
    except Exception:
        return None
    if doc.get('skins') or doc.get('animations'):
        return 'This mesh is rigged or animated: symmetrize the mesh before rigging it.'
    for m in doc.get('meshes', []):
        for p in m.get('primitives', []):
            if 'JOINTS_0' in (p.get('attributes') or {}) or p.get('targets'):
                return 'This mesh is rigged or animated: symmetrize the mesh before rigging it.'
    return None


def region_faces(centres, stamps, reflechir=None):
    """Faces dont le CENTRE tombe dans la zone peinte : tampons appliques dans l'ordre, un tampon « peindre » (s=1)
    allume les faces dans sa sphere, un tampon « gommer » (s=0) les eteint. reflechir = (point, normale unitaire) :
    les centres des tampons sont d'abord reflechis par le plan (zone miroir)."""
    import numpy as np
    sel = np.zeros(len(centres), dtype=bool)
    if not len(centres):
        return sel
    # Centres tries le long de l'axe le plus etendu : chaque tampon ne regarde que sa tranche (au lieu de tout le maillage).
    ax = int(np.argmax(centres.max(axis=0) - centres.min(axis=0)))
    ordre = np.argsort(centres[:, ax], kind='stable')
    xs = centres[ordre, ax]
    for s in stamps or []:
        c = np.array(s[:3], dtype=np.float64)
        if reflechir is not None:
            p, nn = reflechir
            c = c - 2.0 * float(np.dot(c - p, nn)) * nn
        r = float(s[3])
        i0 = int(np.searchsorted(xs, c[ax] - r, side='left'))
        i1 = int(np.searchsorted(xs, c[ax] + r, side='right'))
        if i1 <= i0:
            continue
        idx = ordre[i0:i1]
        sous = centres[idx]
        lo = np.all(sous >= c - r, axis=1) & np.all(sous <= c + r, axis=1)
        idx = idx[lo]
        if not len(idx):
            continue
        dd = centres[idx] - c
        dedans = idx[(dd * dd).sum(axis=1) <= r * r]
        sel[dedans] = bool(float(s[4]) >= 0.5)
    return sel


def _normaliser(M):
    import numpy as np
    L = np.linalg.norm(M, axis=1, keepdims=True)
    return M / np.where(L > 1e-12, L, 1.0)


def _couper_demi_espace(V, F, A, N, point, nn, eps):
    """Garde ce qui est du cote positif du plan (distance signee > 0). Les triangles a cheval sont decoupes ; les
    sommets nouveaux (et ceux deja a moins de eps du plan, ramenes SUR le plan) sont marques « sur le plan ».
    Rend (V, F, A, N, sur_plan, plats) : les triangles entierement dans le plan (face plate qui coincide avec le plan,
    paroi de fermeture d'un demi-modele) sont ECARTES : gardes une fois ils laisseraient une paroi interne a une
    seule face (aretes non manifold) ; plats est donc toujours vide."""
    import numpy as np
    V = V.copy()
    d = (V - point) @ nn
    cls = np.where(d > eps, 1, np.where(d < -eps, -1, 0)).astype(np.int8)
    zero = cls == 0
    V[zero] -= d[zero, None] * nn
    d[zero] = 0.0
    c = cls[F]
    npos = (c == 1).sum(axis=1)
    nneg = (c == -1).sum(axis=1)
    garde = (nneg == 0) & (npos > 0)
    plats = F[(npos == 0) & (nneg == 0)]
    droits = F[garde]
    cheval = (npos > 0) & (nneg > 0)
    nV = len(V)
    liste = []          # (a, b) des aretes a couper, puis les triangles dans leurs propres tableaux

    def tourner(tri, cs, k):
        idx = (k[:, None] + np.arange(3)[None, :]) % 3
        return np.take_along_axis(tri, idx, axis=1), np.take_along_axis(cs, idx, axis=1)

    S, cs = F[cheval], c[cheval]
    ns, nz_ = npos[cheval], (c[cheval] == 0).sum(axis=1)
    cas = {}
    # A : un sommet positif, deux negatifs -> (p, e(p,q), e(p,r))
    mA = (ns == 1) & (nz_ == 0)
    if mA.any():
        t, _ = tourner(S[mA], cs[mA], np.argmax(cs[mA] == 1, axis=1))
        cas['A'] = t
        liste += [t[:, [0, 1]], t[:, [0, 2]]]
    # B : deux positifs, un negatif (en dernier) -> (p, q, e(q,r)) + (p, e(q,r), e(r,p))
    mB = (ns == 2)
    if mB.any():
        t, _ = tourner(S[mB], cs[mB], (np.argmax(cs[mB] == -1, axis=1) + 1) % 3)
        cas['B'] = t
        liste += [t[:, [1, 2]], t[:, [2, 0]]]
    # C : un positif, un sur le plan, un negatif
    mC = (ns == 1) & (nz_ == 1)
    if mC.any():
        t, tc = tourner(S[mC], cs[mC], np.argmax(cs[mC] == 1, axis=1))
        b_zero = tc[:, 1] == 0
        cas['C'] = (t, b_zero)
        liste += [t[b_zero][:, [2, 0]], t[~b_zero][:, [0, 1]]]
    if liste:
        paires = np.concatenate(liste, axis=0).astype(np.int64)
        lo, hi = paires.min(axis=1), paires.max(axis=1)
        cles = lo * nV + hi
        ucles, premier = np.unique(cles, return_index=True)
        ilo, ihi = lo[premier], hi[premier]
        t_ = d[ilo] / (d[ilo] - d[ihi])
        Vn = V[ilo] + t_[:, None] * (V[ihi] - V[ilo])
        Vn -= ((Vn - point) @ nn)[:, None] * nn           # exactement sur le plan
        An = None if A is None else A[ilo] + t_[:, None] * (A[ihi] - A[ilo])
        Nn = None if N is None else _normaliser(N[ilo] + t_[:, None] * (N[ihi] - N[ilo]))

        def ar(a, b):
            k = np.minimum(a, b).astype(np.int64) * nV + np.maximum(a, b)
            return nV + np.searchsorted(ucles, k)
    else:
        Vn = np.zeros((0, 3)); An = None if A is None else np.zeros((0, A.shape[1])); Nn = None if N is None else np.zeros((0, 3))
        ar = None
    morceaux = [droits]
    if 'A' in cas:
        t = cas['A']
        morceaux.append(np.stack([t[:, 0], ar(t[:, 0], t[:, 1]), ar(t[:, 0], t[:, 2])], axis=1))
    if 'B' in cas:
        t = cas['B']
        e_qr, e_rp = ar(t[:, 1], t[:, 2]), ar(t[:, 2], t[:, 0])
        morceaux.append(np.stack([t[:, 0], t[:, 1], e_qr], axis=1))
        morceaux.append(np.stack([t[:, 0], e_qr, e_rp], axis=1))
    if 'C' in cas:
        t, bz = cas['C']
        ta, tb = t[bz], t[~bz]
        if len(ta):   # (a, zero, -) -> (a, b, e(c,a))
            morceaux.append(np.stack([ta[:, 0], ta[:, 1], ar(ta[:, 2], ta[:, 0])], axis=1))
        if len(tb):   # (a, -, zero) -> (a, e(a,b), c)
            morceaux.append(np.stack([tb[:, 0], ar(tb[:, 0], tb[:, 1]), tb[:, 2]], axis=1))
    Fn = np.concatenate([m.reshape(-1, 3) for m in morceaux], axis=0).astype(np.int64)
    Vt = np.concatenate([V, Vn], axis=0)
    At = None if A is None else np.concatenate([A, An], axis=0)
    Nt = None if N is None else np.concatenate([N, Nn], axis=0)
    sur = np.concatenate([zero, np.ones(len(Vn), dtype=bool)])
    # on ne garde que les sommets utilises
    utilise = np.zeros(len(Vt), dtype=bool)
    utilise[Fn.ravel()] = True
    remap = -np.ones(len(Vt), dtype=np.int64)
    remap[utilise] = np.arange(int(utilise.sum()))
    return (Vt[utilise], remap[Fn], None if At is None else At[utilise], None if Nt is None else Nt[utilise],
            sur[utilise], np.zeros((0, 3), dtype=np.int64))


def _reflechir(P, point, nn):
    import numpy as np
    return P - 2.0 * ((P - point) @ nn)[:, None] * nn


def _miroir(V, F, A, N, sur, plats, point, nn, souder):
    """Recopie en miroir. souder=True : les sommets du plan sont partages avec l'original (maillage unique) ;
    False : tout est duplique (copie a part, mode zone)."""
    import numpy as np
    nV = len(V)
    dup = np.ones(nV, dtype=bool) if not souder else ~sur
    idx = np.arange(nV, dtype=np.int64)
    idx[dup] = nV + np.arange(int(dup.sum()))
    Vm = _reflechir(V[dup], point, nn)
    Am = None if A is None else A[dup]
    if N is None:
        Nm = None
    else:
        Nm = N[dup] - 2.0 * (N[dup] @ nn)[:, None] * nn
    Fm = idx[F][:, ::-1]
    if souder and N is not None:
        # une normale posee sur le plan doit rester dans le plan, sinon la couture se voit
        Np = N[sur] - (N[sur] @ nn)[:, None] * nn
        L = np.linalg.norm(Np, axis=1)
        ok = L > 1e-6
        Np[ok] = Np[ok] / L[ok, None]
        Np[~ok] = N[sur][~ok]
        N = N.copy()
        N[sur] = Np
    return V, Fm, Am, Nm, Vm, N


def symetriser_tableaux(V, F, A=None, N=None, point=(0, 0, 0), normal=(1, 0, 0), garder='pos', mode='full', stamps=None):
    """Coeur de l'outil, sur des tableaux. V (n,3), F (m,3) entiers, A (n,k) attributs a interpoler (UV, couleurs),
    N (n,3) normales ou None. Rend (V, F, A, N, stats) ; stats = {gardees, miroir, retirees}. Leve ValueError si rien
    n'est du cote conserve."""
    import numpy as np
    V = np.asarray(V, dtype=np.float64)
    F = np.asarray(F, dtype=np.int64)
    A = None if A is None else np.asarray(A, dtype=np.float64)
    N = None if N is None else np.asarray(N, dtype=np.float64)
    point = np.asarray(point, dtype=np.float64)
    nn = np.asarray(normal, dtype=np.float64)
    ln = float(np.linalg.norm(nn))
    if not np.isfinite(ln) or ln < 1e-12:
        raise ValueError('The symmetry plane is not valid.')
    nn = nn / ln
    if str(garder).lower().startswith('neg'):
        nn = -nn                                    # le cote conserve devient le cote « positif »
    diag = float(np.linalg.norm(V.max(axis=0) - V.min(axis=0))) if len(V) else 1.0
    eps = max(diag, 1e-9) * 1e-6
    stats = {'gardees': 0, 'miroir': 0, 'retirees': 0}
    if str(mode).lower() != 'mask':
        Vc, Fc, Ac, Nc, sur, plats = _couper_demi_espace(V, F, A, N, point, nn, eps)
        if not len(Fc):
            raise ValueError('Nothing to mirror: the kept side of the plane has no surface.')
        Vc, Fm, Am, Nm, Vm, Nc = _miroir(Vc, Fc, Ac, Nc, sur, plats, point, nn, True)
        Vo = np.concatenate([Vc, Vm])
        Fo = np.concatenate([Fc, Fm, plats]).astype(np.int64)
        Ao = None if Ac is None else np.concatenate([Ac, Am])
        No = None if Nc is None else np.concatenate([Nc, Nm])
        stats.update(gardees=len(Fc) + len(plats), miroir=len(Fm))
        return Vo, Fo, Ao, No, stats
    # ---- mode zone : on ajoute la copie miroir des faces peintes (cote conserve) et on retire, de l'autre cote,
    # les faces qui tombent sous la zone miroir.
    stamps = list(stamps or [])
    if not stamps:
        raise ValueError('Paint the area to mirror first.')
    C = V[F].mean(axis=1)
    dC = (C - point) @ nn
    sel = region_faces(C, stamps) & (dC > 0)
    if not sel.any():
        raise ValueError('Paint the area to mirror first.')
    retire = region_faces(C, stamps, (point, nn)) & (dC < 0)
    Vc, Fc, Ac, Nc, sur, plats = _couper_demi_espace(V, F[sel], A, N, point, nn, eps)
    if not len(Fc):
        raise ValueError('Nothing to mirror: the painted area is not on the kept side of the plane.')
    _, Fm, Am, Nm, Vm, _ = _miroir(Vc, Fc, Ac, Nc, sur, np.zeros((0, 3), dtype=np.int64), point, nn, False)
    Fb = F[~retire]
    ub = np.zeros(len(V), dtype=bool)
    ub[Fb.ravel()] = True
    rb = -np.ones(len(V), dtype=np.int64)
    rb[ub] = np.arange(int(ub.sum()))
    Vb, Ab, Nb = V[ub], (None if A is None else A[ub]), (None if N is None else N[ub])
    Fb = rb[Fb]
    nb = len(Vb)
    Vo = np.concatenate([Vb, Vm])
    Fo = np.concatenate([Fb, Fm - len(Vc) + nb]).astype(np.int64)   # les sommets miroir suivent ceux du reste du maillage
    Ao = None if Ab is None else np.concatenate([Ab, Am])
    No = None if Nb is None else np.concatenate([Nb, Nm])
    stats.update(gardees=len(Fb), miroir=len(Fm), retirees=int(retire.sum()))
    return Vo, Fo, Ao, No, stats


def _cuire(scene):
    """Scene -> scene dont chaque noeud est a l'identite (transformations cuites dans les sommets)."""
    import trimesh
    if not isinstance(scene, trimesh.Scene):
        return scene
    plat = trimesh.Scene()
    vus = {}
    for noeud in scene.graph.nodes_geometry:
        T, g = scene.graph[noeud]
        m = scene.geometry[g].copy()
        m.apply_transform(T)
        n = vus.get(g, 0)
        vus[g] = n + 1
        plat.add_geometry(m, node_name=noeud, geom_name=g if n == 0 else f'{g}_{n}')
    return plat


def symetriser_scene(scene, params):
    """Applique la symetrie a chaque maillage de la scene (noeuds cuits). Rend (scene, stats). Les UV, le materiau et
    les couleurs de sommet du cote source sont repris tels quels. Leve ValueError si rien n'est a recopier."""
    import numpy as np
    import trimesh
    p = params or {}
    scene = _cuire(scene)
    geoms = scene.geometry if hasattr(scene, 'geometry') else {'mesh': scene}
    sortie = trimesh.Scene()
    total = {'gardees': 0, 'miroir': 0, 'retirees': 0}
    n_ok = 0
    dernier = None
    masque = str(p.get('mode', 'full')).lower() == 'mask'
    for nom, g in geoms.items():
        if not hasattr(g, 'faces') or len(g.faces) == 0:
            continue
        vis = g.visual
        uv = getattr(vis, 'uv', None) if getattr(vis, 'kind', None) == 'texture' else None
        col = None
        if getattr(vis, 'kind', None) == 'vertex':
            try:
                col = np.asarray(vis.vertex_colors, dtype=np.float64)
            except Exception:
                col = None
        attrs = [a for a in (uv, col) if a is not None]
        A = np.concatenate([np.asarray(a, dtype=np.float64) for a in attrs], axis=1) if attrs else None
        N = np.asarray(g.vertex_normals, dtype=np.float64) if 'vertex_normals' in g._cache.cache else None
        try:
            V, F, A2, N2, st = symetriser_tableaux(
                g.vertices, g.faces, A, N, p.get('point', (0, 0, 0)), p.get('normal', (1, 0, 0)),
                p.get('keep', 'pos'), p.get('mode', 'full'), p.get('stamps'))
        except ValueError as e:
            dernier = e
            if masque and len(geoms) > 1 and p.get('stamps') and ('Paint the area' in str(e) or 'Nothing to mirror' in str(e)):
                # zone peinte absente de cette piece : elle reste telle quelle (sa part de la zone, s'il y en a, est ailleurs)
                sortie.add_geometry(g.copy(), node_name=nom, geom_name=nom)
                continue
            if 'Nothing to mirror' in str(e) and len(geoms) > 1:
                continue            # une autre piece du modele a de la matiere de ce cote
            raise
        for k in total:
            total[k] += st[k]
        n_ok += 1
        m = trimesh.Trimesh(vertices=V, faces=F, process=False)
        if N2 is not None:
            m.vertex_normals = _normaliser(N2)
        if uv is not None:
            m.visual = trimesh.visual.TextureVisuals(uv=A2[:, :2], material=vis.material)
        elif col is not None:
            m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=np.clip(A2[:, -4:], 0, 255).astype(np.uint8))
        m.metadata = dict(getattr(g, 'metadata', {}) or {})
        sortie.add_geometry(m, node_name=nom, geom_name=nom)
    if not n_ok:
        if masque and dernier is not None:
            raise dernier
        raise ValueError('Nothing to mirror: the kept side of the plane has no surface.')
    return sortie, total
# --- NOYAU PARTAGE : FIN ---


def symetriser(glb_bytes: bytes, params: dict | None = None):
    """GLB -> (GLB symetrise, statistiques). Leve RuntimeError (message montre a l'utilisateur) si le maillage est pese ou
    anime, ou si rien n'est du cote conserve. La carte de normales est retiree : elle est tangente aux UV d'origine et
    ne vaut plus pour la moitie miroir."""
    import io
    import trimesh
    from modal_app import _mesh_op
    refus = refus_glb(glb_bytes)
    if refus:
        raise RuntimeError(refus)       # RuntimeError : Modal repond 422 et le worker montre ce texte (voir app.py mesh_start)
    scene = trimesh.load(io.BytesIO(glb_bytes), file_type='glb', force='scene')
    try:
        res, st = symetriser_scene(scene, params or {})
    except ValueError as e:
        raise RuntimeError(str(e))
    return _mesh_op._export(res, carte_normales=False), st
