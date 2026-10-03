"""Essai #2 (suite) : repetabilite apres polissage fin des deux ajustements de camera independants. Usage : python essai2b_polir.py <sujet> ..."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import fid_lib as L
for nom in sys.argv[1:]:
    t0 = time.time(); S = L.Sujet(nom); cj = json.load(open('C:/tmp/texture_essais/cam_%s.json' % nom))
    res = {'sujet': nom}
    pol = {}
    for k in ('cam1', 'cam2'):
        pol[k] = S.polir(cj[k]['cam'], cj[k]['pose'])
        S.poser_texture(S.ATLAS); S.POSE[:] = pol[k]['pose']; r, m, _ = S.rendre(tuple(pol[k]['cam']), S.S)
        res[k] = dict(avant=dict(score=cj[k]['score'], iou=cj[k]['iou'], pose=cj[k]['pose']), apres=dict(score=pol[k]['score'], iou=pol[k]['iou'], pose=pol[k]['pose']), metriques=L.mesures(S.PHOTO, r, m, S.MS, avec_dino=False))
    res['repetabilite_dE_median_apres'] = round(abs(res['cam1']['metriques']['dE2000_median'] - res['cam2']['metriques']['dE2000_median']), 3)
    # meilleure camera retenue pour les essais suivants
    best = 'cam1' if pol['cam1']['score'] >= pol['cam2']['score'] else 'cam2'
    cj['retenue'] = pol[best]; cj['retenue']['nom'] = best; json.dump(cj, open('C:/tmp/texture_essais/cam_%s.json' % nom, 'w'))
    res['duree_s'] = round(time.time() - t0, 1)
    json.dump(res, open('C:/tmp/texture_essais/essai2/%s_polish.json' % nom, 'w'), indent=1, ensure_ascii=False)
    print(nom, 'repetabilite avant/apres :', 'cf. essai2', '->', res['repetabilite_dE_median_apres'], '; scores', round(res['cam1']['apres']['score'], 3), round(res['cam2']['apres']['score'], 3), '; %ds' % res['duree_s'], flush=True)
