# Animation IA : récapitulatif des essais

Tenu à jour à chaque essai, pour ne pas tourner en rond. Détail des mesures :
`AGENT_LOG.md` et `docs/analyse_animation_2026-09-28.md`.

## Règles du jeu (exigences de l'exploitant)

- Tout composant doit être **gratuit, commercialisable et installable en local**.
- Le modèle doit garder **notre squelette dans le calcul** : le mouvement est produit
  directement sur les os de notre rig, sans squelette intermédiaire à recibler.
- Clips visés : jusqu'à **environ 10 secondes**.
- Les essais se font **hors de l'appli** (`C:\tmp\…`), après une sauvegarde poussée sur
  GitHub.

## État au 28/09/2026

- **UniMate** reste le moteur branché (web et bureau). Le chantier est arrêté ; la mention
  « Work in progress — results are poor for now. » est affichée.
- **MoCapAnything V2 jugé insuffisant** (28/09, verdict de l'exploitant) : la qualité de la marche
  ne suffit pas et le mouvement de la vidéo n'est pas fidèlement retranscrit sur le rig.
- **Aucune IA publiée, sous licence propre, ne donne aujourd'hui une animation de qualité sur un
  squelette quelconque** (veille du 28/09 ci-dessous).
- **SkelMo réhabilité (28/09, soir)** : ses échecs venaient de NOTRE usage (axes, bouts d'os, échelle,
  guidage). Corrigé, il reproduit fidèlement la vidéo de contrôle. Sur une vidéo Wan, le mouvement reste
  faible (voir le tableau). Licence toujours bloquante (poids et bibliothèque « Motion » sans licence).
- **Leçon :** filmer **de profil**. De face, les pattes ne se voient pas et le modèle ne prédit
  presque aucun mouvement.

## Essais menés

| Date | Approche | Conditions | Résultat | Verdict |
|---|---|---|---|---|
| juin–juil. 2026 | AnyTop (texte → mouvement, squelette quelconque) | production web avant le 26/09 | mouvement jugé inexploitable par l'exploitant | abandonné |
| 26/09 | UniMate, poids tiers `tarn59` | production (Modal) | 27 os sur 42 nommés « End » sur l'araignée ; boucles qui sautent ; « pas ouf » | corrigé (lignes suivantes) |
| 28/09 | UniMate + noms au vocabulaire d'entraînement + légendes « An animal … » | carte locale, mêmes poids | pattes actives 4,0 → 5,2 sur 10 | gain faible |
| 28/09 | + meilleur de 3 tirages, boucles, noyau Mixamo, stats couplées | carte locale | 8,6 / 11 pattes actives ; raccord de boucle 4,1° → 0° | « un peu mieux, toujours pas ouf » |
| 28/09 | UniMate, poids officiels (préversion, sans licence) | 4 créatures | meilleurs sur insectes, moins bons sur quadrupède | pas de bascule |
| 28/09 | CFG 1,5 à 6 | quadrupède | 6 le plus stable | CFG 6 par défaut |
| 28/09 | pieds plantés (sol, allure, IK) | 4 créatures | glissement ÷ 50, pieds au sol | « exactement pareil » → **chantier UniMate arrêté** |
| 28/09 | vidéo IA : LTX-Video 0.9.5 (2B) | image du lion → vidéo | peu de mouvement, corps qui « fond » | écarté |
| 28/09 | vidéo IA : **Wan 2.2 TI2V-5B** (Apache-2.0) | image du lion → 81 images, 3,5 min | marche crédible | **retenu** pour la vidéo |
| 28/09 | **SkelMo** (vidéo + notre squelette) | vidéo Wan de profil, puis de face | animal tordu, qui flotte | échec |
| 28/09 | SkelMo, test de contrôle | mouvement connu filmé exactement comme ses données d'entraînement | toujours tordu et renversé | **écarté** (modèle non fonctionnel sur un squelette extérieur ; poids et bibliothèque « Motion » sans licence) |
| 28/09 | recalage maison (vidéo → os par optimisation) | projection validée, non lancé | — | refusé par l'exploitant (trop long, trop incertain) |
| 28/09 | MoCapAnything V2 (vidéo + notre squelette, code et poids MIT) | vidéo Wan 2.2 **de face**, lion 36 os, détourage RMBG-1.4 (test seulement) | lion entier mais quasi figé : os à 2,8° d'amplitude médiane, articulations à 6 % de la taille | « ne marche pas du tout » : de face, les pattes ne se voient pas |
| 28/09 | MoCapAnything V2, vidéo **de profil** | même rig, vidéo Wan de profil | mouvement 4× plus ample (24 %) ; bons pas en 1re moitié, puis le corps pivote et se dresse (rotation de racine fausse, 77°) | orientation à corriger |
| 28/09 | MoCapAnything V2 de profil + **orientation du corps figée** | idem, rotation de racine gelée à l'image 0, marche sur place | lion de profil tout le clip, pattes qui font des pas | **meilleur résultat à ce jour** ; vidéo jugée « très bon début » |
| 28/09 | **Clip de 10 s** : 3 plans Wan enchaînés (chaque plan part de la dernière image du précédent) + MoCapAnything, racine figée | 241 images à 24 i/s | l'animation tient sur les 10 s (lion de profil, pattes qui alternent) ; la **vidéo dérive en aspect** (couleurs saturées, crinière qui pousse), sans gêner l'extraction du mouvement | durée atteinte |
| 28/09 | Anti « 5e patte » : 3 tirages Wan (graines 11-13), prompt négatif renforcé, 50 étapes + contrôle automatique des pieds (détourage + comptage en bas de silhouette) | vidéo de profil | graine 11 propre (4 pattes, marche lente) ; 12 pattes qui se mélangent ; 13 rejetée (5 pieds sur 12 images) | plusieurs tirages + contrôle = parade efficace ; le contrôle rate encore une patte qui flotte sans toucher le sol |
| 28/09 | **Verdict** MoCapAnything V2 | toutes les sorties ci-dessus | qualité de marche insuffisante, mouvement de la vidéo mal retranscrit sur le rig | **écarté** par l'exploitant |
| 28/09 soir | **SkelMo, lecture complète du dépôt** (agent) | code relu intégralement | 4 erreurs de NOTRE côté : BVH écrit Y en haut alors que `process_anim` attend Z en haut (lion debout sur sa queue) ; bouts d'os factices de 0,01 ; squelette 2× trop grand et racine du jeton de repos non nulle (hors des statistiques du modèle) ; guidage 2,0 sur une branche « sans condition » jamais entraînée | cause de l'échec : notre usage |
| 28/09 soir | SkelMo corrigé (axes Blender, bouts réels, échelle ×0,46, racine à 0, **guidage 1,0**) | vidéo de contrôle | os à 97 % de leur longueur (46 % avant), variation dans le temps 12 % (38 %), lion debout qui refait les pas de la vidéo | **fonctionne** ; le guidage est la clé principale |
| 28/09 soir | SkelMo corrigé sur vidéo Wan | de face, détourée (Lucida, fond noir, cadrage fixe) | lion cohérent (os à 100 %, variation 5 %) mais pas trop courts : 14-32 % du corps, pieds levés de 5-7 % ; brute (fond gris) : 11-15 % ; de profil : quasi figé et tourné de 33° | « pas ouf » (exploitant) ; clips limités à 40 images (2 s) ; sans licence => **non retenu** |
| 28/09 soir | **Moteur procédural** (sans IA ni données, `C:	mp\procedural_test\locomotion.py`) | lion 36 os, araignée 62 os, humain 27 os | pattes détectées automatiquement : 4 / 8 / 2 ; allure selon leur nombre (pas latéral, tétrapode alterné + onde, alternance) ; pied en appui fixe au sol, arc en vol, pliure par FABRIK depuis la pose de repos ; queue ondulante ; durée libre | **« c'est un super début !!!!! »** (exploitant) : voie retenue |
| 28/09 soir | Moteur procédural v2 : pas calculés le long d'une TRAJECTOIRE (appui = pied neutre sous le corps au milieu de l'appui) | lion, araignée, humain × marche, course (trot à 4 pattes, phase de vol), attente (respiration, regard), virage | aucun os sous le sol ; glissement des pieds en appui 0-0,9 % de la hauteur (marche, virage), 1,7-2,8 % (course : foulée à régler) | « de loin le meilleur résultat que l'on ait eu » (sur la v1) |
| 28/09 soir | Moteur procédural v7, après « à-coups, jambes trop tendues en fin de poussée » (lion, humain) et « 2 pattes de l'araignée ne bougent pas » | mesures : extension des pattes (hanche-pied / longueur), accélération angulaire des os d'une image à l'autre | AVANT : pattes à 100 %, à-coups jusqu'à 197° (lion) et 85° (humain), pieds demandés à 110 % de la jambe. Correctifs : bassin abaissé (jambe à 92 % au neutre, 87 % en course), demi-pas borné à 98 %, portée bornée à 97 % (le pied glisse un peu plutôt que la patte claque), cinématique inverse continue d'une image à l'autre, décollage en sin², pied rigide si son os est court (patte avant du lion), cheville à l'aplomb de la hanche (pattes arrière du lion en pleine foulée au repos), pattes levées au repos détectées (araignée : 10 pattes, moignon de 2 os écarté), appui plus bref pour les pattes courtes. APRÈS : marche/virage/attente ≤ 19° d'à-coups, ≤ 97 %, glissement ≤ 0,3 % ; course lion 35°, araignée 63° ; < 1 s par animation (processeur) | à juger |
| 28/09 soir | Moteur procédural v9, après captures de l'exploitant (humain en « fente », plaque dressée à l'avant de l'araignée) | mêmes mesures + os sous le sol | déroulé du pied (talon qui se lève en fin d'appui, pivot sur l'orteil ou le bout de la patte avant) ; pédipalpes (pattes < 65 % de la médiane, à 6 pattes et plus) laissés au repos avec un léger mouvement : le maillage de la bouche, accroché à eux, se déchirait ; contact au sol par le point le plus BAS du pied (abaisser la cheville enfonçait les orteils) ; bogue : la variable « pivot » (centre du corps) était écrasée par l'orteil, invisible en ligne droite, le corps s'envolait en virage. Lion et humain : aucun os sous le sol, glissement ≤ 0,9 %, à-coups 6-43° ; araignée : une articulation arrière 6 % sous le sol | à juger |

## À ne pas retenter

- **Retoucher UniMate avec les poids tiers** : noms, légendes, tirages, boucles, CFG et pieds
  sont déjà faits. Le plafond vient du modèle.
- **SkelMo avec nos anciens scripts** : ils étaient faux (axes, bouts d'os, échelle, guidage). Utiliser
  `glb_vers_bvh.py` (axes Blender), `variantes_cond.py` (k 0,46, racine 0), `sample/generate_essai.py`
  avec `SKELMO_CFG=1.0`, `preparer_video.py` (Lucida, fond noir), `skelmo_vers_glb.py` (racine depuis l'image 0).
- **LTX-Video 2B** pour la vidéo : Wan 2.2 est nettement meilleur.
- **Le recalage maison** : refusé par l'exploitant.
- **MoCapAnything V2** : profil, racine figée, 10 s, anti « 5e patte » déjà faits ; résultat jugé insuffisant.

## Candidats et veille

| Outil | Entrées | Code | Poids | Licence | Statut |
|---|---|---|---|---|---|
| **MoCapAnything V2** (SIGGRAPH Asia 2026) | vidéo + squelette de référence | oui | oui (Hugging Face) | **MIT (code et poids)** ; détourage RMBG-1.4 non commercial, à remplacer par Lucida | testé : **insuffisant** (marche, fidélité) |
| AnimaX | image/texte + squelette | non publié | non publié | Apache-2.0 annoncée | veille |
| UniMate complet | texte + squelette | oui | annoncés « dans les prochaines semaines » | code MIT, poids à préciser | veille |
| SAMoR, génération animale « topology-agnostic » | texte + squelette | pas de dépôt trouvé | — | — | veille |
| SATA (ICML 2026) | texte → mouvement, puis décodage sur un squelette quelconque | oui (partiel) | oui (Hugging Face) | code Apache-2.0 ; poids entraînés sur HumanML3D (AMASS, **non commercial**) et AniMo4D | hors règle licence (vérifié le 28/09) |
| NECromancer (Huawei) | texte + squelette quelconque (BVH) | non publié | non publié | données HumanML3D (NC) + Objaverse + Truebones | hors règle, rien à tester |
| OmniZoo | texte + squelette quelconque | non publié | non publié | — | veille |
| UniMoGen (Autodesk) | squelette quelconque (style, trajectoire) | non publié | non publié | — | veille |
| SkelGen4D | texte → maillage animé + pseudo-squelette **inventé** | non publié | non publié | — | ne garde pas notre squelette |
| Two2Four | mouvement humain → quadrupède | non publié | non publié | — | veille (quadrupèdes seulement) |
| AnimaX (détail, lu le 28/09) | maillage + **notre squelette** + texte → Wan 2.1 1,3B affiné produit 4 vues vidéo + cartes de pose de nos os → triangulation → IK sur notre rig | dépôt vide depuis juin 2025, 4 tickets « quand ? » sans réponse | — | code Apache annoncé ; données Mixamo (55 k), VRoid (58 k), Objaverse (48 k) : même doute que les poids UniMate | 81 images max, caméras fixes (grands déplacements difficiles), ~6 min par clip ; veille |

## Pièges techniques rencontrés

- Rig « éclaté » de 1,47 M sommets : souder puis décimer (25 000 sommets) avant tout calcul par
  sommet.
- transformers 5 ne charge plus le tokenizer sentencepiece seul de LTX : passer un
  `T5TokenizerFast`.
- Python + Kaspersky : fenêtres d'alerte sur huggingface.co. Télécharger avec `curl`.
- Chemins Windows mélangeant `/` et `\` : certains scripts comparent des chaînes de chemin.
- Les générateurs vidéo imposent des longueurs de la forme 8k+1 (LTX) ou 4k+1 (Wan) images.
- **Le PC a planté** (32 Go de RAM saturés) avec Wan + détourage GPU + Chrome 3D en parallèle.
  Un seul calcul lourd à la fois ; `gen_wan_tirages.py` encode le prompt puis décharge
  l'encodeur de texte (~11 Go) : environ 15 Go de pic, 3 min par tirage.
- Une vidéo écrite par OpenCV (`mp4v`) ne se lit pas dans Chrome : réencoder en H.264.
- MoCapAnything sort une image de BVH par image de vidéo : caler le clip sur la cadence de la
  vidéo (24 i/s pour Wan), pas sur les 30 i/s écrits dans le BVH.

## MoCapAnything V2 : mode d'emploi local (28/09)

Dossier de test : `C:	mp\mocapanything_test\MocapAnything` (hors appli).

1. Rig et mouvement en FBX, **chacun avec maillage et action** (le pipeline l'exige) :
   `glb_vers_fbx.py` (Blender). Maillage allégé (25 000 sommets). Une action de repos pour le
   fichier de base.
2. Vidéo nommée `videos/Lion#<clip>.mp4`.
3. `bash examples/custom_rig/run.sh Lion`, en passant `BLENDER` et `PYTHON` (environ 15 min).
4. `python -m inference.video2pose2rot --config examples/custom_rig/inference.yaml` : BVH sur
   notre squelette (30 images/s), puis `skelmo_vers_glb.py` pour le poser sur le rig.

Correctifs Windows nécessaires :
- l'étape 6 écrit en dur dans `zoo` (ignore `ZOO_ROOT`) ;
- l'étape 9 exige des chemins absolus, sinon Blender écrit dans `C:\zoo` ;
- `ffmpeg -pattern_type glob` n'existe pas sous Windows : passer à une séquence `%05d.png`
  (`utils/visualization.py`) ;
- `ffmpeg` doit être dans le PATH (copie d'imageio-ffmpeg) ;
- le rendu final passe par un script `.sh` : il est ignoré, on fait notre propre rendu.

