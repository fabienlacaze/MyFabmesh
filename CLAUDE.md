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
