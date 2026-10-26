# -*- coding: utf-8 -*-
"""Diagnostic de MATIERE d'un maillage GLB (20/10/2026) : qu'est-ce, exactement, qu'une « zone sans matiere » ?

Contexte : Fill holes ne bouche que les boucles d'aretes de bord. Le proprietaire constate des zones ou il manque de la
matiere que l'outil « ne detecte pas du tout ». Ce banc mesure, sur de VRAIS maillages, ce qui est reellement la :

  (a) aretes de bord brutes (une par couture d'UV) contre aretes de bord apres soudure par position (vraies boucles),
      distribution de leurs tailles, sensibilite a la tolerance de soudure ;
  (b) aretes non-manifold, sommets pince / noeud papillon, composantes connexes, petites composantes flottantes ;
  (c) coherence d'orientation : aretes incoherentes (W), triangles replies (G), aire dont la normale s'oppose a celle d'un
      voisin (mesure historique), feuilles « retournees », orientation globale (volume signe) ;
  (d) VISIBILITE : fraction des pixels dont le PREMIER impact est une face vue par DERRIERE, depuis N directions ;
  (e) structures internes : double peau, parois minces, coques interieures, vide enferme ;
  (f) CARTE DES ZONES : a quoi s'explique chaque pixel « arriere visible » : 0 vraie boucle de bord visible, 1 patch
      retourne, 2 double peau, 3 paroi mince, 4 AUCUNE des trois (= zone sans matiere non detectable par la topologie).

Usage (interprete de l'appli ; numpy + scipy + PIL seulement) :
  python diagnostic_matiere.py analyser <glb> --nom NOM --sortie DOSSIER [--montages DOSSIER_PNG] [--taille 768]
                                       [--vues cube26|ico42|tout] [--sans-structures] [--origine TEXTE]
  python diagnostic_matiere.py corpus <corpus.json> --sortie DOSSIER [--montages DOSSIER_PNG] [--seulement nom,nom]
Sorties : <sortie>/resultats/<nom>.json (mesures) et <sortie>/zones/<nom>.json (liste des zones de reference, pour evaluer
plus tard le RAPPEL d'un detecteur : chaque zone porte ses faces, sa position et sa cause).
"""
import argparse
import base64
import json
import os
import sys
import time
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_lecture import Glb, fusionner  # noqa: E402
from rasteur import directions_26, directions_icosphere  # noqa: E402
from structures import Rayons, coques_internes, epaisseurs, evaluer_proximite  # noqa: E402
from topologie import (Aretes, boucles_de_bord, composantes_faces, feuilles_orientation, plis_levres,  # noqa: E402
                       histogramme_boucles, normales_faces, souder, souder_arrondi_produit, sommets_singuliers,
                       volume_signe)
from visibilite import Contexte, balayer_vues, calculer_vue  # noqa: E402

VERSION_OUTIL = 7   # a incrementer a chaque changement de mesure : les resultats d'une autre version sont a refaire
CATEGORIES = ['bord', 'retourne', 'double_peau', 'mince', 'aucune', 'non_evalue']
TOLERANCES = [1e-6, 1e-5, 1e-4, 1e-3]


def _pct(x, y):
    return round(100.0 * x / y, 4) if y else 0.0


def pic_ram_mo():
    """Pic de memoire residente du processus (Mo), Windows : GetProcessMemoryInfo ; None ailleurs."""
    try:
        import ctypes
        from ctypes import wintypes

        class PMC(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD),
                        ('PeakWorkingSetSize', ctypes.c_size_t), ('WorkingSetSize', ctypes.c_size_t),
                        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
                        ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t)]
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        psapi = ctypes.WinDLL('psapi', use_last_error=True)
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
        c = PMC()
        c.cb = ctypes.sizeof(PMC)
        if psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb):
            return int(c.PeakWorkingSetSize / 1048576)
    except Exception:
        pass
    return None


def _compresser_ids(ids):
    ids = np.sort(np.asarray(ids, np.int64))
    delta = np.diff(ids, prepend=0).astype('<i4')
    return base64.b64encode(zlib.compress(delta.tobytes(), 9)).decode('ascii')


def decompresser_ids(txt):
    delta = np.frombuffer(zlib.decompress(base64.b64decode(txt)), dtype='<i4')
    return np.cumsum(delta.astype(np.int64))


def _jsonable(o):
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return _jsonable(o.tolist())
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, float):
        return None if not np.isfinite(o) else o
    return o


# ---------------------------------------------------------------------------------------------- topologie
def _souder_faces(V, F, rel):
    Wi, Vw, pas = souder(V, rel)
    Fw = Wi[F]
    ok = (Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])
    return Wi, Vw, Fw, ok


def mesurer_topologie(V, F, diag, aire_tot):
    """Mesures (a) (b) (c). Rend (dict JSON, objets internes pour la suite)."""
    res = {}
    # ---- brutes
    ar_brut = Aretes(F, len(V))
    res['aretes_bord_brutes'] = int((ar_brut.cnt == 1).sum())
    res['aretes_total_brutes'] = int(len(ar_brut.cnt))
    # ---- sensibilite a la tolerance
    sens = {}
    for rel in TOLERANCES:
        Wi, Vw, Fw, ok = _souder_faces(V, F, rel)
        ar = Aretes(Fw[ok], len(Vw))
        nb = int((ar.cnt == 1).sum())
        sens['%g' % rel] = {'sommets_soudes': int(len(Vw)), 'aretes_bord': nb,
                            'faces_degenerees': int((~ok).sum()), 'aretes_non_manifold': int((ar.cnt > 2).sum())}
    res['sensibilite_soudure'] = sens
    # ce que voit la garde 1 du produit (soudure par arrondi sur une grille), pour comparer a la soudure par distance
    res['aretes_bord_garde1_produit'] = souder_arrondi_produit(V, F, 1e-5)
    # ---- soudure de reference
    rel = 1e-5
    Wi, Vw, Fw, ok = _souder_faces(V, F, rel)
    face_map = np.nonzero(ok)[0]
    Fs = Fw[ok]
    ar = Aretes(Fs, len(Vw))
    res['soudure_reference'] = {'tolerance_rel_diag': rel, 'sommets_bruts': int(len(V)), 'sommets_soudes': int(len(Vw)),
                                'faces': int(len(F)), 'faces_degenerees_apres_soudure': int((~ok).sum())}
    # doublons de faces
    tri = np.sort(Fs, axis=1)
    _, cnt_t = np.unique(tri, axis=0, return_counts=True)
    res['faces_dupliquees'] = int((cnt_t[cnt_t > 1] - 1).sum())
    # boucles
    bo = boucles_de_bord(Vw, Fs, len(Vw), ar)
    res['aretes_bord_soudees'] = int((ar.cnt == 1).sum())
    res['aretes_non_manifold'] = int((ar.cnt > 2).sum())
    res['aretes_manifold'] = int((ar.cnt == 2).sum())
    res['boucles'] = {'n': int(bo['n'])}
    if bo['n']:
        perim_rel = bo['perimetre'] / diag
        res['boucles'].update({
            'simples': int(bo['simple'].sum()),
            'histogramme': histogramme_boucles(bo['n_aretes'], perim_rel),
            'n_aretes_max': int(bo['n_aretes'].max()),
            'n_aretes_mediane': float(np.median(bo['n_aretes'])),
            'perimetre_rel_max': float(perim_rel.max()),
            'perimetre_rel_median': float(np.median(perim_rel)),
            'aire_ouverture_rel2_max': float((bo['aire_ouverture'] / diag ** 2).max()),
            'aretes_total': int(bo['n_aretes'].sum())})
        ordre = np.argsort(-bo['perimetre'])[:12]
        res['boucles']['plus_grandes'] = [
            {'id': int(i), 'n_aretes': int(bo['n_aretes'][i]), 'perimetre_rel': round(float(perim_rel[i]), 5),
             'aire_ouverture_rel2': round(float(bo['aire_ouverture'][i] / diag ** 2), 6), 'simple': bool(bo['simple'][i]),
             'centre': [round(float(x), 4) for x in bo['centre'][i]]} for i in ordre]
        # ce que le curseur actuel (desktop : 3 a 2000 aretes) laisserait de cote
        res['boucles']['hors_curseur_desktop_3_2000'] = int(((bo['n_aretes'] < 3) | (bo['n_aretes'] > 2000)).sum())
    # singularites
    sing = sommets_singuliers(Fs, ar)
    res['sommets_pince'] = int(len(sing))
    # composantes
    nc, lab = composantes_faces(Fs, ar)
    _, _, un_all = normales_faces(V, F)
    nrm, aire_all, un_all = normales_faces(V, F)
    aire_s = aire_all[ok]
    aire_c = np.bincount(lab, weights=aire_s, minlength=nc)
    nf_c = np.bincount(lab, minlength=nc)
    ordre = np.argsort(-aire_c)
    res['composantes'] = {'n': int(nc), 'n_ge_1pct_aire': int((aire_c >= 0.01 * aire_s.sum()).sum()),
                          'plus_grande_aire_pct': _pct(aire_c.max(), aire_s.sum()),
                          'flottantes_lt_1pct': [
                              {'faces': int(nf_c[i]), 'aire_pct': _pct(aire_c[i], aire_s.sum())}
                              for i in ordre[1:11] if aire_c[i] < 0.01 * aire_s.sum()],
                          'petites_composantes_n': int((nf_c < 50).sum()) if nc > 1 else 0}
    # orientation
    ori = feuilles_orientation(Fs, un_all[ok], aire_s, ar, lab)
    sv = volume_signe(V, F[ok])
    res['orientation'] = {
        'aretes_manifold': ori['aretes_manifold'], 'aretes_incoherentes_W': ori['aretes_W'],
        'aretes_pli_ou_replie_G': ori['aretes_G'],
        'pct_aretes_incoherentes': _pct(ori['aretes_W'], ori['aretes_manifold']),
        'aire_normale_opposee_a_un_voisin_pct': _pct(aire_s[ori['oppose_voisin_face']].sum(), aire_s.sum()),
        'feuilles': int(ori['n_feuilles']),
        'aire_feuilles_retournees_pct': _pct(aire_s[ori['retournee_face']].sum(), aire_s.sum()),
        'volume_signe_rel': round(sv / diag ** 3, 6),
        'orientation_globale': 'inversee' if sv < 0 else 'normale'}
    # composantes FERMEES a volume signe negatif : toute une coque a l'envers (aucun conflit d'orientation a ses bords,
    # donc invisible pour les feuilles) ; elle se voit a l'envers de partout
    hb = ar.bord()
    ouverte = np.zeros(nc, bool)
    if len(hb):
        ouverte[lab[hb // 3]] = True
    a_, b_, c_ = Vw[Fs[:, 0]], Vw[Fs[:, 1]], Vw[Fs[:, 2]]
    vol_f = (a_ * np.cross(b_, c_)).sum(1) / 6.0
    vol_c = np.bincount(lab, weights=vol_f, minlength=nc)
    inversee = (~ouverte) & (vol_c < 0)
    res['orientation']['composantes_fermees'] = int((~ouverte).sum())
    res['orientation']['composantes_fermees_inversees'] = int(inversee.sum())
    res['orientation']['aire_composantes_inversees_pct'] = _pct(aire_s[inversee[lab]].sum(), aire_s.sum())
    # faces touchant une arete NON MANIFOLD (3 faces ou plus) : la, plusieurs nappes sont soudees ensemble et leur orientation
    # relative ne se lit plus (les feuilles s'arretent aux conflits entre deux faces, pas aux aretes a trois)
    marque = np.repeat(ar.cnt > 2, ar.cnt)
    nm_face = np.zeros(len(Fs), bool)
    nm_face[ar.ordre[marque] // 3] = True
    # PLIS A ~180 DEGRES (levres) : le pourtour d'un trou traversant d'une nappe mince fermee n'est pas un bord ouvert
    lev = plis_levres(Vw, Fs, un_all[ok], ar)
    res['plis_levres'] = {
        'aretes': lev['n'], 'pct_des_aretes_manifold': _pct(lev['n'], lev['aretes_manifold']),
        'composantes': lev['n_comp'],
        'composantes_ge_20_aretes': int((lev['n_aretes'] >= 20).sum()) if lev['n_comp'] else 0,
        'aretes_mediane_par_composante': float(np.median(lev['n_aretes'])) if lev['n_comp'] else 0.0,
        'perimetre_rel_max': float(lev['perimetre'].max() / diag) if lev['n_comp'] else 0.0}
    interne = {'lev': lev, 'nm_face': nm_face, 'comp_inversee_face': inversee[lab], 'Vw': Vw, 'Fs': Fs, 'ar': ar, 'bo': bo, 'face_map': face_map, 'ok': ok, 'ori': ori, 'lab': lab, 'nc': nc,
               'aire_all': aire_all, 'un_all': un_all, 'sv': sv, 'Wi': Wi}
    return res, interne


# ---------------------------------------------------------------------------------------------- orchestrateur
def _directions(nom):
    if nom == 'cube26':
        return directions_26()
    if nom == 'ico42':
        return directions_icosphere(1)
    return np.concatenate([directions_26(), directions_icosphere(1)])


def analyser(chemin, nom, S=768, vues='cube26', structures=True, montages=None, graine=0, origine='', journal=print,
             texture=True):
    t0 = time.time()
    rng = np.random.default_rng(graine)

    def etape(txt):
        journal('[%s] %6.1f s  %s' % (nom, time.time() - t0, txt))
        try:
            sys.stdout.flush()
        except Exception:
            pass

    g = Glb(chemin)
    prims = g.primitives()
    V, F, UV, mat, pid = fusionner(prims)
    F = F.astype(np.int64)
    ref = np.unique(F)
    Vr = V[ref]
    lo, hi = Vr.min(0), Vr.max(0)
    diag = float(np.linalg.norm(hi - lo))
    centre = (lo + hi) / 2
    rayon = float(np.linalg.norm(Vr - centre, axis=1).max())
    nF = len(F)
    nrm, aire_all, un_all = normales_faces(V, F)
    aire_tot = float(aire_all.sum())
    etape('charge : %d sommets, %d faces, diag %.4g, primitives %d' % (len(V), nF, diag, len(prims)))

    res = {'version_outil': VERSION_OUTIL, 'nom': nom, 'source': chemin.replace('\\', '/'), 'origine': origine, 'taille_fichier': g.taille,
           'faces': int(nF), 'sommets_bruts': int(len(V)), 'diag': diag, 'aire_totale': aire_tot,
           'primitives': len(prims), 'materiaux': g.materiaux(), 'avec_uv': UV is not None,
           'faces_de_depart_pour_mesure': int(nF), 'versions': {'S': S, 'vues': vues}}

    # ---------------- topologie
    topo, it = mesurer_topologie(V, F, diag, aire_tot)
    res['topologie'] = topo
    etape('topologie : bord brut %d, bord soude %d, boucles %d, non-manifold %d, pince %d, composantes %d' % (
        topo['aretes_bord_brutes'], topo['aretes_bord_soudees'], topo['boucles']['n'], topo['aretes_non_manifold'],
        topo['sommets_pince'], topo['composantes']['n']))
    Vw, Fs, ar, bo, face_map, ori = it['Vw'], it['Fs'], it['ar'], it['bo'], it['face_map'], it['ori']

    # drapeaux par face brute
    retourne_raw = np.zeros(nF, bool)
    retourne_raw[face_map] = ori['retournee_face']
    retourne_raw[face_map] |= it['comp_inversee_face']
    nm_raw = np.zeros(nF, bool)
    nm_raw[face_map] = it['nm_face']
    conflit_raw = np.zeros(nF, bool)
    conflit_raw[face_map] = ori['conflit_face']
    comp_raw = np.full(nF, it['nc'], np.int64)
    comp_raw[face_map] = it['lab']

    # ---------------- visibilite
    dirs = _directions(vues)
    bA = Vw[bo['ha']] if bo['n'] else None
    bB = Vw[bo['hb']] if bo['n'] else None
    bL = bo['arete_boucle'].astype(np.int32) if bo['n'] else None
    lev = it['lev']
    ctx = Contexte(V, F, centre, rayon, diag, bA, bB, bL,
                   Vw[lev['a']] if lev['n'] else None, Vw[lev['b']] if lev['n'] else None,
                   lev['comp'].astype(np.int32) if lev['n'] else None)
    noir_face = np.zeros(nF, bool)
    if texture and UV is not None:
        try:
            res['texture'], noir_face, alpha_face = mesurer_texture(g, prims, UV, F, mat, aire_all, etape)
        except Exception as e:  # la texture est secondaire
            res['texture'] = {'erreur': '%s: %s' % (type(e).__name__, e)}
    ctx.noir = noir_face
    vues_res, cat = balayer_vues(ctx, dirs, S)
    etape('visibilite : %d vues' % len(vues_res))
    couvert = np.array([v['couvert'] for v in vues_res], float)
    arriere = np.array([v['arriere'] for v in vues_res], float)
    pct_vue = 100.0 * arriere / np.maximum(couvert, 1)
    vis = {'directions': len(dirs), 'taille_image': S, 'pixels_objet_moyen': float(couvert.mean()),
           'arriere_pct_moyen': round(float(pct_vue.mean()), 4), 'arriere_pct_max_vue': round(float(pct_vue.max()), 4),
           'vue_max': int(pct_vue.argmax()), 'arriere_pct_global': _pct(arriere.sum(), couvert.sum()),
           'percant_pct_global': _pct(sum(v['percant'] for v in vues_res), couvert.sum()),
           'trou_visuel_pct_global': _pct(sum(v['visuel'] for v in vues_res), couvert.sum()),
           'texture_noire_visible_pct_global': _pct(sum(v['noir_vu'] for v in vues_res), couvert.sum()),
           'trou_visuel_pct_par_seuil_ecart': {k: _pct(sum(v['visuel_g'][k] for v in vues_res), couvert.sum())
                                               for k in vues_res[0]['visuel_g']},
           'trou_visuel_pct_max_vue': round(float(max(100.0 * v['visuel'] / max(v['couvert'], 1) for v in vues_res)), 4),
           'confondu_pct_global': _pct(sum(v['confondu'] for v in vues_res), couvert.sum()),
           'vues_avec_arriere_gt_0_1pct': int((pct_vue > 0.1).sum()),
           'pix_petites_cc_pct_des_arriere': _pct(sum(v['pix_petites_cc'] for v in vues_res), arriere.sum()),
           'par_vue': [{'d': [round(float(x), 3) for x in v['d']], 'couvert': v['couvert'], 'arriere': v['arriere'],
                        'percant': v['percant'], 'visuel': v['visuel'], 'cc': v['n_cc'], 'cc_bord': v['n_cc_e1'],
                        'fen_px': v['fen_px'], 'sil_px': v['sil_px']}
                       for v in vues_res]}
    sil = float(sum(v['sil_px'] for v in vues_res))
    fpx = float(sum(v['fen_px'] for v in vues_res))
    fenetres = {
        'pixels_silhouette_pleine_moyen': float(np.mean([v['sil_px'] for v in vues_res])),
        'pct_global': _pct(fpx, sil),
        'pct_max_vue': round(float(max(100.0 * v['fen_px'] / max(v['sil_px'], 1) for v in vues_res)), 4),
        'composantes_total': int(sum(v['fen_cc'] for v in vues_res)),
        'part_bordee_par_pli_pct': _pct(sum(v['fen_px_lip'] for v in vues_res), fpx) if fpx else 0.0,
        'composantes_bordees_par_pli': int(sum(v['fen_cc_lip'] for v in vues_res)),
        'vues_avec_fenetre_gt_0_1pct': int(sum(1 for v in vues_res if 100.0 * v['fen_px'] / max(v['sil_px'], 1) > 0.1)),
        'par_vue': [{'fen_px': v['fen_px'], 'sil_px': v['sil_px'], 'fen_cc': v['fen_cc'], 'fen_px_lip': v['fen_px_lip']}
                    for v in vues_res]}
    res['fenetres'] = fenetres
    res['visibilite'] = vis
    etape('fenetres (fond cerne) : %.3f %% de la silhouette, dont %.1f %% bordees par un pli' % (fenetres['pct_global'], fenetres['part_bordee_par_pli_pct']))
    etape('arriere visible : moyenne %.4f %%, max vue %.4f %%' % (vis['arriere_pct_moyen'], vis['arriere_pct_max_vue']))

    # ---------------- carte des zones : categories des pixels arriere
    f_pix = cat['faces']
    e1 = cat['e1']
    n_arr = len(f_pix)
    flag_dbl = np.zeros(nF, bool)
    flag_mnc = np.zeros(nF, bool)
    evalue = np.zeros(nF, bool)
    C = None
    arbre = None
    if n_arr:
        from scipy.spatial import cKDTree
        C = (V[F[:, 0]] + V[F[:, 1]] + V[F[:, 2]]) / 3.0
        cand = np.unique(f_pix[~e1])
        cap = 60000
        if len(cand) > cap:
            cand = rng.choice(cand, cap, replace=False)
        if len(cand):
            arbre = cKDTree(C[aire_all > 0])
            vivantes = np.nonzero(aire_all > 0)[0]
            # arbre sur les faces non degenerees ; remap des indices
            d_, m_ = evaluer_proximite_remap(cand, C, un_all, aire_all, it['Wi'][F], diag, arbre, vivantes)
            flag_dbl[cand] = d_
            flag_mnc[cand] = m_
            evalue[cand] = True
    # preuve DIRECTE par pixel : ecart de profondeur jusqu'a la premiere face vue par devant derriere lui
    ecart = cat['ecart']
    aire_comp_tot = np.bincount(comp_raw, weights=aire_all, minlength=int(comp_raw.max()) + 1)
    comp_aire_pct = 100.0 * aire_comp_tot[comp_raw] / max(aire_tot, 1e-30)
    cls = np.full(n_arr, 4, np.int8)
    cls[flag_mnc[f_pix]] = 3
    cls[flag_dbl[f_pix]] = 2
    cls[ecart <= 0.01] = 3
    cls[ecart <= 0.002] = 2
    cls[retourne_raw[f_pix]] = 1
    cls[e1] = 0
    non_ev = (cls == 4) & (~evalue[f_pix]) & (ecart > 0.01)
    # une face jamais evaluee par la proximite (plafond) et sans face derriere proche reste « aucune » mais est signalee
    n_non_ev = int(non_ev.sum())
    cnt = np.bincount(cls, minlength=6)
    aucune_percant = int(((cls == 4) & ~np.isfinite(ecart)).sum())
    tot_cov = float(couvert.sum())
    carte = {'pixels_arriere_total': int(n_arr), 'pixels_objet_total': int(tot_cov)}
    for i, nm in enumerate(CATEGORIES):
        carte[nm] = {'pixels': int(cnt[i]), 'pct_des_arriere': _pct(cnt[i], n_arr), 'pct_des_pixels_objet': _pct(cnt[i], tot_cov)}
    # part de chaque categorie qui est un TROU VISUEL (rendu a faces simples : rien d'autre que du vide ou un mur interieur
    # derriere la face vue par derriere ; une double peau montre l'autre nappe, ce n'est pas un trou)
    if n_arr:
        visuel_pix = ~(ecart <= 0.005)
        carte['trou_visuel'] = {'pixels': int(visuel_pix.sum()), 'pct_des_pixels_objet': _pct(visuel_pix.sum(), tot_cov)}
        for i, nm in enumerate(CATEGORIES):
            carte['trou_visuel'][nm] = int((visuel_pix & (cls == i)).sum())
    else:
        carte['trou_visuel'] = {'pixels': 0, 'pct_des_pixels_objet': 0.0}
    carte['faces_arriere_distinctes'] = int(len(np.unique(f_pix))) if n_arr else 0
    carte['faces_evaluees_proximite'] = int(evalue.sum())
    carte['aucune_detail'] = {'sans_rien_derriere_percant': aucune_percant,
                              'avec_face_avant_plus_loin': int(cnt[4]) - aucune_percant,
                              'dont_faces_non_evaluees_par_proximite': n_non_ev,
                              # parmi les pixels « aucune » : ceux dont la face est a cote d'un conflit d'orientation (arete
                              # W ou G) : un patch retourne PLUS GRAND que son voisinage (les feuilles ne tranchent pas), et
                              # ceux dont la face est un bord de composante flottante
                              'sur_face_en_conflit_orientation': int(((cls == 4) & conflit_raw[f_pix]).sum()),
                              'sur_face_composante_flottante': int(((cls == 4) & (comp_aire_pct[f_pix] < 5.0)).sum()),
                              'sur_face_a_arete_non_manifold': int(((cls == 4) & nm_raw[f_pix]).sum())}
    if n_arr:
        fin = np.isfinite(ecart)
        carte['ecart_derriere_rel_diag'] = {
            'pixels_sans_face_derriere_pct': _pct((~fin).sum(), n_arr),
            'p25': float(np.percentile(ecart[fin], 25)) if fin.any() else None,
            'mediane': float(np.median(ecart[fin])) if fin.any() else None,
            'p75': float(np.percentile(ecart[fin], 75)) if fin.any() else None}
    # indicateurs non exclusifs
    if n_arr:
        carte['non_exclusif'] = {
            'pixels_sur_face_retournee_pct': _pct(retourne_raw[f_pix].sum(), n_arr),
            'pixels_sur_face_en_conflit_orientation_pct': _pct(conflit_raw[f_pix].sum(), n_arr),
            'pixels_sur_face_double_peau_pct': _pct(flag_dbl[f_pix].sum(), n_arr),
            'pixels_sur_face_mince_pct': _pct(flag_mnc[f_pix].sum(), n_arr)}
    res['carte_zones'] = carte
    etape('carte : ' + ', '.join('%s %d' % (nm, cnt[i]) for i, nm in enumerate(CATEGORIES)))

    # ---------------- zones de reference
    zones = construire_zones(nom, V, F, C, aire_all, aire_tot, diag, f_pix, e1, cat, cls, retourne_raw, face_map, ar, bo,
                             cat['ecart'], vues_res)
    ajouter_zones_fenetres(zones, vues_res, it['lev'], it['face_map'], Vw, diag, V, nF)
    res['zones_resume'] = {'zones_bord': len(zones['bord']), 'zones_faces': len(zones['faces']),
                           'zones_fenetres_levre': len(zones['fenetres']),
                           'boucles_invisibles': zones['boucles_invisibles']}

    # ---------------- structures internes
    if structures:
        res['structures'] = mesurer_structures(V, F, C, un_all, aire_all, aire_tot, diag, it, arbre, rng, etape,
                                               nF)
    # ---------------- montage
    if montages:
        try:
            res['montages'] = faire_montages(nom, ctx, dirs, vis, S, retourne_raw, flag_dbl, flag_mnc, evalue,
                                             un_all, C, montages, etape)
        except Exception as e:
            import traceback
            traceback.print_exc()
            res['montages'] = {'erreur': '%s: %s' % (type(e).__name__, e)}
    res['duree_s'] = round(time.time() - t0, 1)
    res['pic_ram_mo'] = pic_ram_mo()
    return res, zones


def evaluer_proximite_remap(ids, C, un, aire, Fw, diag, arbre, vivantes):
    """evaluer_proximite sur un arbre construit seulement sur les faces non degenerees (indices `vivantes`)."""
    from structures import evaluer_proximite as ep
    import itertools
    ids = np.asarray(ids, np.int64)
    n = len(ids)
    t_double, t_mince = 0.002, 0.01
    arete = np.sqrt(4.0 * aire[ids] / np.sqrt(3.0))
    # rayon plafonne a 5 % de la diagonale : un triangle geant (eventail de comblement) ramenerait tout le maillage
    rayon = np.minimum(np.maximum(2.0 * arete, 1.2 * t_mince * diag), 0.05 * diag)
    listes = arbre.query_ball_point(C[ids], r=rayon)
    lens = np.fromiter((len(l) for l in listes), dtype=np.int64, count=n)
    tot = int(lens.sum())
    dbl = np.zeros(n, bool)
    mnc = np.zeros(n, bool)
    if tot == 0:
        return dbl, mnc
    g = vivantes[np.fromiter(itertools.chain.from_iterable(listes), dtype=np.int64, count=tot)]
    prop = np.repeat(np.arange(n), lens)
    f = ids[prop]
    garde = g != f
    g, prop, f = g[garde], prop[garde], f[garde]
    delta = C[g] - C[f]
    dn = np.abs((delta * un[f]).sum(1))
    opp = (un[g] * un[f]).sum(1)
    lat = np.linalg.norm(delta - ((delta * un[f]).sum(1))[:, None] * un[f], axis=1)
    partage = (Fw[g][:, :, None] == Fw[f][:, None, :]).any(axis=(1, 2))
    base = (~partage) & (opp < -0.7) & (lat <= 2.0 * arete[prop] + 0.002 * diag)
    dbl = np.bincount(prop[base & (dn <= t_double * diag)], minlength=n) > 0
    mnc = np.bincount(prop[base & (dn <= t_mince * diag)], minlength=n) > 0
    return dbl, mnc


def ajouter_zones_fenetres(zones, vues_res, lev, face_map, Vw, diag, V, nF):
    """Zones « fenetre » : une par composante de plis qui borde au moins une fenetre (fond cerne) dans au moins une vue
    (fenetres A LEVRE), plus le total des fenetres SANS pli (autres ouvertures : entre deux jambes, panneau manquant...).
    Reference de rappel `reference_fenetres` : les faces du POURTOUR de chaque fenetre (premier impact des pixels de l'anneau
    qui la cerne), ponderees par la taille de la fenetre ; `par_categorie` separe `avec_pli` et `sans_pli`."""
    lo = V.min(0)
    par = {}
    poids = {'avec_pli': {}, 'sans_pli': {}}
    px_cat = {'avec_pli': 0, 'sans_pli': 0}
    for v in vues_res:
        for taille, boucle, faces in v['fen_liste']:
            cat_ = 'avec_pli' if boucle >= 0 else 'sans_pli'
            px_cat[cat_] += taille
            if len(faces):
                w = taille / len(faces)
                for f in faces:
                    poids[cat_][int(f)] = poids[cat_].get(int(f), 0.0) + w
            if boucle >= 0:
                e = par.setdefault(boucle, [0, 0])
                e[0] += taille
                e[1] += 1
    zones['fenetres'] = []
    zones['fenetres_sans_pli_pixels'] = int(px_cat['sans_pli'])
    for boucle, (px, nv) in sorted(par.items(), key=lambda t: -t[1][0]):
        if len(zones['fenetres']) >= 300:
            break
        sel = lev['comp'] == boucle
        fa = np.unique(face_map[lev['faces'][sel].reshape(-1)])
        zones['fenetres'].append({
            'type': 'fenetre_levre', 'levre': int(boucle), 'n_aretes': int(lev['n_aretes'][boucle]),
            'perimetre_rel': round(float(lev['perimetre'][boucle] / diag), 6),
            'centre_rel': [round(float(x), 4) for x in (lev['centre'][boucle] - lo) / diag],
            'pixels_fenetre': int(px), 'vues': int(nv), 'faces_b64': _compresser_ids(fa)})
    tous = {}
    par_cat = {}
    for cat_, dd in poids.items():
        if dd:
            ids = np.fromiter(dd.keys(), np.int64, len(dd))
            w = np.fromiter(dd.values(), float, len(dd))
            o = np.argsort(ids)
            par_cat[cat_] = {'faces_b64': _compresser_ids(ids[o]), 'n_faces': int(len(ids)), 'pixels': int(px_cat[cat_])}
            for f, x in zip(ids.tolist(), w.tolist()):
                tous[f] = tous.get(f, 0.0) + x
    if tous:
        ids = np.fromiter(tous.keys(), np.int64, len(tous))
        w = np.fromiter(tous.values(), float, len(tous))
        o = np.argsort(ids)
        zones['reference_fenetres'] = {'faces_b64': _compresser_ids(ids[o]), 'pixels_par_face': [round(float(x), 2) for x in w[o]],
                                       'n_faces': int(len(ids)), 'pixels': int(px_cat['avec_pli'] + px_cat['sans_pli']),
                                       'par_categorie': par_cat}
    else:
        zones['reference_fenetres'] = {'faces_b64': _compresser_ids(np.zeros(0, np.int64)), 'pixels_par_face': [],
                                       'n_faces': 0, 'pixels': 0, 'par_categorie': {}}


def construire_zones(nom, V, F, C, aire_all, aire_tot, diag, f_pix, e1, cat, cls, retourne_raw, face_map, ar, bo, ecart,
                     vues_res):
    """Liste des zones de reference : (1) une zone par vraie boucle de bord qui explique des pixels arriere ;
    (2) des groupes de faces vues par derriere hors boucle (retournees, double peau, mince, aucune)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    nF = len(F)
    out = {'nom': nom, 'version_outil': VERSION_OUTIL, 'nombre_faces': int(len(F)), 'bord': [], 'faces': [],
           'boucles_invisibles': 0}
    # REFERENCE POUR LE RAPPEL D'UN DETECTEUR : les faces A CORRIGER, par cause, pour les pixels de TROU VISUEL (rendu a faces
    # simples : rien de vu par devant derriere, ou plus loin que 0,5 % de la diagonale). Selon la cause :
    #   bord        -> les faces qui BORDENT la boucle (ce sont elles que Fill holes verrait) ; la face vue par derriere
    #                  en ces pixels est le mur du fond, vu A TRAVERS le trou : ce n'est pas elle qu'il faut corriger ;
    #   les autres  -> les faces vues par derriere elles-memes (patch retourne, nappe externe d'une double peau...).
    # Indices de faces = ordre du GLB tel que lu par glb_lecture.fusionner (primitives mises bout a bout). Le poids d'une
    # face est le nombre de pixels de trou visuel qu'elle explique.
    vis_pix = ~(np.asarray(ecart) <= 0.005)
    par_cat = {}
    if len(f_pix) and vis_pix.any():
        for k, nm in enumerate(CATEGORIES):
            if nm == 'bord':
                continue
            sel_k = vis_pix & (cls == k)
            if sel_k.any():
                u_k, c_k = np.unique(f_pix[sel_k], return_counts=True)
                par_cat[nm] = (u_k.astype(np.int64), c_k.astype(float))
        if bo['n']:
            blb = cat['boucle']
            selb = vis_pix & e1 & (blb >= 0)
            if selb.any():
                pixb = np.bincount(blb[selb], minlength=bo['n'])
                ids_b, w_b = [], []
                for i_b in np.nonzero(pixb)[0]:
                    rim = np.unique(face_map[bo['a'][bo['arete_boucle'] == i_b] // 3])
                    ids_b.append(rim)
                    w_b.append(np.full(len(rim), pixb[i_b] / len(rim)))
                ids_b, w_b = np.concatenate(ids_b), np.concatenate(w_b)
                u_b, inv_b = np.unique(ids_b, return_inverse=True)
                c_b = np.zeros(len(u_b))
                np.add.at(c_b, inv_b, w_b)
                par_cat['bord'] = (u_b.astype(np.int64), c_b)
    if par_cat:
        tous = np.concatenate([v[0] for v in par_cat.values()])
        poids = np.concatenate([v[1] for v in par_cat.values()])
        u_t, inv_t = np.unique(tous, return_inverse=True)
        c_t = np.zeros(len(u_t))
        np.add.at(c_t, inv_t, poids)
        out['reference_visuel'] = {
            'faces_b64': _compresser_ids(u_t), 'pixels_par_face': [round(float(x), 2) for x in c_t],
            'n_faces': int(len(u_t)), 'pixels': int(vis_pix.sum()),
            'par_categorie': {nm: {'faces_b64': _compresser_ids(v[0]), 'n_faces': int(len(v[0])),
                                   'pixels': round(float(v[1].sum()), 1)} for nm, v in par_cat.items()}}
    else:
        out['reference_visuel'] = {'faces_b64': _compresser_ids(np.zeros(0, np.int64)), 'pixels_par_face': [], 'n_faces': 0,
                                   'pixels': 0, 'par_categorie': {}}
    lo = V.min(0)
    # --- zones de bord
    if bo['n']:
        bl = cat['boucle']
        sel = e1 & (bl >= 0)
        pix = np.bincount(bl[sel], minlength=bo['n'])
        nvues = np.zeros(bo['n'], int)
        if sel.any():
            cles = np.unique(bl[sel].astype(np.int64) * 100000 + cat['vue'][sel])
            nvues = np.bincount(cles // 100000, minlength=bo['n'])
        perim_rel = bo['perimetre'] / diag
        out['boucles_invisibles'] = int((pix == 0).sum())
        for i in np.argsort(-pix):
            if pix[i] == 0:
                break
            out['bord'].append({
                'type': 'bord', 'boucle': int(i), 'n_aretes': int(bo['n_aretes'][i]),
                'perimetre_rel': round(float(perim_rel[i]), 6),
                'aire_ouverture_rel2': round(float(bo['aire_ouverture'][i] / diag ** 2), 7),
                'centre_rel': [round(float(x), 4) for x in (bo['centre'][i] - lo) / diag],
                'pixels_arriere_expliques': int(pix[i]), 'vues': int(nvues[i]), 'simple': bool(bo['simple'][i])})
    # --- zones de faces (hors bord)
    sel = ~e1
    if sel.any():
        fids = f_pix[sel]
        cl = cls[sel]
        vue = cat['vue'][sel]
        uf, inv = np.unique(fids, return_inverse=True)
        npix = np.bincount(inv, minlength=len(uf))
        # categorie majoritaire par face
        cm = np.zeros((len(uf), 6), int)
        np.add.at(cm, (inv, cl), 1)
        cat_f = cm.argmax(1)
        pos = np.full(nF, -1, np.int64)
        pos[uf] = np.arange(len(uf))
        # adjacence des faces (soudees) restreinte a l'ensemble
        h1 = ar.paire_h1 // 3
        h2 = ar.paire_h2 // 3
        a = face_map[h1]
        b = face_map[h2]
        m = (pos[a] >= 0) & (pos[b] >= 0)
        g = coo_matrix((np.ones(m.sum()), (pos[a[m]], pos[b[m]])), shape=(len(uf), len(uf)))
        ncomp, lab = connected_components(g, directed=False)
        # vues par zone
        zv = np.unique(lab[inv].astype(np.int64) * 100000 + vue)
        nvz = np.bincount(zv // 100000, minlength=ncomp)
        pix_z = np.bincount(lab, weights=npix, minlength=ncomp)
        aire_z = np.bincount(lab, weights=aire_all[uf], minlength=ncomp)
        nf_z = np.bincount(lab, minlength=ncomp)
        # categorie dominante par zone (en pixels)
        czone = np.zeros((ncomp, 6), int)
        np.add.at(czone, (lab[inv], cl), 1)
        for z in np.argsort(-pix_z):
            idx = np.nonzero(lab == z)[0]
            ids = uf[idx]
            w = aire_all[ids]
            ctr = (C[ids] * w[:, None]).sum(0) / max(w.sum(), 1e-30)
            mn = C[ids].min(0)
            mx = C[ids].max(0)
            out['faces'].append({
                'type': 'faces', 'categorie': CATEGORIES[int(czone[z].argmax())], 'n_faces': int(nf_z[z]),
                'aire_pct': _pct(aire_z[z], aire_tot), 'pixels': int(pix_z[z]), 'vues': int(nvz[z]),
                'centre_rel': [round(float(x), 4) for x in (ctr - lo) / diag],
                'bbox_rel': [[round(float(x), 4) for x in (mn - lo) / diag], [round(float(x), 4) for x in (mx - lo) / diag]],
                'repartition_pixels': {CATEGORIES[k]: int(czone[z][k]) for k in range(6) if czone[z][k]},
                'faces_b64': _compresser_ids(ids)})
            if len(out['faces']) >= 400:
                break
    return out


# ---------------------------------------------------------------------------------------------- structures
def mesurer_structures(V, F, C, un_all, aire_all, aire_tot, diag, it, arbre, rng, etape, nF):
    from scipy.spatial import cKDTree
    out = {}
    vivantes = np.nonzero(aire_all > 0)[0]
    if C is None:
        C = (V[F[:, 0]] + V[F[:, 1]] + V[F[:, 2]]) / 3.0
    if arbre is None:
        arbre = cKDTree(C[vivantes])
    # double peau / mince : echantillon pondere par l'aire
    p = aire_all[vivantes] / aire_all[vivantes].sum()
    n_ech = min(8000, len(vivantes))
    ech = rng.choice(vivantes, n_ech, replace=False, p=p)
    d, m = evaluer_proximite_remap(ech, C, un_all, aire_all, it['Wi'][F], diag, arbre, vivantes)
    out['double_peau_surface_pct'] = round(100.0 * float(d.mean()), 3)
    out['paroi_mince_1pct_surface_pct'] = round(100.0 * float(m.mean()), 3)
    out['echantillon_proximite'] = int(n_ech)
    etape('structures : double peau %.2f %%, mince %.2f %%' % (out['double_peau_surface_pct'], out['paroi_mince_1pct_surface_pct']))
    # epaisseur le long de la normale inverse (rayons) sur un petit echantillon
    ok = np.nonzero(aire_all > 0)[0]
    ray = Rayons(V, F[ok])
    n_r = min(1500, len(ok))
    ech2 = rng.choice(np.arange(len(ok)), n_r, replace=False, p=aire_all[ok] / aire_all[ok].sum())
    sens = -1.0 if it['sv'] >= 0 else 1.0
    Cok = C[ok]
    Uok = un_all[ok]
    t, gg = epaisseurs(ray, Cok, Uok, ech2, sens, diag)
    fin = np.isfinite(t)
    rel = t[fin] / diag
    out['epaisseur_rayon'] = {
        'rayons': int(n_r), 'sans_impact_pct': round(100.0 * float((~fin).mean()), 2),
        'p05_rel_diag': round(float(np.percentile(rel, 5)), 5) if fin.any() else None,
        'p25_rel_diag': round(float(np.percentile(rel, 25)), 5) if fin.any() else None,
        'mediane_rel_diag': round(float(np.median(rel)), 5) if fin.any() else None,
        'lt_0_2pct_pct': round(100.0 * float((rel < 0.002).sum()) / n_r, 2),
        'lt_1pct_pct': round(100.0 * float((rel < 0.01).sum()) / n_r, 2),
        'lt_3pct_pct': round(100.0 * float((rel < 0.03).sum()) / n_r, 2),
        'sens_interieur': 'normale inverse' if sens < 0 else 'normale (orientation globale inversee)'}
    etape('epaisseur : %d rayons, mediane %s' % (n_r, out['epaisseur_rayon']['mediane_rel_diag']))
    # coques internes
    lab_raw = np.full(nF, it['nc'], np.int64)
    lab_raw[it['face_map']] = it['lab']
    ci = coques_internes(V, F[ok], aire_all[ok], lab_raw[ok], diag)
    part = ci['part_visible_par_comp']
    aire_c = ci['aire_comp']
    internes = [i for i in range(len(part)) if aire_c[i] > 0 and part[i] < 0.02 and ci['points_comp'][i] > 50]
    out['coques_internes'] = {
        'n': len(internes), 'aire_pct': round(100.0 * float(sum(aire_c[i] for i in internes)) / aire_tot, 3),
        'vide_enferme_pct_boite': round(ci['vide_enferme_pct_boite'], 3),
        'occupation_pct_boite': round(ci['occupation_pct_boite'], 3), 'resolution': ci['resolution'],
        'details': [{'aire_pct': round(100.0 * float(aire_c[i]) / aire_tot, 3), 'part_visible': round(float(part[i]), 3)}
                    for i in sorted(internes, key=lambda i: -aire_c[i])[:8]]}
    etape('coques internes : %d' % len(internes))
    return out


# ---------------------------------------------------------------------------------------------- texture
def mesurer_texture(g, prims, UV, F, mat, aire_all, etape):
    """Alpha et noir dans la texture de couleur, sur les seuls texels couverts par des triangles d'UV."""
    import io
    from PIL import Image
    from rasteur import rasteriser_triangles
    mats = g.materiaux()
    out = []
    noir_face = np.zeros(len(F), bool)
    alpha_face = np.zeros(len(F), bool)
    for m in mats:
        info = {'index': m['index'], 'alphaMode': m['alphaMode'], 'doubleSided': m['doubleSided'],
                'metallicFactor': m['metallicFactor'], 'roughnessFactor': m['roughnessFactor']}
        if m['image'] is None:
            out.append(info)
            continue
        octets, mime = g.octets_image(m['image'])
        if octets is None:
            out.append(info)
            continue
        im = Image.open(io.BytesIO(octets))
        info['taille'] = list(im.size)
        info['mode'] = im.mode
        # reduction pour limiter la memoire : jamais plus de 2048 de cote
        k = max(1, max(im.size) // 2048)
        if k > 1:
            im = im.reduce(k)
        im = im.convert('RGBA')
        T = im.size[0]
        arr = np.asarray(im)
        # couverture UV (origine glTF en haut a gauche)
        sel = np.nonzero(mat == m['index'])[0]
        U = UV[F[sel]]
        X = U[:, :, 0].astype(np.float64) * T
        Y = U[:, :, 1].astype(np.float64) * T
        Z = np.zeros_like(X)
        z, idb = rasteriser_triangles(X, Y, Z, sel.astype(np.int32), T)
        couvert = (idb >= 0).reshape(T, T)
        nco = int(couvert.sum())
        info['couverture_uv_pct'] = round(100.0 * nco / (T * T), 2)
        if nco:
            a = arr[couvert]
            lum = (0.299 * a[:, 0] + 0.587 * a[:, 1] + 0.114 * a[:, 2])
            info['alpha_lt_250_pct_des_texels_couverts'] = round(100.0 * float((a[:, 3] < 250).mean()), 4)
            info['alpha_lt_128_pct_des_texels_couverts'] = round(100.0 * float((a[:, 3] < 128).mean()), 4)
            info['noir_lt_8_pct_des_texels_couverts'] = round(100.0 * float((lum < 8).mean()), 4)
            info['luminance_moyenne'] = round(float(lum.mean()), 2)
            # faces concernees (alpha / noir au centre de la face)
            Uc = U.mean(1)
            ix = np.clip((Uc[:, 0] * T).astype(int), 0, T - 1)
            iy = np.clip((Uc[:, 1] * T).astype(int), 0, T - 1)
            px = arr[iy, ix]
            aire_s = aire_all[sel]
            info['aire_alpha_lt_128_pct'] = round(100.0 * float(aire_s[px[:, 3] < 128].sum() / aire_s.sum()), 4)
            lumf = 0.299 * px[:, 0] + 0.587 * px[:, 1] + 0.114 * px[:, 2]
            info['aire_noire_lt_8_pct'] = round(100.0 * float(aire_s[lumf < 8].sum() / aire_s.sum()), 4)
            noir_face[sel[lumf < 8]] = True
            alpha_face[sel[px[:, 3] < 128]] = True
        out.append(info)
    etape('texture : %d materiau(x)' % len(out))
    return out, noir_face, alpha_face


# ---------------------------------------------------------------------------------------------- montages
_COUL = {0: (225, 30, 30), 1: (255, 150, 0), 2: (0, 120, 255), 3: (110, 200, 255), 4: (255, 0, 255), 5: (170, 170, 170)}


def _image_vue(buf, ctx, un_all, cat_face, S, d):
    """Ce que montre la visionneuse de l'appli (faces simples) : faces vues par devant en gris ombre, fond clair. Par-dessus,
    les pixels dont le premier impact est une face vue par DERRIERE :
      - TROU VISUEL (rien de vu par devant derriere, ou plus loin que 0,5 % de la diagonale) : colore par cause ;
      - nappe de double peau (autre nappe vue par devant a moins de 0,5 %) : gris teinte de cyan, pas un trou."""
    idF, zF, zB, idB = buf['idF'], buf['zF'], buf['zB'], buf['idB']
    dd = np.asarray(d)
    img = np.full((S, S, 3), 244, np.uint8)
    avant = np.isfinite(zF)
    nF_ = un_all[np.maximum(idF, 0)]
    sh = 0.35 + 0.6 * np.abs(nF_ @ (-dd))
    g = (sh * 200).clip(0, 255).astype(np.uint8)
    img[avant] = np.stack([g, g, g], -1)[avant]
    arr = buf['arriere']
    if arr.any():
        ids = np.maximum(idB, 0)
        nB = un_all[ids]
        shb = (0.55 + 0.45 * np.abs(nB @ (-dd))).clip(0, 1)
        with np.errstate(invalid='ignore'):
            gap = (zF - zB) * np.abs(nB @ dd) / ctx.diag
        visuel = arr & ((gap > 0.005) | ~np.isfinite(zF))
        c = cat_face[ids].astype(int)
        c = np.where((gap <= 0.01) & (c >= 3), 3, c)
        c = np.where((gap <= 0.002) & (c >= 3), 2, c)
        c = np.where(c == 5, 4, c)
        lab = buf['lab']
        e1pix = np.zeros((S, S), bool)
        if buf['cc_e1'].size:
            e1pix = (lab > 0) & buf['cc_e1'][np.maximum(lab - 1, 0)]
        c = np.where(e1pix, 0, c)
        col = np.zeros((S, S, 3))
        for k, v in _COUL.items():
            col[c == k] = v
        col = (col * shb[..., None]).clip(0, 255).astype(np.uint8)
        img[visuel] = col[visuel]
        peau = arr & ~visuel
        if peau.any():
            base = img[peau].astype(np.float32)
            img[peau] = (0.55 * base + 0.45 * np.array([120, 220, 230], np.float32)).astype(np.uint8)
    # fenetres (fond cerne par du maillage) : jaune vif = bordee par un pli (trou a levre fermee), jaune pale = autre
    img[buf['fen_autre']] = (255, 240, 150)
    img[buf['fen_lip']] = (255, 200, 0)
    img[buf['lip'] & ~buf['fen_lip']] = (150, 0, 190)
    img[buf['rim']] = (0, 190, 0)
    return img


def faire_montages(nom, ctx, dirs, vis, S, retourne_raw, flag_dbl, flag_mnc, evalue, un_all, C, dossier, etape):
    from PIL import Image, ImageDraw
    os.makedirs(dossier, exist_ok=True)
    cat_face = np.full(len(ctx.F), 4, np.int8)
    cat_face[~evalue] = 5
    cat_face[flag_mnc] = 3
    cat_face[flag_dbl] = 2
    cat_face[retourne_raw] = 1
    pct = np.array([v['visuel'] / max(v['couvert'], 1) for v in vis['par_vue']])
    pct_arr = np.array([v['arriere'] / max(v['couvert'], 1) for v in vis['par_vue']])
    pct_fen = np.array([v['fen_px'] / max(v['sil_px'], 1) for v in vis['par_vue']])
    score = np.maximum(pct, pct_fen)
    ordre = list(np.argsort(-score)[:6])
    propre = score.max() < 1e-4
    if propre:
        # pas de zone : on montre 6 vues de reference (axes)
        axes = [i for i, d in enumerate(dirs) if np.count_nonzero(np.abs(d) > 1e-9) == 1][:6]
        ordre = axes if len(axes) == 6 else list(range(min(6, len(dirs))))
    tuiles = []
    tail = 600
    for i in ordre:
        v = calculer_vue(ctx, dirs[i], S, garder=True)
        buf = v['tampons']
        img = _image_vue(buf, ctx, un_all, cat_face, S, dirs[i])
        im = Image.fromarray(img).resize((tail, tail), Image.LANCZOS)
        dr = ImageDraw.Draw(im)
        dr.rectangle([0, 0, tail, 16], fill=(255, 255, 255))
        dr.text((4, 2), 'vue %d  trou visuel %.3f %%  (arriere %.2f %%)  fenetre %.3f %%  cc %d (bord %d)' % (i, 100 * pct[i], 100 * pct_arr[i], 100 * pct_fen[i], v['n_cc'], v['n_cc_e1']), fill=(0, 0, 0))
        tuiles.append(im)
    W = 3 * tail
    H = 2 * tail + 20
    mont = Image.new('RGB', (W, H), (255, 255, 255))
    for k, im in enumerate(tuiles):
        mont.paste(im, ((k % 3) * tail, 20 + (k // 3) * tail))
    dr = ImageDraw.Draw(mont)
    dr.text((4, 4), '%s | rendu FACES SIMPLES (visionneuse) | trou visuel : ROUGE=vrai bord, ORANGE=patch retourne, BLEU=double peau/paroi mince, MAGENTA=aucune cause topologique | cyan pale = nappe arriere sans trou | vert = bord visible | JAUNE = fenetre (fond cerne) bordee par un pli a 180 deg, jaune pale = autre fenetre, violet = plis' % nom, fill=(0, 0, 0))
    chemin = os.path.join(dossier, nom + '.png')
    mont.save(chemin)
    etape('montage ecrit : ' + chemin)
    return {'fichier': chemin.replace('\\', '/'), 'vues': [int(i) for i in ordre], 'propre': bool(propre)}


# ---------------------------------------------------------------------------------------------- CLI
def _ecrire(sortie, nom, res, zones):
    os.makedirs(os.path.join(sortie, 'resultats'), exist_ok=True)
    os.makedirs(os.path.join(sortie, 'zones'), exist_ok=True)
    with open(os.path.join(sortie, 'resultats', nom + '.json'), 'w', encoding='utf-8') as f:
        json.dump(_jsonable(res), f, ensure_ascii=False, indent=1)
    with open(os.path.join(sortie, 'zones', nom + '.json'), 'w', encoding='utf-8') as f:
        json.dump(_jsonable(zones), f, ensure_ascii=False)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    a = sp.add_parser('analyser')
    a.add_argument('glb')
    a.add_argument('--nom', required=True)
    a.add_argument('--sortie', required=True)
    a.add_argument('--montages')
    a.add_argument('--taille', type=int, default=768)
    a.add_argument('--vues', default='cube26', choices=['cube26', 'ico42', 'tout'])
    a.add_argument('--sans-structures', action='store_true')
    a.add_argument('--sans-texture', action='store_true')
    a.add_argument('--origine', default='')
    c = sp.add_parser('corpus')
    c.add_argument('corpus')
    c.add_argument('--sortie', required=True)
    c.add_argument('--montages')
    c.add_argument('--seulement', default='')
    c.add_argument('--taille', type=int, default=768)
    c.add_argument('--vues', default='cube26', choices=['cube26', 'ico42', 'tout'])
    args = ap.parse_args(argv)
    if args.cmd == 'analyser':
        res, zones = analyser(args.glb, args.nom, S=args.taille, vues=args.vues, structures=not args.sans_structures,
                              montages=args.montages, origine=args.origine, texture=not args.sans_texture)
        _ecrire(args.sortie, args.nom, res, zones)
        print(json.dumps(_jsonable({k: res[k] for k in ('nom', 'faces', 'carte_zones', 'duree_s')}), ensure_ascii=False)[:1500])
        return 0
    corpus = json.load(open(args.corpus, encoding='utf-8'))
    choisis = set(x for x in args.seulement.split(',') if x)
    for ent in corpus['maillages']:
        if choisis and ent['nom'] not in choisis:
            continue
        if os.path.exists(os.path.join(args.sortie, 'resultats', ent['nom'] + '.json')) and not choisis:
            print('deja fait : ' + ent['nom'])
            continue
        res, zones = analyser(ent['chemin'], ent['nom'], S=args.taille, vues=args.vues, montages=args.montages,
                              origine=ent.get('origine', ''))
        res['corpus'] = {k: v for k, v in ent.items() if k not in ('chemin',)}
        _ecrire(args.sortie, ent['nom'], res, zones)
    return 0


if __name__ == '__main__':
    sys.exit(main())
