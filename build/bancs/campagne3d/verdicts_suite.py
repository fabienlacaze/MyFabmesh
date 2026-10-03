"""Ecrit verdicts_suite.json (verdict HUMAIN de chaque essai de la suite : statut ok / partiel / echec / banc / non_testable + phrase), a partir des mesures verifiees.
Les verdicts automatiques du banc (« un fichier est cree ») ne suffisent pas : un outil peut produire un fichier faux (Smooth, Duplicate...)."""
import json
V = {}


def v(nom, statut, txt):
    V[nom] = {'statut': statut, 'verdict': txt}


# ---- animations du chevalier (rig v0, 72 os, mesure sur le GLB anime : valider_rig2.py)
v('anim_chev_walk_normal', 'ok', '3,27 s, 99 images (30 i/s), 72 canaux ; pieds en appui immobiles (30e centile 0,012 H/s pour une racine a 0,34 H/s) ; raccord de boucle : 1 os a 11,5 deg (leger saut) ; 2,1 % d aretes etirees > 1,5x en marche')
v('anim_chev_run_normal', 'partiel', '1,73 s ; la racine n avance qu a 0,10 H/s (la marche : 0,34 H/s) : la course est PLUS LENTE que la marche ; pieds qui glissent (62 % de la vitesse de la racine) ; raccord de boucle 25 deg sur un os ; 2,7 % d aretes etirees, 3,5 % ecrasees')
v('anim_chev_idle_normal', 'ok', '3,97 s, 120 images ; raccord de boucle parfait (0,4 deg), racine immobile')
v('anim_chev_attack_normal', 'ok', '1,37 s, 42 images ; raccord 2,6 deg, racine immobile')
v('anim_chev_death_normal', 'ok', '2,4 s ; clip non bouclable par nature (raccord 57 deg), la racine descend de 0,42 H : conforme')
for n, t in (('slow', '4,43 s'), ('brisk', '2,6 s'), ('sneak', '5,07 s'), ('proud', '3,6 s'), ('crawl', '5,23 s')):
    v('anim_chev_walk_' + n, 'ok', 'variante « ' + n + ' » de la marche : ' + t + ', clip distinct de la marche normale (empreinte differente), pieds sans glissement')
v('anim_chev_walk_tous', 'ok', 'option « All variants » : UN fichier a 6 clips (walk, slow, brisk, sneak, proud, crawl), memes clips que les 5 essais separes')
v('anim_chev_turn_left_normal', 'partiel', '3,27 s ; le raccord de boucle est ouvert (75 deg) ; pieds qui glissent pendant le virage (33 % de la vitesse racine)')
v('anim_chev_turn_right_normal', 'partiel', 'idem turn_left : raccord 75 deg, glissement des pieds')
v('anim_chev_jump_normal', 'ok', '2,67 s, raccord 6 deg, racine a 0,54 H/s (saut vers l avant), pieds sans glissement')
v('anim_chev_walk_back_normal', 'ok', '3,57 s, raccord 3 deg, pieds sans glissement')
v('anim_chev_hit_normal', 'ok', '0,97 s, 30 images')
v('anim_chev_eat_normal', 'echec', 'la liste propose « eat » mais le clip produit est le clip « hit » (contenu identique a l octet pres a anim_chev_hit_normal) : un bipede n a pas de « eat », l option ne devrait pas etre proposee ou un message devrait le dire')
v('anim_chev_lie_down_normal', 'ok', '2,97 s ; clip non bouclable (120 deg de raccord : on se couche) : conforme')
v('anim_chev_trot_normal', 'echec', 'la liste propose « trot » mais le clip produit est « lie_down » (identique a l essai precedent) : un bipede ne trotte pas ; la generation renvoie le clip PRECEDENT sans prevenir')
v('anim_chev_liste_idle_walk_run_attack', 'ok', 'une liste de 4 animations = UN seul fichier GLB a 4 clips (idle, walk, run, attack), identiques aux clips generes un par un ; 21 s au total')
v('anim_chev_ue5_walk', 'ok', 'rig « UE5 Mannequin » (61 os, noms bone_N) : marche 3,27 s, raccord 11 deg, pieds sans glissement ; le moteur s adapte au squelette retenu par l IA')
v('anim_chev_ue5_idle', 'ok', 'idem, idle 3,97 s, raccord 0,4 deg')
v('anim_chev_espece_oiseau', 'partiel', 'espece « Bird » sur un bipede : marche de 2,27 s differente de la marche humaine (3,27 s), raccord 24 deg ; aucune erreur mais pas de vol (la liste propose « Fly » : non essayee)')
v('anim_chev_espece_dinosaure', 'ok', 'espece « Dinosaur » : marche de 4,1 s, raccord 6 deg, pieds sans glissement')
# ---- cochon (quadrupede + ailes, rig wolf 67 os)
v('anim_cochon_walk_normal', 'ok', '3,93 s, 119 images ; pieds sans glissement ; raccord 21 deg sur 2 os ; 1,8 % d aretes etirees ; a la lecture, un pan de peau plat apparait sur le flanc / la cuisse arriere (voir shots/pig_anims.png)')
v('anim_cochon_trot_normal', 'partiel', 'trot 2,3 s, racine 0,9 H/s ; raccord de boucle 44 deg sur 3 os')
v('anim_cochon_run_normal', 'partiel', 'course 2,0 s, racine 1,17 H/s ; pieds qui glissent (30 % de la vitesse racine) ; raccord de boucle 78 deg sur 9 os (saut visible a la reboucle)')
v('anim_cochon_idle_normal', 'ok', 'idle 3,97 s, raccord 0,2 deg')
v('anim_cochon_walk_equide_normal', 'ok', 'espece « Horse » : marche 3,27 s distincte de la marche « auto » (3,93 s)')
v('anim_cochon_walk_felin_normal', 'ok', 'espece « Cat » : marche 3,6 s distincte')
v('anim_cochon_mode_nage', 'partiel', 'mode « Swims » : clip de 3,87 s produit, MAIS identique a l octet pres au clip du mode « Slithers » (meme empreinte) : le mode ne change que le NOM du clip')
v('anim_cochon_mode_reptation', 'partiel', 'mode « Slithers » : identique au clip « Swims » (voir ci-dessus)')
v('anim_ajouter_lot_cochon', 'partiel', 'fenetre « Add Animation » : un lot de 3 clips en une version, mais attack et death du cochon ont le MEME contenu (empreinte 6e7815), et « walk » est devenu « slither » parce que le mode « Slithers » du test precedent etait reste actif (etat conserve entre deux generations)')
v('anim_alien_walk', 'ok', 'sur l ancien rig de l alien (49 os, objet = manteau a capuche) : marche 2,07 s ; l outil anime sans objection un vetement ; sans interet reel')
v('anim_alien_idle', 'ok', 'idem, idle 3,97 s')
v('anim_voiture_walk', 'partiel', 'rig de 5 os de la voiture : le moteur genere quand meme une « marche » de 3,87 s ; la peau ne bouge pas (0 % d aretes etirees), la racine avance de 0,53 H/s : un vehicule ne devrait pas proposer « walk »')
v('anim_bus_walk', 'non_testable', 'aucun rig du bus : la generation du rig a depasse 600 s (voir rig_bus_natif)')

# ---- rigs
v('rig_cochon_volant_wolf', 'ok', '229 s, VRAM +5,4 Go (pic 10,0), RAM +6,8 Go ; 67 os (le libelle « Canine quadruped 34 os » est sans effet : le squelette vient de l IA) ; somme des poids = 1, aucun sommet sans poids, aucun os orphelin ; MAIS 31 % des sommets sont ponderes sur un os eloigne (flanc / ailes) et le maillage se plisse a la flexion de la cuisse arriere (shots/pig_flex.png)')
v('rig_alien_cape_orc', 'partiel', '196 s, 72 os ; poids sommes a 1 ; 5 os orphelins, 21 % de poids eloignes, 1,5 % d aretes etirees (4,9 % pour certains os) : le rig d un manteau a capuche est de mauvaise qualite (sujet sans squelette evident)')
v('rig_bus_natif', 'echec', 'le rig d un objet rigide (bus 487 K faces) est tue a 600 s par le delai du processus (src/main/main.js:5042) : la completion de squelette passe de 148 a 306 os (1/65 extremites completes) puis le transfert de peau depasse le delai ; aucun fichier ecrit ; la fenetre d erreur « Auto-rig AI failed » s ouvre plus tard')
v('rig_chevalier_ue5_mannequin', 'ok', '222 s, 61 os (le libelle « UE5 Mannequin 161 os » est sans effet, noms bone_N) ; poids sommes a 1, 0 orphelin, 0,01 % de poids eloignes ; meilleure peau des rigs du chevalier')
v('reskin_cochon_volant', 'ok', '158 s ; meme squelette (67 os, aucun os deplace), poids recalcules : poids eloignes de 31 % a 0 %, le pli de flanc disparait (shots/pig_reskin_cmp.png)')
v('points_retirer_os_puis_regenerer', 'ok', 'retirer un os (bone_70) puis « Re-generate rig » : nouveau rig a 71 os (72 avant), 178 s, VRAM pic 10,5 Go, poids sommes a 1, 0 orphelin, 1,2 % de poids eloignes')
v('points_ouvrir_etat', 'ok', 'l editeur s ouvre (72 os, 10 points a atteindre, 45 articulations reperees dans la capture) ; « Save moved joints » sans deplacement repond « Move a pink joint first. » : message correct')
v('points_deplacer_genou_sans_ia', 'non_testable', 'glisser une articulation exige la souris : refusee au niveau « standard » de la Control API')
v('points_ajouter_un_point', 'non_testable', 'idem (souris)')
v('poids_peindre_et_enregistrer', 'non_testable', 'idem (souris)')
v('poids_ouvrir_editeur', 'ok', 'ouverture de l editeur de poids (voir journal : fenetres, boutons)')

v('rig_bus_50k_natif', 'echec', 'meme apres reduction du bus a 50 000 faces, le rig est tue a 607,8 s (VRAM pic 12,6 Go, RAM +9,4 Go) : ce n est donc PAS la taille du maillage ; le journal s arrete apres les 2 tirages (207 s) : l etape « analyse et choix du tirage » (93 s pour le bus complet) ne se termine pas ; aucun fichier ecrit')

# ---- outils de maillage
v('triangle_count_5000_depuis_v4', 'ok', '515 K -> 4 960 faces en 23 s ; la texture passe de 4096 a 2048 sans prevenir ; 4 composantes (536 avant) ; 7,4 % de l aire en faces voisines retournees (0,4 % avant)')
v('triangle_count_1000_depuis_v4', 'echec', 'cible 1 000 faces -> 4 960 faces (resultat IDENTIQUE a la cible 5 000) : plancher silencieux de 1 % des faces (mesh_tools.py:147, ratio = max(0.01, ...)) ; reduire_et_recuire seul atteint bien 970 faces (test hors appli)')
v('triangle_count_500_bus', 'echec', 'cible 500 faces -> 4 602 faces (1 % du bus) ; texture 8192 -> 2048 ; 17,7 % de pixels noirs ; 10,8 % de l aire en faces retournees')
v('triangle_count_50000_bus', 'ok', 'bus 487 K -> 50 000 faces (voir le rig du bus reduit)')
v('subdivide_2_depuis_v6', 'ok', '19 040 -> 304 640 faces (x16), UV et texture conservees, forme identique')
v('watertight_garder_detail', 'echec', 'avec la case « Keep original detail (seal, no remesh) » COCHEE (verifie), le resultat n a plus ni UV ni texture et triple de taille (19 040 -> 59 040 faces) : ce n est pas un colmatage sans remaillage')
v('smooth_fort_10x08', 'echec', '10 iterations, lambda 0,8 : le maillage est dechiquete (3 294 composantes au lieu de 33, 19 335 aretes de bord au lieu de 0, 416 faces degenerees)')
v('smooth_defaut_v4_complet', 'echec', 'Smooth par defaut sur le maillage COMPLET : 536 -> 42 297 composantes, 0 -> 367 949 aretes de bord (fissures le long de toutes les coutures UV, visibles en points noirs) ; cause : trimesh.merge_vertices ne soude rien sur un maillage texture, le lissage laplacien traite chaque ilot UV comme une surface ouverte et les fait retrecir')
v('smooth_defaut_cochon', 'echec', 'meme defaut sur le cochon : 9 -> 14 534 composantes, 0 -> 228 707 aretes de bord')
v('set_pivot_bottom', 'ok', 'pivot « bottom » : geometrie, UV et texture inchangees')
v('resize_rotation_90x', 'ok', 'rotation de 90 deg autour de X : la boite passe de [0,853 ; 0,789 ; 0,324] a [0,853 ; 0,324 ; 0,789] ; texture conservee')

# ---- selection / peinture de sommets
v('select_tout_retourner_normales', 'banc', 'premier essai : « Flip » ouvre une fenetre de confirmation que le banc n a pas validee avant « Save » : aucune version creee ; voir le rejeu')
v('select_tout_retourner_normales_rejeu', 'ok', 'All + Flip normals : « Flipped 19040 faces » puis version creee ; geometrie conservee')
v('select_tout_dupliquer', 'echec', 'All + Duplicate : 38 080 faces mais le GLB est INVALIDE : POSITION et COLOR_0 ont 81 125 elements, TEXCOORD_0 et NORMAL 24 005 ; indices jusqu a 81 124 : les copies n ont ni UV ni normales ; la copie est une soupe de triangles non soudes (18 980 composantes)')
v('select_tout_lisser', 'ok', 'All + Smooth de la selection : aucune fissure (33 composantes, 0 bord) ; l aire diminue de 20 % (1,845 -> 1,477) comme tout lissage ; texture conservee')
v('select_tout_supprimer', 'echec', 'All + Delete + Save : le GLB enregistre n a plus aucun indice (primitive sans faces, 24 005 sommets) : une version vide et illisible est creee au lieu d un refus ; la couleur de sommets cyan de la selection fuit dans COLOR_0')
v('peinture_lisser', 'ok', 'Paint > Smooth sans trait : aucun changement (couleurs uniformes) ; version creee')
v('peinture_remplir_rouge', 'ok', 'Paint > Fill all rouge : COLOR_0 = (1,0,0) sur les 24 005 sommets (verifie) ; le rouge teinte la texture a l affichage ; geometrie et texture inchangees')
v('paint_emissive_vide_v6', 'ok', 'Paint Mesh en mode emissif sans trait puis enregistrement : version creee, texture de base identique')

# ---- textures
v('texvar_rouille_force70_v6', 'ok', 'style « rusty », force 70 % : taches de rouille clairement visibles (luminance 109 -> 102), geometrie inchangee (19 040 faces) ; 112 s ; VRAM pic 12,3 Go. L essai « golden » 40 % de la campagne 1 etait simplement trop faible pour se voir')
v('sharpen_texture_cochon', 'echec', 'Sharpen x2 sur la texture 8192 du cochon : 104 s de calcul puis « Enhance texture failed » : la generation demande ~18,7 Go de VRAM, la limite en offre 9,8 Go ; l estimation n est faite qu apres 100 s de calcul inutile')
v('sharpen_texture_cochon_rejeu', 'echec', 'rejeu : meme refus (18,7 Go requis, 9,8 Go disponibles), fenetre lue : « Enhance texture failed »')
v('material_adjust_bus', 'ok', 'luminosite 1,2 / saturation 0,8 sur le bus (apres alignement de la selection) : version creee, forme inchangee')
v('detail_plus_plus_cochon', 'ok', '141 s ; VRAM pic 15,5 Go sur 16,3 (a la limite) ; effet tres subtil a l ecran ; la texture 8192 est reduite a 4096 sans prevenir')
v('construction_3d_fabriquer_bus', 'ok', '5 etapes (5 GLB navigables) : hauteur 0,13 -> 0,27 -> 0,46 -> 0,66 -> 0,77, faces 28 K -> 218 K -> 395 K -> 460 K -> 490 K ; 92 s (l interface annonce ~1 s par etape), RAM +16,7 Go, VRAM pic 12,1 Go ; 5 GLB de ~100 Mo chacun (texture 8192 dupliquee)')

# ---- fenetres lues sans lancer
v('segment_parts_etat', 'non_testable', 'moteur de segmentation NON installe : « Install part segmentation » (Cancel / Install) ; Cancel presse, mais un travail « segment » en erreur « engine not installed » est cree quand meme')
v('name_the_zones_etat', 'non_testable', 'message « Segment the mesh into parts first » : exige la segmentation')
v('decals_fenetre', 'non_testable', '« Decals » ouvre Paint Mesh en mode Decal ; poser un decalque exige un fichier image et la souris')
v('construction_3d_options', 'ok', 'fenetre d options (5 etapes, materiau auto / manuel) lue puis fermee ; lancement essaye a part sur le bus')
v('reshape_draw_fenetre', 'non_testable', 'peindre la zone a reconstruire exige la souris')
v('watertight_case_keepdetail_etat', 'ok', 'diagnostic : la case « Keep original detail » passe de false a true par /ui/fill : le banc la coche bien')

# ---- exports
v('export_mesh_fbx_unreal', 'partiel', 'FBX Unreal d un MAILLAGE : re-importe dans Blender 5.1, 24 005 sommets / 19 040 faces, UV et texture 2048, echelle en cm (85 x 32 x 79) ; mais la fenetre « FBX Unreal - creer la destruction (Geometry Collection) » (texte francais en dur, bouton « Copy error ») s ouvre apres chaque export, meme d un maillage non fracture')
for ext in ('obj', 'gltf', 'stl', 'ply', 'glb'):
    v('export_mesh_' + ext, 'ok', 'export ' + ext.upper() + ' re-ouvert et verifie : 19 040 faces, boite identique' + (' ; UV et texture 2048 conservees' if ext in ('obj', 'gltf', 'glb') else ''))
v('export_rig_unreal_script_direct_blender51', 'echec', 'test hors appli (script du handler recopie, Blender 5.1) : le FBX d un RIG n a ni armature ni os ni groupes de sommets (object_types={MESH}) : Unreal recevrait un maillage statique')
v('export_anim_fbx_convert_glb_direct_blender51', 'ok', 'test hors appli (scripts/convert_glb.py, Blender 5.1) : FBX avec 72 os, 72 groupes de sommets, action « walk » de 79 images a 24 i/s')
v('export_boutons_blender_grises', 'echec', 'les boutons Export to Unreal / Export FBX d animation / Open in Blender restent grises tant que l appli n est pas redemarree, meme apres l enregistrement de blenderPath')
v('export_rig_unreal_chevalier_v0', 'non_testable', 'bouton « Export to Unreal » grise (voir export_boutons_blender_grises)')
v('export_anim_fbx_walk', 'non_testable', 'bouton « Export FBX » grise : « element desactive »')
v('verification_animations_campagne1', 'banc', 'les 5 « animations » de la campagne 1 etaient 5 fois le meme clip IDLE (banc de la campagne 1 fautif) ; corrige ici')

# ---- souris
for n in ('sculpt_pull', 'sculpt_flatten', 'sculpt_inflate', 'sculpt_smooth', 'sculpt_grab', 'sculpt_push_symetrie_x', 'select_baguette_supprimer', 'select_lasso_recadrer', 'select_pinceau_grow_supprimer', 'select_inverser_supprimer', 'select_dupliquer', 'select_retourner_normales', 'select_lisser', 'select_isoler', 'paint_emissive_v4', 'paint_spray_v6', 'paint_gomme_v6'):
    v(n, 'non_testable', 'exige la souris : refusee au niveau « standard » de la Control API (« Developer full access » eteint)')

json.dump(V, open('C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/build/bancs/campagne3d/verdicts_suite.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(V), 'verdicts')
