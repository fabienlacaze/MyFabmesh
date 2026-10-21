# Banc « diagnostic de matière » (20/10/2026)

Mesure, sur de VRAIS maillages, ce qu'est une « zone sans matière » : ce que Fill holes voit (boucles d'arêtes de bord) et ce
qu'il ne voit pas. Rapport : `docs/campagnes/fillholes_diagnostic_2026-10-20.md`.

Interpréteur : celui de l'appli (`%APPDATA%/myfabmesh-ai/python/python.exe`) ; numpy + scipy + Pillow seulement, aucune
installation, aucun GPU. Tout calcul de plus de ~20 s passe par `bash /c/tmp/lourd.sh --max-sec N <commande>`.

## Fichiers

| fichier | rôle |
|---|---|
| `diagnostic_matiere.py` | l'outil : `analyser <glb>` (un maillage) ou `corpus corpus.json` (tous) ; écrit `resultats/<nom>.json`, `zones/<nom>.json`, un montage PNG |
| `glb_lecture.py` | lecteur GLB minimal (numpy) : indices tels quels, matrices de nœud, `doubleSided` ; écrit aussi un GLB sans texture |
| `rasteur.py` | rastériseur à tampon de profondeur et d'identifiants (numpy pur, orthographique) ; 26 directions du cube |
| `topologie.py` | soudure par distance, arêtes de bord, boucles, non-manifold, pincements, composantes, feuilles d'orientation, plis à 180° |
| `visibilite.py` | par direction : pixels dont le premier impact est une face vue par DERRIÈRE, trou visuel, fenêtres (fond cerné) |
| `structures.py` | double peau, parois minces (proximité et lancer de rayons), coques internes (voxels) |
| `rendu_texture.py` | rendu texturé à faces simples (ou double face) sans GPU : ce que montre la visionneuse |
| `reduire_copie.py` | copie réduite (forme seule) par le moteur de production (meshoptimizer WASM via node) ou `fast_simplification` |
| `produit_fill_holes.py` | lance le `fill_holes` du produit (`modal_app/_mesh_op.py`) sur un GLB et rapporte verdict / refus / faces |
| `rappel.py` | rappel et précision d'un DÉTECTEUR contre les zones de référence (`--reference visuel|fenetres`) |
| `synthese.py`, `tableaux_rapport.py` | tableaux (aucun chiffre du rapport n'est tapé à la main) |
| `versions.py` | liste les résultats manquants ou produits par une autre `VERSION_OUTIL` |
| `test_diagnostic.py` | 21 tests sur des maillages synthétiques à vérité connue (`python build/bancs/fillholes/test_diagnostic.py`) |
| `corpus.json` | les maillages mesurés (chemins de la machine du propriétaire ; AUCUN GLB dans le dépôt, public) |
| `resultats/`, `zones/` | sorties : mesures par maillage, et zones de référence pour évaluer plus tard un détecteur |

## Catégories (carte des zones)

Un pixel « arrière visible » = dont le premier impact est une face vue par derrière. Sa cause, par priorité :
`bord` (une vraie boucle d'arête de bord, soudée, est tout près) > `retourne` (feuille d'orientation plus petite que sa voisine,
ou coque fermée de volume négatif) > `double_peau` (une autre face, d'orientation opposée, à moins de 0,2 % de la diagonale) >
`mince` (idem à moins de 1 %) > `aucune`. TROU VISUEL = arrière visible dont la nappe vue par devant est à plus de 0,5 % de la
diagonale derrière (écart mesuré perpendiculairement), ou absente : ce que la visionneuse (faces simples) montre comme
« mauvaise surface visible ». FENÊTRE = fond cerné par du maillage dans la silhouette pleine ; « à lèvre » si au moins la moitié de
son pourtour est un pli à ~180° (trou traversant d'une nappe mince fermée : aucune arête de bord).

## Reproduire

```bash
PY=$APPDATA/myfabmesh-ai/python/python.exe
$PY -I build/bancs/fillholes/test_diagnostic.py
bash /c/tmp/lourd.sh --max-sec 420 $PY -I build/bancs/fillholes/diagnostic_matiere.py analyser <glb> --nom X --sortie <dossier> --montages <dossier_png>
$PY -I build/bancs/fillholes/tableaux_rapport.py <dossier> build/bancs/fillholes/corpus.json <sortie.md>
```

Les copies réduites (`reduits/`) se fabriquent avec `reduire_copie.py` ; les montages et rendus vont sous `C:/tmp/fillholes_mesure/`
(non commités : PNG).
