# FabMesh — Claude Code instructions

## Auto-commit
Après chaque modification testable (feature finie, fix validé, refactor
qui compile), créer immédiatement un commit avec message clair, sans
demander confirmation.

PUSH SYSTÉMATIQUE après chaque commit (`git push` immédiat, sans
demander). Règle changée le 2026-07-20 à la demande du user — l'ancienne
règle « ne pas push » est abandonnée.

Ne pas attendre que plusieurs changements s'accumulent : un commit par
unité logique de travail (1 fix = 1 commit, 1 feature = 1 commit).

## Auto-update AGENT_LOG.md
Avant tout `git commit` qui touche aux scripts ou au pipeline, ajouter
une entrée datée à `AGENT_LOG.md` à la racine du projet décrivant ce
qui change et pourquoi. Un hook Bash bloque les commits si AGENT_LOG.md
n'a pas été modifié dans la dernière heure.

## Restart Electron quand main.js change
Modifier `src/main/main.js` ou `src/main/preload.js` impose un restart
complet d'Electron (Ctrl+R reload uniquement le renderer). Pour
relancer:
```bash
powershell -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"
unset ELECTRON_RUN_AS_NODE
node_modules/.bin/electron . > logs/fabmesh_start.log 2>&1 &
```
Modifier uniquement `src/renderer/*` ou `scripts/*.py` = pas de restart
Electron, juste Ctrl+R dans la fenêtre (ou re-déclencher l'action).

## Renderer logs
`console.log` du renderer va dans `logs/renderer.log` (via le handler
IPC `renderer-log`). `logs/fabmesh_start.log` ne contient que les logs
du process main + stdout des subprocess Python.

## Backups avant modifs lourdes
Avant un changement structurel (refactor architecture, switch de modèle,
modification d'un script Python sensible), et quand le user demande un
« backup », créer une branche backup ET LA PUSHER sur GitHub (un backup
non pushé ne sert à rien — exigence user):
```bash
git checkout -b backup-<short-desc>-$(date +%Y%m%d-%H%M%S)
git push -u origin HEAD
git checkout <branche-de-travail>
```

## Deploy cloud — TOUJOURS rebuild avant wrangler deploy
Le worker Cloudflare est servi depuis `cloud/wrangler.toml > [assets]
directory = "out"`. Modifier `cloud/public/app/*.js` ne SUFFIT PAS —
il faut `cd cloud && npm run build` pour que les changements soient
copiés dans `out/`, ENSUITE `npx wrangler deploy`.

Sinon `wrangler deploy` upload bien le worker (src/worker.ts) mais
l'ancien `out/` est re-publié et les changements UI ne sortent pas.
Symptôme: `curl https://…/app/index2.js | wc -c` montre une taille
< que le fichier source.

Pattern: `cd cloud && npm run build && npm run deploy`.

**`npm run deploy`, PAS `npx wrangler deploy`.** Les garde-fous
(`check-r2-public`, `check-legal-identity`, `check-out-frais`) sont
branchés sur `predeploy`, que npm ne déclenche que pour `npm run deploy` ;
`npx wrangler deploy` les court-circuite tous.

Et ne jamais mettre un `| tail` entre le build et le `&&` : le code de
sortie d'un tube est celui de la DERNIÈRE commande, donc un build en
échec passe pour un succès et wrangler republie l'ancien `out/` en
affichant « deployed ». C'est arrivé le 23/08/2026 — trois correctifs
vérifiés en local étaient absents de la production. `check-out-frais.mjs`
refuse désormais un `out/` plus vieux que les sources.

## Commits sûrs / risqués
- **Sûr (commit auto OK)**: fix bug ciblé, ajout d'un slider/bouton,
  ajustement de paramètres (ip_scale, prompt, etc.), update doc.
- **Demander confirmation**: refactor large, suppression de fichiers,
  changement de licence ou dépendance lourde, destruction de branches.
  (Le push n'est PLUS soumis à confirmation — voir Auto-commit.)

## JAMAIS d'accès public sur le bucket R2

Le bucket `myfabmesh-meshes` ne doit **jamais** avoir son URL `r2.dev`
activée. Le 18/08/2026, elle l'était : le secret 2FA de l'admin, le hash de
son mot de passe, le journal d'audit avec l'IP du gérant et les fichiers des
clients étaient téléchargeables par n'importe qui, sans jeton.

**Aucun code ne peut empêcher ça** : `r2.dev` sert les objets directement
depuis Cloudflare, sans passer par le worker. Ni authentification ni routage
n'y changent rien.

Le mécanisme légitime existe déjà : `signedR2Url()` sert les objets depuis
l'origine du worker, avec signature HMAC et expiration
(`R2_URL_SIGNING_SECRET`, déjà déployé). Il n'y a aucune raison de rouvrir
l'accès public — même « juste pour déboguer un téléchargement ».

Un garde-fou bloque le déploiement si l'accès est réactivé :
```bash
cd cloud && npm run check:r2-public     # lancé automatiquement par predeploy
```

---

# Prise en main du projet (pour un assistant qui reprend)

Comment **observer et modifier ce projet sans casser**. Chaque règle vient
d'un défaut réel constaté le 2026-09-24, pas d'une préférence de style.

## 1. Trois cibles — c'est la difficulté principale

Le même produit existe en **trois exemplaires qui ne peuvent pas partager de
fichier** :

| cible | code | ce qui l'embarque |
|---|---|---|
| **Bureau** (Electron) | `src/renderer/*`, `src/main/*`, `scripts/*.py` | `package.json > build.files` n'embarque QUE `src/**` et `scripts/**/*.py` |
| **Web** (Cloudflare Worker) | `cloud/public/app/*`, `cloud/src/worker.ts` | `cloud/wrangler.toml > [assets] directory = "out"` |
| **GPU** (Modal) | `modal_app/*` | `app.py` ne monte que `.add_local_python_source("modal_app")` |

Conséquences :

- `cloud/public/app/index2.js` est un **portage** de
  `src/renderer/index2.js`, pas une copie — les deux ont **dérivé**.
  Localiser la fonction et appliquer un correctif ADAPTÉ. Ne jamais copier un
  fichier entier.
- HTML web = `cloud/public/app/index.html` ; HTML bureau =
  `src/renderer/index2.html`. Leurs libellés diffèrent parfois.
- Modal ne peut pas importer `scripts/`, l'appli packagée ne peut pas importer
  `modal_app/`. Tout algorithme commun vit donc **en double**, entre marqueurs
  `# --- NOYAU PARTAGE : DEBUT/FIN ---`, surveillé par
  `build/check-noyaux-partages.mjs` (`--sync` pour resynchroniser).

**Règle de base : toute modification d'outil va sur les DEUX plateformes**,
sauf instruction contraire explicite.

## 2. Observer la réalité plutôt que supposer

La leçon la plus coûteuse de la journée. Quatre sources de vérité.

**R2 — ce qui a réellement été produit.** Identifiants dans
`cloud/.env.local` (jamais commité ; le dépôt est PUBLIC) :

```python
import io, boto3
cfg = {}
for l in io.open(r'cloud/.env.local', encoding='utf-8'):
    l = l.strip()
    if l and not l.startswith('#') and '=' in l:
        k, v = l.split('=', 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
s3 = boto3.client('s3',
    endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'],
    aws_access_key_id=cfg['R2_ACCESS_KEY_ID'],
    aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'], region_name='auto')
```

Clés utiles : `mesh/*.glb`, `<uid>/front/` (images générées),
`<uid>/outfit/`, `<uid>/removebg/`, `_meta/modal_spend/<jour>`,
`_meta/userspend/<uid>/<jour>`, `_meta/userspend_cap/<uid>/<jour>`,
`_meta/last_warm_*.txt`. **`wrangler r2` n'a pas de commande `list`** — passer
par l'API S3.

**Supabase — ce qui a été demandé, avec quels réglages.** Table `jobs`
(`type`, `status`, `credit_cost`, `options`, `error`, `project_name`), table
`profiles` (`credits`). Service role dans `.env.local`, API REST directe.

**Modal — pourquoi ça a échoué.**

```bash
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal app logs myfabmesh-cloud
```

Sans les deux variables UTF-8, la commande meurt sur `charmap codec`.

**La production — ce qui est réellement servi.**

```bash
curl -s "https://myfabmesh-cloud.fabien65400.workers.dev/app/index2.js?v=$(date +%s)" | md5sum
# comparer à : md5sum cloud/out/app/index2.js
```

Une route qui existe répond **401** sans session ; une route absente répond
**404**. C'est ainsi qu'on vérifie un déploiement sans se connecter.

## 3. Construire et déployer

```bash
# WEB — build PUIS deploy
cd cloud && ALLOW_UNFILLED_LEGAL=1 npm run build && ALLOW_UNFILLED_LEGAL=1 npm run deploy

# MODAL — variables UTF-8 obligatoires sous Windows
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal deploy modal_app/app.py
```

- `npm run deploy`, **jamais** `npx wrangler deploy` : les garde-fous sont sur
  `predeploy`, que npm ne déclenche que pour `npm run deploy`.
- **Jamais de `| tail` entre le build et le `&&`** : le code de sortie d'un
  tube est celui de la DERNIÈRE commande, un build en échec passerait pour un
  succès et l'ancien `out/` serait republié.
- `ALLOW_UNFILLED_LEGAL=1` contourne le garde des mentions légales, nécessaire
  tant que l'exploitant n'est pas immatriculé. **Ne jamais inventer** de
  SIRET, RCS ou adresse pour le contourner autrement.
- Modifier `src/main/main.js` ou `preload.js` impose un **restart complet**
  d'Electron ; `src/renderer/*` et `scripts/*.py` : simple Ctrl+R.

## 4. Les garde-fous (lancés par `prebuild` des deux côtés)

Chacun vient d'un défaut livré en production :

| garde | ce qu'il empêche |
|---|---|
| `check-diff-sain.mjs` | une réécriture en masse sans changement de code (indentation écrasée : 7 024 lignes de diff pour 38 vraies) |
| `check-js-syntax.mjs` | du JS invalide dans un fichier livré **ou dans un `<script>` en ligne du HTML** |
| `check-fonctions-portees.mjs` | le web qui appelle une fonction définie seulement sur le bureau, ou une méthode `API.xxx()` absente de `meshyAPI-cloud.js` — un `ReferenceError` au clic, invisible à tout contrôle de syntaxe (Recolorier et Âge n'ont rien fait pendant deux jours) |
| `check_modal_deps.py` | une op mesh facturée dont la dépendance manque à l'image Modal |
| `check-job-steps.mjs` | un travail rattaché à aucune étape (donc sans bouton « Go to ») |
| `check-prompts-budget.mjs` | un gabarit de prompt au-delà de 77 jetons CLIP, et la divergence bureau/web/modal |
| `check-noyaux-partages.mjs` | la divergence des noyaux Python dupliqués |

**Ne jamais désactiver un garde pour faire passer une construction.**

## 5. Pièges mesurés — ne pas les réapprendre

- **`node --check <fichier>` MENT.** Sur `index2.js` (1,18 Mo) il renvoie 0
  alors que le fichier contient une vraie erreur de syntaxe. Utiliser
  `node build/check-js-syntax.mjs` (acorn).
- **Jamais de substitution générique sur un fichier entier**
  (`replace('  ', ' ')`, `replace(' ()', '')`, `sed -i` global) : trois
  accidents en une journée, dont un **livré en production**. Cibler chaque
  chaîne en entier.
- **Ne pas fabriquer de regex à travers un heredoc shell** : `\b` devient un
  caractère backspace (0x08), `\n` un vrai saut de ligne. Écrire les regex en
  littéraux dans le fichier, ou construire avec `chr(92)`.
- **`sed -i` convertit un fichier CRLF entier en LF.** La plupart des fichiers
  sont en CRLF : normaliser (`nl = '\r\n' if '\r\n' in s else '\n'`) avant
  toute recherche ou insertion multi-lignes.
- **Les apostrophes françaises cassent les heredocs et les chaînes JS**
  (`l'extraction`). Préférer les guillemets doubles côté JS.
- **Mesurer un atlas UV sur toute l'image est faux** : le vide est noir et
  écrase la médiane. Restreindre à la zone réellement couverte.
- **Un maillage chargé sans soudure des sommets paraît en milliers de
  morceaux** : les coutures UV dupliquent les sommets. Souder par position
  (`np.unique` sur les coordonnées arrondies) avant toute mesure de topologie.
- **`git diff --stat` avant CHAQUE commit.** C'est ce réflexe qui a rattrapé
  deux des trois accidents ci-dessus.

## 6. Interdictions formelles de l'exploitant

- **Aucune action sur `d:\apovivor512.15`**, ses builds ou ses traces.
- **Jamais d'accès public sur le bucket R2** (`r2.dev`).
- **Ne jamais désactiver Smart App Control** de Windows.
- **Ne jamais modifier le générateur de rig Puppeteer** ; tout pontage se fait
  en AVAL.
- **Ne pas faire fuiter les noms de moteurs** (`unirig`, `trellis`,
  `puppeteer`, `realvis`, `clipseg`…) dans un libellé visible : secret
  industriel.
- **Commit + push systématiques** après chaque unité de travail, sans
  demander. Un backup demandé = une branche **poussée** sur GitHub.
- Avant tout commit touchant aux scripts ou au pipeline : ajouter une entrée
  datée à `AGENT_LOG.md` (un hook bloque sinon).

## 7. Où trouver le contexte

- **`AGENT_LOG.md`** — journal daté de chaque expérience et correctif, avec
  les mesures. **À LIRE avant tout travail** sur mesh, texture ou multi-vues.
- Mémoire de session : `~/.claude/projects/<projet>/memory/`, index dans
  `MEMORY.md`.

## 8. Carte des fichiers qui comptent

**Interface (dupliquée bureau / web)**

| rôle | bureau | web |
|---|---|---|
| logique principale (~1,1 Mo) | `src/renderer/index2.js` | `cloud/public/app/index2.js` |
| page | `src/renderer/index2.html` | `cloud/public/app/index.html` |
| outils d'édition d'image (canvas) | `src/renderer/index2-edit-tools.js` | `cloud/public/app/index2-edit-tools.js` |
| visualiseur 3D (three.js) | `src/renderer/lib/Viewer3D.js` | `cloud/public/app/lib/Viewer3D.js` |
| annuler/refaire du canvas | `src/renderer/canvas-utils.js` | `cloud/public/app/canvas-utils.js` |
| pont vers le backend | IPC `src/main/preload.js` | `cloud/public/app/meshyAPI-cloud.js` |
| adaptations web uniquement | — | `cloud/public/app/cloud-overrides.js` |

**Serveur**

- `cloud/src/worker.ts` (~16 000 lignes) — TOUT le backend web : routes API,
  crédits, budgets, Stripe, Supabase, R2, appels Modal.
- `modal_app/app.py` — les classes GPU et leurs routes ASGI.
- `modal_app/_*.py` — un module par traitement (`_mesh`, `_mesh_op`,
  `_realvis`, `_prompts`, `_auto_inpaint`, `_face_fix`, `_recolor`,
  `_tex_variant`, `_texture_refine`, `_outfit_cutout`…).
- `scripts/*.py` — les équivalents bureau, exécutés par `sdxl_server.py`
  (serveur HTTP local persistant, port 5555) ou en sous-processus.

**Garde-fous** : `build/check-*.mjs` et `build/check_modal_deps.py`.

## 9. Recette de portage d'un outil bureau vers le cloud

Établie et utilisée plusieurs fois. Six étapes, dans cet ordre :

1. **Op Modal** — ajouter le traitement dans `modal_app/`. Si la sortie est
   UNE image, l'ajouter comme `op` de `image_op` (contrat existant) ; si elle
   est MULTIPLE, créer une route dédiée qui rend du JSON (voir `/outfit`).
2. **Route worker** — dans `cloud/src/worker.ts` : un `handleXxx`, le tarif
   dans `PRICING_DEFAULTS`, et surtout la **discipline de remboursement** :
   budget GPU, appels par utilisateur, crédits, puis `addCredits` +
   `refundModalSpend` sur CHAQUE chemin d'échec.
3. **Shim** — une méthode dans `cloud/public/app/meshyAPI-cloud.js` qui
   `postJSON` vers la route et rattache le résultat au projet.
4. **Interface** — copier la modale et le bloc de comportement depuis le
   bureau, en convertissant les chemins `file:///` vers `_toFileUrl` (présent
   des deux côtés).
5. **Tarif visible** — `cloud-overrides.js` a **DEUX** tables à mettre à
   jour : `ACTION_COSTS` (la valeur affichée) et `ACTION_COST_TO_PRICING` (le
   rafraîchissement depuis `/api/pricing`). En oublier une laisse une
   pastille figée.
6. **Vérifier** — `node build/check-js-syntax.mjs`, croisement des `id` HTML
   ↔ `getElementById` du JS, `npx tsc --noEmit`, et les gardes de parité.

## 10. Cycle de vie d'un travail (le panneau « Running jobs »)

```
gatedRun(kind, nom, fn)      ← file d'attente (VRAM ; rend ok() en cloud)
  └─ pushJob(nom, …)         ← crée la tuile ; _jobStepIndex(nom) → étape 1-4
       └─ API.xxx(...)       ← appel réel
            └─ completeJob(id, ok)  ← pousse aussi les journaux vers R2
```

- **`_jobStepIndex()` range un travail par MOTIF SUR SON NOM.** Un nom qui ne
  mord sur rien renvoie 0 : ni panneau d'étape, ni bouton « Go to », et
  **aucune erreur**. Compléter les motifs EN MÊME TEMPS que l'outil.
  `build/check-job-steps.mjs` refuse la construction sinon.
- Le nom stocké reste en ANGLAIS (les motifs le sont) ; `_displayJobName()`
  traduit à l'affichage.
- Ne jamais reconstruire la liste avec `innerHTML` à chaque tick : le bouton
  sous le curseur est détruit, le survol clignote et le clic rate. Mettre à
  jour en place derrière une signature de structure.

## 11. Crédits, budgets et fusibles

- Prix par défaut : `PRICING_DEFAULTS` dans `worker.ts`. **Piège** :
  `_meta/pricing.json` dans R2 les SURCHARGE à chaud.
- Deux compteurs par compte, à ne pas confondre :
  `_meta/userspend/<uid>/<jour>` = **comptabilité**, tous fournisseurs, jamais
  comparée à un plafond ; `_meta/userspend_cap/<uid>/<jour>` = **plafond**,
  écrit et lu par le seul chemin qui l'applique.
- Plafonds globaux : `MAX_DAILY_MODAL_SPEND_USD`, `MAX_DAILY_SPEND_USD`
  (Replicate), `MAX_USER_DAILY_SPEND_USD`, `MAX_USER_DAILY_CALLS` — dans
  `cloud/wrangler.toml`. `_plafond()` respecte le zéro (mettre 0 coupe
  vraiment).
- Message de refus : utiliser `_spendRefusalMessage()`, qui nomme le plafond
  réellement atteint. Ne pas écrire un message en dur.
- Crédits d'un compte : table `profiles`, colonne `credits`.

## 12. Modal : classes, démarrage à froid, chargement paresseux

- `MyFabmeshPredictor` — text2image.
- `MyFabmeshBackview` — back-view, T-pose, rectify, sheet, `image_op`,
  `/outfit`, `/warm`. C'est la classe qui porte CLIPSeg, SDXL Inpaint et
  ControlNet-Tile.
- `MyFabmeshMesh` — TRELLIS-2, **asynchrone** (`/mesh_start` + `/mesh_status`)
  parce qu'un démarrage à froid dépasse le délai HTTP de 150 s.
- Applications séparées : `myfabmesh-rig`, `myfabmesh-anim`,
  `myfabmesh-partsam`, `myfabmesh-fbx-retarget`.

**Démarrage à froid — le piège récurrent.** Cloudflare coupe chaque
sous-requête à 100 s avec un **524**. Toute route synchrone DOIT donc rejouer :

```ts
let r = await envoyer();
for (const attente of [60_000, 90_000]) {
  if (r.status !== 524) break;
  await new Promise(res => setTimeout(res, attente));
  r = await envoyer();
}
```

Une route sans cette escalade échoue à **chaque** conteneur froid. C'est ce
qui rendait `rectify` systématiquement inopérant.

**`/healthz` ne charge RIEN.** Les gros modèles (CLIPSeg + SDXL Inpaint ≈ 6 Go,
ControlNet-Tile) sont chargés paresseusement au premier vrai appel. La
préchauffe doit appeler **`/warm`**, pas `/healthz`, sinon un service annoncé
« chaud » fait quand même payer 6 Go de chargement au premier clic.

## 13. Pipeline mesh (TRELLIS-2)

- Le mode voxel vient du worker : `ultra_q → 1536_cascade`,
  `quality_plus → 1024_cascade`, sinon `1024` (ou `512` en mode « lite »).
  **C'est le seul levier pour les structures fines** : paille, poutres,
  fourrure, feuillage.
- Étapes appliquées après la génération, dans `modal_app/_mesh.py` :
  `brighten_baseColor` (+50 % luminosité, +30 % saturation — **cuit dans
  l'atlas exporté**, donc visible aussi dans Blender et Unreal),
  `lisser_atlas` (filtre bilatéral, option « Texture smooth »),
  `corriger_metal_degenere`.
- **`corriger_metal_degenere`** : TRELLIS-2 déclare parfois un asset organique
  métallique à 94 % sur toute sa surface — en PBR un métal n'a aucune
  composante diffuse, il rend NOIR quel que soit l'éclairage. La règle exige
  métal élevé **et** rugosité élevée simultanément (physiquement dégénéré),
  ce qui épargne les objets réellement métalliques, lisses eux.
- Diagnostiquer un mesh : télécharger le GLB depuis R2 et mesurer
  `metallicFactor`, le canal B de la carte metal/rugosité, la luminance de
  l'atlas sur la zone couverte, puis la topologie (arêtes de bord =
  vrais trous ; nombre de composantes = fragmentation).

## 14. Prompts

- Les gabarits vivent en **TROIS** exemplaires : `src/renderer/index2.js`,
  `cloud/public/app/index2.js`, `modal_app/_prompts.py` (ce dernier est
  GÉNÉRÉ par `build/sync_prompt_tables.py`). `check-prompts-budget.mjs`
  vérifie budget ET parité.
- **Limite CLIP : 77 jetons.** Au-delà, SDXL jette la fin **sans rien dire**.
  Un prompt de 193 jetons faisait disparaître les consignes de cadrage et
  sortait des bâtiments coupés.
- **Une négation dans le prompt POSITIF ne fonctionne pas** : SDXL ne
  comprend pas « no shadows », il voit « shadows » et en dessine. Tout « no X »
  doit aller dans le prompt NÉGATIF (`modal_app/_realvis.py`).
- Le négatif est assemblé **par priorité décroissante et borné au budget** ;
  ce qui tombe est écrit dans le journal Modal. Sans ce bornage il atteignait
  136 jetons pour une créature, et sa fin était jetée en silence.
- `_ANATOMY_NEG` (négatifs anatomiques par type d'asset) n'existe **que** côté
  Modal. Le bureau (`scripts/local_juggernaut_bridge.py`) a quatre prompts
  négatifs écrits en dur, sans anatomie ni bornage. **Divergence connue, non
  traitée.**

## 15. Options par type d'asset

`ASSET_OPTIONS_PROFILE` (dans les deux `index2.js`) décide, pour chaque type,
si une case est cochée, décochée ou masquée :

- `true` = visible et cochée, `false` = visible et décochée,
  **`null` = MASQUÉE et forcée à off**.
- `null` rend une option **inaccessible** à l'utilisateur. C'est ce qui
  empêchait de monter la résolution de voxels sur un bâtiment.
- `window.__optionsMortesCloud` (dans `cloud-overrides.js`) liste les options
  qu'aucun code serveur ne lit. Elle est posée **au tout début** du script
  classique, donc avant les modules : `_applyAssetOptionsProfile` la consulte
  et ne ressuscite pas ces options. Sans ce mécanisme, une option masquée
  était recochée par le profil et **facturée pour un traitement absent**.

## 16. État au 2026-09-24 — ce qui reste ouvert

- **6 outils mesh non portés sur le cloud** : `clone3d`, `detail-synth`,
  `enhance-tex`, `name`, `region-retex`, `texvar`, plus les Étapes de
  construction 3D. Aucun n'est bloqué : kaolin et l'inpaint d'atlas sont déjà
  sur Modal ; seul `enhance-tex` demande d'ajouter Real-ESRGAN à l'image.
- ~~`Variant`, `Extend`, `Sym. Auto` coquilles vides cote web~~ — **regle le
  2026-09-26.** `Extend` et `Sym. Auto` etaient en fait deja a parite (meme
  algorithme des deux cotes) ; `Variant` a recu le guide de variation et le
  verrou de forme, avec le bon moteur (`tex_variant` si la forme est
  verrouillee, `modify` sinon) et le bon tarif.
- **Piege decouvert le 2026-09-26 : une fonction peut etre APPELEE sans
  exister.** `translateUserPrompt()` etait appelee trois fois dans le
  renderer web et definie nulle part — Recolorier et Age ne faisaient
  strictement rien depuis leur portage, sans message ni tuile. Avant de
  declarer un outil porte, verifier que CHAQUE fonction que le bloc copie
  appelle existe aussi cote web.
- **Génération d'image fantôme** : une tuile « Generate images » apparaît à
  chaque mesh sans produire d'image. Trois hypothèses écartées par la mesure ;
  `pushJob` enregistre désormais sa **pile d'appel** — lire les journaux R2
  après la prochaine occurrence.
- **Le garde des prompts ne mesure que le positif** ; le négatif mérite le
  même traitement.
- La **vente est volontairement fermée** (503) tant que les mentions légales
  ne sont pas remplies : 14 champs dans `cloud/src/config/legal-identity.ts`.
