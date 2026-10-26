# -*- coding: utf-8 -*-
"""AVANT / APRES du Fill holes sur un VRAI maillage (21/10/2026) : l'orc de 496 242 faces (generation cloud), auquel on AJOUTE 3 trous.

AVANT = modal_app/_mesh_op.py::fill_holes de release-1.0.45 (copie exportee par `git archive` dans --ancien) ; APRES = celui du depot.
Mesure pour chacun, sur le MEME maillage a trous : duree, faces / sommets en entree et en sortie, part des faces d'entree SUPPRIMEES (cle de face =
triplet trie des positions arrondies), part des couples (position, UV) REECRITS, boucles de bord non degenerees restantes (noyau bouchage_trous), et
verdict / refus. Le GLB a trous n'est JAMAIS dans le depot (public) : il va dans --sortie (C:/tmp/fillholes_mesure/avec_trous/).

Usage (sous lourd.sh : 500 000 faces) :
  bash /c/tmp/lourd.sh --max-sec 900 <python de l'appli> -X utf8 -I build/bancs/fillholes/avant_apres.py <orc.glb> --ancien C:/tmp/fh_ancien \
      --sortie C:/tmp/fillholes_mesure/avec_trous --json build/bancs/fillholes/resultats/orc_avant_apres.json [--seulement apres]
"""
import argparse
import io
import json
import os
import sys
import time

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))

import numpy as np  # noqa: E402
import trimesh  # noqa: E402

import bouchage_trous as B  # noqa: E402


def charger(octets):
    sc = trimesh.load(io.BytesIO(octets), file_type='glb', force='scene', process=False)
    g = [x for x in sc.geometry.values() if hasattr(x, 'faces')][0]
    V = np.asarray(g.vertices, dtype=np.float64)
    F = np.asarray(g.faces, dtype=np.int64)
    UV = np.asarray(g.visual.uv, dtype=np.float64) if getattr(g.visual, 'uv', None) is not None else None
    return sc, g, V, F, UV


def cles_de_faces(V, F, pas):
    """Une cle entiere par face : triplet TRIE des numeros de position (positions arrondies a `pas`)."""
    _, ids = np.unique(np.round(V / pas).astype(np.int64), axis=0, return_inverse=True)
    ids = ids.reshape(-1)
    T = np.sort(ids[F], axis=1).astype(np.int64)
    M = np.int64(1 << 21)
    return (T[:, 0] * M + T[:, 1]) * M + T[:, 2]


def couples_position_uv(V, UV, pas):
    _, ids = np.unique(np.round(V / pas).astype(np.int64), axis=0, return_inverse=True)
    ids = ids.reshape(-1).astype(np.int64)
    u = np.round(UV[:, 0] * 1e5).astype(np.int64)
    v = np.round(UV[:, 1] * 1e5).astype(np.int64)
    return np.unique((ids * np.int64(200003) + u) * np.int64(200003) + v)


def ajouter_trous(V, F, nb_faces=(6, 30, 120)):
    """Retire 3 groupes de faces CONNEXES (par arete d'indice) autour de 3 points de la surface : 3 trous de pourtours differents."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import breadth_first_order
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = np.sort(e, axis=1)
    f = np.tile(np.arange(len(F)), 3)
    cle = e[:, 0] * np.int64(len(V)) + e[:, 1]
    ordre = np.argsort(cle, kind='stable')
    cle, f = cle[ordre], f[ordre]
    memes = np.nonzero(cle[1:] == cle[:-1])[0]
    a, b = f[memes], f[memes + 1]
    n = len(F)
    graphe = coo_matrix((np.ones(len(a), dtype=np.int8), (a, b)), shape=(n, n)).tocsr()
    centres = V[F].mean(axis=1)
    mn, mx = V.min(axis=0), V.max(axis=0)
    cibles = [mn + (mx - mn) * np.array(p) for p in ((0.5, 0.62, 0.9), (0.15, 0.55, 0.5), (0.5, 0.88, 0.5))]
    retirees = []
    for cible, k in zip(cibles, nb_faces):
        depart = int(np.argmin(np.linalg.norm(centres - cible, axis=1)))
        parcours = breadth_first_order(graphe, depart, directed=False, return_predecessors=False)[:k]
        retirees.append([int(x) for x in parcours])
    garde = np.ones(n, dtype=bool)
    for r in retirees:
        garde[r] = False
    return F[garde], retirees


def boucles_restantes(V, F):
    a = B.analyser(V, F, 3, 5000)
    return {'non_degenerees': a['a_boucher'] + a['trop_petites'] + a['trop_grandes'] + a['non_triangulables'], 'degenerees': a['degenerees'],
            'aretes_de_bord': a['aretes_de_bord'], 'tailles': sorted(b['n'] for b in a['boucles'] if b['categorie'] != 'degeneree')[:12]}


def lancer(racine, octets, mn, mx):
    """Lance fill_holes de l'arbre `racine` (ancien ou courant) ; rend le dictionnaire de mesures."""
    for nom in [n for n in sys.modules if n == 'modal_app' or n.startswith('modal_app.')]:
        del sys.modules[nom]
    sys.path.insert(0, racine)
    try:
        from modal_app import _mesh_op
        t = time.time()
        try:
            sortie, stats = _mesh_op.fill_holes(octets, mn, mx)
            return {'resultat': 'ok', 'duree_s': round(time.time() - t, 1), 'octets': sortie, 'verdict': stats.get('verdict'),
                    'faces_ajoutees_declarees': stats.get('holes_filled_delta_faces')}
        except Exception as ex:   # refus explique (RuntimeError) ou autre
            return {'resultat': 'refus', 'duree_s': round(time.time() - t, 1), 'octets': None, 'message': '%s: %s' % (type(ex).__name__, str(ex)[:300])}
    finally:
        sys.path.remove(racine)


def mesurer(nom, r, V_in, F_in, UV_in, pas):
    out = {k: v for k, v in r.items() if k != 'octets'}
    if r['octets'] is None:
        out['maillage_livre'] = 'inchange (refus)'
        return out
    _, _, V, F, UV = charger(r['octets'])
    ent, sor = cles_de_faces(V_in, F_in, pas), cles_de_faces(V, F, pas)
    perdues = np.setdiff1d(ent, sor)
    out.update({'faces_entree': int(len(F_in)), 'faces_sortie': int(len(F)), 'sommets_entree': int(len(V_in)), 'sommets_sortie': int(len(V)),
                'faces_supprimees_pct': round(100.0 * len(perdues) / max(len(ent), 1), 3),
                'faces_ajoutees_nettes': int(len(F) - len(F_in)),
                'boucles_apres': boucles_restantes(V, F)})
    if UV_in is not None and UV is not None:
        a, b = couples_position_uv(V_in, UV_in, pas), couples_position_uv(V, UV, pas)
        out['couples_position_uv_reecrits_pct'] = round(100.0 * len(np.setdiff1d(a, b)) / max(len(a), 1), 3)
    out['sommets_identiques'] = bool(len(V) == len(V_in) and np.array_equal(V, V_in))
    out['faces_d_entree_intactes'] = bool(len(F) >= len(F_in) and np.array_equal(F[:len(F_in)], F_in))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('--ancien', default='C:/tmp/fh_ancien')
    ap.add_argument('--sortie', default='C:/tmp/fillholes_mesure/avec_trous')
    ap.add_argument('--json')
    ap.add_argument('--seulement', choices=['avant', 'apres'])
    ap.add_argument('--max', type=int, default=1_000_000)
    ap.add_argument('--faces', default='6,30,120')
    a = ap.parse_args()
    octets = open(a.glb, 'rb').read()
    sc, g, V, F, UV = charger(octets)
    diag = float(np.linalg.norm(V.max(axis=0) - V.min(axis=0)))
    pas = diag * 1e-6
    print('maillage : %d sommets, %d faces, diagonale %.4f' % (len(V), len(F), diag), flush=True)
    avant_trous = boucles_restantes(V, F)
    F2, retirees = ajouter_trous(V, F, tuple(int(x) for x in a.faces.split(',')))
    g.faces = F2
    os.makedirs(a.sortie, exist_ok=True)
    chemin = os.path.join(a.sortie, os.path.splitext(os.path.basename(os.path.dirname(a.glb) or 'orc'))[0] + '_avec_trous.glb')
    sys.path.insert(0, RACINE)
    from modal_app import _mesh_op as _courant
    avec = _courant._export(sc)          # meme ecriture que la production (WebP rapide), pour que l'entree des deux essais soit identique
    sys.path.remove(RACINE)
    open(chemin, 'wb').write(avec)
    _, _, V2, Fm, UV2 = charger(avec)
    apres_trous = boucles_restantes(V2, Fm)
    res = {'maillage': os.path.basename(os.path.dirname(a.glb)) or a.glb, 'faces_orig': int(len(F)), 'faces_avec_trous': int(len(Fm)),
           'trous_ajoutes': {'faces_retirees': [len(r) for r in retirees]}, 'boucles_avant_ajout': avant_trous, 'boucles_apres_ajout': apres_trous,
           'sortie_glb_non_versionne': chemin.replace('\\', '/')}
    print(json.dumps({k: res[k] for k in ('trous_ajoutes', 'boucles_avant_ajout', 'boucles_apres_ajout')}, ensure_ascii=False), flush=True)
    if a.seulement != 'avant':
        r = lancer(RACINE, avec, 3, a.max)
        res['apres'] = mesurer('apres', r, V2, Fm, UV2, pas)
        print('APRES :', json.dumps(res['apres'], ensure_ascii=False), flush=True)
    if a.seulement != 'apres':
        r = lancer(os.path.abspath(a.ancien), avec, 3, a.max)
        res['avant'] = mesurer('avant', r, V2, Fm, UV2, pas)
        print('AVANT :', json.dumps(res['avant'], ensure_ascii=False), flush=True)
    if a.json:
        os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
        old = {}
        if os.path.exists(a.json):
            try:
                old = json.load(open(a.json, encoding='utf-8'))
            except Exception:
                old = {}
        old.update(res)
        with open(a.json, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(old, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
