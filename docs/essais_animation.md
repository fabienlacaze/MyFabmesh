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
- **Essai en cours :** MoCapAnything V2, premier résultat crédible (lion entier qui marche), à confirmer à l'œil.

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
| 28/09 | **MoCapAnything V2** (vidéo + notre squelette, code et poids MIT) | vidéo Wan 2.2 de face, lion 36 os, détourage RMBG-1.4 (test seulement) | lion **entier, debout, pattes qui alternent** : premier résultat crédible | **prometteur**, verdict à l'œil en attente |

## À ne pas retenter

- **Retoucher UniMate avec les poids tiers** : noms, légendes, tirages, boucles, CFG et pieds
  sont déjà faits. Le plafond vient du modèle.
- **SkelMo** : il échoue même dans ses propres conditions d'entraînement.
- **LTX-Video 2B** pour la vidéo : Wan 2.2 est nettement meilleur.
- **Le recalage maison** : refusé par l'exploitant.

## Candidats et veille

| Outil | Entrées | Code | Poids | Licence | Statut |
|---|---|---|---|---|---|
| **MoCapAnything V2** (SIGGRAPH Asia 2026) | vidéo + squelette de référence | oui | oui (Hugging Face) | **MIT (code et poids)** ; détourage RMBG-1.4 non commercial, à remplacer par Lucida | **testé : prometteur** |
| AnimaX | image/texte + squelette | non publié | non publié | Apache-2.0 annoncée | veille |
| UniMate complet | texte + squelette | oui | annoncés « dans les prochaines semaines » | code MIT, poids à préciser | veille |
| SAMoR, génération animale « topology-agnostic » | texte + squelette | pas de dépôt trouvé | — | — | veille |

## Pièges techniques rencontrés

- Rig « éclaté » de 1,47 M sommets : souder puis décimer (25 000 sommets) avant tout calcul par
  sommet.
- transformers 5 ne charge plus le tokenizer sentencepiece seul de LTX : passer un
  `T5TokenizerFast`.
- Python + Kaspersky : fenêtres d'alerte sur huggingface.co. Télécharger avec `curl`.
- Chemins Windows mélangeant `/` et `\` : certains scripts comparent des chaînes de chemin.
- Les générateurs vidéo imposent des longueurs de la forme 8k+1 (LTX) ou 4k+1 (Wan) images.

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

