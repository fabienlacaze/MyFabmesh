"""Banc de fidelite de FORME (03/10/2026) -- campagne sur les generations DEJA produites (aucun calcul GPU, aucune generation).

Sources de paires (image de reference, GLB) :
  1. les paires du compte du proprietaire telechargees dans C:/tmp/fidelite/paires_r2/ (manifeste paires.json) ;
  2. les GLB d'origine de generation du poste local : %APPDATA%/myfabmesh-ai/meshes/*_trellis2_native_<horodatage>.glb et <depot>/meshes/ -- le chemin
     de l'image source vient de <glb>.source. Les versions derivees (_smooth_, _rigged_, _edited_, _decimate_, _detail_, ... : tout nom qui a un suffixe apres
     l'horodatage) sont exclues.
Attention : « l'image source » consignee n'est pas toujours exactement celle que le modele 3D a recue (selon le cas image brute, detouree ou rectifiee).
Sortie : C:/tmp/fidelite/baseline.json, baseline.md, diffs/<id>.png ; cache par paire dans C:/tmp/fidelite/cache/ (relancer reprend ou il s'est arrete).
Usage : python campagne_existante.py [--sans-local] [--refaire] [--processus 3] [--limite N]
"""
import argparse
import glob
import hashlib
import json
import multiprocessing as mp
import os
import re
import sys
import time
import traceback

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import iou_silhouette as IS     # noqa: E402

SORTIE = 'C:/tmp/fidelite'
PAIRES_R2 = SORTIE + '/paires_r2'
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')).replace('\\', '/')
ORIGINE_RE = re.compile(r'_trellis2_native_\d+\.glb$')

CATEGORIES = [
    ('vehicule', ('truck', 'plane', 'bus', 'voiture', 'car', 'camion')),
    ('batiment', ('hut', 'house', 'barracks', 'townhall', 'portail', 'portal', 'maison', 'tour')),
    ('animal', ('cochon', 'pig', 'centipade', 'chevre', 'ch_vre', 'husky', 'oie', 'canard', 'rat', 'renne', 'bat', 'b_uf', 'boeuf', 'mule', 'butterfly',
                'poule', 'cow', 'spider', 'hog', 'ne', 'dog', 'chien')),
    ('personnage', ('warrior', 'worker', 'man', 'orc', 'chevalier', 'alien', 'human', 'hu')),
]


def categorie(nom):
    n = nom.lower()
    n = re.sub(r'^\d+_', '', n)
    for cat, mots in CATEGORIES:
        for m in mots:
            if n == m or n.startswith(m) or ('_' + m) in n or n.startswith(m + '_'):
                return cat
    return 'autre'


def _norm(p):
    return os.path.normpath(p.replace('\\', '/')) if p else p


def lister_paires_r2():
    f = PAIRES_R2 + '/paires.json'
    if not os.path.isfile(f):
        return []
    out = []
    for p in json.load(open(f, encoding='utf-8')):
        nom = os.path.basename(p['dossier'].rstrip('/'))
        out.append({'id': 'r2_' + nom, 'nom': re.sub(r'^\d+_', '', nom), 'origine': 'r2', 'image': _norm(os.path.join(p['dossier'], p['image'])),
                    'glb': _norm(os.path.join(p['dossier'], p['glb'])),
                    'params': {k: p.get(k) for k in ('preset', 'voxel_grid', 'texture_size', 'tex_steps', 'seed', 'rectify', 'quality_plus', 'ultra_q', 'ultra_hd', 'date',
                                                      'image_dossier_r2', 'backend')}})
    return out


def lister_paires_locales():
    dossiers = []
    if os.environ.get('APPDATA'):
        dossiers.append(os.path.join(os.environ['APPDATA'], 'myfabmesh-ai', 'meshes'))
    dossiers.append(os.path.join(REPO, 'meshes'))
    vus, out = set(), []
    for d in dossiers:
        for g in sorted(glob.glob(os.path.join(d, '*.glb'))):
            b = os.path.basename(g)
            if not ORIGINE_RE.search(b):
                continue
            src = g + '.source'
            if not os.path.isfile(src):
                out.append({'id': 'loc_' + b[:-4], 'nom': b, 'origine': 'local', 'glb': _norm(g), 'image': None, 'ignore': 'pas de fichier .source'})
                continue
            img = _norm(open(src, encoding='utf-8', errors='replace').read().strip())
            cle = (os.path.normcase(os.path.abspath(g)), os.path.normcase(img))
            if cle in vus:
                continue
            vus.add(cle)
            params = {}
            mf = g + '.meta.json'
            if os.path.isfile(mf):
                try:
                    pj = json.load(open(mf, encoding='utf-8')).get('params', {})
                    params = {'preset': pj.get('preset'), 'voxel_grid': pj.get('voxelMode'), 'texture_size': pj.get('textureSize'), 'tex_steps': pj.get('steps'),
                              'seed': pj.get('seed'), 'rectify': pj.get('rectifySource'), 'asset_type': pj.get('assetType'), 'quality_plus': pj.get('qualityPlus'),
                              'ultra_hd': pj.get('ultraHD')}
                except Exception:
                    pass
            nom = ORIGINE_RE.sub('', b)
            e = {'id': 'loc_' + b[:-4], 'nom': nom, 'origine': 'local', 'glb': _norm(g), 'image': img, 'params': params}
            if not os.path.isfile(img):
                e['ignore'] = 'image source introuvable : ' + img
            out.append(e)
    return out


def _version_code():
    """Empreinte du code de mesure : un changement du banc invalide le cache."""
    d = os.path.dirname(os.path.abspath(__file__))
    h = hashlib.md5()
    for f in ('rendre_silhouette.py', 'masque_reference.py', 'iou_silhouette.py'):
        h.update(open(os.path.join(d, f), 'rb').read())
    return h.hexdigest()[:8]


_VERSION = _version_code()


def _cache_path(p):
    h = hashlib.md5((p['glb'] + '|' + str(p['image']) + '|' + _VERSION).encode('utf-8')).hexdigest()[:10]
    return os.path.join(SORTIE, 'cache', p['id'][:60] + '_' + h + '.json')


def traiter(p):
    """Une paire -> dict resultat (erreurs capturees)."""
    cache = _cache_path(p)
    if os.path.isfile(cache) and not os.environ.get('FIDELITE_REFAIRE'):
        return json.load(open(cache, encoding='utf-8'))
    t = time.time()
    r = {k: p[k] for k in ('id', 'nom', 'origine', 'glb', 'image', 'params') if k in p}
    r['categorie'] = categorie(p['nom'])
    try:
        os.makedirs(SORTIE + '/diffs', exist_ok=True)
        png = SORTIE + '/diffs/' + p['id'][:70] + '.png'
        res = IS.evaluer(p['image'], p['glb'], '+y', 'auto', 'auto', None, panneau_png=png)
        r['resultat'] = IS.nettoyer_json(res)
        r['diff_png'] = png
        r['duree_s'] = round(time.time() - t, 1)
    except Exception as e:   # noqa: BLE001
        r['erreur'] = '%s: %s' % (type(e).__name__, e)
        r['trace'] = traceback.format_exc()[-600:]
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    json.dump(r, open(cache, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    return r


def stats(vals):
    v = np.array([x for x in vals if x is not None and np.isfinite(x)], float)
    if len(v) == 0:
        return None
    q = np.percentile(v, [0, 25, 50, 75, 100])
    return {'n': int(len(v)), 'min': float(q[0]), 'q1': float(q[1]), 'mediane': float(q[2]), 'q3': float(q[3]), 'max': float(q[4]), 'moyenne': float(v.mean())}


def agreger(resultats):
    ok = [r for r in resultats if 'resultat' in r]
    champs = {
        'score': lambda r: r['resultat']['score'], 'iou': lambda r: r['resultat']['iou'], 'dice': lambda r: r['resultat']['dice'],
        'f_contour': lambda r: r['resultat']['f_contour'], 'hausdorff_moyen_pct_H': lambda r: 100 * r['resultat']['hausdorff_moyen'],
        'manquant_pct': lambda r: r['resultat']['manquant_pct'], 'en_trop_pct': lambda r: r['resultat']['en_trop_pct'],
        'iou_recale': lambda r: r['resultat']['recale']['iou'], 'score_recale': lambda r: r['resultat']['recale']['score'],
        'fraction_fines_perdue': lambda r: r['resultat']['parties_fines']['fraction_fines_perdue'],
        'iou_contre_u2net': lambda r: r['resultat'].get('contre_u2net', {}).get('iou'),
    }
    out = {'global': {k: stats([f(r) for r in ok]) for k, f in champs.items()}, 'par_categorie': {}, 'par_origine': {}, 'par_preset': {}, 'par_methode_masque': {},
           'par_rectify': {}, 'par_yaw': {}}
    for cle, getter, nom in [('par_categorie', lambda r: r['categorie'], None), ('par_origine', lambda r: r['origine'], None),
                             ('par_preset', lambda r: str(r['params'].get('preset')), None),
                             ('par_methode_masque', lambda r: r['resultat']['masque_reference']['methode'], None),
                             ('par_rectify', lambda r: str(r['params'].get('rectify')), None),
                             ('par_yaw', lambda r: str(r['resultat']['orientation']['yaw']), None)]:
        grp = {}
        for r in ok:
            grp.setdefault(getter(r), []).append(r)
        for g, rs in grp.items():
            out[cle][g] = {'n': len(rs), 'score': stats([r['resultat']['score'] for r in rs]), 'iou': stats([r['resultat']['iou'] for r in rs])}
    return out


def tableau_md(resultats, st):
    ok = sorted([r for r in resultats if 'resultat' in r], key=lambda r: r['resultat']['score'])
    L = ['# Fidelite de forme : baseline du 03/10/2026', '',
         'Mesure : silhouette de face du GLB contre le masque de l\'image source (voir `build/bancs/fidelite/README.md`). Score 0-100 sur boites englobantes normalisees ;',
         '« recale » = apres recalage optimal en echelle et translation (diagnostic de cadrage/proportions).', '',
         '| # | paire | cat. | preset | rectify | masque | lacet | score | IoU | F-contour | Haus. % H | manque % | en trop % | fines perdues | IoU recale | IoU u2net | coupe bords % |',
         '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for i, r in enumerate(ok, 1):
        x = r['resultat']
        L.append('| %d | %s | %s | %s | %s | %s | %d | **%.1f** | %.3f | %.3f | %.2f | %.1f | %.1f | %d/%d | %.3f | %s | %.0f |' % (
            i, r['id'][:34], r['categorie'], r['params'].get('preset'), r['params'].get('rectify'), x['masque_reference']['methode'], x['orientation']['yaw'],
            x['score'], x['iou'], x['f_contour'], 100 * x['hausdorff_moyen'], x['manquant_pct'], x['en_trop_pct'],
            x['parties_fines']['nb_fines_perdues'], x['parties_fines']['nb_fines'], x['recale']['iou'],
            ('%.3f' % x['contre_u2net']['iou']) if 'iou' in x.get('contre_u2net', {}) else '-', x['masque_reference']['coupe_bords_pct']))
    ko = [r for r in resultats if 'resultat' not in r]
    if ko:
        L += ['', '## Paires non mesurees', '']
        for r in ko:
            L.append('- %s : %s' % (r['id'], r.get('erreur') or r.get('ignore')))
    g = st['global']
    L += ['', '## Distribution (%d paires)' % g['score']['n'], '', '| mesure | min | Q1 | mediane | Q3 | max |', '|---|---|---|---|---|---|']
    for k, v in g.items():
        if v:
            L.append('| %s | %.3f | %.3f | %.3f | %.3f | %.3f |' % (k, v['min'], v['q1'], v['mediane'], v['q3'], v['max']))
    L += ['', '## Par categorie (score mediane)', '']
    for c, v in sorted(st['par_categorie'].items()):
        L.append('- %s : n=%d, score median %.1f, IoU median %.3f' % (c, v['n'], v['score']['mediane'], v['iou']['mediane']))
    return '\n'.join(L) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--sans-local', action='store_true')
    ap.add_argument('--refaire', action='store_true', help='ignore le cache')
    ap.add_argument('--processus', type=int, default=3)
    ap.add_argument('--limite', type=int, default=0)
    a = ap.parse_args(argv)
    if a.refaire:
        os.environ['FIDELITE_REFAIRE'] = '1'
    paires = lister_paires_r2() + ([] if a.sans_local else lister_paires_locales())
    exclues = [p for p in paires if p.get('ignore')]
    a_faire = [p for p in paires if not p.get('ignore')]
    if a.limite:
        a_faire = a_faire[:a.limite]
    print('%d paires a mesurer (%d exclues)' % (len(a_faire), len(exclues)), flush=True)
    t = time.time()
    resultats = []
    if a.processus > 1:
        with mp.Pool(a.processus) as pool:
            for i, r in enumerate(pool.imap(traiter, a_faire), 1):
                resultats.append(r)
                x = r.get('resultat')
                print('[%2d/%d] %-40s %s' % (i, len(a_faire), r['id'][:40], ('score %.1f IoU %.3f (%s, lacet %d)' % (x['score'], x['iou'], x['masque_reference']['methode'], x['orientation']['yaw'])) if x else r.get('erreur')), flush=True)
    else:
        for i, p in enumerate(a_faire, 1):
            r = traiter(p)
            resultats.append(r)
            x = r.get('resultat')
            print('[%2d/%d] %-40s %s' % (i, len(a_faire), r['id'][:40], ('score %.1f IoU %.3f' % (x['score'], x['iou'])) if x else r.get('erreur')), flush=True)
    for p in exclues:
        resultats.append({k: p.get(k) for k in ('id', 'nom', 'origine', 'glb', 'image', 'ignore')} | {'params': {}, 'categorie': categorie(p['nom'])})
    st = agreger(resultats)
    os.makedirs(SORTIE, exist_ok=True)
    json.dump({'date': time.strftime('%Y-%m-%d %H:%M'), 'version_banc': 1, 'paires': resultats, 'statistiques': st}, open(SORTIE + '/baseline.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    open(SORTIE + '/baseline.md', 'w', encoding='utf-8').write(tableau_md(resultats, st))
    g = st['global']
    print('\n%d paires mesurees en %.0f s | score median %.1f (Q1 %.1f, Q3 %.1f) | IoU median %.3f | F-contour median %.3f' % (
        g['score']['n'], time.time() - t, g['score']['mediane'], g['score']['q1'], g['score']['q3'], g['iou']['mediane'], g['f_contour']['mediane']))
    print('-> %s/baseline.json, baseline.md, diffs/' % SORTIE)
    return 0


if __name__ == '__main__':
    mp.freeze_support()
    sys.exit(main())
