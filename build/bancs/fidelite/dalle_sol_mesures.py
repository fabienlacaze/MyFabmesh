"""Mesures du retrait de la dalle de sol sur des GLB REELS (2026-10-18). HORS GARDE : un banc de mesure a sous-commandes, pas un test.
CPU seulement, lecture seule, sans reseau, sans GPU. Chaque chiffre de l'entree AGENT_LOG du 18/10 sort d'une de ces commandes.

  balayage <glb | dossier> ...   la decision du detecteur sur chaque GLB, un a la fois : faux positifs, marge des seuils (--max-mo 300)
  echelle <glb> <k>              temps et memoire du detecteur sur le GLB subdivise k fois (1 -> x4 faces) ; mesure dans un processus NEUF
  inclinaison <glb>              le GLB tourne autour de Z et de X (--angles 0.02,1,12,14,16,25) : corps perdu, dalle laissee
  decimation <glb>               le GLB decime (--cibles 200000,50000,5000,500 ; exige fast_simplification) : la decision change-t-elle ?
  composantes <glb>              composantes du maillage GARDE, avec et sans le retrait des ilots (le constat de la relecture du 03/10)

Lancer :  <python de l'appli> build/bancs/fidelite/dalle_sol_mesures.py <sous-commande> ... [--module scripts/acceleration_glb.py]
Les GLB de l'orc et des paires : voir build/bancs/fidelite/README.md.
"""
import argparse
import gc
import glob
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time

import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
MODULE_PAR_DEFAUT = os.path.join(RACINE, 'scripts', 'acceleration_glb.py')


def charger_module(chemin=None):
    spec = importlib.util.spec_from_file_location('acceleration_glb_mesures', chemin or MODULE_PAR_DEFAUT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def charger_glb(chemin):
    """(V float64, F int64) : toutes les geometries fusionnees avec leur transformation de noeud, sans materiaux."""
    import trimesh
    sc = trimesh.load(chemin, force='scene', skip_materials=True, process=False)
    Vs, Fs, deca = [], [], 0
    for nom in sc.graph.nodes_geometry:
        T, g = sc.graph[nom]
        G = sc.geometry[g]
        if not hasattr(G, 'faces') or len(G.faces) == 0:
            continue
        Vs.append(np.asarray(G.vertices, np.float64) @ np.asarray(T)[:3, :3].T + np.asarray(T)[:3, 3])
        Fs.append(np.asarray(G.faces, np.int64) + deca)
        deca += len(G.vertices)
    del sc
    return np.concatenate(Vs), np.concatenate(Fs)


def rotation(plan, degres):
    """Rotation de `degres` degres dans le plan des axes `plan` (i, j)."""
    a = np.radians(degres)
    R = np.eye(3)
    i, j = plan
    R[i, i] = R[j, j] = np.cos(a)
    R[i, j], R[j, i] = -np.sin(a), np.sin(a)
    return R


def memoire_mo():
    """(memoire residente, pic) du processus en Mo ; (-1, -1) si indisponible."""
    try:
        if os.name == 'nt':
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
            ps.GetProcessMemoryInfo.restype = wintypes.BOOL
            if not ps.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
                return -1.0, -1.0
            return pmc.WorkingSetSize / 1e6, pmc.PeakWorkingSetSize / 1e6
        import resource
        pic = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
        return pic, pic
    except Exception:
        return -1.0, -1.0


# --------------------------------------------------------------------------------------------------------------- balayage
def cmd_balayage(a):
    acc = charger_module(a.module)
    cibles = []
    for c in a.cibles:
        cibles += sorted(glob.glob(os.path.join(c, '*.glb'))) if os.path.isdir(c) else [c]
    res = []
    for chemin in cibles:
        nom = os.path.basename(chemin)
        mo = os.path.getsize(chemin) / 1e6
        if mo > a.max_mo:
            res.append({'nom': nom, 'decision': 'ignore', 'mo': round(mo, 1)})
            print('%-60s IGNORE (%.0f Mo)' % (nom[:60], mo), flush=True)
            continue
        try:
            t0 = time.time()
            V, F = charger_glb(chemin)
            tc = time.time() - t0
            diag = {}
            t1 = time.time()
            garder, rap = acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
            ta = time.time() - t1
            c0 = (diag.get('candidats') or [{}])[0]
            r = {'nom': nom, 'faces': int(len(F)), 'decision': 'retire' if rap else 'inchange', 'analyse_s': round(ta, 2),
                 'charge_s': round(tc, 1), 'part': diag.get('part_horizontale'), 'ratio': c0.get('ratio_empreinte'), 'raison': diag.get('raison')}
            if rap:
                r.update(faces_pct=round(rap['faces_retirees_pct'], 1), aire_pct=round(rap['aire_retiree_pct'], 1),
                         ligne_pct=round(100 * rap['ligne_pieds']['fraction'], 2), criteres=rap['criteres'], mode=rap['mode'],
                         ilots=(rap.get('ilots') or {}).get('faces'), incl=round(rap['dalle'].get('inclinaison_deg', 0.0), 3),
                         ratio=round(rap['dalle']['ratio_empreinte'], 2))
            res.append(r)
            print('%-60s %9d F %-8s faces -%5s %% aire -%5s %% ligne %6s %% rapport %6s %s' % (
                nom[:60], len(F), r['decision'], r.get('faces_pct', 0), r.get('aire_pct', 0), r.get('ligne_pct', '-'),
                ('%.2f' % r['ratio']) if r.get('ratio') is not None else '-', '' if rap else '| ' + str(r.get('raison'))[:70]), flush=True)
            del V, F, garder
            gc.collect()
        except Exception as e:
            res.append({'nom': nom, 'decision': 'erreur', 'raison': '%s: %s' % (type(e).__name__, e)})
            print('%-60s ERREUR %s: %s' % (nom[:60], type(e).__name__, e), flush=True)
    retires = [r['nom'] for r in res if r['decision'] == 'retire']
    refus = [r['ratio'] for r in res if r['decision'] == 'inchange' and r.get('ratio') is not None]
    print('\n%d GLB, %d avec dalle : %s ; plus fort rapport d\'un refus : %s (seuil %.1f)' % (
        len(res), len(retires), ', '.join(retires) or 'aucun', ('%.2f' % max(refus)) if refus else '-', acc.REGLAGES_DALLE['ratio_min']))
    if a.sortie:
        with open(a.sortie, 'w', encoding='utf-8') as f:
            json.dump(res, f, indent=1, ensure_ascii=False)
    return res


# ---------------------------------------------------------------------------------------------------------------- echelle
def _echelle_mesure(a):
    """Sous-commande cachee : dans un processus NEUF, charge le maillage .npz, lance le detecteur et rend une ligne JSON."""
    acc = charger_module(a.module)
    d = np.load(a.npz)
    V, F = d['V'], d['F']
    ws0, pic0 = memoire_mo()
    t0 = time.time()
    garder, rap = acc.masque_dalle_sol(V, F, a.axe)
    dt = time.time() - t0
    ws1, pic1 = memoire_mo()
    print(json.dumps({'faces': int(len(F)), 'sommets': int(len(V)), 'duree_s': round(dt, 2), 'decision': 'retire' if rap else 'inchange',
                      'faces_retirees_pct': round(rap.get('faces_retirees_pct', 0.0), 1), 'aire_retiree_pct': round(rap.get('aire_retiree_pct', 0.0), 1),
                      'pic_avant_mo': round(pic0), 'pic_apres_mo': round(pic1), 'surcout_pic_mo': round(pic1 - ws0)}))


def cmd_echelle(a):
    import trimesh
    V, F = charger_glb(a.glb)
    for _ in range(a.k):
        V, F = trimesh.remesh.subdivide(V, F)
    with tempfile.TemporaryDirectory() as dossier:
        npz = os.path.join(dossier, 'maillage.npz')
        np.savez(npz, V=V.astype(np.float32), F=F.astype(np.int32))
        del V, F
        gc.collect()
        cmd = [sys.executable, '-X', 'utf8', os.path.abspath(__file__), '_echelle_mesure', npz, '--axe', str(a.axe)]
        if a.module:
            cmd += ['--module', a.module]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if p.returncode != 0:
        raise RuntimeError('mesure en echec : ' + (p.stderr or p.stdout)[-400:])
    res = json.loads(p.stdout.strip().splitlines()[-1])
    print('%d faces : %.2f s, surcout de pic memoire %d Mo, decision %s (%.1f %% des faces, %.1f %% de l\'aire)' % (
        res['faces'], res['duree_s'], res['surcout_pic_mo'], res['decision'], res['faces_retirees_pct'], res['aire_retiree_pct']))
    return res


# ----------------------------------------------------------------------------------------------------------- inclinaison
def cmd_inclinaison(a):
    acc = charger_module(a.module)
    V, F = charger_glb(a.glb)
    plat, rap0 = acc.masque_dalle_sol(V, F, 1)
    if not rap0:
        print('rien n\'est retire a plat : rien a comparer')
        return []
    n_corps, n_dalle = int(plat.sum()), int((~plat).sum())
    print('a plat : %d faces de corps, %d de dalle' % (n_corps, n_dalle))
    print('%-5s %-7s %-9s %-22s %-22s %s' % ('plan', 'degres', 'decision', 'corps perdu', 'dalle laissee', 'inclinaison mesuree'))
    res = []
    for plan, nom in (((0, 1), 'Z'), ((2, 1), 'X')):
        for deg in a.angles:
            g, rap = acc.masque_dalle_sol(V @ rotation(plan, deg).T, F, 1)
            if not rap:
                res.append({'plan': nom, 'degres': deg, 'decision': 'inchange'})
                print('%-5s %-7g %-9s' % (nom, deg, 'inchange'))
                continue
            perdu, laisse = int((plat & ~g).sum()), int((~plat & g).sum())
            res.append({'plan': nom, 'degres': deg, 'decision': 'retire', 'corps_perdu': perdu, 'corps_perdu_pct': 100.0 * perdu / n_corps,
                        'dalle_laissee': laisse, 'dalle_laissee_pct': 100.0 * laisse / n_dalle,
                        'inclinaison_mesuree': rap['dalle'].get('inclinaison_deg', 0.0)})
            print('%-5s %-7g %-9s %7d (%.3f %%)      %7d (%.2f %%)      %.3f' % (
                nom, deg, 'retire', perdu, 100.0 * perdu / n_corps, laisse, 100.0 * laisse / n_dalle, rap['dalle'].get('inclinaison_deg', 0.0)))
    return res


# ----------------------------------------------------------------------------------------------------------- decimation
def cmd_decimation(a):
    import fast_simplification
    acc = charger_module(a.module)
    V, F = charger_glb(a.glb)
    Vu, inv = np.unique(np.round(V, 6), axis=0, return_inverse=True)           # soudure des coutures d'UV avant de decimer
    Fu = inv.reshape(-1)[F]
    Fu = Fu[(Fu[:, 0] != Fu[:, 1]) & (Fu[:, 1] != Fu[:, 2]) & (Fu[:, 0] != Fu[:, 2])]
    g0, r0 = acc.masque_dalle_sol(Vu, Fu, 1)
    if not r0:
        print('rien n\'est retire en pleine resolution : rien a comparer')
        return []
    print('plein (%d faces soudees) : %.1f %% des faces, %.1f %% de l\'aire, ligne %.2f %%' % (
        len(Fu), r0['faces_retirees_pct'], r0['aire_retiree_pct'], 100 * r0['ligne_pieds']['fraction']))
    print('%-8s %-8s %-9s %-11s %-10s %-8s %s' % ('cible', 'faces', 'decision', 'faces-ret %', 'aire-ret %', 'ligne %', 'sommet du corps avant -> apres'))
    res = []
    for cible in a.cibles:
        if cible >= len(Fu):
            continue
        v2, f2 = fast_simplification.simplify(Vu.astype(np.float32), Fu.astype(np.int32), target_reduction=1.0 - cible / len(Fu), agg=7)
        f2 = f2.astype(np.int64)
        g, rap = acc.masque_dalle_sol(v2, f2, 1)
        haut_avant = float(v2[np.unique(f2)][:, 1].max())
        if not rap:
            res.append({'cible': cible, 'faces': int(len(f2)), 'decision': 'inchange'})
            print('%-8d %-8d %-9s' % (cible, len(f2), 'inchange'))
            continue
        haut_apres = float(v2[np.unique(f2[g])][:, 1].max())
        res.append({'cible': cible, 'faces': int(len(f2)), 'decision': 'retire', 'faces_retirees_pct': rap['faces_retirees_pct'],
                    'aire_retiree_pct': rap['aire_retiree_pct'], 'ligne_pct': 100 * rap['ligne_pieds']['fraction'],
                    'sommet_avant': haut_avant, 'sommet_apres': haut_apres})
        print('%-8d %-8d %-9s %-11.1f %-10.1f %-8.2f %.4f -> %.4f' % (cible, len(f2), 'retire', rap['faces_retirees_pct'], rap['aire_retiree_pct'],
                                                                   100 * rap['ligne_pieds']['fraction'], haut_avant, haut_apres))
    return res


# ---------------------------------------------------------------------------------------------------------- composantes
def cmd_composantes(a):
    acc = charger_module(a.module)
    V, F = charger_glb(a.glb)
    centres, nh, aires = acc._geometrie_faces(V, F, 1)
    hmin = float(V[np.unique(F)][:, 1].min())
    T = float(V[np.unique(F)][:, 1].max()) - hmin
    etendue = float((V.max(0) - V.min(0)).max())
    res = {}
    for etiquette, kw in (('avec', {}), ('sans', {'debris_hauteur': 0})):
        g, rap = acc.masque_dalle_sol(V, F, 1, **kw)
        if not rap:
            print('rien n\'est retire : rien a mesurer')
            return {}
        ligne = rap['ligne_pieds']['hauteur']
        Fk = np.flatnonzero(g)
        _, comp = np.unique(acc._composantes_faces(V, F[Fk], etendue), return_inverse=True)
        n = int(comp.max()) + 1
        aire = np.bincount(comp, weights=aires[Fk], minlength=n)
        nbf = np.bincount(comp, minlength=n)
        haut = np.full(n, -np.inf)
        np.maximum.at(haut, comp, (centres[Fk, 1] - ligne) / T)
        princ = int(np.argmax(aire))
        sec = np.ones(n, bool)
        sec[princ] = False
        en_l_air = sec & (haut < 0.05)
        res[etiquette] = {'composantes': n, 'principale_faces': int(nbf[princ]), 'principale_aire_pct': float(100 * aire[princ] / aire.sum()),
                          'secondaires': int(sec.sum()), 'secondaires_faces': int(nbf[sec].sum()),
                          'secondaires_faces_pct': float(100 * nbf[sec].sum() / len(Fk)),
                          'en_l_air': int(en_l_air.sum()), 'en_l_air_faces': int(nbf[en_l_air].sum())}
        print('%s retrait des ilots : %d composantes gardees, principale %d faces (%.1f %% de l\'aire gardee) ; secondaires %d composantes, %d faces '
              '(%.2f %% des faces gardees) ; dont entierement a moins de 5 %% de T au-dessus de la ligne : %d composantes, %d faces' % (
                  etiquette.upper(), n, nbf[princ], 100 * aire[princ] / aire.sum(), int(sec.sum()), int(nbf[sec].sum()),
                  100 * nbf[sec].sum() / len(Fk), int(en_l_air.sum()), int(nbf[en_l_air].sum())))
    return res


def liste_nombres(texte):
    return [float(x) if '.' in x else int(x) for x in texte.split(',') if x.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('balayage')
    p.add_argument('cibles', nargs='+')
    p.add_argument('--max-mo', type=float, default=300.0)
    p.add_argument('--sortie', default=None)
    p.add_argument('--module', default=None)
    p = sp.add_parser('echelle')
    p.add_argument('glb')
    p.add_argument('k', type=int)
    p.add_argument('--axe', type=int, default=1)
    p.add_argument('--module', default=None)
    p = sp.add_parser('_echelle_mesure')
    p.add_argument('npz')
    p.add_argument('--axe', type=int, default=1)
    p.add_argument('--module', default=None)
    p = sp.add_parser('inclinaison')
    p.add_argument('glb')
    p.add_argument('--angles', type=liste_nombres, default=[0.02, 0.1, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 10, 12, 13, 14, 15, 16, 18, 20, 25])
    p.add_argument('--module', default=None)
    p = sp.add_parser('decimation')
    p.add_argument('glb')
    p.add_argument('--cibles', type=liste_nombres, default=[200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500])
    p.add_argument('--module', default=None)
    p = sp.add_parser('composantes')
    p.add_argument('glb')
    p.add_argument('--module', default=None)
    a = ap.parse_args(argv)
    fonctions = {'balayage': cmd_balayage, 'echelle': cmd_echelle, '_echelle_mesure': _echelle_mesure, 'inclinaison': cmd_inclinaison,
                 'decimation': cmd_decimation, 'composantes': cmd_composantes}
    fonctions[a.cmd](a)
    return 0


if __name__ == '__main__':
    sys.exit(main())
