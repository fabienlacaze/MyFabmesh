"""Essai #4 : garde-fou local et deuxieme passe de projection. Photo ENTIERE (usage reel, sans fenetre cachee), mesure des 'doubles contours' par un PROXY automatique
(aucun releveur humain n'est disponible) : segments de contour du rendu qui n'ont aucun contour de la photo a moins de 2 px (composantes connexes >= 15 px), sur 3 gros plans
choisis automatiquement (les 3 fenetres de 192 px les plus riches en contours de la photo) + sur toute la zone.
Usage : python essai4_contours.py <sujet> [--photo <png>] [--etiquette <txt>]"""
import sys, os, json, time, argparse
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, cv2
from PIL import Image
import fid_lib as L, proj_lib as P

ap = argparse.ArgumentParser(); ap.add_argument('sujet'); ap.add_argument('--photo', default=None); ap.add_argument('--etiquette', default='')
a = ap.parse_args(); nom = a.sujet
OUT = 'C:/tmp/texture_essais/essai4'; os.makedirs(OUT, exist_ok=True)
t0 = time.time()


def log(*x): print('[%s %5.0fs]' % (nom, time.time() - t0), *x, flush=True)


S = L.Sujet(nom)
if S.AH > 4096:
    S.ATLAS = cv2.resize(S.ATLAS, (4096, 4096), interpolation=cv2.INTER_AREA); S.AH = 4096
cj = json.load(open('C:/tmp/texture_essais/cam_%s.json' % nom)); cr = cj['retenue']; cam = tuple(cr['cam']); pose = cr['pose']
photo = S.PHOTO
if a.photo:
    photo = np.asarray(Image.open(a.photo).convert('RGB').resize((S.S, S.S), Image.LANCZOS))


def vue(atlas):
    S.poser_texture(atlas); S.POSE[:] = pose; r, m, _ = S.rendre(cam, S.S); return r, m


def contours(rgb):
    g = cv2.GaussianBlur(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (0, 0), 1.0)
    return cv2.Canny(g, 40, 100) > 0


rA, mA = vue(S.ATLAS)
zone = cv2.erode((mA & S.MS).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
EP = contours(photo) & zone
dP = cv2.distanceTransform((~EP).astype(np.uint8), cv2.DIST_L2, 3)        # distance au contour de la photo le plus proche
# 3 gros plans : fenetres de 192 px les plus riches en contours de la photo (non chevauchantes)
dens = cv2.boxFilter(EP.astype(np.float32), -1, (192, 192), normalize=False)
fen = []; dd = dens.copy()
for _ in range(3):
    y, x = np.unravel_index(np.argmax(dd), dd.shape); y0 = int(np.clip(y - 96, 0, S.S - 192)); x0 = int(np.clip(x - 96, 0, S.S - 192)); fen.append((y0, x0))
    dd[max(0, y - 192):y + 192, max(0, x - 192):x + 192] = -1


def proxy(rgb, m):
    er = contours(rgb) & zone; ghost = er & (dP > 2.0)
    dR = cv2.distanceTransform((~er).astype(np.uint8), cv2.DIST_L2, 3)
    def stats(box):
        sl = (slice(box[0], box[0] + 192), slice(box[1], box[1] + 192)) if box else (slice(None), slice(None))
        e = er[sl]; gh = ghost[sl]; ep = EP[sl]
        n, lab, st, _ = cv2.connectedComponentsWithStats(gh.astype(np.uint8), connectivity=8)
        seg = int(sum(1 for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= 15))
        return {'contours_rendu_px': int(e.sum()), 'contours_photo_px': int(ep.sum()), 'precision_2px': round(float((e & (dP[sl] <= 2.0)).sum() / max(e.sum(), 1)), 3),
                'rappel_2px': round(float((ep & (dR[sl] <= 2.0)).sum() / max(ep.sum(), 1)), 3), 'segments_fantomes': seg, 'pixels_fantomes': int(gh.sum())}
    return {'zone': stats(None), 'gros_plans': [stats(b) for b in fen]}


def dE_zone(rgb, m):
    me = L.mesures(photo, rgb, m, S.MS, avec_dino=False); return {k: me[k] for k in ('dE2000_median', 'ratio_laplacien', 'correlation_HF', 'psnr_basse_freq_dB')}


res = {'sujet': nom, 'fenetres_gros_plans_(y0,x0)': fen, 'conditions': {}}
res['conditions']['A_origine'] = {'proxy': proxy(rA, mA), 'metriques_zone_circulaires': dE_zone(rA, mA)}
cases = [('B1_garde45', 45.0, 1, True), ('B1_sans_garde', 45.0, 1, False), ('B1_garde25', 25.0, 1, True), ('D2_garde45', 45.0, 2, True), ('D2_sans_garde', 45.0, 2, False)]
tuiles = [np.concatenate([photo[fen[0][0]:fen[0][0] + 192, fen[0][1]:fen[0][1] + 192], rA[fen[0][0]:fen[0][0] + 192, fen[0][1]:fen[0][1] + 192]], 0)]
for label, tau, passes, garde in cases:
    t1 = time.time(); r1 = P.projeter(S, cam, pose, photo, hide=None, tau=tau, garde=garde); fin = r1['FINAL']
    if passes == 2: fin = P.projeter(S, cam, pose, photo, atlas_base=fin, hide=None, tau=tau, garde=garde)['FINAL']
    r, m = vue(fin)
    res['conditions'][label] = {'proxy': proxy(r, m), 'metriques_zone_circulaires': dE_zone(r, m), 'texels_projetes_pct': round(r1['diag']['texels_projetes_pct'], 2), 'duree_s': round(time.time() - t1, 1)}
    tuiles.append(np.concatenate([photo[fen[0][0]:fen[0][0] + 192, fen[0][1]:fen[0][1] + 192], r[fen[0][0]:fen[0][0] + 192, fen[0][1]:fen[0][1] + 192]], 0))
    c = res['conditions'][label]['proxy']['gros_plans']; c0 = res['conditions']['A_origine']['proxy']['gros_plans']
    log(label, 'segments fantomes gros plans', [x['segments_fantomes'] for x in c], '(origine', [x['segments_fantomes'] for x in c0], ') ; precision zone %.3f (origine %.3f) ; dE zone %.2f' % (
        res['conditions'][label]['proxy']['zone']['precision_2px'], res['conditions']['A_origine']['proxy']['zone']['precision_2px'], res['conditions'][label]['metriques_zone_circulaires']['dE2000_median']))
Image.fromarray(np.concatenate(tuiles, 1)).save('%s/%s%s_gros_plan1.png' % (OUT, nom, a.etiquette))
res['duree_s'] = round(time.time() - t0, 1)
json.dump(res, open('%s/%s%s.json' % (OUT, nom, a.etiquette), 'w'), indent=1, ensure_ascii=False); log('termine', res['duree_s'], 's')
