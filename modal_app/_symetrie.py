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


def grille_centres(centres, stamps):
    """Index spatial des centres de faces (grille uniforme, numpy seul) : cellule = rayon median des tampons. Les centres
    sont tries par numero de cellule ((ix, iy) puis iz) : pour un tampon, chaque rangee (ix, iy) de cellules voisines est
    UNE tranche contigue du tableau trie."""
    import numpy as np
    mn = centres.min(axis=0)
    ext = float((centres.max(axis=0) - mn).max())
    rs = np.array([float(s[3]) for s in stamps], dtype=np.float64)
    h = max(float(np.median(rs)) if len(rs) else 0.0, ext / 128.0, 1e-12)
    dims = np.floor((centres.max(axis=0) - mn) / h).astype(np.int64) + 1
    cel = np.minimum(np.floor((centres - mn) / h).astype(np.int64), dims - 1)
    cle = (cel[:, 0] * dims[1] + cel[:, 1]) * dims[2] + cel[:, 2]
    ordre = np.argsort(cle, kind='stable')
    return {'mn': mn, 'mx': centres.max(axis=0), 'h': h, 'dims': dims, 'ordre': ordre, 'cles': cle[ordre]}


def region_faces(centres, stamps, reflechir=None, grille=None):
    """Faces dont le CENTRE tombe dans la zone peinte : tampons appliques dans l'ordre, un tampon « peindre » (s=1)
    allume les faces dans sa sphere, un tampon « gommer » (s=0) les eteint. reflechir = (point, normale unitaire) :
    les centres des tampons sont d'abord reflechis par le plan (zone miroir). grille = rendu de grille_centres (a
    construire une fois pour les deux appels) : chaque tampon ne regarde que les cellules qu'il touche."""
    import numpy as np
    sel = np.zeros(len(centres), dtype=bool)
    stamps = list(stamps or [])
    if not len(centres) or not stamps:
        return sel
    if grille is None:
        grille = grille_centres(centres, stamps)
    mn, mx, h, dims = grille['mn'], grille['mx'], grille['h'], grille['dims']
    ordre, cles = grille['ordre'], grille['cles']
    nx, ny, nz = int(dims[0]), int(dims[1]), int(dims[2])
    # Du DERNIER tampon au premier : une face est decidee par le dernier tampon qui la couvre, on ne teste donc que
    # les faces encore indecises (un long trait de pinceau recouvre chaque face des centaines de fois).
    decide = np.zeros(len(centres), dtype=bool)
    for s in reversed(stamps):
        c = np.array(s[:3], dtype=np.float64)
        if reflechir is not None:
            p, nn = reflechir
            c = c - 2.0 * float(np.dot(c - p, nn)) * nn
        r = float(s[3])
        m = r * (1.0 + 1e-9) + 1e-12
        lo, hi = c - m, c + m
        if np.any(hi < mn) or np.any(lo > mx):
            continue
        c0 = np.clip(np.floor((lo - mn) / h).astype(np.int64), 0, dims - 1)
        c1 = np.clip(np.floor((hi - mn) / h).astype(np.int64), 0, dims - 1)
        ix = np.arange(c0[0], c1[0] + 1, dtype=np.int64)
        iy = np.arange(c0[1], c1[1] + 1, dtype=np.int64)
        base = ((ix[:, None] * ny + iy[None, :]) * nz).ravel()
        deb = np.searchsorted(cles, base + c0[2], side='left')
        fin = np.searchsorted(cles, base + c1[2], side='right')
        lg = fin - deb
        tot = int(lg.sum())
        if tot <= 0:
            continue
        pos = np.arange(tot, dtype=np.int64) + np.repeat(deb - (np.cumsum(lg) - lg), lg)
        idx = ordre[pos]
        idx = idx[~decide[idx]]
        if not len(idx):
            continue
        dd = centres[idx] - c
        dedans = idx[(dd * dd).sum(axis=1) <= r * r]
        decide[dedans] = True
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


def _bord_dirige(F, M):
    """Aretes dirigees (a -> b) qui n'ont pas de voisine inverse (b -> a) : le bord du maillage, dans le sens des faces."""
    import numpy as np
    if not len(F):
        return np.zeros((0, 2), dtype=np.int64)
    F = np.asarray(F, dtype=np.int64)
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], axis=0)
    cles = E[:, 0] * M + E[:, 1]
    return E[~_dans(E[:, 1] * M + E[:, 0], np.sort(cles))]


def _defauts_bord(F, M):
    """Nombre d'aretes dirigees sans voisine inverse (bord ouvert) ou portees par plusieurs faces (non manifold)."""
    import numpy as np
    if not len(F):
        return 0
    F = np.asarray(F, dtype=np.int64)
    cles = np.sort(np.concatenate([F[:, 0] * M + F[:, 1], F[:, 1] * M + F[:, 2], F[:, 2] * M + F[:, 0]]))
    inv = np.concatenate([F[:, 1] * M + F[:, 0], F[:, 2] * M + F[:, 1], F[:, 0] * M + F[:, 2]])
    return int((~_dans(inv, cles)).sum()) + int((cles[1:] == cles[:-1]).sum())


def _dans(cles, tries):
    """cles[i] figure-t-il dans le tableau TRIE `tries` ? (recherche dichotomique, bien plus vite que np.isin sur 1 M)"""
    import numpy as np
    if not len(tries):
        return np.zeros(len(cles), dtype=bool)
    k = np.minimum(np.searchsorted(tries, cles), len(tries) - 1)
    return tries[k] == cles


def combler_ilots(F, region, M, permis, limite=40):
    """Regularise la zone avant la couture. (1) Un petit ILOT de faces non retenues qu'elle entoure completement (au plus
    `limite` faces, de voisine en voisine par les aretes) est ajoute a la zone : il ferait une boucle de bord de plus, sans
    vis-a-vis de l'autre cote. (2) Un sommet PINCE (le bord de la zone le touche deux fois) fait ajouter les faces qui
    l'entourent : une boucle qui se croise ne se relie pas proprement a sa copie. Seules les faces `permis` (bool) sont
    ajoutees ; quelques passes. Rend une copie de region."""
    import numpy as np
    region = region.copy()
    vert = F.ravel()
    ordre = None
    for _ in range(4):
        E = _bord_trou(F, region, M)
        if not len(E):
            break
        if ordre is None:
            ordre = np.argsort(vert, kind='stable')
            debuts = np.searchsorted(vert[ordre], np.arange(M + 1))

            def autour(v):
                return ordre[debuts[v]:debuts[v + 1]] // 3

        ajout = set()
        sommets, nb = np.unique(E[:, 0], return_counts=True)
        for x in sommets[nb > 1].tolist():
            for f in autour(x).tolist():
                if not region[f]:
                    ajout.add(f)
        for boucle in _boucles(E):
            if len(boucle) > 2 * limite + 2:
                continue
            graines = set()
            for i in range(len(boucle)):
                x, y = boucle[i], boucle[(i + 1) % len(boucle)]
                for f in autour(x).tolist():
                    if region[f]:
                        continue
                    t = F[f]
                    if (t[0] == x and t[1] == y) or (t[1] == x and t[2] == y) or (t[2] == x and t[0] == y):
                        graines.add(f)
            vus = set(graines)
            pile = list(graines)
            trop = False
            while pile:
                f = pile.pop()
                t = F[f].tolist()
                for k in range(3):
                    x, y = t[k], t[(k + 1) % 3]
                    for g in autour(x).tolist():
                        if g in vus or region[g]:
                            continue
                        if y in F[g].tolist():
                            vus.add(g)
                            pile.append(g)
                if len(vus) > limite:
                    trop = True
                    break
            if not trop:
                ajout |= vus
        ajout = [f for f in ajout if permis[f]]
        if not ajout:
            break
        region[ajout] = True
    return region


def _bord_trou(F, retire, M):
    """Aretes dirigees des faces GARDEES dont l'arete inverse appartient a une face retiree : le bord du trou, sans les
    bords deja presents dans le maillage d'origine. Indices d'origine."""
    import numpy as np
    if not retire.any():
        return np.zeros((0, 2), dtype=np.int64)
    R = F[retire]
    toucher = np.zeros(M, dtype=bool)
    toucher[R.ravel()] = True
    K = F[~retire]
    K = K[toucher[K].any(axis=1)]                     # seules les faces gardees qui touchent le trou comptent
    if not len(K):
        return np.zeros((0, 2), dtype=np.int64)
    ER = np.concatenate([R[:, [0, 1]], R[:, [1, 2]], R[:, [2, 0]]], axis=0)
    EK = np.concatenate([K[:, [0, 1]], K[:, [1, 2]], K[:, [2, 0]]], axis=0)
    return EK[_dans(EK[:, 1] * M + EK[:, 0], np.sort(ER[:, 0] * M + ER[:, 1]))]


def _boucles(E):
    """Chaines fermees d'aretes dirigees -> listes de sommets. Une chaine rompue (bord non manifold) est abandonnee."""
    suiv = {}
    for a, b in E.tolist():
        suiv.setdefault(a, []).append(b)
    boucles = []
    for a in list(suiv.keys()):
        while suiv.get(a):
            chemin = [a]
            cur = a
            ferme = False
            while True:
                if not suiv.get(cur):
                    break
                nb = suiv[cur].pop()
                if nb == a:
                    ferme = True
                    break
                chemin.append(nb)
                cur = nb
            if ferme and len(chemin) >= 3:
                boucles.append(chemin)
    return boucles


def _distance_boucles(V, A, C):
    """Distance moyenne des sommets (echantillon) de la boucle C a la boucle A, et etendue de la plus grande des deux."""
    import numpy as np
    pa = V[np.asarray(A)]
    pc = V[np.asarray(C)]
    if len(pa) > 600:
        pa = pa[np.linspace(0, len(pa) - 1, 600).astype(np.int64)]
    if len(pc) > 300:
        pc = pc[np.linspace(0, len(pc) - 1, 300).astype(np.int64)]
    d = np.sqrt(((pc[:, None, :] - pa[None, :, :]) ** 2).sum(axis=2)).min(axis=1)
    etendue = max(float((V[np.asarray(A)].max(axis=0) - V[np.asarray(A)].min(axis=0)).max()),
                  float((V[np.asarray(C)].max(axis=0) - V[np.asarray(C)].min(axis=0)).max()))
    return float(d.mean()), etendue


def _zipper(V, A, C):
    """Bande de triangles entre la boucle A (bord du trou du maillage, dans le sens de ses faces) et la boucle C (bord de
    la copie miroir, dans le sens de ses faces) : chaque arete de bord recoit son arete inverse, la couture est fermee.
    Avance a chaque pas du cote qui donne la plus courte diagonale."""
    import numpy as np
    P = list(reversed(C))
    nA, nP = len(A), len(P)
    j0 = int(np.argmin(((V[np.asarray(P)] - V[A[0]]) ** 2).sum(axis=1)))
    P = P[j0:] + P[:j0]
    xa = V[np.asarray(A)]
    xp = V[np.asarray(P)]
    tris = []
    i = j = 0
    while i < nA or j < nP:
        if i == nA:
            av_a = False
        elif j == nP:
            av_a = True
        else:
            dA = float(((xa[(i + 1) % nA] - xp[j % nP]) ** 2).sum())
            dP = float(((xa[i % nA] - xp[(j + 1) % nP]) ** 2).sum())
            av_a = dA <= dP
        if av_a:
            tris.append((A[(i + 1) % nA], A[i % nA], P[j % nP]))
            i += 1
        else:
            tris.append((P[j % nP], P[(j + 1) % nP], A[i % nA]))
            j += 1
    return np.array(tris, dtype=np.int64).reshape(-1, 3)


def resorber_colineaires(V, corps, ponts):
    """Un triangle de la bande dont un sommet w tombe SUR l'arete (u, v) des deux autres (un sommet de la copie pose sur
    une arete du maillage, au croisement du plan) n'a pas d'aire : il serait ecarte par tout nettoyage et rouvrirait la
    couture. On le supprime et on COUPE en deux, en passant par w, la face voisine (v, u, c) qui porte l'arete inverse.
    Rend (corps, ponts) ; les moities supplementaires sont ajoutees a la fin de corps."""
    import numpy as np
    if not len(ponts):
        return corps, ponts
    P = V[ponts]
    e0, e1, e2 = P[:, 1] - P[:, 0], P[:, 2] - P[:, 1], P[:, 0] - P[:, 2]
    long2 = np.maximum(np.maximum((e0 * e0).sum(1), (e1 * e1).sum(1)), (e2 * e2).sum(1))
    air2 = (np.cross(e0, -e2) ** 2).sum(1)                       # (2 * aire)^2
    flat = (air2 <= 1e-12 * long2 * long2) & (long2 > 0)
    if not flat.any():
        return corps, ponts
    M = len(V)
    corps = corps.copy()
    # Pour chaque triangle plat (w, u, v), la face voisine (v, u, c) qui porte l'arete v -> u.
    cibles = []
    for k in np.nonzero(flat)[0]:
        t = ponts[k]
        pts = V[t]
        mid = None
        for m in range(3):
            d1, d2 = pts[(m + 1) % 3] - pts[m], pts[(m + 2) % 3] - pts[m]
            # w strictement entre les deux autres (un sommet confondu avec un autre n'est pas une jonction en T)
            if float(d1 @ d2) < 0 and float(d1 @ d1) > 1e-8 * float((d1 - d2) @ (d1 - d2)) and float(d2 @ d2) > 1e-8 * float((d1 - d2) @ (d1 - d2)):
                mid = m
        if mid is None:
            continue
        # t = (w, u, v) en ordre cyclique : la bande porte u -> v, la face voisine (v, u, c) porte v -> u
        cibles.append((int(k), int(t[mid]), int(t[(mid + 1) % 3]), int(t[(mid + 2) % 3])))
    if not cibles:
        return corps, ponts
    voulu = np.array(sorted({v * M + u for _, _, u, v in cibles}), dtype=np.int64)
    face_de = {}
    for col in range(3):
        cle = corps[:, col] * M + corps[:, (col + 1) % 3]
        for f in np.nonzero(_dans(cle, voulu))[0].tolist():
            face_de[int(cle[f])] = f
    gardes = np.ones(len(ponts), dtype=bool)
    ajouts = []
    touches = set()
    nC = len(corps)
    for k, w, u, v in cibles:
        f = face_de.get(v * M + u)
        if f is None:
            continue
        t = corps[f].tolist() if f < nC else ajouts[f - nC]
        col = [i for i in range(3) if t[i] == v and t[(i + 1) % 3] == u]
        if not col:
            continue
        a_, b_, c_ = t[col[0]], t[(col[0] + 1) % 3], t[(col[0] + 2) % 3]           # a_ = v, b_ = u
        nouveau = nC + len(ajouts)
        if f < nC:
            corps[f] = (a_, w, c_)
        else:
            ajouts[f - nC] = (a_, w, c_)
        ajouts.append((w, b_, c_))
        for cle, fi in ((a_ * M + w, f), (w * M + c_, f), (c_ * M + a_, f),
                        (w * M + b_, nouveau), (b_ * M + c_, nouveau), (c_ * M + w, nouveau)):
            face_de[cle] = fi
        touches.add(f)
        gardes[k] = False
    if ajouts:
        corps = np.concatenate([corps, np.array(ajouts, dtype=np.int64)], axis=0)
    ponts = ponts[gardes]
    # Un coin de face coupe peut redoubler, a l'envers, un triangle de la bande (meme trois sommets, sens opposes) : la
    # paire n'enferme rien et surcharge ses aretes (4 faces sur une arete) : on retire les deux.
    cand = [('c', i) for i in sorted(touches | set(range(nC, len(corps))))] + [('p', i) for i in range(len(ponts))]
    vus = {}
    for typ, i in cand:
        t = corps[i] if typ == 'c' else ponts[i]
        vus.setdefault(tuple(sorted(t.tolist())), []).append((typ, i, t.tolist()))
    sup_c, sup_p = [], []
    for liste in vus.values():
        if len(liste) != 2:
            continue
        t1, t2 = liste[0][2], liste[1][2]
        if any(t2 == t1[k:] + t1[:k] for k in range(3)):
            continue                                   # meme sens : un vrai doublon, on n'y touche pas
        for typ, i, _ in liste:
            (sup_c if typ == 'c' else sup_p).append(i)
    if sup_c:
        corps = np.delete(corps, sup_c, axis=0)
    if sup_p:
        ponts = np.delete(ponts, sup_p, axis=0)
    return corps, ponts


def relier_trou_et_copie(V, boucles_trou, boucles_copie):
    """Relie chaque boucle de la copie miroir a la boucle de trou la plus proche (1 pour 1, la plus proche d'abord) par
    une bande de triangles. Rend les triangles ajoutes (k, 3). Une boucle sans vis-a-vis (copie dans le vide) reste ouverte."""
    import numpy as np
    paires = []
    for ic, C in enumerate(boucles_copie):
        for ia, A in enumerate(boucles_trou):
            d, et = _distance_boucles(V, A, C)
            if d <= 0.5 * et:
                paires.append((d, ic, ia))
    paires.sort()
    pris_c, pris_a = set(), set()
    out = []
    for d, ic, ia in paires:
        if ic in pris_c or ia in pris_a:
            continue
        pris_c.add(ic)
        pris_a.add(ia)
        out.append(_zipper(V, boucles_trou[ia], boucles_copie[ic]))
    return np.concatenate(out, axis=0) if out else np.zeros((0, 3), dtype=np.int64)


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
    N (n,3) normales ou None. Rend (V, F, A, N, stats) ; stats = {gardees, miroir, retirees, ponts, ouvert} (ponts = faces de couture du mode zone, ouvert = aretes de bord
    que la couture n'a pas pu fermer). Leve ValueError si rien
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
    stats = {'gardees': 0, 'miroir': 0, 'retirees': 0, 'ponts': 0, 'ouvert': 0}
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
    grille = grille_centres(C, stamps)
    sel = combler_ilots(F, region_faces(C, stamps, None, grille) & (dC > 0), len(V), dC > 0)
    if not sel.any():
        raise ValueError('Paint the area to mirror first.')
    retire = combler_ilots(F, region_faces(C, stamps, (point, nn), grille) & (dC < 0), len(V), dC < 0)
    Vc, Fc, Ac, Nc, sur, plats = _couper_demi_espace(V, F[sel], A, N, point, nn, eps)
    if not len(Fc):
        raise ValueError('Nothing to mirror: the painted area is not on the kept side of the plane.')
    _, Fm, Am, Nm, Vm, _ = _miroir(Vc, Fc, Ac, Nc, sur, np.zeros((0, 3), dtype=np.int64), point, nn, False)
    Fb = F[~retire]
    # Bord du trou laisse par les faces retirees (hors bords deja presents dans le maillage d'origine), en indices d'origine.
    Eh = _bord_trou(F, retire, len(V))
    ub = np.zeros(len(V), dtype=bool)
    ub[Fb.ravel()] = True
    rb = -np.ones(len(V), dtype=np.int64)
    rb[ub] = np.arange(int(ub.sum()))
    Vb, Ab, Nb = V[ub], (None if A is None else A[ub]), (None if N is None else N[ub])
    Fb = rb[Fb]
    nb = len(Vb)
    Vo = np.concatenate([Vb, Vm])
    Fm = Fm - len(Vc) + nb                                          # les sommets miroir suivent ceux du reste du maillage
    # Couture : la copie n'a pas les memes sommets de bord que le trou ; une bande de triangles relie les deux bords.
    ponts = np.zeros((0, 3), dtype=np.int64)
    if len(Eh):
        Vo_ = np.concatenate([Vb, Vm])
        ponts = relier_trou_et_copie(Vo_, _boucles(rb[Eh]), _boucles(_bord_dirige(Fm, len(Vo_))))
    corps, ponts = resorber_colineaires(np.concatenate([Vb, Vm]), np.concatenate([Fb, Fm]).astype(np.int64), ponts)
    Fo = np.concatenate([corps, ponts]).astype(np.int64)
    Ao = None if Ab is None else np.concatenate([Ab, Am])
    No = None if Nb is None else np.concatenate([Nb, Nm])
    stats.update(gardees=len(Fb), miroir=len(Fm), retirees=int(retire.sum()), ponts=len(Fo) - len(Fb) - len(Fm),
                 ouvert=max(0, _defauts_bord(Fo, len(Vo)) - _defauts_bord(F, len(V))))
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
    total = {'gardees': 0, 'miroir': 0, 'retirees': 0, 'ponts': 0, 'ouvert': 0}
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
