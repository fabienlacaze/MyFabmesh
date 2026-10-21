# -*- coding: utf-8 -*-
"""Visibilite : pour chaque direction, quels pixels voient une face PAR DERRIERE en premier impact (= on voit l'interieur
du maillage), et ces zones touchent-elles le bord visible d'une vraie boucle de bord (= une ouverture que Fill holes
peut voir) ?

FENETRES (v5) : fond CERNE par du maillage dans la silhouette pleine (on voit a travers l'objet). Un trou traversant d'une
nappe mince fermee a une levre fermee (pli a ~180 degres, voir topologie.plis_levres) : pas d'arete de bord, mais le fond
se voit. Chaque fenetre est rattachee, si possible, a la composante de plis qui la borde.
"""
import numpy as np
from scipy import ndimage

from rasteur import Camera, rasteriser_triangles, rasteriser_segments


class Contexte:
    """Donnees geometriques partagees par toutes les vues d'un maillage."""

    def __init__(self, V, F, centre, rayon, diag, bord_A=None, bord_B=None, bord_boucle=None,
                 lip_A=None, lip_B=None, lip_L=None):
        self.V, self.F = V, F
        self.Nraw = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        self.aire = 0.5 * np.linalg.norm(self.Nraw, axis=1)
        ln = np.linalg.norm(self.Nraw, axis=1)
        self.un = np.divide(self.Nraw, ln[:, None], out=np.zeros_like(self.Nraw), where=ln[:, None] > 0)
        self.valide = self.aire > 0
        self.centre, self.rayon, self.diag = centre, rayon, diag
        self.noir = None          # drapeau par face : texture quasi noire (rempli par l'appelant)
        n = 0 if bord_A is None else len(bord_A)
        self.bA = bord_A if n else np.zeros((0, 3))
        self.bB = bord_B if n else np.zeros((0, 3))
        self.bL = bord_boucle if n else np.zeros(0, np.int32)
        m = 0 if lip_A is None else len(lip_A)
        self.lA = lip_A if m else np.zeros((0, 3))
        self.lB = lip_B if m else np.zeros((0, 3))
        self.lL = lip_L if m else np.zeros(0, np.int32)


def _fenetres(ctx, cam, couvert2, zfirst, S, eps_lip_rel=3e-3, r_cov=2.0, seuil_cov=0.5, min_fen=None, id_premier=None):
    """Fenetres de la vue : composantes du fond cernees par du maillage. Une fenetre est « a levre » quand AU MOINS la moitie
    de son pourtour (anneau de pixels de maillage qui la touche) est a moins de r_cov pixels d'un pli a ~180 degres visible :
    c'est le pourtour d'un trou traversant d'une nappe mince fermee. Une simple ouverture entre deux jambes ou sous un bras
    (pourtour lisse, silhouettes de pieces epaisses) n'a pas de pli sur son pourtour : fenetre « autre ».
    Rend un dict de statistiques et les masques (fen_lip, fen_autre, lip) pour les montages. Chaque fenetre de `fen_liste`
    porte aussi les FACES du pourtour (premier impact des pixels de l'anneau) : ce sont elles qu'un detecteur d'ouvertures doit
    rendre."""
    if min_fen is None:
        min_fen = max(4, int(round(S * S * 2.5e-5)))
    remplie = ndimage.binary_fill_holes(couvert2)
    fen = remplie & ~couvert2
    out = {'sil_px': int(remplie.sum()), 'fen_px': 0, 'fen_cc': 0, 'fen_px_lip': 0, 'fen_cc_lip': 0, 'fen_liste': []}
    masques = {'fen_lip': np.zeros((S, S), bool), 'fen_autre': np.zeros((S, S), bool), 'lip': np.zeros((S, S), bool)}
    if not fen.any():
        return out, masques
    labw, nw = ndimage.label(fen, structure=np.ones((3, 3), bool))
    taille = np.bincount(labw.ravel(), minlength=nw + 1)[1:]
    grandes = taille >= min_fen
    if not grandes.any():
        return out, masques
    lip = np.full(S * S, -1, np.int32)
    if len(ctx.lA):
        xa, ya, za = cam.projeter(ctx.lA)
        xb, yb, zb = cam.projeter(ctx.lB)
        lip = rasteriser_segments(np.stack([xa, xb], 1), np.stack([ya, yb], 1), np.stack([za, zb], 1), ctx.lL, S, zfirst,
                                  eps_lip_rel * ctx.diag)
    lip2 = lip.reshape(S, S)
    masques['lip'] = lip2 >= 0
    boucle_de = np.full(nw, -1, np.int32)
    if masques['lip'].any():
        dist, (iy, ix) = ndimage.distance_transform_edt(~masques['lip'], return_indices=True)
        anneau = ndimage.binary_dilation(fen, structure=np.ones((3, 3), bool), iterations=2) & ~fen
        lab_anneau = ndimage.grey_dilation(labw, size=(5, 5))          # etiquette de la fenetre la plus proche (anneau)
        ra = anneau & (lab_anneau > 0)
        tot_a = np.bincount(lab_anneau[ra], minlength=nw + 1)[1:].astype(float)
        pres = ra & (dist <= r_cov)
        lip_a = np.bincount(lab_anneau[pres], minlength=nw + 1)[1:].astype(float)
        couverture = np.divide(lip_a, np.maximum(tot_a, 1.0))
        # boucle dominante : etiquette de pli la plus frequente sur l'anneau, par fenetre
        ys, xs = np.nonzero(pres)
        if len(ys):
            lp = lip2[iy[ys, xs], ix[ys, xs]].astype(np.int64)
            cles = lab_anneau[ys, xs].astype(np.int64) * 1_000_003 + lp
            u, n_ = np.unique(cles, return_counts=True)
            comp_u, lp_u = u // 1_000_003, u % 1_000_003
            ordre = np.lexsort((n_, comp_u))
            for kk in ordre:                                              # le dernier d'une fenetre est le plus frequent
                boucle_de[comp_u[kk] - 1] = lp_u[kk]
        boucle_de[(couverture < seuil_cov) | ~grandes] = -1
    lipw = (boucle_de >= 0) & grandes
    out['fen_px'] = int(taille[grandes].sum())
    out['fen_cc'] = int(grandes.sum())
    out['fen_px_lip'] = int(taille[lipw].sum())
    out['fen_cc_lip'] = int(lipw.sum())
    faces_anneau = {}
    if id_premier is not None:
        anneau = ndimage.binary_dilation(fen, structure=np.ones((3, 3), bool), iterations=2) & ~fen
        lab_anneau = ndimage.grey_dilation(labw, size=(5, 5))
        ra = anneau & (lab_anneau > 0) & (id_premier >= 0)
        if ra.any():
            cles = np.unique(lab_anneau[ra].astype(np.int64) * 4_000_000_007 + id_premier[ra].astype(np.int64))
            for kk, ff in zip(cles // 4_000_000_007, cles % 4_000_000_007):
                faces_anneau.setdefault(int(kk) - 1, []).append(int(ff))
    out['fen_liste'] = [(int(taille[k]), int(boucle_de[k]), np.asarray(faces_anneau.get(k, []), np.int64))
                        for k in range(nw) if grandes[k]]
    cible_lip = np.zeros(nw + 1, bool)
    cible_lip[1:] = lipw
    cible_autre = np.zeros(nw + 1, bool)
    cible_autre[1:] = grandes & ~lipw
    masques['fen_lip'] = cible_lip[labw]
    masques['fen_autre'] = cible_autre[labw]
    return out, masques


def calculer_vue(ctx, d, S, eps_rel=2e-4, eps_bord_rel=3e-3, r_rim=4.0, min_pix=4, garder=False, g_visuel=0.005):
    """Rend un dict de statistiques (et, si garder, les tampons) pour la direction de visee d."""
    cam = Camera(ctx.centre, ctx.rayon, d, S)
    px, py, z = cam.projeter(ctx.V)
    facing = (ctx.Nraw @ cam.d) < 0
    F = ctx.F
    f_idx = np.nonzero(ctx.valide & facing)[0]
    b_idx = np.nonzero(ctx.valide & ~facing)[0]
    Ff, Fb = F[f_idx], F[b_idx]
    zF, idF = rasteriser_triangles(px[Ff], py[Ff], z[Ff], f_idx.astype(np.int32), S)
    zB, idB = rasteriser_triangles(px[Fb], py[Fb], z[Fb], b_idx.astype(np.int32), S)
    eps = eps_rel * ctx.diag
    zfirst = np.minimum(zF, zB)
    couvert = np.isfinite(zfirst)
    arriere = couvert & (zB < zF - eps)
    with np.errstate(invalid='ignore'):
        confondu = np.isfinite(zF) & np.isfinite(zB) & (np.abs(zF - zB) <= eps)
    percant = arriere & ~np.isfinite(zF)
    # TROU VISUEL (rendu a faces simples, ce que montre la visionneuse de l'appli : mat.side = FrontSide) : un pixel dont
    # le premier impact est une face vue par derriere ET dont la premiere face vue par devant est plus loin que
    # g x diagonale (ou n'existe pas). Plus pres que ca, on voit l'autre nappe d'une double peau : pas de trou.
    # L'ecart est mesure PERPENDICULAIREMENT a la face vue par derriere (ecart le long du rayon x |cos|) : deux nappes
    # paralleles a 0,2 % de distance sont a 0,2 % partout, y compris sur le limbe ou le rayon les traverse en biais.
    idB2 = idB.reshape(S, S)
    with np.errstate(invalid='ignore'):
        cos_b = np.abs(ctx.un[np.maximum(idB, 0)] @ cam.d)
        ecart_n = (zF - zB) * cos_b / ctx.diag
        loin = ecart_n > g_visuel
    visuel = arriere & (loin | ~np.isfinite(zF))
    # sensibilite du seuil d'ecart perpendiculaire (fraction de la diagonale)
    visuel_g = {}
    for gg in (0.002, 0.005, 0.01, 0.02):
        visuel_g['%g' % gg] = int((arriere & ((ecart_n > gg) | ~np.isfinite(zF))).sum())
    noir_vu = 0
    if ctx.noir is not None and ctx.noir.any():
        vus = np.isfinite(zF) & ~arriere
        noir_vu = int(ctx.noir[np.maximum(idF, 0)][vus].sum())
    out = {'d': np.asarray(d, float), 'couvert': int(couvert.sum()), 'arriere': int(arriere.sum()), 'noir_vu': noir_vu, 'visuel_g': visuel_g,
           'confondu': int(confondu.sum()), 'percant': int(percant.sum()), 'visuel': int(visuel.sum())}
    id_premier = np.where(zF <= zB, idF, idB).reshape(S, S)
    fen_stats, fen_masques = _fenetres(ctx, cam, couvert.reshape(S, S), zfirst, S, id_premier=id_premier)
    out.update(fen_stats)

    # bord visible des vraies boucles
    rim = np.full(S * S, -1, np.int32)
    if len(ctx.bA) and arriere.any():
        xa, ya, za = cam.projeter(ctx.bA)
        xb, yb, zb = cam.projeter(ctx.bB)
        rim = rasteriser_segments(np.stack([xa, xb], 1), np.stack([ya, yb], 1), np.stack([za, zb], 1),
                                  ctx.bL, S, zfirst, eps_bord_rel * ctx.diag)
    rim2 = rim.reshape(S, S) >= 0
    arriere2 = arriere.reshape(S, S)
    lab = np.zeros((S, S), np.int32)
    nl = 0
    if arriere.any():
        lab, nl = ndimage.label(arriere2, structure=np.ones((3, 3), bool))
    taille = np.bincount(lab.ravel(), minlength=nl + 1)[1:]
    if nl and rim2.any():
        dist, (iy, ix) = ndimage.distance_transform_edt(~rim2, return_indices=True)
        proche = rim.reshape(S, S)[iy, ix]
        mind = np.asarray(ndimage.minimum(dist, lab, index=np.arange(1, nl + 1)))
    else:
        dist = None
        proche = None
        mind = np.full(nl, np.inf)
    cc_e1 = mind <= r_rim
    out['n_cc'] = int(nl)
    out['n_cc_e1'] = int(cc_e1.sum())
    out['pix_petites_cc'] = int(taille[taille < min_pix].sum()) if nl else 0
    out['plus_grande_cc'] = int(taille.max()) if nl else 0
    out['arriere_e1'] = int(taille[cc_e1].sum()) if nl else 0

    ys, xs = np.nonzero(arriere2)
    cc_pix = lab[ys, xs]
    pix_e1 = cc_e1[cc_pix - 1] if nl else np.zeros(0, bool)
    out['_faces'] = idB.reshape(S, S)[ys, xs].astype(np.int32)
    # ecart de profondeur (en fraction de la diagonale) jusqu'a la premiere face vue par DEVANT derriere ce pixel :
    # tout petit = deux nappes collees face a face (paroi mince dont la nappe externe est a l'envers) ; inf = rien derriere
    out['_ecart'] = ecart_n.reshape(S, S)[ys, xs].astype(np.float32)
    out['_e1'] = pix_e1
    out['_cc'] = cc_pix
    if nl and dist is not None:
        out['_boucle'] = np.where(pix_e1, proche[ys, xs], -1).astype(np.int32)
    else:
        out['_boucle'] = np.full(len(ys), -1, np.int32)
    out['_xy'] = np.stack([xs, ys], 1).astype(np.int16)
    out['_cc_taille'] = taille
    out['_cc_e1'] = cc_e1
    if garder:
        out['tampons'] = {'zF': zF.reshape(S, S), 'zB': zB.reshape(S, S), 'idF': idF.reshape(S, S),
                          'idB': idB.reshape(S, S), 'arriere': arriere2, 'rim': rim2, 'lab': lab, 'cc_e1': cc_e1,
                          'confondu': confondu.reshape(S, S), 'cam': cam, 'percant': percant.reshape(S, S),
                          'fen_lip': fen_masques['fen_lip'], 'fen_autre': fen_masques['fen_autre'], 'lip': fen_masques['lip']}
    return out


def balayer_vues(ctx, directions, S, **kw):
    """Calcule toutes les vues. Rend (liste des dicts par vue sans les gros tableaux, tableaux concatenes)."""
    vues = []
    faces, e1, vue_id, boucle, ecart = [], [], [], [], []
    for i, d in enumerate(directions):
        v = calculer_vue(ctx, d, S, **kw)
        faces.append(v.pop('_faces'))
        ecart.append(v.pop('_ecart'))
        e1.append(v.pop('_e1'))
        boucle.append(v.pop('_boucle'))
        v.pop('_cc')
        v.pop('_xy')
        v.pop('_cc_taille')
        v.pop('_cc_e1')
        vue_id.append(np.full(len(faces[-1]), i, np.int16))
        vues.append(v)
    cat = {'faces': np.concatenate(faces) if faces else np.zeros(0, np.int32),
           'e1': np.concatenate(e1) if e1 else np.zeros(0, bool),
           'boucle': np.concatenate(boucle) if boucle else np.zeros(0, np.int32),
           'ecart': np.concatenate(ecart) if ecart else np.zeros(0, np.float32),
           'vue': np.concatenate(vue_id) if vue_id else np.zeros(0, np.int16)}
    return vues, cat
