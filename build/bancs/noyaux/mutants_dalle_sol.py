"""Mutations du retrait de la dalle de sol (scripts/acceleration_glb.py) : la PREUVE que test_dalle_sol.py echoue sans chaque comportement.
Banc de mesure, HORS garde (une soixantaine de lancements de la suite, ~4 s chacun sans le GLB de l'orc).

Chaque mutant est UN remplacement exact dans le texte du module (une valeur de reglage, une condition, une ligne). Il est ecrit dans un
fichier a part, puis la suite test_dalle_sol.py est lancee dessus (variable NOYAU_ACCEL) avec `-f`. Le mutant est TUE si la suite echoue,
il SURVIT si elle passe : il faut alors un test de plus (ou le mutant est equivalent et la ligne est du code mort). Un remplacement qui ne
trouve pas son texte EXACTEMENT une fois est INVALIDE (le module a change : mettre la table a jour).

    python build/bancs/noyaux/mutants_dalle_sol.py [--module CHEMIN] [--sortie DOSSIER] [--avec-orc] [nom_de_mutant ...]

--avec-orc : garde GLB_ORC (les tests du GLB reel de l'orc tournent aussi : ~15 s de plus par mutant et ~1 Go de memoire ; a lancer
sous `bash /c/tmp/lourd.sh`). Par defaut les tests de l'orc sont sautes (scenes synthetiques seules, legeres).
Rend 0 si tous les mutants sont tues, 1 sinon. Un journal par mutant dans le dossier de sortie (defaut : dossier temporaire).

Historique : la relecture du 03/10 avait laisse survivre cos_horizontal 0,9 -> 0,5 (M0), bande_demi 1 % -> 4 % (M4) et le seuil de double
face 20 % -> 90 % (M13) ; les tests 29, 30 et 31 les tuent (2026-10-15). Au premier passage du 15/10, 60 mutants sur 63 etaient tues ; les
trois survivants (I5, I6, I9, tous sur les ilots detaches) ont donne les tests 33 et 33b.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
TEST = os.path.join(RACINE, 'build', 'bancs', 'noyaux', 'test_dalle_sol.py')
MODULE = os.path.join(RACINE, 'scripts', 'acceleration_glb.py')

MUTANTS = {
    # --- seuils
    'M0_cos_horizontal_0.5': ("'cos_horizontal': 0.9,", "'cos_horizontal': 0.5,"),
    'M0b_cos_horizontal_0.97': ("'cos_horizontal': 0.9,", "'cos_horizontal': 0.97,"),
    'M1_fenetre_0.2': ("'fenetre': 0.02,", "'fenetre': 0.2,"),
    'M1b_fenetre_0.002': ("'fenetre': 0.02,", "'fenetre': 0.002,"),
    'M4_bande_demi_0.04': ("'bande_demi': 0.01,", "'bande_demi': 0.04,"),
    'M4b_bande_demi_0.002': ("'bande_demi': 0.01,", "'bande_demi': 0.002,"),
    'M5_hauteur_max_0.9': ("'hauteur_max': 0.35,", "'hauteur_max': 0.9,"),
    'M6_part_min_0': ("'part_min': 0.04,", "'part_min': 0.0,"),
    'M7_composante_min_0': ("'composante_min': 0.01,", "'composante_min': 0.0,"),
    'M8_ratio_min_0': ("'ratio_min': 3.0,", "'ratio_min': 0.0,"),
    'M8b_ratio_min_10': ("'ratio_min': 3.0,", "'ratio_min': 10.0,"),
    'M9_dessus_min_0': ("'dessus_min': 0.10,", "'dessus_min': 0.0,"),
    'M10_marge_coupe_0': ("'marge_coupe': 0.0025,", "'marge_coupe': 0.0,"),
    'M10b_marge_coupe_0.02': ("'marge_coupe': 0.0025,", "'marge_coupe': 0.02,"),
    'M11_profondeur_socle_1': ("'profondeur_socle_max': 0.15,", "'profondeur_socle_max': 1.0,"),
    'M11b_profondeur_socle_0.01': ("'profondeur_socle_max': 0.15,", "'profondeur_socle_max': 0.01,"),
    'M12_conserve_min_0': ("'conserve_min': 0.03,", "'conserve_min': 0.0,"),
    'M13_double_face_0.9': ("min(a_haut, a_bas) >= 0.2 * max(a_haut, a_bas, 1e-300)", "min(a_haut, a_bas) >= 0.9 * max(a_haut, a_bas, 1e-300)"),
    'M13b_double_face_0': ("min(a_haut, a_bas) >= 0.2 * max(a_haut, a_bas, 1e-300)", "min(a_haut, a_bas) >= 0.0 * max(a_haut, a_bas, 1e-300)"),
    # --- feuille penchee (le plan)
    'T1_plan_jamais': ("'plan_rms': 0.9,", "'plan_rms': 0.0,"),
    'T2_plan_variation_inf': ("'plan_variation': 0.25,", "'plan_variation': 1e9,"),
    'T3_coupe_horizontale': ("        sous = hp < coupe ", "        sous = h < coupe "),
    'T4_hp_plat': ("    hp = hauteurs[choix]  ", "    hp = h  "),
    'T5_dessus_plat': ("    au = np.flatnonzero(hp > coupe)", "    au = np.flatnonzero(h > coupe)"),
    'T6_rebord_plat': ("    rebord = _rebord_dalle(centres, hp, axes, est_dalle, dalle['h_bas'], dalle['h_sommet'], T, etendue)\n    if mode == 'socle_retire':",
                       "    rebord = _rebord_dalle(centres, h, axes, est_dalle, dalle['h_bas'], dalle['h_sommet'], T, etendue)\n    if mode == 'socle_retire':"),
    'T7_pente_sans_recentrage': ("        hp2 = h - (a * (cx - mx) + b * (cy - my))", "        hp2 = h - (a * cx + b * cy)"),
    'T8_plan_une_iteration': ("    for _ in range(3):\n        plan = _ajuster_plan", "    for _ in range(1):\n        plan = _ajuster_plan"),
    # --- ilots detaches
    'I1_debris_off': ("'debris_hauteur': 0.05,", "'debris_hauteur': 0.0,"),
    'I1b_debris_hauteur_1': ("'debris_hauteur': 0.05,", "'debris_hauteur': 1.0,"),
    'I1c_debris_hauteur_0.005': ("'debris_hauteur': 0.05,", "'debris_hauteur': 0.005,"),
    'I2_debris_aire_1': ("'debris_aire_max': 0.05,", "'debris_aire_max': 1.0,"),
    'I2b_debris_aire_0.0001': ("'debris_aire_max': 0.05,", "'debris_aire_max': 0.0001,"),
    'I3_debris_total_1': ("'debris_total_max': 0.10,", "'debris_total_max': 1.0,"),
    'I3b_debris_total_0.001': ("'debris_total_max': 0.10,", "'debris_total_max': 0.001,"),
    'I4_dominante_0': ("'debris_dominante': 0.5,", "'debris_dominante': 0.0,"),
    'I4b_dominante_1': ("'debris_dominante': 0.5,", "'debris_dominante': 1.01,"),
    'I5_sans_contact_coupe': ("    ilot = touchee & (haut <=", "    ilot = (haut <="),
    'I6_principale_retiree': ("    ilot[principale] = False\n", "    pass\n"),
    'I7_sans_hauteur': ("(haut <= coupe + r['debris_hauteur'] * T)", "(haut <= 1e18)"),
    'I8_sans_soudure': ("    W = _souder(V, F, etendue)\n    nbv", "    W = np.arange(3 * len(F)).reshape(-1, 3)\n    nbv"),
    'I9_ilots_en_mode_dalle_seule': ("        retire = est_dalle | rebord\n        if rebord.any():",
                                     "        retire = est_dalle | rebord\n        _il = _ilots_detaches(V, F, retire, hp, coupe, T, aires, etendue, r)\n        if _il is not None:\n            retire = retire | _il\n        if rebord.any():"),
    # --- coeur
    'C1_percentile_0.5': ("h_sommet = _percentile_pondere(hd, aires[D], 0.99)", "h_sommet = _percentile_pondere(hd, aires[D], 0.5)"),
    'C2_sans_soudure': ("    _, inv = np.unique(cle, return_inverse=True)\n    return inv.reshape(n, 3).astype(np.int64)", "    inv = np.arange(len(cle))\n    return inv.reshape(n, 3).astype(np.int64)"),
    'C3_sans_rebord': ("        retire = est_dalle | rebord", "        retire = est_dalle"),
    'C4_socle_epais_toujours': ("        if socle >= max(50, int(0.002 * m)):", "        if True:"),
    'C5_limite_socle_ignoree': ("candidats[i]['coupe'] <= limite]", "candidats[i]['coupe'] <= 1e9]"),
    'C6_plus_basse': ("            choix = max(dans_limite, key=lambda i: candidats[i]['coupe'])", "            choix = min(dans_limite, key=lambda i: candidats[i]['coupe'])"),
    'C7_ratio_ignore': ("    ratio = c['aire_une_face'] / max(sil, 1e-300)", "    ratio = 1e9"),
    'C8_silhouette_non_remplie': ("    pad = (np.pad(img, 1) * 255).astype(np.uint8)", "    pad = (np.pad(img, 1) * 255).astype(np.uint8)\n    return float(img.sum()) * cell * cell"),
    'C9_rebord_sans_hors': ("    return bande & hors & ~est_dalle", "    return bande & ~est_dalle"),
    'C10_axes_fixes': ("    axes = [i for i in range(3) if i != axe]\n    centres, nh, aires", "    axes = [0, 2]\n    centres, nh, aires"),
    # --- trimesh / scene
    'S1_normales_recalculees': ("        kw['vertex_normals'] = np.asarray(g.vertex_normals)[utiles]", "        pass"),
    'S2_uv_prefixe': ("kw['visual'] = trimesh.visual.TextureVisuals(uv=np.asarray(vis.uv)[utiles], material=vis.material)",
                      "kw['visual'] = trimesh.visual.TextureVisuals(uv=np.asarray(vis.uv)[:len(utiles)], material=vis.material)"),
    'S3_scene_copy_simple': ("            nouvelle.geometry[nom_geo] = g.copy(include_cache=True)", "            pass"),
    'S4_instance_multiple': ("        if nom_geo in vus:\n            return scene, {}", "        if False:\n            return scene, {}"),
    'S5_materiau_copie': ("material=vis.material)", "material=vis.material.copy())"),
    # --- adaptateur cumesh / crochet
    'A1_dtype_faces': ("        f2 = np.ascontiguousarray(inv.reshape(-1, 3).astype(f_np.dtype))", "        f2 = np.ascontiguousarray(inv.reshape(-1, 3))"),
    'A2_deux_passes': ("    if not e.actif or getattr(mesh, '_dalle_traitee', False):", "    if not e.actif:"),
    'A3_double_enveloppe': ("        if getattr(cls, '_fabmesh_retrait_dalle', False):\n            return True\n", ""),
    'A4_etat_non_restaure': ("        e.actif, e.conserver_socle, e.axe_haut, e.log, e.reglages, e.rapports = ancien", "        pass"),
    'A5_etat_partage': ("class _EtatRetrait(_threading.local):", "class _EtatRetrait(object):"),
    'A6_exception_non_attrapee': ("    except Exception as e:\n        log(\"[mesh] dalle de sol : retrait ignore", "    except KeyboardInterrupt as e:\n        log(\"[mesh] dalle de sol : retrait ignore"),
    'A7_hors_contexte_actif': ("    if not e.actif or getattr(mesh, '_dalle_traitee', False):", "    if getattr(mesh, '_dalle_traitee', False):"),
}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--module', default=MODULE)
    ap.add_argument('--sortie', default=None)
    ap.add_argument('--avec-orc', action='store_true')
    ap.add_argument('noms', nargs='*')
    a = ap.parse_args(argv)
    sortie = a.sortie or tempfile.mkdtemp(prefix='mutants_dalle_sol_')
    os.makedirs(sortie, exist_ok=True)
    noms = a.noms or list(MUTANTS)
    inconnus = [n for n in noms if n not in MUTANTS]
    if inconnus:
        print('mutants inconnus : %s' % inconnus, file=sys.stderr)
        return 2
    texte = open(a.module, 'rb').read().decode('utf-8').replace('\r\n', '\n')
    resultats = {}
    for nom in noms:
        ancien, nouveau = MUTANTS[nom]
        n = texte.count(ancien)
        if n != 1:
            resultats[nom] = 'INVALIDE (%d occurrences du texte a remplacer)' % n
            print('%-32s %s' % (nom, resultats[nom]), flush=True)
            continue
        chemin = os.path.join(sortie, nom + '.py')
        with open(chemin, 'wb') as f:
            f.write(texte.replace(ancien, nouveau).encode('utf-8'))
        env = dict(os.environ, NOYAU_ACCEL=chemin)
        if not a.avec_orc:
            env['GLB_ORC'] = os.path.join(sortie, 'sans_orc.glb')          # n'existe pas : les tests de l'orc reel sont sautes
        journal = os.path.join(sortie, nom + '.log')
        t0 = time.time()
        with open(journal, 'wb') as fj:
            p = subprocess.run([sys.executable, TEST, '-f'], env=env, stdout=fj, stderr=subprocess.STDOUT, timeout=600)
        sortie_test = open(journal, 'rb').read().decode('utf-8', 'replace')
        premier = ''
        for ligne in sortie_test.splitlines():
            if ligne.startswith(('FAIL:', 'ERROR:')):
                premier = ligne.split(' (')[0]
                break
        resultats[nom] = ('TUE par ' + premier) if p.returncode != 0 else 'SURVIT'
        print('%-32s %-70s %.0f s' % (nom, resultats[nom], time.time() - t0), flush=True)
    with open(os.path.join(sortie, 'resultats.json'), 'w', encoding='utf-8') as f:
        json.dump(resultats, f, indent=1, ensure_ascii=False)
    survivants = [k for k, v in resultats.items() if not v.startswith('TUE')]
    print('\nBILAN : %d mutants, %d tues, survivants ou invalides : %s' % (len(resultats), len(resultats) - len(survivants), survivants or 'aucun'))
    print('journaux : %s' % sortie)
    return 1 if survivants else 0


if __name__ == '__main__':
    sys.exit(main())
