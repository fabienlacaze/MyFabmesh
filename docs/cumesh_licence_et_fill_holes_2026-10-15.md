# CuMesh : licence du BVH (cubvh) et bogue de `fill_holes` — constats, correctifs, marche a suivre

Verifie a la source le 2026-10-15 (GitHub, binaires de la roue publique et du Python installe de l'appli). Branche
`fidelite-cumesh-1410`. **Rien n'est deploye ni publie** : l'image Modal se reconstruit au prochain deploiement groupe,
la roue du bureau demande une compilation sur une machine Windows (section 3).

## 1. Constat de licence

| fait | preuve |
|---|---|
| CuMesh (JeffreyXiang, MIT) compile `third_party/cubvh` en `cumesh._cubvh` | `setup.py` de CuMesh 12289e1 |
| ce sous-module pointe sur `JeffreyXiang/cubvh` branche `trellis.2`, commit `ce92267` (30/12/2025) | `.gitmodules` + gitlink |
| ce commit contient `LICENSE_NVIDIA` (« NVIDIA Source Code License for instant neural graphics primitives ») et `src/bvh.cu` avec `TriangleBvhWithBranchingFactor` / `DistAndIdx` | lecture des fichiers a `ce92267` |
| licence NVIDIA : §3.3 usage « only ... non-commercially », c'est-a-dire « for research or evaluation purposes only » ; §3.1 toute redistribution sous cette licence avec copie complete | `LICENSE_NVIDIA` |
| `ashawkey/cubvh` `c7379c0` (26/08/2026, Jeff Daily/AMD) « Rewrite BVH core as independent MIT-licensed implementations » : remplace `src/bvh.cu`, `include/gpu/{bvh,triangle,bounding_box}.cuh` et une partie de `common.h`, qui « borrowed code from NVlabs/instant-ngp » ; `191b020` supprime `LICENSE_NVIDIA` ; `de1badf` (27/08) corrige les distances sans triangle valide ; PR #34 fusionnee par le mainteneur | `gh api repos/ashawkey/cubvh/commits/...` |
| meme API Python (`create_cuBVH`, `ray_trace`, `unsigned_distance`, `signed_distance`, plus `state_dict`), memes structures memoire, meme Eigen (`e63d9f6c`) ; difference avec le fork epingle : seulement l'enrobage `namespace cumesh` (`ce92267`, « avoid symbol conflicts ») et la pile de 64 entrees (deja dans ashawkey depuis `e5a657a`) | `compare` GitHub |
| **testee sur AMD seulement** par son auteur (« a CUDA build-and-test run ... would be a welcome double check ») | message de `c7379c0` |
| aucun `cubvh` autonome chez nous (seul `o_voxel.postprocess` appelle `cumesh.cuBVH`) : l'enrobage de namespace n'est pas necessaire | grep de `external/TRELLIS2_win/src` |

**Ou on l'utilise** : `o_voxel.postprocess.to_glb` (distance au plus proche triangle, remaillage et cuisson de la texture),
`modal_app/_mesh.py::densifier` et `scripts/trellis2_native_full_pipeline.py::densifier` (lancers de rayons),
`external_patches/TRELLIS2_win/o_voxel_patch.py`.

**Exposition, deux fois** :
* **Cloud** : usage dans un service payant d'un binaire compile avec du code « recherche / evaluation uniquement ».
* **Bureau** : la roue `cumesh-1.0-cp311-cp311-win_amd64.whl` est **livree** (`package.json` `extraResources` `build/wheels` ->
  `resources/wheels`, installee par `scripts/wizard_install_deps.py`) et **publiee** dans la pre-release `trellis2-wheels-v1` du
  depot public (sha256 `d1ed72dfb2815776812bd634c175885bf373ae585306a5b819dc191041c1f024`). Mesure du 15/10 : son
  `_cubvh.cp311-win_amd64.pyd` (1 785 344 octets) contient `TriangleBvhWithBranchingFactor` (3) et `...33signed_distance_watertight_kernel`
  (13) ; idem pour le `.pyd` installe dans `%APPDATA%\myfabmesh-ai\python`. Son `dist-info` ne porte pas `LICENSE_NVIDIA` (le §3.1 n'est
  donc pas respecte non plus). `THIRD_PARTY_LICENSES` §40 disait « not redistributed » : corrige.
* Origine de la roue (verifie octet pour octet) : sa couche Python (`bvh.py`, `cumesh.py`, `remeshing.py`, `xatlas.py`, `__init__.py`,
  CRLF compris) est identique a `visualbruno/CuMesh` `d10e54c` « version 1.0 » (08/03/2026), un fork qui **versionne cubvh dans l'arbre**
  (`third_party/cubvh/LICENSE_NVIDIA`). C'est la « distribution ComfyUI-Trellis2 (Torch280) » de `build/fetch_trellis2_wheels.py`.
  Les deux `.pyd` ne portent que le motif `sm_86` (aucun autre `sm_`/`compute_` dans les octets) : la roue a probablement ete compilee pour Ampere seulement.

Risque residuel a faire relire par un juriste : la licence MIT de la reecriture repose sur la declaration de son auteur (travail « independant »,
prepare avec un agent IA) et sur sa fusion par le mainteneur.

## 2. Ce qui change dans le code

* `modal_app/app.py` : `_CUMESH_MIT`, derniere couche de `mesh_image` (avant `add_local_python_source`). Elle clone CuMesh `12289e1`
  (= `main` ; **la couche d'origine datait du 25/05 et `main` n'a pas bouge depuis le 09/05** : c'est la version qui tourne),
  remplace `third_party/cubvh` par `ashawkey/cubvh` `de1badf`, lance **la garde des sources** puis compile, lance **la garde du paquet installe**,
  efface toutes les sources. La couche d'origine (clone recursif, compile) est inchangee : seule cette compilation (~10-15 min) est refaite ; o-voxel,
  FlexGEMM, flash-attn et les ~25 Go de poids restent en cache. Limite : les couches basses de l'image contiennent encore l'ancien binaire
  (jamais execute : le fichier est masque). Option « propre » : retirer le `--recursive` de la couche d'origine, au prix d'une reconstruction complete.
* `modal_app/construction_cumesh.py` (copie dans l'image, `/opt/`) : **echoue bruyamment** (`CONSTRUCTION CUMESH : ...`, code 1) si l'arbre cubvh contient
  `LICENSE_NVIDIA`, le texte de la licence NVIDIA, `TriangleBvhWithBranchingFactor`, `DistAndIdx`, une licence non MIT, ne descend pas de `c7379c0` ou n'est pas
  `de1badf` ; apres compilation, si le binaire `_cubvh` porte l'ancienne signature ou n'a pas celle de la reecriture (`bvh_signed_distance_watertight_kernel`),
  si le paquet n'a pas ete installe depuis le dossier compile (`direct_url.json`), ou si un BVH construit sur le CPU n'a pas pour racine la boite exacte du maillage.
  Commandes : `sources`, `installation`, `roue`, `site`.
* **Correctif de la PR #41** (voir section 4) applique a `src/dtypes.cuh` sur le **texte exact** attendu, sinon la construction s'arrete.
* Bureau : `build/reconstruire_roue_cumesh.py` (section 3), avertissement dans `build/fetch_trellis2_wheels.py`, mise en garde dans `scripts/_rebuild_cumesh.sh`
  (environnement de developpement WSL, compile encore le cubvh d'origine : ne pas en tirer une roue).
* `THIRD_PARTY_LICENSES.txt` §40 : exacte (deux licences, fichiers sous licence propre : tiny-cuda-nn BSD-3, PCG32 Apache-2.0, Eigen MPL-2.0 ; l'ancien code est
  signale tant que l'ancienne roue est livree).
* Tests (CPU) : `build/bancs/noyaux/test_cumesh_mit.py`, `test_roue_cumesh.py`, `test_banc_bvh_cumesh.py`. Bancs GPU : `modal_app/test_cumesh_fill_holes.py`, `modal_app/test_cumesh_bvh.py`.

## 3. Marche a suivre — bureau (a faire par le proprietaire)

La roue se refait **avec le meme fork** (`visualbruno/CuMesh d10e54c`), seul `third_party/cubvh` change ; son `fill_holes` est deja corrige (`de49c4a`).
1. Machine Windows avec : **Python 3.11 complet** (pas l'interpreteur embarque : il n'a pas `Include/`), `torch==2.8.0` cu128, `setuptools wheel ninja`,
   CUDA Toolkit 12.8 (present : `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8`), Visual Studio 2022 Build Tools, git. Ouvrir l'invite
   « x64 Native Tools Command Prompt for VS 2022 ». Le script n'installe rien ; `--prerequis` dit ce qui manque.
2. `python build/reconstruire_roue_cumesh.py --prerequis`, puis `--construire C:\tmp\cumesh_mit --a-blanc` (affiche le plan), puis sans `--a-blanc`.
   Sortie : `build/wheels/cumesh-1.0.1-cp311-cp311-win_amd64.whl` + sha256. La **version 1.0.1** est voulue : `pip install cumesh==1.0` se croit satisfait par
   une 1.0 deja posee. `--archs` vaut `8.6;8.9;12.0+PTX` par defaut (la roue actuelle n'a que `sm_86`) : binaire plus gros, compilation plus longue.
3. Essayer sur votre machine : `<python de l'appli> -m pip install --no-deps --force-reinstall build/wheels/cumesh-1.0.1-...whl`, puis une generation 3D locale
   (comparer avec une generation d'avant : trous, vitesse). `python build/reconstruire_roue_cumesh.py --verifier` doit repondre « conforme ».
4. Publier : pre-release `trellis2-wheels-v2` du depot (les 5 roues ; copier les 4 autres telles quelles), puis mettre a jour **ensemble**
   `build/fetch_trellis2_wheels.py` (`RELEASE_BASE`, entree `cumesh-1.0.1-...` et son sha256), `scripts/wizard_install_deps.py` (`TRELLIS2_WHEELS_BASE`,
   `cumesh==1.0.1`, nom de fichier), `build/build_wheels.md`, `THIRD_PARTY_LICENSES.txt` §40 (sha256 de la nouvelle roue, retirer l'avertissement).
   `test_roue_cumesh.py` verifie la coherence wizard / fetch / §40.
5. **Retirer l'ancienne roue** de la pre-release `trellis2-wheels-v1` (publique) et ne plus livrer `cumesh-1.0`.
6. Activer la garde de packaging : ajouter `python build/reconstruire_roue_cumesh.py --verifier` apres `python build/patch_ovoxel_wheel.py --verify`
   dans `prebuild:licence-check` (`package.json`). **Non fait ici** : elle ferait echouer tout `build:installer` tant que l'ancienne roue est la, et la ligne est
   deja modifiee par les lots en cours (fusion).
7. Installations existantes : le wizard ne tourne qu'a la premiere installation ; un cumesh 1.0 deja pose (dont le votre) garde l'ancien binaire. Il faut une
   reinstallation ciblee de `cumesh==1.0.1` (a coder dans le wizard ou dans une mise a jour : changement de `src/main/main.js`, donc redemarrage d'Electron).

## 4. Etude de `fill_holes` (PR #41 de CuMesh)

* **PR** : `rwfsmith`, 21/08/2026, **ouverte, 0 commentaire, 0 relecture, non fusionnee** (base `12289e1`). Diagnostic : `fill_holes` calcule le sommet de
  bouchage de chaque trou par `cub::DeviceSegmentedReduce::Sum` sur des `Vec3f` (`src/clean_up.cu`, ~l.660-680). CUB construit la valeur initiale cote hote
  (`OutputT(), // zero-initialize`, `device_segmented_reduce.cuh` l.405 et 420 du CUDA 12.8 de cette machine) ; le constructeur de `Vec3f` est `__device__`
  seulement, donc la valeur initiale G est ce qui traine sur la pile, ajoutee a la somme avant la division : sommet = (G + somme des milieux) / n. Observe par
  l'auteur (Windows, CUDA 13.0, RTX 5090) : 1er appel du processus juste, suivants faux (arete de 4,76e9, colonne de triangles). Correctif : 6 lignes, constructeurs en
  `__host__ __device__`. **Mecanisme coherent a la lecture du code, non confirme chez nous.**
* **Corrige independamment** dans `visualbruno/CuMesh` `de49c4a` (21/02/2026, « Fixed "infinite lines" bug » : somme refaite par un noyau GPU) : **la roue du bureau n'est
  pas concernee** (`d10e54c` en descend).
* **Chez nous (Modal)** : Linux, gcc, CUDA 12.4 : le mecanisme ne depend pas de la plateforme (PR), donc le scenario est possible. `to_glb(remesh=True)` (production)
  appelle `fill_holes` **1 fois** sur un `CuMesh` neuf ; `remesh=False` (second export de `_exporter_cible`) **3 fois** sur le meme objet ; `acceleration_glb._nettoyer`
  1 fois. Un conteneur chaud enchaine les generations dans le **meme processus** : « le 2e appel du processus » est l'ordinaire. Aucun artefact de type colonne / aiguille
  n'est note dans `AGENT_LOG`. Les « trous » observes viennent d'autres causes mesurees (triangles retournes a petite cible, `AGENT_LOG` 29/09).
* **Decision** : correctif applique a l'image Modal (inoffensif, 6 lignes, texte exact exige), **a mesurer sur GPU** (section 5) pour dire s'il changeait quelque chose.
* **PR #39** du meme auteur (`get_vertex_val` : `udf[idx]` sans test d'absence, remaillage) **examinee et ecartee** : `get_sparse_voxel_grid_active_vertices`
  (`svox2vert.cu`) insere tous les coins de tout voxel actif ; or `get_vertex_val` n'est appelee qu'avec les 8 coins du voxel courant : la recherche ne rate pas sur le
  chemin standard. Le « non-determinisme » qu'elle decrit s'explique mieux par la PR #41 (meme jour, meme auteur).

## 5. Protocole de mesure GPU (a lancer plus tard, sur accord ; ~0,2 $ en tout)

Depuis la racine du depot, UTF-8 obligatoire sous Windows. Le premier lancement **construit la couche CuMesh** de `mesh_image` (10-15 min, gardes de licence comprises) ;
les suivants et le deploiement reutilisent l'image.
```
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_cumesh_bvh.py
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_cumesh_fill_holes.py --appels 8 --sequences 3
```
1. **BVH MIT juste sur CUDA 12.4 / L40S** (`test_cumesh_bvh.py`) : distances et `uvw` contre une reference exhaustive numpy (pas l'ancien BVH), rayons, triangles
   d'aire nulle jamais rendus, 3 constructions successives identiques, durees sur 327 680 triangles. Attendu : `verdict.banc_valide = true`.
2. **fill_holes avec / sans correctif** (`test_cumesh_fill_holes.py`) : sphere de 327 680 faces percee de 200 trous connus ; 8 appels directs + 3 sequences « comme to_glb » par
   variante, chaque sommet de bouchage compare a son oracle. Attendu : `banc_valide = true` (avec correctif tous justes a 1e-5) ; `defaut_confirme_sans_correctif = true` dirait que la
   production etait touchee, `false` que le correctif etait sans effet chez nous (a garder quand meme).
3. **Une generation reelle, a froid PUIS a chaud** (protocole `feedback_protocole_mesure_generation`) apres le deploiement groupe + `build/rechauffer_apres_deploy.py` : meme sujet,
   graine fixe ; comparer a une generation d'avant (journaux `image prepared`, `TRELLIS-2 inference`, `GLB export dt=`) : le temps d'export ne doit pas bouger (BVH annonce ±3 %), le
   maillage garder le meme nombre de faces a ±1 % ; verifier aussi `Densifier` (cibles > 1 M de triangles) puisque les lancers de rayons ont change. `CuMesh 12289e1` ajoute le traitement
   des flux CUDA de la PR #29 (Blackwell) : sans effet attendu sur L40S, a constater.
4. Relire le journal de construction de l'image : `CONSTRUCTION CUMESH : sources conformes (...)` puis `cumesh installe conforme (...)`.

## 6. Decisions du proprietaire

* Retirer / remplacer la roue du bureau (section 3) : delai ? La roue actuelle est publique et livree.
* Couche finale (rapide, ancien binaire masque dans les couches basses) ou reconstruction complete de l'image sans `--recursive` ?
* Activer la garde de packaging (3.6) maintenant ou apres la nouvelle roue.
* Faire relire le §40 et le risque de la reecriture MIT par un juriste.
* Compiler la nouvelle roue pour `8.6;8.9;12.0+PTX` ou garder `sm_86` seul.
