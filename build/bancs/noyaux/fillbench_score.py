# -*- coding: utf-8 -*-
"""Banc Fill holes : NOTATION d'un detecteur de trous contre la verite terrain (voir LISEZMOI.md dans C:/tmp/fillbench/).

    python score.py <module.py[:fonction]> [--cas motif] [--rapide] [--racine C:/tmp/fillbench] [--delai 1800] [--json sortie.json] [--option cle=valeur ...]

Le module expose  detect(V, F, uv=None, **options) -> list[dict]  ;  dict = {'centre':[x,y,z], 'rayon':float, 'contour':[[x,y,z],...] (optionnel)}.
Attributs facultatifs du module :  SOUDER = True  (on passe un maillage soude par position, tolerance 1e-6 x diag, uv de la premiere occurrence).
Options passees a detect : max_trou_relatif (0,10 : diametre maximal / diag d'un trou a boucher), plus les --option.

Chaque cas tourne dans un SOUS-PROCESSUS (duree, pic de memoire, delai maximal mesures proprement).
Appariement : un trou de verite est TROUVE si une detection (non deja utilisee, la plus proche d'abord) a son centre a moins de
max(1,5 x rayon_verite, 0,5 % de diag). Rappel = trouves / trous ; precision = detections appariees / detections ;
faux positifs = detections non appariees (dont : sur 'ouvertures_voulues', celles qui tombent sur une fenetre = 'ouverture_bouchee').
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time

import numpy as np

RACINE = os.environ.get('FILLBENCH_RACINE', 'C:/tmp/fillbench')
MAX_TROU_RELATIF = 0.10
PLANCHER_REL = 0.005
RAPIDE = ['peau_double_perce_2', 'peau_collee_perce_2', 'bord_ouvert_perce_1', 'sains_collee', 'ouvertures_voulues_1']


# ----------------------------------------------------------------------------------------------------------------------------------------
def charger_cas(chemin, souder=False):
    """(V, F, uv) : toutes les geometries du GLB mises bout a bout (uv = 0 pour une geometrie sans uv)."""
    import trimesh
    sc = trimesh.load(chemin, force='scene', process=False)
    Vs, Fs, Us = [], [], []
    dec = 0
    for g in sc.geometry.values():
        v = np.asarray(g.vertices, dtype=np.float64)
        Vs.append(v)
        Fs.append(np.asarray(g.faces, dtype=np.int64) + dec)
        uv = getattr(g.visual, 'uv', None)
        Us.append(np.asarray(uv, dtype=np.float64) if uv is not None and len(uv) == len(v) else np.zeros((len(v), 2)))
        dec += len(v)
    V, F, U = np.concatenate(Vs), np.concatenate(Fs), np.concatenate(Us)
    if souder:
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components
        from scipy.spatial import cKDTree
        diag = float(np.linalg.norm(V.max(0) - V.min(0)))
        p = cKDTree(V).query_pairs(1e-6 * diag, output_type='ndarray')
        n = len(V)
        if len(p):
            _, lab = connected_components(coo_matrix((np.ones(len(p), dtype=np.int8), (p[:, 0], p[:, 1])), shape=(n, n)), directed=False)
        else:
            lab = np.arange(n)
        nw = int(lab.max()) + 1
        prem = np.full(nw, -1, dtype=np.int64)
        prem[lab[::-1]] = np.arange(n)[::-1]
        V, U, F = V[prem], U[prem], lab[F]
        F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return V, F, U


def scinder(spec):
    """'chemin.py:fonction' -> (chemin, fonction) ; 'C:/x/y.py' -> ('C:/x/y.py', 'detect')."""
    ch, sep, fn = spec.rpartition(':')
    if sep and fn and '/' not in fn and chr(92) not in fn and len(ch) > 1:
        return ch, fn
    return spec, 'detect'


def charger_module(spec):
    chemin, fonction = scinder(spec)
    d = os.path.dirname(os.path.abspath(chemin))
    if d not in sys.path:
        sys.path.insert(0, d)
    sp = importlib.util.spec_from_file_location('detecteur_banc', chemin)
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m, getattr(m, fonction)


def pic_memoire_mo():
    try:
        import ctypes
        from ctypes import wintypes

        class PMC(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD), ('PeakWorkingSetSize', ctypes.c_size_t),
                        ('WorkingSetSize', ctypes.c_size_t), ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaPagedPoolUsage', ctypes.c_size_t), ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaNonPagedPoolUsage', ctypes.c_size_t), ('PagefileUsage', ctypes.c_size_t),
                        ('PeakPagefileUsage', ctypes.c_size_t)]
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        k32, ps = ctypes.WinDLL('kernel32'), ctypes.WinDLL('psapi')
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        ps.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
        ps.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb)
        return pmc.PeakWorkingSetSize / 1048576.0
    except Exception:
        try:
            import resource
            return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
        except Exception:
            return -1.0


def _jsonable(o):
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return _jsonable(o.tolist())
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    return o


def enfant(spec, glb, sortie, options):
    m, fn = charger_module(spec)
    V, F, U = charger_cas(glb, souder=bool(getattr(m, 'SOUDER', False)))
    t0 = time.time()
    err = None
    try:
        res = fn(V, F, U, **options)
    except Exception as e:                                           # noqa: BLE001
        import traceback
        res, err = [], traceback.format_exc()[-1500:]
    dt = time.time() - t0
    out = [{'centre': [float(x) for x in d['centre']], 'rayon': float(d.get('rayon', 0.0)),
            'contour': _jsonable(d.get('contour'))} for d in (res or [])]
    json.dump({'detections': out, 'duree_s': dt, 'pic_memoire_mo': pic_memoire_mo(), 'erreur': err}, open(sortie, 'w'))


# ----------------------------------------------------------------------------------------------------------------------------------------
def apparier(trous, dets, diag):
    """Appariement glouton un-pour-un par distance croissante. Rend (paires [(i_verite, j_det, dist)], tolerances)."""
    tol = [max(1.5 * t['rayon'], PLANCHER_REL * diag) for t in trous]
    cand = []
    for i, t in enumerate(trous):
        for j, d in enumerate(dets):
            dist = float(np.linalg.norm(np.asarray(t['centre']) - np.asarray(d['centre'])))
            if dist <= tol[i]:
                cand.append((dist, i, j))
    cand.sort()
    pi, pj, paires = set(), set(), []
    for dist, i, j in cand:
        if i in pi or j in pj:
            continue
        pi.add(i)
        pj.add(j)
        paires.append((i, j, dist))
    return paires, tol


def noter_cas(nom, fiche, rep, diag):
    dets = rep['detections']
    trous = fiche.get('trous', [])
    ouv = fiche.get('ouvertures', [])
    paires, _ = apparier(trous, dets, diag)
    utilisees = {j for _, j, _ in paires}
    restants = [j for j in range(len(dets)) if j not in utilisees]
    p_ouv, _ = apparier(ouv, [dets[j] for j in restants], diag) if ouv else ([], None)
    sur_ouverture = len(p_ouv)
    # fragments : detection non appariee mais posee a moins de 3 tolerances d'un trou (un trou coupe en plusieurs morceaux) : pas un faux positif
    frag = 0
    for j in restants:
        if any(np.linalg.norm(np.asarray(t['centre']) - np.asarray(dets[j]['centre'])) <= 3 * max(1.5 * t['rayon'], PLANCHER_REL * diag) for t in trous):
            frag += 1
    fp = len(restants) - frag
    r = {'cas': nom, 'famille': fiche['famille'], 'n_trous': len(trous), 'n_detections': len(dets), 'trouves': len(paires),
         'faux_positifs': fp, 'fragments': frag, 'ouvertures_bouchees': sur_ouverture,
         'rappel': (len(paires) / len(trous)) if trous else None,
         'precision': (len(paires) / len(dets)) if dets else (1.0 if not fp else 0.0),
         'duree_s': rep['duree_s'], 'pic_memoire_mo': rep['pic_memoire_mo'], 'erreur': rep.get('erreur'),
         'trouves_detail': [{'verite': i, 'taille': trous[i]['taille'], 'forme': trous[i]['forme'], 'contexte': trous[i]['contexte'],
                             'ecart': d, 'rayon_estime': dets[j]['rayon'], 'rayon_vrai': trous[i]['rayon']} for i, j, d in paires],
         'manques': [{'verite': i, 'taille': t['taille'], 'forme': t['forme'], 'contexte': t['contexte'], 'rayon': t['rayon']}
                     for i, t in enumerate(trous) if i not in {p[0] for p in paires}],
         'detections': dets}
    return r


def agreger(res):
    A = {}
    for c in res:
        if c['n_trous']:
            for d in c['trouves_detail']:
                for cle in (('taille', d['taille']), ('contexte', d['contexte']), ('forme', d['forme']), ('famille', c['famille'])):
                    A.setdefault(cle, [0, 0])[0] += 1
                    A[cle][1] += 1
            for d in c['manques']:
                for cle in (('taille', d['taille']), ('contexte', d['contexte']), ('forme', d['forme']), ('famille', c['famille'])):
                    A.setdefault(cle, [0, 0])[1] += 1
    return {'%s=%s' % k: {'trouves': v[0], 'total': v[1], 'rappel': v[0] / v[1]} for k, v in sorted(A.items())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('module')
    ap.add_argument('--cas', default='')
    ap.add_argument('--rapide', action='store_true')
    ap.add_argument('--racine', default=RACINE)
    ap.add_argument('--delai', type=int, default=1800)
    ap.add_argument('--json', default='')
    ap.add_argument('--option', action='append', default=[])
    ap.add_argument('--v2', action='store_true', help='cas v2 (cases_v2/, verite_v2.json) : peau simple propre, interieur visible par les trous')
    ap.add_argument('--enfant', nargs=3, metavar=('GLB', 'SORTIE', 'OPTIONS_JSON'))
    a = ap.parse_args()
    if a.enfant:
        enfant(a.module, a.enfant[0], a.enfant[1], json.loads(a.enfant[2]))
        return 0
    verite = json.load(open(os.path.join(a.racine, 'verite_v2.json' if a.v2 else 'verite.json'), encoding='utf-8'))['cas']
    options = {'max_trou_relatif': MAX_TROU_RELATIF}
    for o in a.option:
        k, _, v = o.partition('=')
        try:
            options[k] = json.loads(v)
        except Exception:
            options[k] = v
    noms = [n for n, f in verite.items() if f.get('famille') != 'reels' and (not a.cas or a.cas in n)]
    if a.rapide:
        noms = [n for n in noms if n in RAPIDE]
    res = []
    ch, fn = scinder(a.module)
    etiquette = os.path.splitext(os.path.basename(ch))[0] + ('' if fn == 'detect' else '_' + fn)
    for n in noms:
        f = verite[n]
        glb = os.path.join(a.racine, f['fichier'])
        tmp = os.path.join(a.racine, 'resultats', '_tmp_%s.json' % n)
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        if os.path.exists(tmp):
            os.remove(tmp)
        t0 = time.time()
        try:
            subprocess.run([sys.executable, os.path.abspath(__file__), a.module, '--enfant', glb, tmp, json.dumps(options)],
                           timeout=a.delai, check=False)
        except subprocess.TimeoutExpired:
            pass
        if os.path.exists(tmp):
            rep = json.load(open(tmp))
            os.remove(tmp)
        else:
            rep = {'detections': [], 'duree_s': time.time() - t0, 'pic_memoire_mo': -1, 'erreur': 'delai depasse ou plantage'}
        r = noter_cas(n, f, rep, f['diag'])
        res.append(r)
        print('  %-24s trouves %s/%d  det %d  fp %d  frag %d  %.1f s' % (n, r['trouves'], r['n_trous'], r['n_detections'], r['faux_positifs'], r['fragments'], r['duree_s']),
              flush=True)
    # tableau
    print()
    print('%-24s %-18s %7s %9s %5s %5s %5s %7s %8s' % ('cas', 'famille', 'rappel', 'precision', 'det', 'fp', 'frag', 'duree s', 'mem Mo'))
    for r in res:
        print('%-24s %-18s %7s %9.2f %5d %5d %5d %7.1f %8.0f%s' % (
            r['cas'], r['famille'], '-' if r['rappel'] is None else '%.2f' % r['rappel'], r['precision'], r['n_detections'], r['faux_positifs'], r['fragments'],
            r['duree_s'], r['pic_memoire_mo'], ('  ERREUR: ' + r['erreur'].strip().splitlines()[-1]) if r['erreur'] else ''))
    avec = [r for r in res if r['n_trous']]
    nt, nf = sum(r['n_trous'] for r in avec), sum(r['trouves'] for r in avec)
    nd = sum(r['n_detections'] for r in avec)
    fp_vides = sum(r['faux_positifs'] for r in res if not r['n_trous'])
    fp_tot = sum(r['faux_positifs'] for r in res)
    glob = {'rappel_global': (nf / nt) if nt else None, 'precision_globale': (nf / nd) if nd else None, 'trous': nt, 'trouves': nf,
            'faux_positifs_total': fp_tot, 'fragments': sum(r['fragments'] for r in res), 'faux_positifs_cas_sains': fp_vides,
            'ouvertures_bouchees': sum(r['ouvertures_bouchees'] for r in res), 'duree_totale_s': sum(r['duree_s'] for r in res),
            'pic_memoire_mo': max([r['pic_memoire_mo'] for r in res] or [0])}
    print()
    print('GLOBAL : ' + '  '.join('%s=%s' % (k, ('%.3f' % v) if isinstance(v, float) else v) for k, v in glob.items()))
    ag = agreger(res)
    print('RAPPEL PAR CATEGORIE : ' + '  '.join('%s %d/%d' % (k, v['trouves'], v['total']) for k, v in ag.items()))
    sortie = a.json or os.path.join(a.racine, 'resultats', '%s%s_%s.json' % (etiquette, '_v2' if a.v2 else '', time.strftime('%Y%m%d_%H%M%S')))
    os.makedirs(os.path.dirname(sortie), exist_ok=True)
    json.dump(_jsonable({'module': a.module, 'options': options, 'global': glob, 'categories': ag, 'cas': res}), open(sortie, 'w', encoding='utf-8'),
              indent=1)
    print('JSON :', sortie)
    return 0


if __name__ == '__main__':
    sys.exit(main())
