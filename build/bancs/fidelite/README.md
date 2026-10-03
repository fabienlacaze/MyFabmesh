# Banc de fidélité de FORME (03/10/2026)

Mesure objective de la ressemblance entre l'**image de référence** et la **silhouette du maillage 3D** qui en sort. Objectif produit : « le 3D doit
correspondre le plus possible à l'image ». Le banc de COULEUR existe déjà (`build/bancs/texture/fid_lib.py`, `proj_lib.py`, qui exigent un GPU et
OpenGL) ; celui-ci est le banc de FORME : **CPU seulement** (numpy, cv2, trimesh, scipy, onnxruntime CPU), **sans OpenGL**, sans GPU, sans réseau,
lecture seule sur les projets. Python de l'application :

```
C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe
```

(Ce Python embarqué n'ajoute pas le dossier courant à `sys.path` quand on lui envoie du code par l'entrée standard : lancer des FICHIERS.)

## Une commande par cas

```bash
PY=C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe
B=build/bancs/fidelite

# 1. une paire (image de référence + GLB) : métriques, orientation, pose libre, panneau [référence | diff | 3D]  -> C:/tmp/fidelite/iou/
$PY $B/iou_silhouette.py images/verif_t80_orc/ref_0.png meshes/verif_t80_orc_trellis2_native_1791026496124.glb --relief

# 2. toute la campagne existante (paires du compte R2 déjà téléchargées + GLB d'origine du poste)   -> C:/tmp/fidelite/baseline.json / baseline.md / diffs/
$PY $B/campagne_existante.py --processus 2          # --sans-local, --limite N, --refaire

# 3. juste la silhouette d'un GLB (PNG), ou juste le masque d'une image
$PY $B/rendre_silhouette.py meshes/x.glb --haut +y --yaw 180 --relief
$PY $B/masque_reference.py images/x/ref_0.png --methode auto

# 4. les tests (formes synthétiques) : 24 tests, ~15 s
$PY $B/test_fidelite.py
```

En bibliothèque : `import iou_silhouette as IS; r = IS.evaluer(image, glb)` (dict JSON-isable) ; `IS.comparer(masque_ref, masque_3d)` sur deux masques.
Utiliser **le même banc avant/après** chaque essai (gabarit de prompt, rectification, voxels, préréglage) : comparer `score`, `iou` et `parties_fines`
paire par paire, pas seulement la médiane.

## Ce que fait la chaîne

1. **GLB → silhouette** (`rendre_silhouette.py`). Toutes les géométries sont fusionnées avec leur transformation de nœud. Projection **orthographique**
   (ou `--persp k`), cadrage automatique sur la boîte englobante (marge 3 %). Rastérisation CPU : triangles de plus de 1 px remplis un par un
   (`fillConvexPoly`), plus petits tracés par leurs arêtes (`polylines`). Un maillage de 500 K faces à 1024 px : ~1 s ; 10 M de faces : ~2,5 s
   (sous-échantillon aléatoire reproductible à 3 triangles par pixel). Ouverture morphologique de 0,5 % du côté qui retire les plans minces vus
   par la tranche (la dalle de sol de l'orc, 2 mm d'épaisseur, étirait la boîte englobante de 70 %).
   **Piège mesuré : `cv2.fillPoly` remplit en PARITÉ** (pair-impair) : deux triangles qui se recouvrent s'annulent, un cube vu de face sort VIDE. Ne jamais
   l'employer sur un maillage.
2. **Orientation** (`chercher_orientation`). Convention du banc : y vers le haut, la caméra est en +z. Un GLB (glTF) est en Y haut, la face avant regarde +z :
   `haut='+y', lacet=0`. Sur les paires réelles le meilleur lacet est 0 ou 180 (la silhouette orthographique de +z est le miroir de celle de −z : le contour
   seul ne distingue pas l'avant de l'arrière, la couleur départage si les deux sont à 0,02 d'IoU). Les quatre lacets sont toujours mesurés et rapportés
   (`orientation.iou_par_lacet`). Le miroir n'est jamais choisi (il n'a pas de sens physique), seulement rapporté (`miroir_diagnostic`).
3. **Pose libre** (`chercher_pose`) : meilleur (axe du haut parmi 6, lacet quelconque, tangage) pour recouvrir la référence, rendus à 256 px (~0,2 s
   chacun, 100-150 rendus). C'est la **borne haute** de la fidélité de forme quand l'image n'est pas une vue de face du modèle (véhicule en 3/4, insecte vu
   de dessus). L'écart `score_libre − score` dit si le défaut est la POSE (écart grand) ou la FORME (écart faible).
4. **Masque de référence** (`masque_reference.py`), par ordre de repli : `alpha` (canal alpha utile) → `fond` (fond uni : région du cadre connectée au bord) →
   `degrade` (fond lisse non uni : estimation par convolution normalisée anisotrope, hystérésis sur le gradient) → `u2net` (onnxruntime CPU, poids
   `%APPDATA%/myfabmesh-ai/ai-cache/u2net/u2net.onnx` déjà présent, jamais téléchargé ; échec explicite `MasqueIntrouvable` s'il manque). Chaque résultat
   porte `methode` et `coupe_bords` (part du périmètre de l'image où le sujet touche le bord : sujet coupé par le cadre).
   Le masque `u2net` est AUSSI calculé (clé `contre_u2net`) : **le pipeline détoure l'image avec u2net AVANT de la donner à TRELLIS** (`scripts/local_trellis2_bridge.py`
   l. 81-99, `modal_app/_mesh.py prep_image`). Ce que TRELLIS a vu est donc l'image détourée, pas l'image affichée à l'utilisateur.

## Métriques (toutes sur la boîte englobante NORMALISÉE de chaque masque)

Normalisation : on découpe la boîte englobante de chaque masque, on la ramène à 90 % du canevas 512 × 512 (échelle isotrope, plus grand côté), centrée.
Aucune différence de cadrage, d'échelle ou de résolution n'entre donc dans la mesure ; en contrepartie **une erreur de proportions globale est
partiellement absorbée** (le 3D plus étroit est étiré) : voir `aspect_rapport` (largeur/hauteur du 3D divisée par celle de la référence ; < 1 : membres perdus).

| clé | définition |
|---|---|
| `iou` | \|R ∩ S\| / \|R ∪ S\| (R = référence, S = silhouette 3D) |
| `dice` | 2 \|R ∩ S\| / (\|R\| + \|S\|) |
| `f_contour` | F-score des contours : précision = part des points du contour de S à moins de **2 % de la hauteur** du contour de R ; rappel = l'inverse ; F = 2PR/(P+R). `f_contour_demi_tol` : même chose à 1 % |
| `hausdorff_moyen` | moyenne symétrique des distances d'un point de contour à l'autre contour, en fraction de la hauteur (0 = parfait). `hausdorff_95` : 95e centile |
| `manquant_pct` | aire de R absente de S, en % de l'aire de R (rouge sur le diff) |
| `en_trop_pct` | aire de S absente de R, en % de l'aire de R (bleu) |
| `regions` | 3 colonnes (gauche / centre / droit) × 2 lignes (haut / bas) sur la boîte de l'union : aire de la référence, manquant et en trop de chaque cellule, en % de l'aire TOTALE de R (la somme des cellules redonne les totaux) ; `iou_cellule` |
| `parties_fines` | voir ci-dessous |
| `recale`, `iou_recale` | mêmes métriques après le meilleur recalage de S sur R en échelle + translation (diagnostic de cadrage ou de proportions ; **jamais** la mesure officielle) |
| `pose_libre` | mêmes métriques à la meilleure pose (voir 3) |
| `contre_u2net` | `iou` et `score` contre le masque u2net, quand le masque principal n'est pas déjà u2net |

**Parties fines perdues.** Une partie est « fine » si plus étroite que 4 % de la hauteur (ouverture morphologique par un disque de rayon 2 %, le résidu
moins un liseré de 2 px). Chaque composante connexe de ce résidu (≥ 0,02 % du canevas : arme, queue, corne, antenne, doigt, patte) est « perdue » si
moins de 50 % de sa surface tombe dans la silhouette 3D dilatée de 2 % de la hauteur. Rapport : liste (aire, longueur en % de la hauteur, zone, couverture),
`nb_fines_perdues`, `fraction_fines_perdue` (part de l'aire fine perdue). `composantes_perdues` : composantes ENTIÈRES du masque de référence (≥ 0,05 %)
sans équivalent.

**Score global 0-100** (`score_global`) :

```
score = 100 × ( 0,45 × IoU  +  0,25 × F_contour  +  0,15 × max(0, 1 − Hausdorff_moyen / 0,05)  +  0,15 × (1 − fraction_fines_perdue) )
```

100 = silhouettes identiques ; 0 = rien en commun. L'IoU pèse le plus (volume), le contour punit les erreurs de détail, le terme Hausdorff s'annule à
5 % de la hauteur d'écart moyen, le dernier punit les armes, queues et antennes perdues. Ces poids sont un choix du banc, pas une vérité : comparer
des scores entre eux, jamais à une valeur « bonne » absolue ; en cas de doute, regarder l'IoU et le diff.

**Image de diff** (`<nom>_diff.png`) : à gauche la référence normalisée avec le contour 3D en jaune ; au milieu **vert = commun, rouge = manquant dans le
3D, bleu = en trop** ; à droite le 3D (silhouette ou ombrage avec `--relief`). `_libre.png` : même chose à la pose libre.

## Limites — à lire avant de conclure

- **La silhouette de face ne voit pas la profondeur.** Un bras plié vers la caméra, un ventre creux, une cavité, une jambe à moitié devant l'autre, un
  visage plat ne changent pas le contour. Un 3D parfait de face peut être faux de profil. Ce que le banc ne mesure PAS : l'épaisseur, la forme de profil,
  le relief, la topologie (trous, fragments), la couleur, la netteté, l'identité.
- **L'image source n'est pas toujours celle que TRELLIS a reçue** (image brute, détourée, rectifiée selon les réglages) ; le masque principal est celui de
  l'image affichée, `contre_u2net` approche ce que le modèle a vu.
- **Une référence qui n'est pas de face** (3/4, dessus) fait mesurer la pose, pas la forme : lire `pose_libre`.
- **Perspective** : le banc est orthographique par défaut ; une photo en perspective forte donne un petit biais (`--persp`).
- Le masque `degrade` et le masque `fond` gardent un **socle** et une **ombre portée** (ils diffèrent du fond) : un 3D qui les a retirés est pénalisé
  alors que c'est parfois voulu. `coupe_bords` signale un sujet coupé par le cadre (alors l'IoU est borné par ce qui est visible).
- Le diff est à 512 px : les détails de moins de ~0,4 % de la hauteur ne sont pas résolus.

## Compléments proposés (non faits ici : demandent un GPU ou un accord)

1. **Vues latérales pour le contour** : rendre le GLB de profil et de dos et les comparer aux vues générées par le pipeline (vue de dos, rectification :
   `modal_app/_backview*`, `generate_back_view.py`) ; même code (`rendre_masque(.., yaw=90)`), la référence de profil étant la vue générée.
2. **DINOv2 sur rendus ombrés** : similarité de cosinus entre les caractéristiques DINOv2 de la référence et celles de 6-8 rendus du 3D (poids déjà dans
   le cache hors ligne de l'appli, cf. `fid_lib.py`) — capte la forme apparente, les parties et l'identité que la silhouette ignore. Nécessite le GPU
   (ou un CPU lent) : à lancer seulement quand le propriétaire l'autorise.
3. **Chamfer / profondeur** contre une profondeur estimée de l'image (Depth Anything v2, Apache) : mesure du relief.
4. Étendre la campagne avec les paires de régénération (même prompt, autre graine) pour mesurer la variance : un écart de score inférieur à cette variance n'est
   pas un progrès.

## Fichiers

`rendre_silhouette.py` (rendu, orientation, pose libre) · `masque_reference.py` · `iou_silhouette.py` (métriques, diff, `evaluer`) ·
`campagne_existante.py` · `test_fidelite.py` · sorties hors dépôt dans `C:/tmp/fidelite/` (`baseline.json`, `baseline.md`, `diffs/`, `cache/`).
