"""Analyse des GLB produits par essai_gen.py (essais #7, #9, #12) : metriques du banc de fidelite contre la photo ET contre une reference (cuisson 4096 / config actuelle) rendue sous la MEME camera.
Usage : python essai_gen_analyse.py <photo> <ref.glb> <variante1.glb> [<variante2.glb> ...]   -> JSON sur stdout (et C:/tmp/texture_essais/analyse_<ref>.json)
Camera : ajustee sur la reference (recherche de pose + polissage), reutilisee pour toutes les variantes si leur maillage est identique (meme nombre de sommets), sinon ajustee a part."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, cv2
from skimage.color import rgb2lab, deltaE_ciede2000
import fid_lib as L

photo = sys.argv[1]; ref = sys.argv[2]; autres = sys.argv[3:]
t0 = time.time(); res = {'photo': os.path.basename(photo), 'reference': os.path.basename(ref), 'variantes': {}}


def charger(glb):
    return L.Sujet(glb + '|' + photo)


Sr = charger(ref); c = Sr.ajuster_camera(); c = Sr.polir(c['cam'], c['pose'])
res['camera_ref'] = {'iou': round(c['iou'], 3), 'score': round(c['score'], 3), 'sommets': len(Sr.V0), 'faces': len(Sr.F), 'atlas': Sr.AH}
res['n_sommets_ref'] = len(Sr.V0)
AZ = (0, 25, -25, 60)


def rendus(S, cam, pose):
    S.poser_texture(S.ATLAS if S.AH <= 4096 else cv2.resize(S.ATLAS, (4096, 4096), interpolation=cv2.INTER_AREA)); S.POSE[:] = pose
    out = {}
    for az in AZ:
        r, m, _ = S.rendre(tuple(cam), S.S, daz=az); out[az] = (r, m)
    return out


def contre_ref(r, rr, m, mr):
    zone = cv2.erode((m & mr).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    if zone.sum() < 500: return None
    la = rgb2lab(r.astype(np.float32) / 255.0); lb = rgb2lab(rr.astype(np.float32) / 255.0); d = deltaE_ciede2000(la, lb)[zone]
    mse = ((r.astype(np.float32) - rr.astype(np.float32)) ** 2)[zone].mean()
    return {'dE2000_median': round(float(np.median(d)), 3), 'dE2000_p90': round(float(np.percentile(d, 90)), 3), 'psnr_dB': round(float(10 * np.log10(255 ** 2 / max(mse, 1e-9))), 2)}


R_ref = rendus(Sr, c['cam'], c['pose'])
res['variantes'][os.path.basename(ref)] = {'vs_photo': L.mesures(Sr.PHOTO, R_ref[0][0], R_ref[0][1], Sr.MS), 'atlas': Sr.AH, 'ref': True}
for g in autres:
    S = charger(g); nom = os.path.basename(g); meme = (len(S.V0) == len(Sr.V0) and np.allclose(S.V0, Sr.V0, atol=1e-5))
    proche = meme or (abs(len(S.V0) - len(Sr.V0)) < 0.03 * len(Sr.V0) and np.abs(S.V0.min(0) - Sr.V0.min(0)).max() < 2e-3 * Sr.R and np.abs(S.V0.max(0) - Sr.V0.max(0)).max() < 2e-3 * Sr.R)
    if proche: cam, pose = c['cam'], c['pose']
    else:
        c2 = S.ajuster_camera(); c2 = S.polir(c2['cam'], c2['pose']); cam, pose = c2['cam'], c2['pose']
    Rv = rendus(S, cam, pose)
    v = {'maillage_identique_a_la_ref': bool(meme), 'maillage_proche_de_la_ref_(camera_de_la_ref_reutilisee)': bool(proche), 'sommets': len(S.V0), 'atlas': S.AH, 'vs_photo': L.mesures(S.PHOTO, Rv[0][0], Rv[0][1], S.MS)}
    if proche: v['vs_ref_par_azimut'] = {str(az): contre_ref(Rv[az][0], R_ref[az][0], Rv[az][1], R_ref[az][1]) for az in AZ}
    else: v['vs_ref_par_azimut'] = 'maillage different : comparaison pixel a pixel impossible'
    if proche:
        v['vs_ref_2048px'] = {}
        for az in (0, 25):
            S.poser_texture(S.ATLAS if S.AH <= 4096 else cv2.resize(S.ATLAS, (4096, 4096), interpolation=cv2.INTER_AREA)); S.POSE[:] = pose
            r, m, _ = S.rendre(tuple(cam), 2048, daz=az)
            Sr.poser_texture(Sr.ATLAS if Sr.AH <= 4096 else cv2.resize(Sr.ATLAS, (4096, 4096), interpolation=cv2.INTER_AREA)); Sr.POSE[:] = c['pose']
            rr, mr, _ = Sr.rendre(tuple(c['cam']), 2048, daz=az)
            zone = cv2.erode((m & mr).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
            la = rgb2lab(r.astype(np.float32) / 255.0); lb = rgb2lab(rr.astype(np.float32) / 255.0); d = deltaE_ciede2000(la, lb)[zone]
            mse = ((r.astype(np.float32) - rr.astype(np.float32)) ** 2)[zone].mean()
            g1 = cv2.cvtColor(r, cv2.COLOR_RGB2GRAY).astype(np.float32); g0 = cv2.cvtColor(rr, cv2.COLOR_RGB2GRAY).astype(np.float32)
            v['vs_ref_2048px'][str(az)] = {'dE2000_median': round(float(np.median(d)), 3), 'dE2000_p90': round(float(np.percentile(d, 90)), 3), 'psnr_dB': round(float(10 * np.log10(255 ** 2 / max(mse, 1e-9))), 2),
                                           'ratio_laplacien_variante_sur_ref': round(float(cv2.Laplacian(g1, cv2.CV_32F)[zone].var() / cv2.Laplacian(g0, cv2.CV_32F)[zone].var()), 3), 'pixels': int(zone.sum())}
    res['variantes'][nom] = v
    print(nom, 'meme maillage :', meme, {k: v['vs_photo'].get(k) for k in ('dE2000_median', 'ratio_laplacien', 'correlation_HF', 'dinov2_patchs')}, flush=True)
    del S
res['duree_s'] = round(time.time() - t0, 1)
json.dump(res, open('C:/tmp/texture_essais/analyse_%s%s.json' % (os.path.splitext(os.path.basename(ref))[0], os.environ.get('ESSAI_TAG', '')), 'w'), indent=1, ensure_ascii=False); print('termine', res['duree_s'], 's')
