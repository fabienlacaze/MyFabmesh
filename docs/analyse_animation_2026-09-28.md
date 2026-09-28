# Génération d'animations : analyse (28/09/2026)

Analyse faite sans GPU ni agent : lecture de notre code, du dépôt UniMate
(révision `9f3076e` utilisée en production, et version à jour du 27/09),
des deux jeux de poids sur Hugging Face, et mesures sur les 4 clips de
l'araignée présents sur le disque (`meshes/animated/*red_killing_spider*`).

## Verdict

- La chaîne **fonctionne** et reste fidèle au modèle sur l'essentiel : échelle,
  orientation, cadence, format des légendes et réglages d'échantillonnage sont
  ceux de l'entraînement.
- La mauvaise qualité vient surtout de **ce qu'on donne au modèle** :
  - les pattes sont nommées « End » ;
  - les sujets de légende n'ont jamais été vus à l'entraînement ;
  - rien n'est fait pour les boucles ni pour les clips longs.
- Tout cela se corrige **dans notre pilote**, sans changer de modèle.
- **Nouveau depuis hier :** des poids officiels existent, en préversion. Ils
  ont été entraînés sur beaucoup plus de données que les poids tiers
  utilisés aujourd'hui. Leur fiche ne déclare aucune licence.

## 1. Comment la chaîne s'imbrique

```
Bureau (anim:motion, IPC)  ─┐
Web (API.autoAnimAI)       ─┴─> worker POST /api/animate
    (5 crédits, budget GPU, remboursement sur chaque échec ; engine imposé = motionplus)
      └─> Modal myfabmesh-anim : routeur (_anytop_anim.py)
            └─> Modal myfabmesh-unimate : animer_unimate (A10G, repos après 120 s)
                  └─> _unimate_moteur.MoteurUniMate.animer
                        GLB -> os + pose de repos -> rôles (classifieur d'AnyTop)
                        -> noms anatomiques -> ordre BFS -> canonisation
                        -> conditionnement (pose, graphe, spectre, noms T5, légende T5)
                        -> flow matching (CFG 3, dopri5) -> 60 images x J x 12
                        -> rotations par os + trajectoire de la racine
                        -> clip glTF AJOUTÉ au GLB du rig (pas de reciblage)
                  -> /anim_data/<job>.glb (volume partagé)
    worker GET /api/animate-status (sondage) -> copie R2 -> client
```

- **Poids** : `tarn59/UniMate-Weights` (v2, EMA), empreintes vérifiées à la
  construction de l'image.
- **Texte** : les légendes sont écrites d'avance par type d'animation
  (`_VERBES`), sans texte libre dans l'interface.
- **Mesures du 26/09** : 30 s à chaud, 48 s à froid.

## 2. Ce qui est conforme (vérifié dans le code d'UniMate)

| Point | Entraînement | Notre pilote |
|---|---|---|
| Échelle | diamètre géodésique feuille à feuille = 2 (`get_skeleton_diameter`) | même calcul (`diametre`) |
| Orientation | face +Z, XZ centré, sol à 0 | idem (nos modèles sont générés face +Z) |
| Cadence | 60 images à 30 i/s | 60 images à 30 i/s |
| Échantillonnage | CFG 3,0, dopri5 | idem |
| Légende | « A person walks forward. » (< 12 mots) | « A person walks forward » |
| Pose de départ | T-pose en positions, rotation identité, vitesse 0 | idem |

## 3. Défauts trouvés, par priorité

### P1. Les pattes sont nommées « End »

- **Mesure :** sur l'araignée, 27 os sur 42 reçoivent le nom « End » ; 10
  d'entre eux ne bougent pas du tout (33 % des os immobiles sur la course,
  l'attaque et la mort).
- **Cause :**
  - Le classifieur hérité d'AnyTop ne nomme qu'**une** chaîne de jambe et
    qu'**un** bras par côté. Les autres pattes deviennent `limb_NN`, que
    `noms_unimate` traduit en « End ».
  - Or l'entraînement conditionne le modèle sur un vocabulaire anatomique
    commun (`data_process/joint_annotation/vocab.py`), au format
    « [Left |Right ]<partie>[ End] », avec « Bone » pour un os inconnu.
    **« End » seul n'y apparaît jamais** (0 sur 300 000 noms publiés).
  - *Corrigé le 28/09 après lecture des noms réels :* les pattes d'arthropodes
    ne sont PAS nommées « Front/Middle/Hind Leg ». `patch_annotations.py`
    (`CHAIN_RIGS`) renomme chaque patte d'araignée, de crabe ou de scorpion
    « Thigh, Shin, Foot, Toe », répété pour chaque patte ; le côté vient du
    signe de X (+X = gauche).
- **Correctif (fait le 28/09, `noms_unimate`) :** un nommeur géométrique dans
  ce vocabulaire exact.
  - Toute chaîne latérale qui touche le sol, ou redescend nettement sous son
    attache, est une patte : « Thigh, Shin, Foot, Toe…, Toe End ».
  - Au-delà de deux pattes au sol par côté (arthropode), la paire que le
    classifieur appelle « bras » devient aussi une patte, comme dans
    Truebones.
  - Branches d'un membre : « Toe » / « Finger » ; appendices de tête :
    « Antenna » (montant) ou « Mandible » ; os central vers l'avant :
    « Jaw », vers l'arrière : « Tail » ; os isolé : « Bone ».
  - Araignée : 27 « End » avant, 0 après ; 8 pattes complètes, 3 paires de
    crochets en « Jaw » ; tous les noms existent dans le vocabulaire
    d'entraînement.
- Les quadrupèdes (deux paires de pattes) sont touchés de la même façon.

### P2. Sujets de légende jamais vus à l'entraînement

- **Constat :**
  - Les poids en production (tiers, entraînés vers le 19/09) n'ont vu que
    trois sujets : « A person » (Mixamo), « An animal » (Truebones, qui
    comprend insectes, oiseaux, poissons et dragons) et « An object »
    (Objaverse). *Précision du 28/09 :* depuis le 27/09, le dépôt force
    « An object » pour TOUTES les légendes (3 414 sur 3 414 dans le jeu
    publié). À reprendre si l'on passe aux poids officiels.
  - Nous envoyons aussi « An insect … » et « A creature … ».
  - Nos légendes n'ont pas de point final, alors que toutes celles
    d'entraînement en ont un.
- **Correctif (sans GPU) :**
  - insecte et créature → « An animal » ;
  - véhicule ou objet articulé → « An object » ;
  - ajouter le point final.

### P3. Les cycles ne bouclent pas

- **Mesure :** l'écart de pose entre la dernière et la première image vaut
  4,1° pour la course, 8,0° pour l'attaque et 2,7° pour l'attente, alors
  qu'un cycle parfait vaut 0°. On voit donc un saut à chaque tour de boucle.
- **Ce que le dépôt fournit déjà** (`generate_samples(..., x1_known,
  keep_mask)`, présent dans la révision utilisée, et
  `inference/motion_inbetweening.py`) : on peut figer des images pendant
  l'échantillonnage.
- **Correctif :** pour marche, course et attente, en deux passes :
  1. génération libre ;
  2. seconde passe avec les dernières images figées sur les premières.

  La vitesse de la racine est comprise dans les images figées, ce qui donne
  un cycle continu. Coût : environ une génération de plus.

### P4. Clips de 2 secondes seulement

- **Ce que le dépôt fournit :** `inference/motion_expansion.py`
  (`expand_motion_chain`) enchaîne des segments de 60 images qui se
  chevauchent. Durée totale : `60 + (60 - recouvrement) x (N - 1)`.
  - Avec un recouvrement de 20 : 100 images (3,3 s) pour 2 segments, 180
    images (6 s) pour 4.
  - Chaque segment peut avoir sa propre légende, pour des enchaînements
    comme « marche puis court » ou « ramasse puis porte ».
- **Utilité :** c'est la brique des animations longues d'ouvriers.

### P5. Les poids : une préversion officielle est sortie le 27/09

| | Poids tiers (production) | Préversion officielle `Linzhan/UniMate` |
|---|---|---|
| Architecture | graph + AdaLN, 10 couches, 512 | identique (74,1 M de paramètres) |
| Étapes | 120 000 | 120 000 |
| Matériel | 1 GPU, lots de 16 | 6 H100 pendant 23 h |
| Données | UniML3D, 31 clips défectueux traités | UniML3D telle que publiée |
| Os maximum | 61 | 60 |
| Licence déclarée | MIT (étiquette du tiers) | **aucune** |

- **Qualité :** la préversion a vu plusieurs fois plus d'exemples et devrait
  être meilleure. Le remplacement est direct : `config.json`,
  `dataset_stats.npy`, et les poids EMA extraits de
  `checkpoint_step_120000.pt`.
- **Sécurité :** ce fichier `.pt` est un pickle. Il faut le lire avec
  `torch.load(weights_only=True)`, comme on le fait déjà pour
  `dataset_stats.npy`.
- **Licence :** les deux jeux sont entraînés sur Mixamo, Objaverse-XL (en
  partie non commercial) et Truebones (pack commercial, non
  redistribuable). Des poids sans licence déclarée sont juridiquement
  **plus fragiles** que l'étiquette MIT du tiers. Évaluation seulement,
  décision à prendre avant la vente.
- **À venir :** un modèle complet, et un modèle par jeu de données.

### P6. Un seul tirage, alors que l'échantillonnage est bon marché

- **Constat :** le modèle ne fait que 74 M de paramètres, et le temps mesuré
  est surtout du chargement.
- **Correctif :**
  - générer 3 candidats en un seul lot (B = 3) ;
  - garder le meilleur selon un score physique : à-coups, glissement des
    pieds au sol, pénétration du sol, et raccord de boucle pour les cycles.
- **Coût GPU :** faible.

### P7. Attaque saccadée

- **Mesure :** 4,3° d'à-coups (dérivée seconde de la rotation), contre 0,1 à
  0,2° pour l'attente et la mort.
- **Correctif :** P6 d'abord. Sinon, un lissage temporel léger des
  quaternions (fenêtre de 3 images) sur les clips qui dépassent un seuil.

### P8. Déplacement de la racine très grand

- **Mesure :** 5,6 unités en 2 s pour l'attaque, 6,1 pour la course. Pour une
  araignée d'environ une unité, c'est beaucoup, surtout pour une attaque.
- **À vérifier :** la conversion d'échelle de la trajectoire, sur un clip
  connu.
- **Palliatif existant :** le bouton « In place » de la visionneuse et de
  l'export.

### P9. Pour les ~78 animations d'ouvriers : l'édition d'articulations

- **Ce que le dépôt fournit :** `inference/motion_editing.py`, qui régénère
  un **sous-ensemble** d'os en gardant les autres.
- **Usage :** garder la marche des jambes et régénérer les bras (« porte une
  caisse », « martèle »).
- **Intérêt :** c'est la brique des variantes de métier.

## 4. Tester sans budget GPU

- Le modèle est petit (74 M de paramètres, 60 images).
- L'environnement `C:\tmp\unimate_venv` existe déjà.
- Une inférence **sur le processeur** est donc plausible, de l'ordre de la
  minute par clip, avec Unreal fermé.
- On pourrait valider P1, P2 et P3 sur la fourmi et l'araignée avant octobre,
  en local, sans Modal.
- **Pas encore mesuré** : c'est la première chose à essayer si tu le
  souhaites.

## 5. Plan proposé

1. **P1 et P2** : nommeur de pattes dans le vocabulaire d'UniMate, sujets
   « An animal » et « An object », point final. Code seulement, test
   processeur.
2. **P3** : boucles par double passe avec images figées (marche, course,
   attente).
3. **P6** : meilleur de 3, avec score physique.
4. **P5** : comparer poids tiers et préversion officielle sur les mêmes rigs.
   La licence reste à trancher.
5. **P4 puis P9** : clips longs, enchaînements, édition d'articulations. Ce
   sont les briques de la génération par lot pour Apovivor.

## 6. Résultats du 28/09 (fin de nuit, carte locale RTX 5080)

Mesure : part des bouts de pattes qui bougent (> 5 % de la taille) dans le repère
du corps, et amplitude moyenne. Araignée de 62 os, course, poids de production
sauf mention.

| Version | Pattes actives | Amplitude | Raccord de boucle |
|---|---|---|---|
| Production (anciens noms, 1 tirage) | 4,0 / 10 | 11 % | 4,1° |
| Noms et légendes corrigés, 1 tirage | 5,2 / 10 | 10,5 % | — |
| Moteur corrigé (meilleur de 3, boucle) | 8,6 / 11 | 15 % | 0,0° |
| Moteur corrigé + poids officiels, « An animal » | 11 / 11 | 34 % | 0,0° |
| Moteur corrigé + poids officiels, « An object » | 11 / 11 | 38 % | 0,0° |

- Les poids officiels sont le levier principal. Leur fiche ne déclare aucune
  licence : à trancher avant tout usage commercial.
- Avec ces poids, le sujet unique « An object » du dépôt fait légèrement mieux.
- Rien n'est déployé : budget Modal coupé jusqu'au 1er octobre.
