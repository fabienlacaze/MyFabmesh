"""Combine plusieurs vues projetees (projeter_source4.py --sauver) puis cale les couleurs et melange.
Usage : python combiner_vues.py <maillage.glb> <sortie> <dossier_vue1[:poids]> [<dossier_vue2[:poids]> ...] [--tau 45] [--gain-max 1.4] [--sans-ton]"""
import argparse, json, math, os, sys, time
import numpy as np, cv2, trimesh
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('sortie'); ap.add_argument('vues', nargs='+')
ap.add_argument('--tau', type=float, default=45.0); ap.add_argument('--gain-max', type=float, default=1.4); ap.add_argument('--sans-ton', action='store_true')
args = ap.parse_args(); os.makedirs(args.sortie, exist_ok=True)
T0 = time.time()
def log(*a): print('[%5.1fs]' % (time.time() - T0), *a, flush=True)
scene = trimesh.load(args.glb, force='scene', process=False); mesh = list(scene.geometry.values())[0]
mat = mesh.visual.material
ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB')); AH = ATLAS.shape[0]
acc = np.zeros((AH, AH, 3), np.float32); W = np.zeros((AH, AH), np.float32)
for v in args.vues:
    d, _, p = v.partition(':'); pv = float(p) if p else 1.0
    n = np.load(os.path.join(d, 'nouveau.npy')); w = np.load(os.path.join(d, 'poids.npy')).astype(np.float32) / 255.0 * pv
    acc += n.astype(np.float32) * w[..., None]; W += w
    log('vue', d, 'poids', pv, ': %.2f %% des texels' % (100.0 * float((w > 0.5).mean())))
    del n, w
NOUVEAU = np.clip(acc / np.maximum(W, 1e-4)[..., None], 0, 255).astype(np.uint8); del acc
POIDS = (np.minimum(W, 1.0) * 255).astype(np.uint8)
log('combinaison : %.2f %% des texels avec poids > 0,5' % (100.0 * float((W > 0.5).mean())))
# ───────────── calage des couleurs (basse frequence de l'atlas) puis melange
K = 8; Lr = AH // K
w_f = POIDS.astype(np.float32) / 255.0
def aire(x): return cv2.resize(x, (Lr, Lr), interpolation=cv2.INTER_AREA)
den = aire(w_f)
ATLAST = ATLAS
if not args.sans_ton:
    # ETALONNAGE GLOBAL : l'atlas TRELLIS est plus pale et moins sature que la photo (beige contre or). On apprend, sur les zones ou la photo a ete reportee, la
    # courbe de tons ancienne texture -> photo (appariement de quantiles des moyennes locales, par canal) et on l'applique a TOUT l'atlas : meme rendu partout,
    # plus de rupture entre l'avant et le reste.
    sel = den > 0.5
    x = np.arange(256, dtype=np.float32); lut = []
    for c in range(3):
        o = aire(ATLAS[..., c].astype(np.float32) * w_f) / np.maximum(den, 1e-6); n = aire(NOUVEAU[..., c].astype(np.float32) * w_f) / np.maximum(den, 1e-6)
        qs = np.linspace(0.01, 0.99, 50); oq = np.quantile(o[sel], qs); nq = np.maximum.accumulate(np.quantile(n[sel], qs))
        l = np.interp(x, oq, nq); l[x < oq[0]] = x[x < oq[0]] + (nq[0] - oq[0]); l[x > oq[-1]] = x[x > oq[-1]] + (nq[-1] - oq[-1])
        lut.append(np.clip(l, 0, 255).astype(np.uint8))
        log('ton canal %d : %.0f -> %.0f (mediane), %.0f -> %.0f (haut)' % (c, oq[len(qs) // 2], nq[len(qs) // 2], oq[-1], nq[-1]))
    ATLAST = np.stack([lut[c][ATLAS[..., c]] for c in range(3)], axis=-1)
gains = []
for c in range(3):
    n_old = aire(ATLAST[..., c].astype(np.float32) * w_f); n_new = aire(NOUVEAU[..., c].astype(np.float32) * w_f)
    g = (n_old + 1.0) / (n_new + 1.0)
    # lissage normalise par le poids (aucun melange avec les texels non projetes)
    gs = cv2.GaussianBlur(g * den, (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(den, (0, 0), 2.0), 1e-4)
    gs = np.where(cv2.GaussianBlur(den, (0, 0), 2.0) > 1e-3, gs, 1.0)
    gains.append(np.clip(gs, 1.0 / args.gain_max, args.gain_max).astype(np.float32))
# GARDE-FOU : la photo et l'ancienne texture doivent s'accorder a l'echelle moyenne (une tache jaune sur une barre sombre = decalage)
K2 = 4; L2 = AH // K2
def aire2(x): return cv2.resize(x, (L2, L2), interpolation=cv2.INTER_AREA)
den2 = aire2(w_f)
g_up = [cv2.resize(g, (L2, L2), interpolation=cv2.INTER_LINEAR) for g in gains]
delta = np.zeros((L2, L2), np.float32)
for c in range(3):
    o = cv2.GaussianBlur(aire2(ATLAST[..., c].astype(np.float32) * w_f), (0, 0), 1.5); n = cv2.GaussianBlur(aire2(NOUVEAU[..., c].astype(np.float32) * w_f), (0, 0), 1.5)
    d_ = cv2.GaussianBlur(den2, (0, 0), 1.5)
    delta += np.abs(n * g_up[c] - o) / np.maximum(d_, 1e-3)
delta /= 3.0
garde = np.exp(-(delta / args.tau) ** 2).astype(np.float32)
garde[den2 < 1e-3] = 1.0
log('garde-fou de couleur : poids moyen %.2f sur les texels projetes' % (float((garde * den2).sum() / max(den2.sum(), 1e-6))))
GARDE = cv2.resize(garde, (AH, AH), interpolation=cv2.INTER_LINEAR)
w_f = w_f * GARDE
FINAL = ATLAST.copy()
bande = 1024
for r0_ in range(0, AH, bande):
    sl = slice(r0_, r0_ + bande)
    wb = w_f[sl][..., None]
    g_full = np.stack([cv2.resize(g[r0_ // K:(r0_ + bande) // K], (AH, bande), interpolation=cv2.INTER_LINEAR) for g in gains], axis=-1)
    new = np.clip(NOUVEAU[sl].astype(np.float32) * g_full, 0, 255)
    FINAL[sl] = np.clip(ATLAST[sl].astype(np.float32) * (1 - wb) + new * wb, 0, 255).astype(np.uint8)
log('melange fait')
Image.fromarray(FINAL).resize((2048, 2048), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_apres_2k.png'))
Image.fromarray(ATLAS).resize((2048, 2048), Image.LANCZOS).save(os.path.join(args.sortie, 'atlas_avant_2k.png'))

Image.fromarray(FINAL).save(os.path.join(args.sortie, 'atlas_final_8k.jpg'), quality=93)
Image.fromarray(ATLAS).save(os.path.join(args.sortie, 'atlas_avant_8k.jpg'), quality=93)
sc = trimesh.load(args.glb, force='scene', process=False); m = list(sc.geometry.values())[0]; mt = m.visual.material
img = Image.open(os.path.join(args.sortie, 'atlas_final_8k.jpg')); img.load(); mt.baseColorTexture = img
mr = getattr(mt, 'metallicRoughnessTexture', None)
if mr is not None and mr.size[0] > 4096: mt.metallicRoughnessTexture = mr.resize((4096, 4096), Image.LANCZOS)
sc.export(os.path.join(args.sortie, 'modele.glb')); log('modele.glb ecrit')
