"""Essais #3 et #4 : validation non circulaire de la projection de la photo (fenetre cachee), deuxieme passe, garde-fou.
Usage : python essai3_projection.py <sujet> [--garde-var] [--photo <png>] [--etiquette <txt>]
Conditions : A texture d'origine ; B projection (1 passe, garde-fou tau=45) ; D deux passes ; (--garde-var) B0 sans garde-fou, B25 garde-fou strict tau=25, D0 deux passes sans garde-fou.
Mesures dans la FENETRE CACHEE (25 % de la boite du sujet : ces pixels ne servent ni au recalage de la camera, ni au flot, ni au report).
Atlas de travail plafonne a 4096 (les atlas 8192 sont un agrandissement x2 : voir plan)."""
import sys, os, json, time, argparse
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, cv2
from PIL import Image
from skimage.color import rgb2lab, deltaE_ciede2000
import fid_lib as L, proj_lib as P

ap = argparse.ArgumentParser(); ap.add_argument('sujet'); ap.add_argument('--garde-var', action='store_true'); ap.add_argument('--photo', default=None); ap.add_argument('--photo-hr', default=None); ap.add_argument('--etiquette', default='')
a = ap.parse_args(); nom = a.sujet
OUT = 'C:/tmp/texture_essais/essai3'; os.makedirs(OUT, exist_ok=True)
t0 = time.time()


def log(*x): print('[%s %5.0fs]' % (nom, time.time() - t0), *x, flush=True)


S = L.Sujet(nom)
if S.AH > 4096:
    S.ATLAS = cv2.resize(S.ATLAS, (4096, 4096), interpolation=cv2.INTER_AREA); S.AH = 4096
cj = json.load(open('C:/tmp/texture_essais/cam_%s.json' % nom)); cr = cj['retenue']; cam = tuple(cr['cam']); pose = cr['pose']
hide = P.fenetre_cachee(S); hide_in = cv2.erode(hide.astype(np.uint8), np.ones((17, 17), np.uint8)).astype(bool)   # fenetre erodee de 8 px : pas de fuite par le flou
photo = S.PHOTO
if a.photo:
    photo = np.asarray(Image.open(a.photo).convert('RGB').resize((S.S, S.S), Image.LANCZOS))
log('camera retenue %s : IoU %.3f score %.3f ; atlas de travail %d ; fenetre cachee %d px (%.1f %% du masque)' % (cr['nom'], cr['iou'], cr['score'], S.AH, hide.sum(), 100.0 * (hide & S.MS).sum() / S.MS.sum()))
S.POSE[:] = pose
photo_hr = np.asarray(Image.open(a.photo_hr).convert('RGB')) if a.photo_hr else None


def vue(atlas, daz=0.0, taille=None):
    S.poser_texture(atlas); S.POSE[:] = pose; r, m, _ = S.rendre(cam, taille or S.S, daz=daz); return r, m


def mes(atlas, zone, dino=True):
    r, m = vue(atlas); return L.mesures(photo, r, m, S.MS, fenetre=zone, avec_dino=dino)


res = {'sujet': nom, 'atlas_travail': S.AH, 'camera': {'iou': cr['iou'], 'score': cr['score']}, 'fenetre_px': int(hide.sum()), 'conditions': {}}
res['conditions']['A_origine'] = {'fenetre': mes(S.ATLAS, hide_in), 'visible': mes(S.ATLAS, S.MS & ~hide, dino=False)}
log('A fenetre', {k: res['conditions']['A_origine']['fenetre'].get(k) for k in ('dE2000_median', 'ratio_laplacien', 'correlation_HF')})
rA, mA = vue(S.ATLAS)


def seam(atlas_av, W, taille):
    """dE2000 moyen entre pixels voisins a cheval sur le bord de la zone projetee (poids > 0,5 d'un cote, < 0,1 de l'autre), sur un rendu de `taille` px."""
    Wrgb = np.clip(np.repeat(W[..., None], 3, axis=2) * 255, 0, 255).astype(np.uint8)
    S.poser_texture(Wrgb if S.AH <= 4096 else cv2.resize(Wrgb, (4096, 4096), interpolation=cv2.INTER_AREA)); S.POSE[:] = pose
    rw, mw, _ = S.rendre(cam, taille); pw = rw[..., 0].astype(np.float32) / 255.0
    out = {}
    for nm, at in atlas_av.items():
        r, m = vue(at, taille=taille); lab = rgb2lab(r.astype(np.float32) / 255.0); ds = []
        for dy, dx in ((0, 1), (1, 0)):
            p0 = pw[:pw.shape[0] - dy, :pw.shape[1] - dx]; p1 = pw[dy:, dx:]; m0 = m[:m.shape[0] - dy, :m.shape[1] - dx] & m[dy:, dx:]
            b = m0 & (((p0 > 0.5) & (p1 < 0.1)) | ((p1 > 0.5) & (p0 < 0.1)))
            ds.append(deltaE_ciede2000(lab[:lab.shape[0] - dy, :lab.shape[1] - dx], lab[dy:, dx:])[b])
        d = np.concatenate(ds); out[nm] = [round(float(d.mean()), 3), int(len(d))] if len(d) else [None, 0]
    return out


def rnd(dct):
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in dct.items() if k != 'atlas_tone'}


def ond(label, tau, passes, garde=True):
    t1 = time.time(); r1 = P.projeter(S, cam, pose, photo, photo_hr=photo_hr, atlas_base=None, hide=hide, tau=tau, garde=garde)
    fin = r1['FINAL']; diag = r1['diag']; W = r1['W']; VALID = r1['VALID']; POIDS = r1['POIDS']
    diag2 = None
    if passes == 2:
        r2 = P.projeter(S, cam, pose, photo, photo_hr=photo_hr, atlas_base=fin, hide=hide, tau=tau, garde=garde)
        fin = r2['FINAL']; diag2 = r2['diag']; W = np.maximum(W, r2['W'])
    d = {'duree_s': round(time.time() - t1, 1), 'diag_passe1': rnd(diag)}
    if diag2: d['diag_passe2'] = rnd(diag2)
    d['fenetre'] = mes(fin, hide_in); d['visible_circulaire'] = mes(fin, S.MS & ~hide, dino=False)
    nt = VALID & (POIDS == 0)       # zones non touchees : distribution de couleur de l'atlas avant / apres
    if nt.sum() > 1000:
        qs = np.arange(1, 100); la = cv2.cvtColor(S.ATLAS, cv2.COLOR_RGB2GRAY)[nt]; lb = cv2.cvtColor(fin, cv2.COLOR_RGB2GRAY)[nt]
        d['non_touches_wasserstein_luminance_niveaux'] = round(float(np.abs(np.percentile(la, qs) - np.percentile(lb, qs)).mean()), 2)
        ta = S.ATLAS[nt].astype(np.float32); tb = fin[nt].astype(np.float32)
        d['non_touches_wasserstein_par_canal'] = [round(float(np.abs(np.percentile(ta[:, c], qs) - np.percentile(tb[:, c], qs)).mean()), 2) for c in range(3)]
        d['non_touches_texels_pct_des_valides'] = round(100.0 * nt.sum() / VALID.sum(), 1)
    d['couture_bord_projete'] = {str(t): seam({'avant': S.ATLAS, 'apres': fin}, W, t) for t in (S.S, S.S // 4)}
    d['texels_projetes_pct'] = round(diag['texels_projetes_pct'], 2)
    tuiles = []
    for daz in (0, 25, -25, 60, -60):
        ra, ma = vue(S.ATLAS, daz); rb, mb = vue(fin, daz)
        tuiles.append(np.concatenate([np.where(ma[..., None], ra, 255), np.where(mb[..., None], rb, 255)], 0).astype(np.uint8))
    ph = np.where(S.MS[..., None], photo, 255).astype(np.uint8).copy(); ph[hide & ~(cv2.erode(hide.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)] = (255, 0, 0)
    mont = np.concatenate([np.concatenate([ph, ph * 0 + 255], 0)] + tuiles, 1)
    Image.fromarray(cv2.resize(mont, (mont.shape[1] // 2, mont.shape[0] // 2), interpolation=cv2.INTER_AREA)).save('%s/%s_%s%s.png' % (OUT, nom, label, a.etiquette))
    ys, xs = np.where(hide); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    zz = np.concatenate([photo[y0:y1, x0:x1], np.where(mA[..., None], rA, 255)[y0:y1, x0:x1], vue(fin)[0][y0:y1, x0:x1]], 1)
    Image.fromarray(zz).save('%s/%s_%s%s_fenetre.png' % (OUT, nom, label, a.etiquette))
    res['conditions'][label] = d
    mf = d['fenetre']; mAf = res['conditions']['A_origine']['fenetre']
    log(label, 'fenetre dE %.2f -> %.2f ; HF corr %.3f -> %.3f ; lap %.3f -> %.3f ; non touches W %s ; texels projetes %.1f %% ; couture mip0 %s ; %ds' % (
        mAf['dE2000_median'], mf['dE2000_median'], mAf['correlation_HF'], mf['correlation_HF'], mAf['ratio_laplacien'], mf['ratio_laplacien'],
        d.get('non_touches_wasserstein_luminance_niveaux'), d['texels_projetes_pct'], d['couture_bord_projete'][str(S.S)], d['duree_s']))
    return fin


ond('B_1passe', 45.0, 1)
ond('D_2passes', 45.0, 2)
if a.garde_var:
    ond('B0_sans_garde', 45.0, 1, garde=False); ond('B25_garde_strict', 25.0, 1); ond('D0_2passes_sans_garde', 45.0, 2, garde=False)
B = res['conditions']['B_1passe']; sc = cr['score']; cn = B['diag_passe1']['ncc_apres']; tp = B['texels_projetes_pct']
res['regle_auto'] = {'score_photo': round(sc, 3), 'correlation_apres_recalage': round(cn, 3), 'texels_touches_pct': tp, 'accepte': bool(sc >= 0.85 and cn >= 0.45 and tp >= 2.0), 'seuils': 'score >= 0,85 ET corr >= 0,45 ET texels >= 2 %'}
log('regle Auto', res['regle_auto'])
res['duree_s'] = round(time.time() - t0, 1)
json.dump(res, open('%s/%s%s.json' % (OUT, nom, a.etiquette), 'w'), indent=1, ensure_ascii=False); log('termine', res['duree_s'], 's')
