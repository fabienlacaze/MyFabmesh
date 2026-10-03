"""Compare deux GLB rigges (avant / apres un outil de squelette ou de poids) : le maillage a-t-il bouge ? quelles articulations ont bouge, de combien ? les poids ont-ils change ?
Usage : python comparer_rigs.py <avant.glb> <apres.glb>  -> une ligne JSON. Aucune ecriture."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig_lib import Rig

a = Rig(sys.argv[1]); b = Rig(sys.argv[2])
r = {'avant': os.path.basename(sys.argv[1]), 'apres': os.path.basename(sys.argv[2])}
try:
    pa = [p for p in a.prims() if p['J'] is not None]; pb = [p for p in b.prims() if p['J'] is not None]
    r['sommets'] = [int(sum(len(p['P']) for p in pa)), int(sum(len(p['P']) for p in pb))]
    if r['sommets'][0] == r['sommets'][1]:
        Pa = np.vstack([p['P'] for p in pa]); Pb = np.vstack([p['P'] for p in pb])
        H = float(Pa[:, 1].max() - Pa[:, 1].min())
        # le maillage est-il identique au repos ? (positions de repos avec la peau au repos = positions du fichier)
        d = np.linalg.norm(Pa - Pb, axis=1)
        r['maillage_deplacement_max_rel'] = round(float(d.max() / H), 6); r['maillage_deplaces_pct'] = round(float(100 * (d > 1e-5 * H).mean()), 3)
        Wa = np.vstack([p['W'] for p in pa]); Wb = np.vstack([p['W'] for p in pb]); Ja = np.vstack([p['J'] for p in pa]); Jb = np.vstack([p['J'] for p in pb])
        r['poids_identiques'] = bool(np.allclose(Wa, Wb, atol=1e-4) and np.array_equal(Ja, Jb))
        if not r['poids_identiques']:
            # difference de masse par os
            nj = max(Ja.max(), Jb.max()) + 1
            ma = np.zeros(nj); mb = np.zeros(nj)
            for k in range(Ja.shape[1]): np.add.at(ma, Ja[:, k], Wa[:, k])
            for k in range(Jb.shape[1]): np.add.at(mb, Jb[:, k], Wb[:, k])
            n = min(nj, len(ma))
            r['poids_difference_masse_pct_max'] = round(float(100 * np.abs(ma - mb).max() / max(ma.sum(), 1)), 3)
            r['sommets_dont_le_poids_dominant_change_pct'] = round(float(100 * (Ja[np.arange(len(Ja)), Wa.argmax(1)] != Jb[np.arange(len(Jb)), Wb.argmax(1)]).mean()), 3)
    # articulations
    if a.skins and b.skins:
        ja = a.skins[0]['joints']; jb = b.skins[0]['joints']
        r['joints'] = [len(ja), len(jb)]
        if len(ja) == len(jb):
            Wa_ = a.world(); Wb_ = b.world()
            pos_a = np.array([Wa_[n][:3, 3] for n in ja]); pos_b = np.array([Wb_[n][:3, 3] for n in jb])
            H = float(np.ptp(np.vstack([p['P'] for p in pa])[:, 1])) if pa else 1.0
            dd = np.linalg.norm(pos_a - pos_b, axis=1) / H
            idx = np.argsort(-dd)[:6]
            r['joints_deplaces'] = [{'os': a.names[ja[i]], 'distance_rel_hauteur': round(float(dd[i]), 4)} for i in idx if dd[i] > 1e-4]
            r['joints_deplaces_nb'] = int((dd > 1e-4).sum())
            r['noms_identiques'] = [a.names[n] for n in ja] == [b.names[n] for n in jb]
except Exception as e:  # noqa
    r['erreur'] = repr(e)[:300]
print(json.dumps(r, ensure_ascii=False))
