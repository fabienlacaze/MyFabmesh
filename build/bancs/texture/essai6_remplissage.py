"""Essai #6 : remplissage des vides d'atlas par prolongement du bord le plus proche, contre Telea (rayon 3 pour la couleur, comme o_voxel/postprocess.py:289), avec le VRAI masque de to_glb
(texel dont le centre tombe dans un triangle de l'atlas UV : rasterisation GL au centre de pixel = meme regle que nvdiffrast).
Mesures : identite octet a octet des texels couverts ; dE2000 de couture (aretes de couture UV du maillage : couleur des deux cotes, echantillonnee dans la pyramide mip 0..4 de l'atlas rempli) ; secondes.
Usage : python essai6_remplissage.py <sujet> [taille_max_atlas]"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, cv2
from skimage.color import rgb2lab, deltaE_ciede2000
import fid_lib as L, proj_lib as P

nom = sys.argv[1]; TMAX = int(sys.argv[2]) if len(sys.argv) > 2 else 4096
t0 = time.time()


def log(*x): print('[%s %5.0fs]' % (nom, time.time() - t0), *x, flush=True)


S = L.Sujet(nom)
atlas = S.ATLAS
if S.AH > TMAX:
    atlas = cv2.resize(atlas, (TMAX, TMAX), interpolation=cv2.INTER_AREA); S.AH = TMAX
S.ATLAS = atlas; AH = S.AH
VALID = np.zeros((AH, AH), bool)
for ti, tj, N, Tl, Pp, Nn in P.texels_positions(S):
    VALID[(N - 1 - tj) * Tl:(N - tj) * Tl, ti * Tl:(ti + 1) * Tl] = Pp[..., 3] > 0.5
log('atlas %d ; texels couverts (centre dans un triangle) : %.1f %%' % (AH, 100.0 * VALID.mean()))
base = atlas.copy(); base[~VALID] = 0
mask_inv = (~VALID).astype(np.uint8)


def remplir_telea(img, rayon=3):
    return cv2.inpaint(img, mask_inv, rayon, cv2.INPAINT_TELEA)


def remplir_proche(img):
    """Chaque texel non couvert prend la couleur du texel couvert le plus proche (distance euclidienne) : cv2.distanceTransformWithLabels."""
    src = (~VALID).astype(np.uint8)          # non-zero = a calculer ; zero = couvert (source)
    dist, labels = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(VALID)               # etiquette k (a partir de 1) = k-ieme texel nul dans l'ordre de balayage
    out = img.copy(); lab = labels[~VALID] - 1
    out[~VALID] = img[ys[lab], xs[lab]]
    return out


res = {'sujet': nom, 'atlas': AH, 'couverts_pct': round(100.0 * VALID.mean(), 2)}
tt = time.time(); fT = remplir_telea(base); res['secondes_telea_couleur_rayon3'] = round(time.time() - tt, 2)
g1 = np.ascontiguousarray(base[..., 0]); tt = time.time(); _ = cv2.inpaint(g1, mask_inv, 1, cv2.INPAINT_TELEA); res['secondes_telea_canal_rayon1'] = round(time.time() - tt, 2)
tt = time.time(); fN = remplir_proche(base); res['secondes_bord_proche_couleur'] = round(time.time() - tt, 2)
tt = time.time(); _ = remplir_proche(g1[..., None])[..., 0]; res['secondes_bord_proche_canal'] = round(time.time() - tt, 2)
res['secondes_production_estimees_4_inpaints'] = round(res['secondes_telea_couleur_rayon3'] + 3 * res['secondes_telea_canal_rayon1'], 2)
res['secondes_remplacement_4_canaux_estimees'] = round(res['secondes_bord_proche_couleur'] + 3 * res['secondes_bord_proche_canal'], 2)
res['gain_secondes_couleur_seule'] = round(res['secondes_telea_couleur_rayon3'] - res['secondes_bord_proche_couleur'], 2)
res['gain_secondes_4_canaux'] = round(res['secondes_production_estimees_4_inpaints'] - res['secondes_remplacement_4_canaux_estimees'], 2)
res['texels_couverts_identiques_telea'] = bool(np.array_equal(fT[VALID], base[VALID])); res['texels_couverts_identiques_proche'] = bool(np.array_equal(fN[VALID], base[VALID]))
log('Telea couleur %.2fs (canal r1 %.2fs) ; bord proche %.2fs ; identite des couverts Telea/proche : %s/%s' % (res['secondes_telea_couleur_rayon3'], res['secondes_telea_canal_rayon1'], res['secondes_bord_proche_couleur'], res['texels_couverts_identiques_telea'], res['texels_couverts_identiques_proche']))

# ---- aretes de couture UV : arete 3D (sommets soudes par position) portee par deux triangles dont les UV different
V = S.V0; F = S.F; UV = S.UV
q = np.round(V / (S.R * 1e-6)).astype(np.int64)
_, wid = np.unique(q, axis=0, return_inverse=True); wid = wid.reshape(-1)
a = F[:, [0, 1, 2]].reshape(-1); b = F[:, [1, 2, 0]].reshape(-1)
wa = wid[a]; wb = wid[b]; lo = np.minimum(wa, wb); hi = np.maximum(wa, wb); swap = wa > wb
uva = np.where(swap[:, None], UV[b], UV[a]); uvb = np.where(swap[:, None], UV[a], UV[b])
key = lo.astype(np.int64) * (wid.max() + 1) + hi
order = np.argsort(key, kind='stable'); ks = key[order]
_, first, cnt = np.unique(ks, return_index=True, return_counts=True)
deux = first[cnt == 2]                                         # aretes portees par exactement 2 triangles
i0 = order[deux]; i1 = order[deux + 1]
d0 = np.linalg.norm(uva[i0] - uva[i1], axis=1) + np.linalg.norm(uvb[i0] - uvb[i1], axis=1)
seam = d0 > 2.0 / AH                                         # UV differents de plus de 2 texels : vraie couture (et non un simple sommet duplique)
i0 = i0[seam]; i1 = i1[seam]
log('aretes 3D : %d ; coutures UV : %d' % (len(a) // 2, len(i0)))
rng = np.random.default_rng(0)
if len(i0) > 120000:
    k = rng.choice(len(i0), 120000, replace=False); i0 = i0[k]; i1 = i1[k]
ts = np.array([0.25, 0.5, 0.75], np.float32)
PA = (uva[i0][:, None, :] * (1 - ts)[None, :, None] + uvb[i0][:, None, :] * ts[None, :, None]).reshape(-1, 2)
PB = (uva[i1][:, None, :] * (1 - ts)[None, :, None] + uvb[i1][:, None, :] * ts[None, :, None]).reshape(-1, 2)


def echantillon(img, uv):
    h = img.shape[0]; x = uv[:, 0] * h - 0.5; y = (1.0 - uv[:, 1]) * h - 0.5      # GLB : v vers le haut, image rangee de haut en bas
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    g = lambda yy, xx: img[np.clip(yy, 0, h - 1), np.clip(xx, 0, h - 1)].astype(np.float32)
    return (g(y0, x0) * (1 - fx) * (1 - fy) + g(y0, x0 + 1) * fx * (1 - fy) + g(y0 + 1, x0) * (1 - fx) * fy + g(y0 + 1, x0 + 1) * fx * fy)


def couture(img):
    out = {}; cur = img
    for k in range(5):
        if k > 0: cur = cv2.resize(cur, (cur.shape[0] // 2, cur.shape[0] // 2), interpolation=cv2.INTER_AREA)
        ca = echantillon(cur, PA); cb = echantillon(cur, PB)
        la = rgb2lab((ca / 255.0)[None]); lb = rgb2lab((cb / 255.0)[None]); d = deltaE_ciede2000(la, lb)[0]
        out['mip%d' % k] = [round(float(d.mean()), 3), round(float(np.median(d)), 3)]
    return out


# controle : echantillons plausibles, l'atlas d'origine (rempli par la production) est la reference
res['couture_dE2000_[moyenne, mediane]'] = {'atlas_origine_(rempli_par_to_glb)': couture(atlas), 'telea_r3': couture(fT), 'bord_proche': couture(fN)}
res['n_echantillons_couture'] = int(len(PA))
for k, v in res['couture_dE2000_[moyenne, mediane]'].items(): log('couture', k, v)
# difference de fond entre les deux remplissages
dm = np.abs(fT.astype(np.int16) - fN.astype(np.int16))[~VALID].mean(); res['ecart_moyen_des_remplissages_niveaux'] = round(float(dm), 2)
res['duree_s'] = round(time.time() - t0, 1)
os.makedirs('C:/tmp/texture_essais/essai6', exist_ok=True)
json.dump(res, open('C:/tmp/texture_essais/essai6/%s.json' % nom, 'w'), indent=1, ensure_ascii=False); log('termine', res['duree_s'], 's')
