"""Completion GENERIQUE d'un squelette produit par le rigger IA : aucune
connaissance de l'espece. On detecte les extremites reelles du maillage
(tronc = ce qui survit a une erosion ; appendices = branches geodesiques qui
en partent), puis :
  * une chaine de l'IA qui s'arrete avant le bout est PROLONGEE jusqu'a
    l'extremite, avec l'espacement d'os de l'IA elle-meme ;
  * une extremite sans aucun os recoit une NOUVELLE chaine, rattachee a
    l'articulation la plus proche ; plusieurs nouvelles chaines qui partent du
    meme endroit (tete : museau, oreilles, cornes) partagent un moyeu commun.
Les joints sont poses sur la LIGNE MEDIANE des membres (centre de section),
pas sur leur bord.

Usage : python completer_squelette.py maillage.glb rig_ia.glb sortie.json
"""
import os, sys, json, collections
import numpy as np
import trimesh
from scipy import ndimage

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'modal_app'))
import _unimate_moteur as um

PORTEE_OK = 0.9          # au-dela, la chaine est jugee complete


def volume(chemin_glb, resolution=220):
    m = trimesh.load(chemin_glb).to_geometry()
    ext = float(np.ptp(m.vertices, axis=0).max())
    vg = m.voxelized(ext / resolution)
    M = np.asarray(vg.transform)
    coque = vg.matrix
    compte = np.zeros(coque.shape, np.uint8)
    for ax in range(3):
        compte += np.maximum.accumulate(coque, axis=ax).astype(np.uint8)
        compte += np.flip(np.maximum.accumulate(np.flip(coque, ax), axis=ax), ax).astype(np.uint8)
    plein = coque | (compte >= 5)
    return plein, M, ext


def appendices(plein, M):
    """Chemins voxel (indices) tronc -> pointe, par distance geodesique."""
    dist = ndimage.distance_transform_edt(plein)
    sh = plein.shape
    seuil = max(3.0, 0.3 * float(dist.max()))
    lab, _ = ndimage.label(dist > seuil)
    t = np.bincount(lab.ravel()); t[0] = 0
    tronc = ndimage.binary_dilation(lab == t.argmax(), iterations=int(seuil) + 1) & plein
    autour = ndimage.binary_dilation(tronc, iterations=3)
    reste = plein & ~autour
    depart = reste & ndimage.binary_dilation(autour, iterations=1)
    vois = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]
    dg = np.full(sh, -1, np.int32); pred = {}
    f = collections.deque()
    for v in map(tuple, np.argwhere(depart)):
        dg[v] = 0; pred[v] = None; f.append(v)
    while f:
        u = f.popleft()
        for d in vois:
            v = (u[0] + d[0], u[1] + d[1], u[2] + d[2])
            if 0 <= v[0] < sh[0] and 0 <= v[1] < sh[1] and 0 <= v[2] < sh[2] and reste[v] and dg[v] < 0:
                dg[v] = dg[u] + 1; pred[v] = u; f.append(v)
    if dg.max() <= 0:
        return [], dist, tronc
    maxloc = ndimage.maximum_filter(np.where(dg >= 0, dg, -1), size=5) == dg
    cand = sorted(map(tuple, np.argwhere(maxloc & (dg > 0.25 * dg.max()))), key=lambda v: -dg[v])
    consomme = np.zeros(sh, bool); traces = np.zeros(sh, bool); dtr = None
    res = []
    for v in cand:
        if consomme[v]:
            continue
        c = []
        u = v
        while u is not None:
            c.append(u); u = pred[u]
        propre = next((i for i, w in enumerate(c) if consomme[w]), len(c))
        if propre < 12 or propre < 0.9 * dg[v]:
            continue
        if res and dtr[v] <= 15:
            continue
        res.append(np.array(c[::-1]))
        tr = np.zeros(sh, bool); tr[tuple(np.array(c).T)] = True
        consomme |= ndimage.binary_dilation(tr, iterations=3)
        traces |= tr
        dtr = ndimage.distance_transform_edt(~traces)
    return res, dist, tronc


def ligne_mediane(chemin_vox, plein, dist):
    """Recentre un chemin voxel sur le centre de section du membre : chaque
    point est remplace par le barycentre des voxels pleins d'une tranche
    perpendiculaire a la direction locale du chemin."""
    P = chemin_vox.astype(float)
    n = len(P)
    pts_pleins = np.argwhere(plein)
    arbre = __import__('scipy.spatial', fromlist=['cKDTree']).cKDTree(pts_pleins)
    out = np.empty_like(P)
    for i in range(n):
        a, b = P[max(0, i - 3)], P[min(n - 1, i + 3)]
        t = b - a
        t = t / (np.linalg.norm(t) or 1.0)
        rayon = max(2.0, 2.5 * float(dist[tuple(chemin_vox[i])]) + 2.0)
        idx = arbre.query_ball_point(P[i], rayon)
        if not idx:
            out[i] = P[i]; continue
        q = pts_pleins[idx].astype(float)
        tranche = q[np.abs((q - P[i]) @ t) <= 1.0]
        out[i] = tranche.mean(0) if len(tranche) else P[i]
    # lissage leger
    k = 3
    lisse = np.array([out[max(0, i - k):i + k + 1].mean(0) for i in range(n)])
    lisse[-1] = out[-1]
    return lisse


def abscisse(P):
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])


def point_a(P, s_cible):
    s = abscisse(P)
    return np.array([np.interp(s_cible, s, P[:, k]) for k in range(3)])


def main():
    plein, M, ext = volume(sys.argv[1])
    monde = lambda ijk: (M[:3, :3] @ np.atleast_2d(ijk).astype(float).T).T + M[:3, 3]
    chemins, dist, tronc = appendices(plein, M)
    apps = [monde(ligne_mediane(c, plein, dist)) for c in chemins]
    print(f'{len(apps)} extremites')

    js, bn = um.lire_glb(open(sys.argv[2], 'rb').read())
    joints = js['skins'][0]['joints']
    W, pn = um.matrices_monde(js)
    par = um.MoteurUniMate._parents_joints(joints, pn)
    idx = {n: i for i, n in enumerate(joints)}
    J = [W[n][:3, 3].copy() for n in joints]
    parents = [idx[par[n]] if par[n] is not None else -1 for n in joints]
    noms = [js['nodes'][n].get('name', f'bone_{i}') for i, n in enumerate(joints)]
    n_ia = len(J)
    longueurs_os = [np.linalg.norm(J[j] - J[p]) for j, p in enumerate(parents) if p >= 0]
    pas_global = float(np.median(longueurs_os)) if longueurs_os else 0.1 * ext

    rapport = []
    nouvelles = []   # (appendice, s_depart, pas) a creer ensuite pour le moyeu
    for a_i, P in sorted(enumerate(apps), key=lambda t: -abscisse(t[1])[-1]):
        s = abscisse(P); L = s[-1]
        Jarr = np.array(J)
        d = np.linalg.norm(Jarr[:, None, :] - P[None, :, :], axis=2)
        rayon = max(0.03 * ext, 1.5 * float(np.median([dist[tuple(np.round(np.linalg.inv(M)[:3, :3] @ p + np.linalg.inv(M)[:3, 3]).astype(int).clip(0, np.array(plein.shape) - 1))] for p in P[::5]])) * (ext / 220.0))
        proches = np.where(d.min(axis=1) < rayon)[0]
        if len(proches):
            s_j = s[d[proches].argmin(axis=1)]
            k = int(np.argmax(s_j)); dernier = int(proches[k]); s_max = float(s_j[k])
        else:
            dernier, s_max = None, 0.0
        portee = s_max / L if L > 0 else 1.0
        if portee >= PORTEE_OK:
            rapport.append((a_i, round(portee, 2), 'complete', 0)); continue
        if dernier is not None and portee >= 0.15:
            # PROLONGER : meme espacement que les os de l'IA sur ce membre
            s_tries = np.sort(s_j)
            pas = float(np.median(np.diff(s_tries))) if len(s_tries) > 1 else pas_global
            pas = max(pas, 0.02 * ext)
            n_new = max(1, int(round((L - s_max) / pas)))
            parent = dernier
            for q in range(1, n_new + 1):
                J.append(point_a(P, s_max + q * (L - s_max) / n_new))
                parents.append(parent); noms.append(f'ext_{a_i}_{q}')
                parent = len(J) - 1
            rapport.append((a_i, round(portee, 2), 'prolongee', n_new))
        else:
            nouvelles.append((a_i, P))
            rapport.append((a_i, round(portee, 2), 'nouvelle', None))

    # NOUVELLES CHAINES : moyeu commun quand plusieurs partent du meme endroit
    groupes = []
    for a_i, P in nouvelles:
        for g in groupes:
            if np.linalg.norm(g['attache'] - P[0]) < 0.08 * ext:
                g['membres'].append((a_i, P)); g['attache'] = np.mean([m[1][0] for m in g['membres']], axis=0); break
        else:
            groupes.append({'attache': P[0].copy(), 'membres': [(a_i, P)]})
    # Rattachement : de preference a un os DU TRONC (un pedipalpe qui nait
    # pres de la base d'une patte ne doit pas pendre a cette patte).
    inv = np.linalg.inv(M)
    tronc_large = ndimage.binary_dilation(tronc, iterations=2)

    def dans_tronc(p):
        ijk = np.round(inv[:3, :3] @ p + inv[:3, 3]).astype(int)
        if np.any(ijk < 0) or np.any(ijk >= np.array(plein.shape)):
            return False
        return bool(tronc_large[tuple(ijk)])

    def parent_pour(point):
        Jarr = np.array(J)
        d = np.linalg.norm(Jarr - point, axis=1)
        candidats = [j for j in range(len(J)) if dans_tronc(J[j])]
        if candidats:
            return int(min(candidats, key=lambda j: d[j]))
        return int(np.argmin(d))

    for g in groupes:
        parent = parent_pour(g['attache'])
        if len(g['membres']) > 1:
            J.append(g['attache'].copy()); parents.append(parent); noms.append(f'moyeu_{len(J)}')
            parent = len(J) - 1
        for a_i, P in g['membres']:
            L = abscisse(P)[-1]
            n_new = max(2, int(round(L / pas_global)))
            p = parent
            debut = 0 if len(g['membres']) == 1 else 1
            for q in range(debut, n_new + 1):
                J.append(point_a(P, q * L / n_new)); parents.append(p); noms.append(f'app_{a_i}_{q}')
                p = len(J) - 1
            for r in rapport:
                if r[0] == a_i:
                    rapport[rapport.index(r)] = (a_i, r[1], 'nouvelle', n_new + 1 - debut)

    # TRONC SANS OS (abdomen d'araignee, tete epaisse...) : les zones du tronc
    # loin de tout os recoivent une chaine centre -> bout, rattachee a l'os le
    # plus proche. « Loin » = plus de la moitie de l'epaisseur max du tronc.
    pas_vox = ext / 220.0
    # seul le COEUR du tronc est teste : la surface d'une partie epaisse est
    # forcement loin de l'os qui la traverse, son centre ne doit pas l'etre
    coeur = tronc & (dist > 0.5 * float(dist.max()))
    pts_tronc = monde(np.argwhere(coeur))
    n_coeur = max(1, len(pts_tronc))
    rayon_tronc = float(dist.max()) * pas_vox
    zones = []
    for _ in range(4):
        if len(pts_tronc) == 0:
            break
        Jarr = np.array(J)
        segs = [(Jarr[p], Jarr[j]) for j, p in enumerate(parents) if p >= 0]
        A = np.array([s[0] for s in segs]); B = np.array([s[1] for s in segs])
        dmin = np.full(len(pts_tronc), np.inf)
        for k0 in range(0, len(segs), 64):
            a, b = A[k0:k0 + 64], B[k0:k0 + 64]
            ab = b - a
            t = np.clip(((pts_tronc[:, None, :] - a[None]) * ab[None]).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-12)[None], 0, 1)
            proj = a[None] + t[..., None] * ab[None]
            dmin = np.minimum(dmin, np.linalg.norm(pts_tronc[:, None, :] - proj, axis=2).min(axis=1))
        # plus loin que l'EPAISSEUR du tronc : le ventre d'un quadrupede est a
        # ~1 rayon de sa colonne (qui longe le dos) sans manquer d'os ; un
        # abdomen d'araignee, lui, est a plus de 2 rayons de tout os.
        loin = dmin > 1.2 * rayon_tronc
        if loin.sum() < 0.05 * n_coeur:
            break
        # La zone = le BLOC entier du coeur (composante connexe) qui contient
        # le plus de voxels « loin » : sa calotte seule est plus large que
        # longue et donnait un axe en travers de l'abdomen.
        ijk_tronc = np.argwhere(coeur)
        lab_c, _ = ndimage.label(coeur)
        blocs = lab_c[tuple(ijk_tronc[loin].T)]
        if len(blocs) == 0:
            break
        bloc = int(np.bincount(blocs).argmax())
        zone = monde(np.argwhere(lab_c == bloc))
        # (tout le bloc est desormais couvert : on le retire du test suivant)
        coeur = coeur & (lab_c != bloc)
        pts_tronc = monde(np.argwhere(coeur)) if coeur.any() else pts_tronc[:0]
        # residu trop petit devant la premiere zone : on s'arrete (sinon les
        # flancs d'un gros abdomen recoivent chacun une branche, en etoile)
        if len(zone) < 0.05 * n_coeur or (zones and len(zone) < 0.3 * zones[0]):
            break
        # chaine le long de l'AXE PRINCIPAL de la zone : bout proche -> centre -> bout loin
        centre = zone.mean(0)
        parent = parent_pour(centre)
        _, _, vt = np.linalg.svd(zone - centre, full_matrices=False)
        axe = vt[0]
        proj = (zone - centre) @ axe
        e1, e2 = centre + proj.min() * axe, centre + proj.max() * axe
        proche, loin_ = (e1, e2) if np.linalg.norm(e1 - J[parent]) < np.linalg.norm(e2 - J[parent]) else (e2, e1)
        for nom_p, p in (('debut', proche), ('centre', centre), ('bout', loin_)):
            J.append(p); parents.append(parent); noms.append(f'tronc_{len(zones)}_{nom_p}')
            parent = len(J) - 1
        zones.append(len(zone))
    if zones:
        print(f'zones du tronc sans os completees : {len(zones)} ({zones} voxels)')

    print(f'os IA {n_ia} -> complete {len(J)} (+{len(J) - n_ia})')
    for r in sorted(rapport):
        print(f'  extremite {r[0]:2d} : portee IA {r[1]:.2f} -> {r[2]}' + (f' (+{r[3]} os)' if r[3] else ''))
    json.dump({'joints': np.round(np.array(J), 5).tolist(), 'parents': parents, 'noms': noms,
               'n_ia': n_ia, 'extremites': [np.round(P[-1], 4).tolist() for P in apps],
               'lignes': [np.round(P[::4], 4).tolist() for P in apps]},
              open(sys.argv[3], 'w'))


if __name__ == '__main__':
    main()
