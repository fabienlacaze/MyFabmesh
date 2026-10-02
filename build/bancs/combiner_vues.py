"""Combine plusieurs vues projetees (projeter_source4.py --sauver) puis cale les couleurs et melange.
Usage : python combiner_vues.py <maillage.glb> <sortie> <dossier_vue1[:poids]> [<dossier_vue2[:poids]> ...] [--tau 45] [--gain-max 1.4] [--sans-ton]"""
import argparse, json, math, os, sys, time
import numpy as np, cv2, trimesh
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser()
ap.add_argument('glb'); ap.add_argument('sortie'); ap.add_argument('vues', nargs='+')
ap.add_argument('--tau', type=float, default=45.0); ap.add_argument('--gain-max', type=float, default=1.4); ap.add_argument('--sans-ton', action='store_true'); ap.add_argument('--ton-canal', action='store_true'); ap.add_argument('--echelle-gain', type=int, default=8)   # taille (texels d'atlas) d'une cellule du calage local de couleur : 8 = fin (recale aussi les plaques de l'ancienne texture), 64 = grossier
ap.add_argument('--remplir', type=int, default=0)   # rayon (texels) de comblement des bordures d'ilots / petits trous : etend les couleurs voisines la ou aucun poids n'a ete reporte
ap.add_argument('--combler-trous', type=int, default=0)   # aire maximale (texels) d'une zone isolee SANS poids qui sera comblee par la couleur lisse qui l'entoure (eclats de surface que aucune vue ne retrouve)
ap.add_argument('--gain-global', action='store_true')   # un seul facteur de couleur par canal (rapport des medianes sur les texels reportes) au lieu d'un calage local : aucune structure spatiale
ap.add_argument('--exclure', default=None)   # dossier d'une projection deja appliquee (poids.npy) : les vues ne remplacent PAS les texels qu'elle couvre
ap.add_argument('--ton-sur-premiere', action='store_true')   # ajuste la courbe de tons sur la PREMIERE vue seule (la photo)
args = ap.parse_args(); os.makedirs(args.sortie, exist_ok=True)
T0 = time.time()
def log(*a): print('[%5.1fs]' % (time.time() - T0), *a, flush=True)
scene = trimesh.load(args.glb, force='scene', process=False); mesh = list(scene.geometry.values())[0]
mat = mesh.visual.material
ATLAS = np.asarray((getattr(mat, 'baseColorTexture', None) or getattr(mat, 'image', None)).convert('RGB')); AH = ATLAS.shape[0]
acc = np.zeros((AH, AH, 3), np.float32); W = np.zeros((AH, AH), np.float32); W_TON = None; accT = np.zeros((AH, AH, 3), np.float32)
for v in args.vues:
    d, _, p = v.rpartition(':')
    try:
        pv = float(p); 
    except ValueError:
        d, pv = v, 1.0
    n = np.load(os.path.join(d, 'nouveau.npy')); w = np.load(os.path.join(d, 'poids.npy')).astype(np.float32) / 255.0 * pv
    acc += n.astype(np.float32) * w[..., None]; W += w
    if W_TON is None:
        W_TON = np.minimum(w, 1.0).copy(); accT = n.astype(np.float32) * w[..., None]
    log('vue', d, 'poids', pv, ': %.2f %% des texels' % (100.0 * float((w > 0.5).mean())))
    del n, w
NOUVEAU = np.clip(acc / np.maximum(W, 1e-4)[..., None], 0, 255).astype(np.uint8); del acc
POIDS = (np.minimum(W, 1.0) * 255).astype(np.uint8)
if args.remplir > 0:
    kk = 2 * args.remplir + 1
    for _passe in range(2):
        wf = POIDS.astype(np.float32) / 255.0
        wsum = cv2.boxFilter(wf, -1, (kk, kk), normalize=False); moy = wsum / float(kk * kk)
        cible = (wf < 0.5) & (moy > 0.15)
        if not cible.any():
            break
        for c in range(3):
            csum = cv2.boxFilter(NOUVEAU[..., c].astype(np.float32) * wf, -1, (kk, kk), normalize=False)
            NOUVEAU[..., c] = np.where(cible, np.clip(csum / np.maximum(wsum, 1e-6), 0, 255), NOUVEAU[..., c]).astype(np.uint8)
        POIDS = np.where(cible, np.clip(moy * 1.5, 0, 1) * 255, POIDS).astype(np.uint8)
        log('comblement passe %d : %d texels' % (_passe + 1, int(cible.sum())))
    del wf, wsum, moy, cible
log('combinaison : %.2f %% des texels avec poids > 0,5' % (100.0 * float((W > 0.5).mean())))
# ───────────── calage des couleurs (basse frequence de l'atlas) puis melange
K = args.echelle_gain; Lr = AH // K
if args.combler_trous > 0:
    zero = (POIDS < 128).astype(np.uint8)
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(zero, connectivity=8)
    petit = np.zeros(nlab, bool); petit[1:] = stats[1:, cv2.CC_STAT_AREA] <= args.combler_trous
    petit[0] = False
    trous = petit[lab] & (zero > 0); del lab
    # le fond (composante 0 = poids >= 128) n'est pas un trou ; on ne comble que les zones sans poids, petites et isolees
    wf_ = (POIDS >= 128).astype(np.float32); sig = 10.0
    den_ = cv2.GaussianBlur(wf_, (0, 0), sig)
    for c in range(3):
        num_ = cv2.GaussianBlur(NOUVEAU[..., c].astype(np.float32) * wf_, (0, 0), sig)
        NOUVEAU[..., c] = np.where(trous, np.clip(num_ / np.maximum(den_, 1e-4), 0, 255), NOUVEAU[..., c]).astype(np.uint8)
        del num_
    POIDS = np.where(trous & (den_ > 0.2), 255, POIDS).astype(np.uint8)
    log('trous combles : %d zones, %d texels' % (int(petit.sum()), int(trous.sum()))); del trous, den_, wf_, zero
w_f = POIDS.astype(np.float32) / 255.0
if args.exclure:
    _ex = np.load(os.path.join(args.exclure, 'poids.npy')).astype(np.float32) / 255.0
    w_f = w_f * (1.0 - np.clip(_ex * 1.5, 0.0, 1.0)); POIDS = (w_f * 255).astype(np.uint8); del _ex
    log('zones deja couvertes par', args.exclure, 'exclues : poids > 0,5 restant %.2f %%' % (100.0 * float((w_f > 0.5).mean())))
def aire(x): return cv2.resize(x, (Lr, Lr), interpolation=cv2.INTER_AREA)
den = aire(w_f)
ATLAST = ATLAS
if not args.sans_ton:
    # ETALONNAGE GLOBAL DES TONS (luminance seulement) : l'atlas TRELLIS est plus pale que la photo. On apprend, sur les zones ou la photo a ete reportee, la courbe de LUMINANCE
    # ancienne texture -> photo (appariement de quantiles des moyennes locales) et on l'applique a TOUT l'atlas comme un facteur commun aux trois canaux : la teinte de chaque texel
    # ne bouge pas (l'appariement canal par canal faisait virer le cochon au vert). Le calage local de couleur traite ensuite la teinte la ou la photo est reportee.
    sel = den > 0.5
    if args.ton_sur_premiere:
        denT = aire(W_TON); sel = denT > 0.5; den_t = denT; NT = np.clip(accT / np.maximum(W_TON, 1e-4)[..., None], 0, 255).astype(np.uint8)
    else:
        den_t = den; W_TON = w_f; NT = NOUVEAU
    Lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    oL = Lum([aire(ATLAS[..., c].astype(np.float32) * W_TON) / np.maximum(den_t, 1e-6) for c in range(3)]); nL = Lum([aire(NT[..., c].astype(np.float32) * W_TON) / np.maximum(den_t, 1e-6) for c in range(3)])
    qs = np.linspace(0.01, 0.99, 50); oq = np.quantile(oL[sel], qs); nq = np.maximum.accumulate(np.quantile(nL[sel], qs))
    x = np.arange(256, dtype=np.float32); l = np.interp(x, oq, nq); l[x < oq[0]] = x[x < oq[0]] + (nq[0] - oq[0]); l[x > oq[-1]] = x[x > oq[-1]] + (nq[-1] - oq[-1])
    lutL = np.clip(l, 0, 255).astype(np.float32)
    fac = np.clip(lutL / np.maximum(x, 10.0), 0.6, 1.6).astype(np.float32); fac[x < 10] = 1.0
    log('ton (luminance) : mediane %.0f -> %.0f ; haut %.0f -> %.0f ; facteurs %.2f a %.2f' % (oq[len(qs) // 2], nq[len(qs) // 2], oq[-1], nq[-1], fac.min(), fac.max()))
    if args.ton_canal:
        raise SystemExit('--ton-canal : voir projeter_source4.py')
    ATLAST = np.empty_like(ATLAS)
    for r_ in range(0, AH, 1024):
        blk = ATLAS[r_:r_ + 1024].astype(np.float32); Li = np.clip(Lum([blk[..., 0], blk[..., 1], blk[..., 2]]), 0, 255).astype(np.uint8)
        ATLAST[r_:r_ + 1024] = np.clip(blk * fac[Li][..., None], 0, 255).astype(np.uint8)
gains = []
for c in range(3):
    n_old = aire(ATLAST[..., c].astype(np.float32) * w_f); n_new = aire(NOUVEAU[..., c].astype(np.float32) * w_f)
    g = (n_old + 12.0 * den + 1e-3) / (n_new + 12.0 * den + 1e-3)
    # lissage normalise par le poids (aucun melange avec les texels non projetes)
    gs = cv2.GaussianBlur(g * den, (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(den, (0, 0), 2.0), 1e-4)
    gs = np.where(cv2.GaussianBlur(den, (0, 0), 2.0) > 1e-3, gs, 1.0)
    gains.append(np.clip(gs, 1.0 / args.gain_max, args.gain_max).astype(np.float32))
if args.gain_global:
    sel_g = POIDS > 128
    ii = np.flatnonzero(sel_g.ravel())[::7]
    gains = []
    for c in range(3):
        go = float(np.median(ATLAST[..., c].ravel()[ii])); gn = float(np.median(NOUVEAU[..., c].ravel()[ii]))
        log('gain global canal %d : %.3f (ancien %.0f, neuf %.0f)' % (c, go / max(gn, 1.0), go, gn))
        gains.append(np.full((Lr, Lr), go / max(gn, 1.0), np.float32))
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
