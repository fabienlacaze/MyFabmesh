"""Campagne du retrait de la dalle de sol sur les paires reelles (2026-10-03). HORS GARDE : un banc de mesure, pas un test.

Parcourt les paires de C:/tmp/fidelite/paires_r2/ (manifeste paires.json, GLB telecharges du compte R2) et, en tete, l'orc du
proprietaire (meshes/verif_t80_orc_...glb) ; pour CHAQUE maillage, un a la fois (trimesh sans materiaux, memoire rendue entre deux) :
  - la decision de scripts/acceleration_glb.py (masque_dalle_sol) : faces et aire retirees, ligne des pieds, criteres ;
  - ce qui s'est passe pour le meilleur candidat refuse (part de l'aire horizontale, rapport avec la silhouette du corps) : c'est
    la MARGE des seuils (le plus fort rapport d'un maillage sans dalle contre le plus faible d'un maillage avec) ;
  - « sans garde de rapport » : ce que l'algorithme retirerait si le rapport d'empreinte n'etait pas exige (ratio_min = 0) :
    les degats que ce garde-fou evite sur les batiments, vehicules, etc. ;
  - la PISTE B de la consigne (socle SEUL, sans feuille : ligne des pieds par chute de la section de silhouette en fonction de la
    hauteur + faces sous la ligne et hors de l'empreinte du corps dilatee) telle qu'elle a ete ESSAYEE ici pour la justifier ou la
    rejeter : part d'aire qu'elle retirerait sur chaque maillage. Ce n'est PAS ce que fait le module.

Les fichiers de plus de 120 Mo sont ignores (--max-mo). Sortie : C:/tmp/fidelite/dalle_sol.json (+ tableau sur la sortie standard).
CPU seulement, sans reseau ; ~30 s pour 38 paires.

Lancer :  <python de l'appli> build/bancs/fidelite/dalle_sol_campagne.py [--limite N] [--sans-orc] [--max-mo 120]
"""
import argparse
import gc
import importlib.util
import json
import os
import re
import sys
import time

import numpy as np

RACINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
DOSSIER_PAIRES = 'C:/tmp/fidelite/paires_r2'
SORTIE = 'C:/tmp/fidelite/dalle_sol.json'
GLB_ORC = os.path.join(RACINE, 'meshes', 'verif_t80_orc_trellis2_native_1791026496124.glb')
TYPE_DE_CATEGORIE = {'personnage': 'character', 'creature': 'creature', 'animal': 'animal'}
# Maillages qui portent une dalle de sol, CONSTATEE A LA MAIN (profil d'aire horizontale par hauteur : 56 % et 81 % de l'aire dans
# une bande de 0,2 % de la hauteur ; planches de coupe vues de dessus) : la verite terrain du banc. Tous les autres : au plus 11 % de
# l'aire en faces horizontales a une meme hauteur (planchers de batiments), 4,4 % pour les etres vivants.
AVEC_DALLE_CONSTATEE = ('orc_t80', '30_Red_river_hog')


def charger_module():
    spec = importlib.util.spec_from_file_location('acceleration_glb_campagne', os.path.join(RACINE, 'scripts', 'acceleration_glb.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def categorie(projet):
    """Categorie deduite du nom du projet (aucune etiquette de type dans le manifeste)."""
    p = projet.lower()
    if re.search(r'hut|house|barracks|townhall|crafter|castle|tower', p):
        return 'batiment'
    if re.search(r'truck|plane|\bcar\b|boat|ship', p):
        return 'vehicule'
    if re.search(r'warrior|worker|\bman\b|^orc|cochon|villager|soldier', p):
        return 'personnage'
    if re.search(r'centipade|centipede|spider|butterfly|^bat$|insect', p):
        return 'creature'
    return 'animal'


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


def piste_b_chute_de_section(acc, V, F, axe=1):
    """Piste B de la consigne, essayee telle quelle : ligne des pieds = la plus basse hauteur (parmi les 30 % inferieurs) ou la
    silhouette remplie moyenne des 3 tranches de 1 % DESSOUS vaut plus de 2 fois celle des 3 tranches DESSUS (chute de la
    section) ; socle = faces dont le centre est sous cette ligne ET hors de l'empreinte du corps (boite des faces de la ligne a
    +10 % de la hauteur) dilatee de 10 %. Rend (part d'aire retiree en %, hauteur de la ligne en % de T) ou (0.0, None)."""
    centres, nh, aires = acc._geometrie_faces(V, F, axe)
    marque = np.zeros(len(V), bool)
    marque[F.reshape(-1)] = True
    hmin = float(V[marque][:, axe].min())
    T = float(V[marque][:, axe].max()) - hmin
    if not T > 0:
        return 0.0, None
    axes = [i for i in range(3) if i != axe]
    h = (centres[:, axe] - hmin) / T
    A = float(aires.sum())
    S = np.zeros(34)
    for i in range(34):
        idx = np.flatnonzero((h >= i / 100.0) & (h < (i + 1) / 100.0))
        if len(idx) >= 20:
            S[i] = acc._aire_silhouette(centres[idx, axes[0]], centres[idx, axes[1]])
    ligne = None
    for i in range(3, 30):
        dessous, dessus = S[i - 3:i].mean(), S[i:i + 3].mean()
        if dessous > 0 and dessous >= 2.0 * max(dessus, 1e-12):
            ligne = i / 100.0
            break
    if ligne is None:
        return 0.0, None
    corps = np.flatnonzero((h >= ligne) & (h < ligne + 0.10))
    if len(corps) < 20:
        return 0.0, ligne * 100
    lo = np.array([centres[corps, axes[0]].min(), centres[corps, axes[1]].min()])
    hi = np.array([centres[corps, axes[0]].max(), centres[corps, axes[1]].max()])
    marge = 0.10 * (hi - lo)
    lo, hi = lo - marge, hi + marge
    sous = h < ligne
    hors = ((centres[:, axes[0]] < lo[0]) | (centres[:, axes[0]] > hi[0]) | (centres[:, axes[1]] < lo[1]) | (centres[:, axes[1]] > hi[1]))
    retire = sous & hors
    return float(100.0 * aires[retire].sum() / A), ligne * 100


def mesurer(acc, nom, projet, chemin, extra=None):
    t_charge = time.time()
    V, F = charger_glb(chemin)
    t_charge = time.time() - t_charge
    cat = categorie(projet)
    diag = {}
    t0 = time.time()
    garder, rapport = acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
    duree = time.time() - t0
    marque = np.zeros(len(V), bool)
    marque[F.reshape(-1)] = True
    ext = V[marque].max(0) - V[marque].min(0)
    res = {'nom': nom, 'projet': projet, 'categorie': cat, 'type_concerne': bool(acc.type_concerne(TYPE_DE_CATEGORIE.get(cat))),
           'faces': int(len(F)), 'taille_boite': [round(float(x), 4) for x in ext], 'duree_analyse_s': round(duree, 3),
           'duree_chargement_s': round(t_charge, 2), 'decision': 'retire' if rapport else 'inchange'}
    if extra:
        res.update(extra)
    cands = diag.get('candidats') or []
    if cands:
        meilleur = cands[0]
        res['meilleur_candidat'] = {k: meilleur.get(k) for k in ('hauteur_fenetre', 'part_horizontale', 'ratio_empreinte', 'double_face', 'accepte', 'raison')}
    else:
        res['meilleur_candidat'] = {'part_horizontale': diag.get('part_horizontale')}
    if rapport:
        res.update(faces_retirees=rapport['faces_retirees'], faces_retirees_pct=round(rapport['faces_retirees_pct'], 2),
                   aire_retiree_pct=round(rapport['aire_retiree_pct'], 2), ligne_pieds_pct=round(100 * rapport['ligne_pieds']['fraction'], 2),
                   criteres=rapport['criteres'], mode=rapport['mode'], ratio_empreinte=round(rapport['dalle']['ratio_empreinte'], 2),
                   dalle={k: rapport['dalle'][k] for k in ('hauteur', 'epaisseur', 'faces', 'aire_pct', 'double_face', 'etendue')})
        _, r2 = acc.masque_dalle_sol(V, F, 1, conserver_socle=True)
        res['conserver_socle_aire_retiree_pct'] = round(r2.get('aire_retiree_pct', 0.0), 2)
    else:
        res.update(faces_retirees=0, faces_retirees_pct=0.0, aire_retiree_pct=0.0, raison=diag.get('raison'))
        # ce que le garde « rapport d'empreinte » evite
        _, rs = acc.masque_dalle_sol(V, F, 1, ratio_min=0.0)
        res['sans_garde_de_rapport_aire_pct'] = round(rs.get('aire_retiree_pct', 0.0), 2)
        res['sans_garde_de_rapport_faces_pct'] = round(rs.get('faces_retirees_pct', 0.0), 2)
    pb, ligne_b = piste_b_chute_de_section(acc, V, F, 1)
    res['piste_b_aire_pct'] = round(pb, 2)
    res['piste_b_ligne_pct'] = None if ligne_b is None else round(ligne_b, 1)
    del V, F, garder
    gc.collect()
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--paires', default=DOSSIER_PAIRES)
    ap.add_argument('--sortie', default=SORTIE)
    ap.add_argument('--max-mo', type=float, default=120.0)
    ap.add_argument('--limite', type=int, default=None)
    ap.add_argument('--sans-orc', action='store_true')
    a = ap.parse_args(argv)
    acc = charger_module()
    if not hasattr(acc, 'masque_dalle_sol'):
        print('scripts/acceleration_glb.py : masque_dalle_sol absent', file=sys.stderr)
        return 2
    manifeste = os.path.join(a.paires, 'paires.json')
    with open(manifeste, encoding='utf-8') as f:
        paires = json.load(f)
    cibles = []
    if not a.sans_orc and os.path.exists(GLB_ORC):
        cibles.append(('orc_t80', 'orc (verif t80, poste)', GLB_ORC, {'preset': 'poste', 'decimation_target': 500000}))
    for p in paires:
        chemin = os.path.join(p['dossier'], p['glb'])
        nom = os.path.basename(p['dossier'])
        cibles.append((nom, p.get('projet', nom), chemin, {'preset': p.get('preset'), 'decimation_target': p.get('decimation_target'),
                                                           'max_tris': p.get('max_tris')}))
    if a.limite:
        cibles = cibles[:a.limite]
    resultats = []
    for nom, projet, chemin, extra in cibles:
        if not os.path.exists(chemin):
            resultats.append({'nom': nom, 'projet': projet, 'decision': 'absent'})
            print('%-34s ABSENT' % nom)
            continue
        taille = os.path.getsize(chemin) / 1e6
        if taille > a.max_mo:
            resultats.append({'nom': nom, 'projet': projet, 'categorie': categorie(projet), 'decision': 'ignore',
                              'raison': 'fichier de %.0f Mo (> %.0f)' % (taille, a.max_mo)})
            print('%-34s IGNORE (%.0f Mo)' % (nom, taille))
            continue
        try:
            r = mesurer(acc, nom, projet, chemin, extra)
        except Exception as e:
            r = {'nom': nom, 'projet': projet, 'decision': 'erreur', 'raison': '%s: %s' % (type(e).__name__, e)}
        resultats.append(r)
        bc = r.get('meilleur_candidat') or {}
        print('%-30s %-10s %8s F | %-8s | -%5.1f %% faces -%5.1f %% aire | ligne %5s %% | part %5s | rapport %6s | sans garde -%5.1f %% | piste B -%5.1f %%' % (
            nom[:30], r.get('categorie', '?'), r.get('faces', '?'), r['decision'], r.get('faces_retirees_pct', 0), r.get('aire_retiree_pct', 0),
            r.get('ligne_pieds_pct', '-'), ('%.1f%%' % (100 * bc['part_horizontale'])) if bc.get('part_horizontale') is not None else '-',
            ('%.2f' % bc['ratio_empreinte']) if bc.get('ratio_empreinte') is not None else ('%.2f' % r['ratio_empreinte'] if 'ratio_empreinte' in r else '-'),
            r.get('sans_garde_de_rapport_aire_pct', 0), r.get('piste_b_aire_pct', 0)))
    mesures = [r for r in resultats if r['decision'] in ('retire', 'inchange')]
    retires = [r for r in mesures if r['decision'] == 'retire']
    refus = [r for r in mesures if r['decision'] == 'inchange']
    rapports_refus = [r['meilleur_candidat'].get('ratio_empreinte') for r in refus if r.get('meilleur_candidat', {}).get('ratio_empreinte') is not None]
    bilan = {
        'mesures': len(mesures), 'ignores': sum(1 for r in resultats if r['decision'] == 'ignore'), 'erreurs': sum(1 for r in resultats if r['decision'] == 'erreur'),
        'avec_dalle': [r['nom'] for r in retires],
        'plus_fort_rapport_d_un_refus': max(rapports_refus) if rapports_refus else None,
        'plus_faible_rapport_d_une_dalle': min(r['ratio_empreinte'] for r in retires) if retires else None,
        'seuil_rapport': acc.REGLAGES_DALLE['ratio_min'],
        'faux_positifs': [r['nom'] for r in retires if r['nom'] not in AVEC_DALLE_CONSTATEE],
        'faux_negatifs': [n for n in AVEC_DALLE_CONSTATEE if n in {r['nom'] for r in mesures} and n not in {r['nom'] for r in retires}],
        'piste_b_maillages_touches': [(r['nom'], r['piste_b_aire_pct']) for r in refus if r.get('piste_b_aire_pct', 0) > 0.05],
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.sortie)), exist_ok=True)
    with open(a.sortie, 'w', encoding='utf-8') as f:
        json.dump({'date': time.strftime('%Y-%m-%d %H:%M:%S'), 'reglages': acc.REGLAGES_DALLE, 'bilan': bilan, 'resultats': resultats},
                  f, indent=1, ensure_ascii=False)
    print('\n%d maillages mesures, %d avec dalle : %s' % (bilan['mesures'], len(retires), ', '.join(bilan['avec_dalle'])))
    print('plus fort rapport d\'un maillage SANS dalle : %s ; plus faible d\'un maillage AVEC dalle : %s ; seuil %.1f' % (
        bilan['plus_fort_rapport_d_un_refus'], bilan['plus_faible_rapport_d_une_dalle'], bilan['seuil_rapport']))
    print('faux positifs : %s ; faux negatifs : %s' % (bilan['faux_positifs'] or 'aucun', bilan['faux_negatifs'] or 'aucun'))
    print('piste B (socle seul par chute de section) toucherait %d maillages sans dalle' % len(bilan['piste_b_maillages_touches']))
    print('ecrit', a.sortie)
    return 0


if __name__ == '__main__':
    sys.exit(main())
