"""Note de COMPLETUDE generique d'un ou plusieurs rigs, sans rien savoir de
l'espece : on detecte les appendices reels du maillage (tronc = ce qui survit
a l'erosion ; appendices = branches geodesiques longues qui en partent), puis
on mesure jusqu'ou les os parcourent chacun (0 = aucun os, 1 = jusqu'au bout).

Usage : python noter_rigs.py maillage.glb rig1.glb [rig2.glb ...]
"""
import os, sys, collections
import numpy as np
import trimesh
from scipy import ndimage

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'modal_app'))
import _unimate_moteur as um


def appendices(chemin_glb, resolution=220):
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
    dist = ndimage.distance_transform_edt(plein)
    sh = plein.shape
    monde = lambda ijk: (M[:3, :3] @ np.atleast_2d(ijk).astype(float).T).T + M[:3, 3]
    # tronc : plus grosse composante survivant a une erosion proportionnelle
    # a l'epaisseur max (generique : pas de seuil propre a une espece)
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
        return [], ext
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
        P = monde(np.array(c[::-1]))
        res.append(P)
        tr = np.zeros(sh, bool); tr[tuple(np.array(c).T)] = True
        consomme |= ndimage.binary_dilation(tr, iterations=3)
        traces |= tr
        dtr = ndimage.distance_transform_edt(~traces)
    return res, ext


def os_du_rig(chemin_glb, boite_ref):
    """Positions des os, ramenees dans le repere du maillage de reference :
    un rig dont le transfert a echoue sort dans le repere NORMALISE du moteur
    (autre centre, autre echelle) — alignement par boite englobante."""
    js, bn = um.lire_glb(open(chemin_glb, 'rb').read())
    joints = js['skins'][0]['joints']
    W, _ = um.matrices_monde(js)
    o = np.array([W[n][:3, 3] for n in joints])
    sc = trimesh.load(chemin_glb)
    g = sc.to_geometry() if hasattr(sc, 'to_geometry') else sc
    lo, hi = np.asarray(g.bounds[0]), np.asarray(g.bounds[1])
    lo_r, hi_r = boite_ref
    e, e_r = float(np.ptp([lo, hi], axis=0).max()), float(np.ptp([lo_r, hi_r], axis=0).max())
    if abs(e / e_r - 1) > 0.02 or np.linalg.norm((lo + hi) / 2 - (lo_r + hi_r) / 2) > 0.02 * e_r:
        o = (o - (lo + hi) / 2) * (e_r / e) + (lo_r + hi_r) / 2
        print(f'   ({chemin_glb.split(chr(92))[-1].split("/")[-1]} : repere different, realigne)')
    return o


def portee(P, os_pos, rayon):
    """Fraction de la longueur de l'appendice P atteinte par des os proches."""
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    if s[-1] <= 0 or len(os_pos) == 0:
        return 0.0
    d = np.linalg.norm(os_pos[:, None, :] - P[None, :, :], axis=2)   # (os, points)
    proches = d.min(axis=1) < rayon
    if not proches.any():
        return 0.0
    idx = d[proches].argmin(axis=1)
    return float(s[idx].max() / s[-1])


def main():
    app, ext = appendices(sys.argv[1])
    print(f'{len(app)} appendices detectes (longueurs', [round(float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum()), 2) for P in app], ')')
    ref = trimesh.load(sys.argv[1]).to_geometry()
    boite = (np.asarray(ref.bounds[0]), np.asarray(ref.bounds[1]))
    rayon = 0.03 * ext
    for f in sys.argv[2:]:
        o = os_du_rig(f, boite)
        p = [portee(P, o, rayon) for P in app]
        complets = sum(x >= 0.85 for x in p)
        rates = sum(x < 0.3 for x in p)
        print(f'{f.split("/")[-1].split(chr(92))[-1]:28s} os {len(o):3d} | portee moyenne {np.mean(p):.2f} | '
              f'complets {complets}/{len(p)} | rates {rates} | ' + ' '.join(f'{x:.2f}' for x in p))


if __name__ == '__main__':
    main()
