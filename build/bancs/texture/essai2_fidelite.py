"""Essai #2 : banc de fidelite a l'image source. Par sujet : camera ajustee deux fois (recherches de pose independantes), metriques sur la texture d'origine et deux variantes degradees (atlas 2048 / 1024),
montage a l'aveugle (cote tire au hasard, cle dans la sortie). Usage : python essai2_fidelite.py <sujet> [<sujet> ...]"""
import sys, os, json, time, random
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, cv2
from PIL import Image
import fid_lib as L
OUT = 'C:/tmp/texture_essais/essai2'; os.makedirs(OUT, exist_ok=True)
for nom in sys.argv[1:]:
    t0 = time.time(); log = lambda *a: print('[%s %5.0fs]' % (nom, time.time() - t0), *a, flush=True)
    S = L.Sujet(nom); log('charge ; atlas', S.AH, '; photo', S.photo_taille_origine)
    c1 = S.ajuster_camera(); log('camera 1 : IoU %.3f score %.3f pose %s D/R %.2f' % (c1['iou'], c1['score'], [round(x, 1) for x in c1['pose']], c1['D_sur_R']))
    c2 = S.ajuster_camera(az_decalage=7.5, pitchs=(-5, 5, 15, 25, 35)); log('camera 2 : IoU %.3f score %.3f pose %s' % (c2['iou'], c2['score'], [round(x, 1) for x in c2['pose']]))
    json.dump({'cam1': c1, 'cam2': c2, 'atlas': S.AH, 'R': S.R}, open('C:/tmp/texture_essais/cam_%s.json' % nom, 'w'))
    res = {'sujet': nom, 'atlas': S.AH, 'cam1': c1, 'cam2': c2, 'variantes': {}}
    imgs = {}
    for variante, cible in (('origine', 99999), ('atlas2048', 2048), ('atlas1024', 1024)):
        if cible < S.AH or variante == 'origine':
            a = L.degrader(S.ATLAS, cible)
        else:
            continue
        S.poser_texture(a)
        for ncam, c in (('cam1', c1), ('cam2', c2)):
            if ncam == 'cam2' and variante != 'origine': continue
            S.POSE[:] = c['pose']; r, m, _ = S.rendre(tuple(c['cam']), S.S)
            me = L.mesures(S.PHOTO, r, m, S.MS)
            res['variantes'].setdefault(variante, {})[ncam] = me
            if ncam == 'cam1': imgs[variante] = (r, m)
            log(variante, ncam, {k: me.get(k) for k in ('dE2000_median', 'psnr_basse_freq_dB', 'ratio_laplacien', 'ratio_HF_ecart_type', 'correlation_structure', 'correlation_HF', 'dinov2_patchs')})
    # repetabilite
    o = res['variantes']['origine']
    res['repetabilite_dE_median'] = round(abs(o['cam1']['dE2000_median'] - o['cam2']['dE2000_median']), 3)
    # montage a l'aveugle : origine contre la plus degradee
    pire = 'atlas1024' if 'atlas1024' in imgs else ('atlas2048' if 'atlas2048' in imgs else None)
    if pire:
        rnd = random.Random(hash(nom) & 0xffff); cote = rnd.choice(['A_origine', 'A_degrade'])
        ro, mo = imgs['origine']; rd, md = imgs[pire]
        ys, xs = np.where(cv2.erode((mo & S.MS).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)); y0 = int(np.median(ys)) - 128; x0 = int(np.median(xs)) - 128
        y0 = max(0, min(S.S - 256, y0)); x0 = max(0, min(S.S - 256, x0))
        ph = S.PHOTO[y0:y0 + 256, x0:x0 + 256]; a, b = (ro, rd) if cote == 'A_origine' else (rd, ro)
        row = np.hstack([ph, a[y0:y0 + 256, x0:x0 + 256], b[y0:y0 + 256, x0:x0 + 256]])
        Image.fromarray(row).resize((row.shape[1] * 2, 512), Image.NEAREST).save('%s/aveugle_%s.png' % (OUT, nom)); res['aveugle'] = {'cle': cote, 'degrade': pire, 'fichier': 'aveugle_%s.png (photo | A | B)' % nom}
    res['duree_s'] = round(time.time() - t0, 1)
    json.dump(res, open('%s/%s.json' % (OUT, nom), 'w'), indent=1, ensure_ascii=False); log('termine', res['duree_s'], 's ; repetabilite dE', res['repetabilite_dE_median'])
