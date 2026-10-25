# « Reshape a region » avec une vue choisie : bancs d'essai (2026-10-20)

Ce qui est MESURE ici, sans GPU, sans compte, sans reseau, sans lancer l'application de bureau.
Resultats et chiffres : `AGENT_LOG.md`, entrees du 2026-10-20 (« RESHAPE A REGION »).

| script | ce qu'il fait |
|---|---|
| `test_site.mjs` | page du SITE (copie de `cloud/public/app`) dans Chromium : etape 1 (visualiseur 3D), vues rapides, orbite a la souris, « Use this view », « Change view », Apply (corps de `/api/mesh-reshape`), vue de face immediate. `/api` et `/r2` sont simules par `mock.mjs`. |
| `test_site_ancien.mjs` | le MEME parcours sur l'ANCIEN code (copie de `cloud/public/app` de `release-1.0.45`) : sert a comparer la vue de face a l'octet. |
| `test_bureau.mjs` | page du BUREAU (`src/renderer/index2.html` telle quelle) avec une API `meshyAPI` simulee (les methodes de `preload.js`) : etapes 1 et 2, angles transmis a `renderMeshFront` / `reshapeRegion`. Le rendu a plat y est une image fixe. |
| `cmp_rendus.py` | parite des rendus a plat : site (three.js, captures de `test_site.mjs`) contre bureau (`mesh_inpaint.rendre`, pyrender), IoU des silhouettes et ecart de couleur ; vue de face du nouveau site contre l'ancien code. |
| `chaine_orc.py` | la chaine du bureau HORS IA sur un vrai maillage : rendre -> masque -> repeinte simulee -> preparer -> assembler (piece synthetique). Mesure le retour des sommets, les faces retirees (profondeur de coupe) et la position de la piece. |

## Lancer (depuis la racine du depot ; node_modules par jonction ; un seul Chromium a la fois ; tout calcul long via `lourd.sh`)

1. Copies servies (jamais `cloud/out` lui-meme : le serveur verrouille le dossier) :
   `C:/tmp/r3d_site/new/app` = copie de `cloud/public/app` ; `C:/tmp/r3d_site/old/app` = `git archive origin/release-1.0.45 cloud/public/app` ;
   `C:/tmp/r3d_site/desktop` = copie de `src/renderer` + `orc.glb` (le maillage d'essai a cote de `index2.html`).
2. Serveurs statiques : `python -m http.server 8796 --bind 127.0.0.1 --directory C:/tmp/r3d_site/new` (site), `8797` (ancien), `8798` (bureau).
3. Essai : `node <skill browser-automation>/browser.mjs about:blank --script build/bancs/reshape_vue/test_site.mjs`
   (idem `test_site_ancien.mjs`, `test_bureau.mjs`). Variables : `R3D_MAILLAGE` (GLB d'essai, l'orc de `C:/tmp/trellis_cloud/glb/` par defaut),
   `R3D_SORTIE` (captures et JSON, `C:/tmp/trellis_cloud/montages/` par defaut), `R3D_THREE` (autre copie de three.js).
4. Parite : `python build/bancs/reshape_vue/cmp_rendus.py` (lit les JSON de `test_site*.mjs` dans `R3D_SORTIE`).
5. Chaine hors IA : `python build/bancs/reshape_vue/chaine_orc.py <yaw> <pitch> <u> <v> <rayon_px> [maillage.glb]`
   (u, v : centre du masque dans l'image du rendu, 0..1 ; ex. dos du torse : `180 0 0.5 0.42 30`).

## Pieges connus

- three.js vient de `node_modules` (r182) : le site charge r170 depuis unpkg ; `mock.mjs` redirige l'import map, rien ne sort sur le reseau.
- Apres le lancement d'une reconstruction, la fenetre « Running task » s'ouvre d'elle-meme (comportement existant) et recouvre la page : la fermer avant de repeindre.
- `page.evaluate` tourne dans un monde isole (ni globales ni import map) : tout passe par le DOM.
- Les tests unitaires (sans navigateur) sont ailleurs : `build/bancs/noyaux/test_reshape_vue.py`, `tests/main/reshape_vue.test.mjs`,
  `tests/bureau-interface/reshape-vue.test.mjs`, `cloud/tests/reshape-vue.test.mjs`.
