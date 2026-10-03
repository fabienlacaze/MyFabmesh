"""Consolide docs/campagnes/resultats_outils_3d_suite.jsonl : fusionne les lignes ajoutees a la main avec celles du banc (meme essai), ajoute les verifications de correctifs hors appli,
puis colle le verdict humain (verdicts_suite.json) dans chaque ligne. Le fichier est reecrit (une ligne par essai, dans l'ordre de premiere apparition).
Usage : python consolider_suite.py   (a lancer quand aucun essai ne tourne)"""
import io, json, os
REPO = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself'
SRC = REPO + '/docs/campagnes/resultats_outils_3d_suite.jsonl'
VERD = json.load(io.open(REPO + '/build/bancs/campagne3d/verdicts_suite.json', encoding='utf-8'))
lignes = [json.loads(l) for l in io.open(SRC, encoding='utf-8') if l.strip()]
# lignes d'origine du fichier avant les verdicts : on garde la derniere tentative de chaque essai, en fusionnant les champs manquants des tentatives precedentes
fus = {}
ordre = []
for d in lignes:
    k = (d.get('groupe'), d.get('nom'))
    if k not in fus:
        fus[k] = {}; ordre.append(k)
    prec = fus[k]
    nouveau = dict(d)
    # une ligne ecrite a la main (sans duree) complete la ligne du banc ; sinon la derniere tentative remplace
    if 'duree_s' not in d and 'duree_s' in prec:
        merged = dict(prec); merged.update(d); nouveau = merged
    else:
        nouveau['tentatives_precedentes'] = (prec.get('tentatives_precedentes') or 0) + (1 if prec else 0)
        if not nouveau['tentatives_precedentes']: nouveau.pop('tentatives_precedentes')
    fus[k] = nouveau
# correctifs verifies hors appli
ajouts = [
    {'groupe': '08_correctifs_proposes', 'nom': 'correctif_smooth_soude_par_position', 'projet': 'chevalier_medieval', 'ok': True, 'genre': 'test hors appli (scratch, aucune modification de scripts/)',
     'mesures': {'avant_correctif': {'composantes': 3279, 'aretes_bord': 19379, 'aire': 0.663}, 'apres_correctif': {'composantes': 33, 'aretes_bord': 0, 'aire': 1.7877}, 'base': {'composantes': 33, 'aretes_bord': 0, 'aire': 1.8447}},
     'note': 'build/bancs/campagne3d/correctifs_proposes/smooth_corrige.py : souder les sommets par position (np.unique des coordonnees arrondies), lisser le maillage soude, reporter la position sur tous les doubles de couture. Meme 20 K faces, 3 iterations, lambda 0,5 : plus aucune fissure.'},
    {'groupe': '08_correctifs_proposes', 'nom': 'correctif_triangle_count_plancher_1_pct', 'projet': 'chevalier_medieval', 'ok': True, 'genre': 'test hors appli',
     'mesures': {'cible_1000': 970, 'cible_500': 478, 'base_faces': 515057}, 'note': 'acceleration_glb.reduire_et_recuire atteint 970 / 478 faces pour 1 000 / 500 demandes ; le plancher vient donc du seul clamp ratio = max(0.01, ...) de scripts/mesh_tools.py:147'},
    {'groupe': '08_correctifs_proposes', 'nom': 'correctif_export_unreal_rig_armature', 'projet': 'chevalier_medieval', 'ok': True, 'genre': 'test hors appli (Blender 5.1)',
     'mesures': {'armatures': 1, 'os': 72, 'groupes_de_sommets': 72, 'sommets_sans_groupe': 0, 'maillages_avec_modifier_armature': 1}, 'note': 'correctifs_proposes/unreal_corrige.py : object_types={MESH, ARMATURE}, add_leaf_bones=False, bake_anim=False, global_scale=100 : le FBX contient le squelette et la peau'},
]
for a in ajouts:
    k = (a['groupe'], a['nom'])
    if k not in fus: ordre.append(k)
    fus[k] = a
nb = 0
out = []
for k in ordre:
    d = fus[k]; vv = VERD.get(d.get('nom'))
    if vv: d['statut'] = vv['statut']; d['verdict'] = vv['verdict']; nb += 1
    out.append(d)
io.open(SRC, 'w', encoding='utf-8').write('\n'.join(json.dumps(d, ensure_ascii=False) for d in out) + '\n')
print(len(out), 'essais ecrits,', nb, 'avec verdict ; sans verdict :', [d['nom'] for d in out if 'verdict' not in d])
