# Piloter l'appli de bureau depuis une session

> **Fichier GENERE** par `node build/lister-commandes-bureau.mjs` — ne pas editer a la main,
> relancer le generateur apres tout ajout d'outil (de preference appli ouverte, pour le
> catalogue par zone).

## Principe

L'appli de bureau (mode developpement) ecoute sur `http://127.0.0.1:7331` (Control API,
`src/main/control_api.js`). Chaque requete porte `Authorization: Bearer <jeton>` ; le jeton est
reecrit a chaque demarrage dans `.test_api_token` (racine) et `~/.fabmesh/test_api_token.txt`.
Desactivee dans l'appli packagee (Store) sauf `FABMESH_CONTROL_API=1`.

Trois niveaux couvrent **100 % des fonctions** :

1. **Interface** (`/ui/*`) — tout ce qu'un utilisateur fait : cliquer n'importe quel bouton (meme dans une
   carte repliee), remplir les champs, lire les modales, et la **souris / clavier reels** pour ce qui se
   dessine ou se tire (masques, gizmos, camera 3D). C'est le chemin a preferer : il passe par la file
   d'attente, les tuiles de travaux, la facturation et l'enregistrement dans le projet, comme un clic.
2. **IPC** (`POST /ipc {method, args}`) — les 176 fonctions du processus principal
   (`window.meshyAPI.*`), sans interface : utiles pour lire (listes, meta) ou lancer un traitement brut.
3. **Code** (`POST /eval {code}`) — JS dans la page (`window.state`, `window.meshyAPI`) : dernier recours.

Les **dialogues natifs** (choisir un fichier a importer, un chemin d'export, une boite de message) se
reglent AVANT le clic avec `POST /dialog/next` ; sinon ils attendent un humain.

## Outil en ligne de commande : `build/fab.mjs`

```bash
node build/fab.mjs etat                                   # projet ouvert, travaux, modales
node build/fab.mjs catalogue resize                       # controles visibles contenant « resize »
node build/fab.mjs clic ws-mesh-resize-btn                # id, @ref du catalogue, selecteur, ou texte:Apply
node build/fab.mjs remplir rz-rot-x 90
node build/fab.mjs modale                                 # champs et boutons de la modale ouverte
node build/fab.mjs attendre '{"jobsDone":true,"timeout":900000}'
node build/fab.mjs capture C:/tmp/vue.png rz-viewport     # PNG d'un element (ou de la fenetre)
node build/fab.mjs ipc listMeshes
node build/fab.mjs POST /ui/mouse '{"target":"rz-canvas","path":[[0.3,0.5],[0.7,0.5]]}'
```

## Recettes

| but | commandes |
|---|---|
| ouvrir un projet | `POST /select-project {name}` ou `clic "texte:<nom>"` sur la page Projets |
| lancer un outil | `catalogue <mot>` -> `clic <id>` -> `modale` -> `remplir` -> `clic <bouton Apply/Generate>` -> `attendre {"jobsDone":true}` |
| peindre un masque / dessiner | `POST /ui/mouse {target:<canvas>, path:[[fx,fy],...], steps, delay}` (fractions 0..1 du canvas) |
| tirer un gizmo, tourner la camera | `POST /ui/mouse` (bouton `left` / `right`), `POST /ui/wheel {target, deltaY}` pour zoomer |
| importer un fichier | `POST /dialog/next {open:["C:/chemin/image.png"]}` puis `clic` sur le bouton d'import |
| exporter | `POST /dialog/next {save:"C:/chemin/sortie.glb"}` puis `clic` sur le bouton d'export |
| raccourci clavier | `POST /ui/key {key:"z", modifiers:["control"]}` ; texte : `{text:"..."}` ; focus : `{target}` |
| verifier le resultat | `GET /ui/toasts`, `GET /ui/shot?target=<vue>&file=<png>`, `GET /jobs`, `GET /logs?file=renderer` |

Cibles acceptees partout : `id`, `#id`, `@r12` (reference donnee par le catalogue, pour les elements
sans id : vignettes de versions, cartes de projets), selecteur CSS, ou `{"text":"Apply","within":"modal-resize"}`.

## 1. Routes de la Control API (48)

```
GET  /
GET  /state
GET  /status  (vivant ? + dernieres requetes recues)
GET  /screenshot  (full Electron window PNG)
GET  /screenshot-file?path=  (stream any PNG/JPG inside project root)
GET  /thumbs?project=&kind=  (list image|mesh versions + paths)
POST /compare-thumbs  {a, b, threshold?}  pixel-diff two files
GET  /logs?file=&lines=200  (file optional; back-compat default: fabmesh + error)
GET  /logs/list
POST /logs/clear  {file}
POST /logs/append  {file, line | content}
POST /logs/rotate  {file}
GET  /logs/stream?file=fabmesh  (Server-Sent Events live tail)
GET  /console
GET  /ipc/methods  (list every window.meshyAPI.* method)
POST /ipc  {method, args?: [...] | arg?: ...}  generic IPC dispatch
POST /click  {selector}
POST /eval  {code}  (JS dans la page ; window.state, window.meshyAPI)
GET  /ui/catalog?q=&zone=&all=1&limit=  catalogue des controles (ref, label, zone, valeur, options)
POST /ui/click  {target, wait?}  target = id | #id | @ref | selecteur | {text, within?} ; deplie la carte
POST /ui/fill  {fields: {cible: valeur, ...}}  champs, cases, listes (valeur ou libelle)
GET  /ui/modal  modales ouvertes : titre, texte, champs, boutons
POST /ui/wait  {target?, gone?, enabled?, modal?, noModal?, toast?, since?, text?, jobsDone?, timeout?}
GET  /ui/toasts?since=  notifications affichees (type, texte)
POST /ui/mouse  {target, path?: [[fx,fy],...], pixels?, button?, double?, move?, modifiers?, steps?, delay?, hold?}
POST /ui/wheel  {target, deltaY, fx?, fy?}  molette (zoom des vues 3D)
POST /ui/key  {key | keys: [...] | text, modifiers?: [control, shift, alt]}
GET  /ui/shot?target=&file=  capture PNG d un element (ou de la fenetre) vers un fichier
POST /dialog/next  {open?: [chemins], save?: chemin, message?: indexBouton}  reponses aux prochains dialogues natifs
GET  /dialog/state  file d attente + derniers dialogues ouverts (et qui y a repondu)
POST /dialog/clear
POST /set  {selector, value}
POST /select-project  {name}
POST /generate-image  {prompt, engine, count, steps}
POST /generate-3d  {imageIndex, engine}
POST /auto-rig  {}
GET  /jobs
GET  /wait-job?id=xxx&timeout=300
GET  /popups
POST /dismiss-popup  {id?}
GET  /last-error
GET  /devtools-open
POST /calib/run  run full auto-diagnose (SF3D + z123 + projection)
GET  /calib/list-reports
GET  /calib/last-report
GET  /calib/report?name=...
GET  /calib/log?lines=500  tail logs/fabmesh.log filtered by [calib]
POST /calib/build-rubiks  rebuild the Rubik's calibration reference
```

## 2. Fonctions IPC — `POST /ipc {"method": "<nom>", "args": [...]}` (176)

Signature = arguments du preload ; description = commentaire au-dessus du gestionnaire dans le processus principal.

### Projets, fichiers, versions (42)

| methode | args | canal | description |
|---|---|---|---|
| `animExport` | opts | `anim:export` | --------------------------------------------------------------------------- anim:export â€” GLB pass-through, FBX/USD via Blender --------------------------------------------------------------------------- |
| `animMotionThumb` | opts | `anim:motion-thumb` | --------------------------------------------------------------------------- anim:motion-thumb â€” lazy-render a small loop preview if missing --------------------------------------------------------------------------- |
| `checkProjectNsfw` | opts | `check-project-nsfw` | Instant NSFW check: look for .nsfw tag files in a project's image folder. Returns true if ANY image in the folder has a .nsfw sidecar file. This is O(1) per project (just readdir + filter), no Python, no AI model. |
| `cloudHistoryExport` | — | `cloud-history-export` | — |
| `copyMeshToProject` | srcPath | `copy-mesh-to-project` | — |
| `createProjectFromMesh` | opts | `create-project-from-mesh` | — |
| `creerProjetVide` | opts | `projet-vide:creer` | — |
| `deleteFile` | filePath | `delete-file` | — |
| `deleteImageFolder` | folderPath | `delete-image-folder` | — |
| `deleteMesh` | filename | `delete-mesh` | — |
| `deleteProject` | opts | `delete-project` | — |
| `duplicateImageVersion` | opts | `duplicate-image-version` | Duplicate an image into a new version (same project dir, suffix + timestamp). Used by Multi-Views button so the original image stays untouched while the new version receives the 6-view dir + any subsequent view edits. |
| `exportDiagnostics` | — | `export-diagnostics` | One-click diagnostics export: bundles the logs + system info into a single .txt on the user's Desktop so they (or a friend testing the app) can send it to support without hunting through %APPDATA%. |
| `exportImage` | opts | `export-image` | Export an image to a user-picked location. Copies the source file as-is (no transcoding) so layers/alpha are preserved. Returns the written path or null if the user cancelled. |
| `exportMesh` | opts | `export-mesh` | — |
| `exportToUnreal` | opts | `export-to-unreal` | Export mesh to Unreal-friendly FBX (cm scale, Y-up axis) |
| `getFileInfo` | filePath | `get-file-info` | Get basic file info (size, mtime, dimensions for images, tris for meshes) |
| `getLineageMeta` | filePath | `get-lineage-meta` | Lineage sidecar reader (Generation History popup) — renvoie le .meta.json parsé de n'importe quel artefact (image/mesh/rig/anim), ou null. |
| `getProjectDisplayNames` | — | `get-project-display-names` | — |
| `getThumbnail` | meshPath | `get-thumbnail` | — |
| `getVersions` | name | `get-versions` | --- Version history handlers --- |
| `importDroppedFile` | args | `import-dropped-file` | - dropped on the projects grid (no projectName) -> CREATE a new project holding the dropped element. - dropped inside an open project (projectName + intoImageDir given) -> ADD a new VERSION of that element to the right s |
| `importImage` | — | `import-image` | — |
| `importImageFile` | filePath | `import-image-file` | Import an image file (drag&drop or picker) into the images folder |
| `importMesh` | — | `import-mesh` | — |
| `listerProjetsVides` | — | `projet-vide:lister` | — |
| `listImageFolders` | — | `list-image-folders` | — |
| `listImageVersions` | imagePath | `list-image-versions` | — |
| `listMeshes` | — | `list-meshes` | — |
| `listProjects` | — | `list-projects` | — |
| `logToFile` | line | `renderer-log` (send) | IPC: read the last N lines of the log file (for an in-app log viewer later) Renderer -> file log passthrough for debug instrumentation |
| `openImagesFolder` | — | `open-images-folder` | — |
| `openLogsFolder` | — | `open-logs-folder` | IPC: open the logs folder in the OS file explorer |
| `openMeshesFolder` | — | `open-meshes-folder` | — |
| `pickExportPath` | opts | `pick-export-path` | Ask the user where to save an exported mesh (returns full file path or null) |
| `readMeshFile` | filePath | `read-mesh-file` | — |
| `renameProject` | args | `rename-project` | Project rename = a DISPLAY-NAME override (stored in config), not a file rename. Renaming the image folder + every mesh/rig/animation filename would be error-prone (meshProject() parsing, animation rigStem links), so we k |
| `renameProjectFiles` | args | `rename-project-files` | — |
| `revertToVersion` | opts | `revert-to-version` | — |
| `saveBuffer` | opts | `save-buffer` | --- Save Buffer IPC (for GLTFExporter output) --- |
| `saveEmissiveFile` | opts | `save-emissive-file` | Save the emissive mask of an image as a real file in the project folder, in an `_emissive/` subfolder so it never shows up as a gallery version. This makes the emissive map a persistent asset (the 3D pipeline / export ca |
| `saveThumbnail` | opts | `save-thumbnail` | — |

### Cloud, compte, credits (15)

| methode | args | canal | description |
|---|---|---|---|
| `cloudDownloadItem` | opts | `cloud-download-item` | — |
| `cloudHistoryDetail` | id | `cloud-history-detail` | — |
| `cloudHistoryList` | — | `cloud-history-list` | — |
| `cloudListLibrary` | — | `cloud-list-library` | — |
| `cloudListMarket` | — | `cloud-list-market` | — |
| `cloudLogin` | opts | `cloud-login` | — |
| `cloudLogout` | — | `cloud-logout` | — |
| `cloudPrewarm` | opts | `cloud-prewarm` | — |
| `cloudPricing` | opts | `cloud-pricing` | — |
| `cloudRecover` | opts | `cloud-recover` | — |
| `cloudReportContent` | opts | `cloud-report-content` | renderer Electron n'est pas celle du worker. Un appel direct echouait donc systematiquement et retombait sur le repli courriel — exactement ce qu'on ne veut pas, puisque le signalement doit atterrir dans la messagerie de |
| `cloudShareAsset` | opts | `cloud-share-asset` | — |
| `cloudSignup` | opts | `cloud-signup` | Inscription DANS l'application : plus aucun aller-retour par le navigateur. |
| `cloudStatus` | — | `cloud-status` | — |
| `cloudVerifySignup` | opts | `cloud-verify-signup` | — |

### Animation (12)

| methode | args | canal | description |
|---|---|---|---|
| `animateAI` | opts | `animate-ai` | AnyTop animation on a rigged GLB (desktop side). Spawns scripts/anytop_bridge.py via Python and writes the animated GLB under the project's animations/ folder. |
| `animBanque` | opts | `anim:banque` | — |
| `animBanqueListe` | — | `anim:banque-liste` | — |
| `animCancel` | opts | `anim:cancel` | --------------------------------------------------------------------------- anim:cancel â€” SIGTERM an in-flight job --------------------------------------------------------------------------- |
| `animCostEstimate` | opts | `anim:cost-estimate` | --------------------------------------------------------------------------- anim:cost-estimate â€” used by the UI cloud cost badge --------------------------------------------------------------------------- |
| `animJudge` | opts | `anim:judge` | — |
| `animKimodo` | opts | `anim:kimodo` | --------------------------------------------------------------------------- anim:kimodo — generative motion AI (text -> motion), humanoid rigs only ------------------------------------------------------------------------ |
| `animListMotions` | opts | `anim:list-motions` | --------------------------------------------------------------------------- anim:list-motions â€” return motions filtered by detected class --------------------------------------------------------------------------- |
| `animMotion` | opts | `anim:motion` | --------------------------------------------------------------------------- anim:motion — clips du moteur d'animation EN LIGNE (parite web, 2026-09-28) POST /api/animate + sondage /api/animate-status, QUEL QUE SOIT le mo |
| `animRetarget` | opts | `anim:retarget` | --------------------------------------------------------------------------- anim:retarget â€” main work, local or cloud --------------------------------------------------------------------------- |
| `listAnimations` | — | `list-animations` | 2026-06-13: list everything in meshes/animated/ so the renderer can rebuild p.animations after a reload. Rokoko outputs land here as `${motionFbxStem}__${rigGlbStem}.glb`, so we can attribute each clip back to its source |
| `listRigAnimations` | opts | `list-rig-animations` | List animation FBX files for a given rig template (e.g. "orc_m1" → returns the absolute paths of every .fbx in scripts/rig_templates/animations/<name>/) |

### Rig et squelette (6)

| methode | args | canal | description |
|---|---|---|---|
| `analyzeSkeleton` | opts | `analyze-skeleton` | Analyze a SKM template's skeleton: returns the bones JSON (cached) |
| `autoRig` | opts | `auto-rig` | Auto-rigging: applies a skeleton template to a mesh and exports rigged FBX |
| `autoRigAI` | opts | `auto-rig-ai` | — |
| `listRigTemplates` | — | `list-rig-templates` | List available SKM templates (custom FBX) and generic templates from registry |
| `maskInpaint` | opts | `mask-inpaint` | Manual mask inpaint: user paints the mask in-app, we send it to SDXL |
| `readBonesJson` | name | `read-bones-json` | Read a target skeleton .bones.json template and return its bone count |

### Mesh 3D et textures (25)

| methode | args | canal | description |
|---|---|---|---|
| `alignTexture` | opts | `mesh:align-texture` | ============================================================ ALIGN TEXTURE — manual photo→mesh projection re-trigger. Calls texture_project.py directly with user-tweaked params from the Align Texture modal. Writes back t |
| `checkStages3dDir` | meshPath | `check-stages3d-dir` | Disk fallback: does a 3D construction-stages folder exist for a mesh? Lets the mesh stages bar re-appear after an app restart (association is otherwise in-memory only; the GLBs persist in MESHES_DIR/<stem>_stages3d/). |
| `checkStagesDir` | imagePath | `check-stages-dir` | Disk fallback: does a construction-stages folder already exist for an image? Lets the stages bar re-appear after a reload / image-version switch. |
| `detailSynth` | opts | `detail-synth` | — |
| `enhanceMeshTexture` | opts | `enhance-mesh-texture` | Texture variant: ControlNet-Tile re-texture (shape/geometry locked) — used by the Variante tool's "vary texture only" mode. Each seed = a different surface/texture. Enhance the FINAL mesh texture: Real-ESRGAN x2 on the b |
| `generateBuildStages` | opts | `generate-build-stages` | --- Construction Mode: 3 build stages --- |
| `generateConstructionStages` | opts | `generate-construction-stages` | — |
| `generateConstructionStages3d` | opts | `generate-construction-stages-3d` | 3D construction stages — fabricate REAL staged GLBs from a finished mesh (scripts/construction_stages_3d.py: sliced shell + timber frame + scaffold cage). Stages live in MESHES_DIR/<stem>_stages3d/ (subfolder → not picke |
| `generateExplode3d` | opts | `generate-explode-3d` | EXPLOSION / DESTRUCTION 3D — fracture the mesh into Voronoi shards and project them outward over N stages (navigable + exportable). Mirrors the construction stages handler: a NEW mesh version is created so the original s |
| `getMeshLocalUrl` | filePath | `get-mesh-local-url` | — |
| `getMeshPath` | filename | `get-mesh-path` | — |
| `imageTo3D` | opts | `image-to-3d` | --- Image-to-3D: TRELLIS-2 native (default). SF3D and TripoSR have been retired for non-commercial license; legacy requests for those engines are silently rerouted to trellis2_native. --- |
| `imageToTrellis` | opts | `image-to-3d-trellis` | — |
| `materialAdjust` | opts | `material-adjust` | — |
| `meshSegment` | opts | `mesh-segment` | ── SAMPart3D part segmentation (LOCAL, RTX 5080) ────────────────────── Splits the mesh into named, colored parts. Long GPU job (~6-10 min): streams progress on 'ai3d-progress' and returns a new MESH version (a segmented |
| `meshTool` | opts | `mesh-tool` | — |
| `nameParts` | opts | `name-parts` | Material adjust: wraps scripts/mesh_material_adjust.py for the Manual Tools > Material slider modal in the renderer. ── Nommage des parties (roue/chenille/tourelle — bras/jambe/tête) ────── Sur un mesh SEGMENTÉ (sous-mes |
| `reconfigureFabmesh` | — | `wizard:reset-setup` | — |
| `refineMesh` | opts | `refine-mesh` | --- Refine existing mesh --- |
| `regionRetex` | opts | `mesh:region-retex` | — |
| `renderMeshFront` | opts | `mesh:render-front` | --- Mesh Tools IPC --- AI region re-texture (MVP modif-mesh): render the mesh front so the user can draw a mask aligned to face_inpaint_atlas.py's projection, then re-texture the painted region with a prompt (generalises |
| `reshapeRegion` | opts | `mesh:reshape-region` | — |
| `resizeMesh` | opts | `mesh-resize` | RESIZE / DIMENSION — bake an orientation (quaternion, optional, 2026-09-28) and a per-axis scale into a new mesh version (texture preserved). Driven by the interactive gizmo/ruler tool in the renderer. |
| `segmentMask` | opts | `segment-mask` | Auto-inpaint: CLIPSeg segments target area + SDXL Inpainting replaces it Live mask preview for Auto Inpaint: run CLIPSeg detection ONLY (no inpaint) and return a red-overlay image so the user sees what will be repainted |
| `uninstallFabmesh` | opts | `app:uninstall` | Launch the NSIS uninstaller (from the app or from dev — resolved via the exe folder or the Windows registry). The uninstaller itself asks whether to also delete models/generated content/settings. |

### Images (22)

| methode | args | canal | description |
|---|---|---|---|
| `autoInpaint` | opts | `auto-inpaint` | — |
| `batchCheckNsfw` | opts | `batch-check-nsfw` | Batch scan multiple images for NSFW in one Python process (loads model once). Paths are passed via a temp file to avoid Windows backslash escaping issues. |
| `captionImage` | opts | `caption-image` | ============================================================ CAPTION IMAGE — BLIP describes the front photo (clothes, hair, etc.) for back-view prompt enrichment. Output is added to the back-view promptHint so SDXL+IPAda |
| `checkImageNsfw` | opts | `check-image-nsfw` | Scan an image file for NSFW content using Falconsai/nsfw_image_detection (ViT). Falls back to skin-ratio heuristic if the model isn't available. Returns { nsfw: true/false, score: 0.XX } |
| `checkImagesNsfwTags` | opts | `check-images-nsfw-tags` | Return which images in a list have .nsfw tag files (instant, no AI) |
| `checkMultiviewDir` | imagePath | `check-multiview-dir` | --- Multi-View Generation IPC --- Check whether a given image already has `<stem>_multiview/` on disk with all 6 views + input. Used by the renderer to re-hydrate the multi-view bar after reloadCurrentProject() clears it |
| `generateBackView` | opts | `generate-back-view` | ============================================================ GENERATE BACK VIEW — RealVis XL + IPAdapter, replaces Z123 for the 2-view texturing pipeline. Produces a photoreal back view of the same subject, conditioned o |
| `generateFromImage` | opts | `generate-from-image` | --- TRELLIS Image-to-3D via Hugging Face --- |
| `generateFromPrompt` | opts | `generate-from-prompt` | — |
| `generateImages` | opts | `generate-images` | — |
| `generateMultiview` | opts | `generate-multiview` | — |
| `getNsfwKeywords` | — | `get-nsfw-keywords` | — |
| `i18nAutoTranslate` | opts | `i18n-auto-translate` | Runtime UI auto-translate: EN -> target language for any string the dicts miss. Used by i18n.js to fill gaps live (cached so each string is translated once). |
| `imageAdjust` | opts | `image-adjust` | Image adjustments (auto_levels, auto_contrast) |
| `imageQuickEdit` | opts | `image-quick-edit` | Quick image edits: symmetrize, upscale, brightness, crop, etc. All done via a single Python one-liner using PIL — fast, no GPU needed. |
| `img2img` | opts | `img2img` | Img2img: local SDXL by default, or cloud Pollinations if explicitly chosen |
| `outfitCutout` | opts | `outfit-cutout` | Habits seuls — extrait les vetements d'une image de personnage. Sortie MULTIPLE (une image par piece), contrairement aux autres outils image : le handler rend { success, pieces:[{nom,chemin,aire,complete}], absentes:[... |
| `recolor` | opts | `recolor` | Recolor: auto-detect a part (CLIPSeg) and recolor ONLY it, shape preserved. |
| `removeBackground` | imagePath | `remove-background` | — |
| `revertImage` | opts | `revert-image` | — |
| `saveImageDataUrl` | opts | `save-image-data-url` | Save a PNG dataUrl as a new versioned image next to basePath |
| `translatePrompt` | opts | `translate-prompt` | — |

### Systeme, GPU, reglages, journaux (54)

| methode | args | canal | description |
|---|---|---|---|
| `calibCancel` | — | `calib-cancel` | — |
| `calibClearLog` | — | `calib-clear-log` | No separate calib log to clear — fabmesh.log rotation handles size. The 'clear' button in the UI now just refreshes the filtered view. |
| `calibDiagnose` | opts | `calib-diagnose` | — |
| `calibLastReport` | — | `calib-last-report` | — |
| `calibListReports` | — | `calib-list-reports` | List every report dir with score.json — fed into the in-app gallery. |
| `calibOpenReport` | opts | `calib-open-report` | — |
| `calibReadLog` | opts | `calib-read-log` | — |
| `calibRun` | opts | `calib-run` | IPC: calibration pipeline |
| `calibTiered` | — | `calib-tiered` | calib-tiered and calib-diagnose IPC handlers removed in 2026-05-18 legal cleanup — their Python scripts (_calib_tiered.py, _calib_diagnose.py) were never in the repo, so the handlers had no implementation. calib-v3 above |
| `calibV3` | opts = {} | `calib-v3` | — |
| `cancelJob` | jobId | `cancel-job` | — |
| `checkClaudeDesktop` | — | `check-claude-desktop` | — |
| `checkForUpdate` | — | `app:check-for-update` | Auto-update IPC for the renderer. |
| `checkGPU` | — | `check-gpu` | Check GPU status |
| `checkRAM` | — | `check-ram` | Check system RAM stats |
| `confirmAppClose` | opts | `app-close-confirmed` (send) | — |
| `connectClaudeDesktop` | — | `connect-claude-desktop` | Connect FabMesh to Claude Desktop by writing the MCP server config into Claude Desktop's settings file (%APPDATA%\Claude\claude_desktop_config.json). This is a one-click operation: the user clicks "Connect to Claude Desk |
| `countPython` | — | `count-python` | IPC: count python.exe subprocesses currently running (excluding the SDXL server) |
| `disconnectClaudeDesktop` | — | `disconnect-claude-desktop` | — |
| `downloadToTemp` | url | `download-to-temp` | Download an image dragged from a web page (no local file path) to a temp file so the normal import flow can handle it. Follows redirects, picks the extension from the content-type, and refuses non-image responses. |
| `flashTaskbar` | — | `flash-taskbar` | Flash taskbar when generation completes |
| `getConfig` | — | `get-config` | — |
| `getControlApiToken` | — | `get-control-api-token` | Return the Control API Bearer token so the renderer's live-logs viewer can open an authenticated EventSource to /logs/stream. |
| `getCrashReports` | — | `app:get-crash-reports` | Crash-reporting opt-out — the setting the privacy policy has always promised. Reading it never touches Sentry; writing it takes effect immediately for JS errors (beforeSend returns null) and, from the next launch, preven |
| `getParentalStatus` | — | `get-parental-status` | — |
| `gpuStatus` | — | `gpu-status` | — |
| `hidreamAvailable` | — | `hidream-available` | Whether HiDream-O1 (the 2nd image engine) can run on THIS machine: it needs a CUDA GPU with enough VRAM (FP8 peaks ~11 GB → require ~12 GB) AND the isolated HiDream runtime present. The renderer uses this to hide the HiD |
| `installUpdateNow` | — | `app:install-update-now` | — |
| `isStoreBuild` | — | `app:is-store-build` | Le rendu en a besoin pour ne PAS afficher un dispositif que le paquet du Store refuse de toute facon (cadenas de la barre du haut, section « Parental Control » des Reglages). |
| `jobsKillAll` | — | `jobs:kill-all` | — |
| `jobsRunningCount` | — | `jobs:running-count` | The quit-confirm dialog must count only real GENERATION jobs (activeProcs, keyed by jobId) — NOT persistent helpers (SDXL server, MCP bridge, etc.) which live in allActiveProcs. Counting helpers popped the "jobs running" |
| `killProcess` | pid | `kill-process` | — |
| `listProcesses` | — | `list-processes` | — |
| `loadLandmarks` | opts | `load-landmarks` | — |
| `openInBlender` | opts | `open-in-blender` | Open a mesh file in Blender (foreground GUI). Used by the workspace "Open in Blender" / "Edit in Blender" buttons. |
| `openMailto` | url | `app:open-mailto` | — |
| `openWebsite` | — | `app:open-website` | Opens the MyFabmesh.AI website in the user's default browser. Called when the user clicks the brand in the main app header. |
| `readLogTail` | opts | `read-log-tail` | — |
| `rendererLog` | opts | `renderer-log` | IPC: read the last N lines of the log file (for an in-app log viewer later) Renderer -> file log passthrough for debug instrumentation |
| `runBlenderScript` | opts | `run-blender-script` | — |
| `saveLandmarks` | opts | `save-landmarks` | Save / load rig landmarks (per-mesh JSON file) |
| `saveScreenshot` | opts | `save-screenshot` | --- Save screenshot from renderer --- |
| `setBlenderPath` | — | `set-blender-path` | — |
| `setComputeMode` | m | `compute-mode` (send) | — |
| `setConfig` | patch | `set-config` | Patch-merge into config.json. Only whitelisted fields are accepted to avoid the renderer corrupting arbitrary keys. |
| `setCrashReports` | on | `app:set-crash-reports` | — |
| `setGpuLimits` | limits | `set-gpu-limits` | We do THREE things so the throttle reacts for new AND running processes: 1. process.env.FABMESH_GPU_LIMIT / FABMESH_TEMP_LIMIT / FABMESH_VRAM_FRACTION → inherited by new children subprocesses 2. scripts/.gpu_limit.json → |
| `setRamLimit` | pct | `set-ram-limit` | Priority: MB cap from RAM slider (FABMESH_RAM_LIMIT_MB, populated by |
| `setSpellcheckLang` | lang | `set-spellcheck-lang` | — |
| `showInExplorer` | filePath | `show-in-explorer` | — |
| `showNotification` | opts | `show-notification` | — |
| `stopSdxlServer` | — | `stop-sdxl-server` | — |
| `texVariant` | opts | `tex-variant` | — |
| `toggleUnrestricted` | opts | `toggle-unrestricted` | — |

### Evenements (abonnements, lecture seule) (15)

`onUpdateAvailable` (update-available), `onUpdateDownloaded` (update-downloaded), `onUpdateProgress` (update-progress), `onAI3DProgress` (ai3d-progress), `onBuildStageProgress` (build-stage-progress), `onMcpJobStart` (mcp-job-start), `onMcpJobEnd` (mcp-job-end), `onMcpRefresh` (mcp-refresh), `onConstructionStageProgress` (construction-stage-progress), `onAppCloseRequested` (app-close-requested), `onCalibProgress` (calib-progress), `onMainLog` (main-log), `onJobsResumed` (jobs-resumed), `onJobPidExited` (job-pid-exited), `onAnimProgress` (anim:progress)

## 3. Controles de l'interface (578) — `POST /ui/click`, `POST /ui/fill`

Source : catalogue de l'appli en marche (GET /ui/catalog?all=1). Seuls les elements a **id** stable sont listes ; `GET /ui/catalog` donne en plus
les elements dynamiques (vignettes, cartes) avec une reference `@rN` valable jusqu'au prochain rendu.

### page:page-projects (5)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#project-search` | input:text | 🔍 Search projects... |
| `#btn-select-all` | button | ☐ Select all — Select all visible projects |
| `#btn-new-project` | button | + New project |
| `#btn-import-image` | button | 📦 Import |
| `#btn-cloud-library` | button | ☁ Cloud library |

### etape:step-card-animation (15)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#ws-anim-apercu` | canvas |  |
| `#ws-anim-choix` | select:select-one [idle=😴 Idle, walk=🚶 Walk, run=🏃 Run, turn_left=↰ Turn left, turn_right=↱ Turn right, attack=⚔️ Attack, death=💀 Death, fly=✈️ Fly] | Animation |
| `#ws-anim-variante` | select:select-one [normal=Normal, slow=Slow, brisk=Brisk, sneak=Sneaky, proud=Proud, crawl=Crawl, *=All variants] | Variant |
| `#ws-anim-ajouter` | button | ＋ Add to the list — Add to the list |
| `#ws-generate-anim` | button | Generate Animation |
| `#ws-anim-source-canvas` | canvas |  |
| `#ws-anim-result-canvas` | canvas |  |
| `#ws-anim-expand-btn` | button | View animation fullscreen |
| `#ws-anim-scrub` | input:range | Scrub frame by frame |
| `#ws-anim-export-btn` | button | 📥 Export FBX |
| `#ws-anim-folder-btn` | button | 📁 Show in folder — Show this file in the file explorer. |
| `#ws-anim-play-btn` | button | ❚❚ Pause — Play the animation. |
| `#ws-anim-loop-btn` | button | 🔁 Loop — Loop playback. |
| `#ws-anim-inplace-btn` | button | 📌 In place — In place: the animation stays on the spot (no travel). The exported file follows this setting. |
| `#ws-anim-bones-btn` | button | 🦴 Bones — Show skeleton |

### etape:step-card-image (47)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#ws-compute-local` | button | Local (free) — Generate on this PC (NVIDIA GPU required) — free and unlimited |
| `#ws-compute-cloud` | button | Cloud (credits) — Generate on MyFabmesh cloud — works on any PC, uses credits |
| `#ws-engine` | select:select-one [local-flux=Balanced (quality/speed), hidream=Max quality (HD · slower), local-lightning=Fast (Turbo ⚡ · ~4 steps)] |  |
| `#ws-asset-type` | select:select-one [character=Character / Unit, creature=Creature / Beast, animal=Animal, insect=Insect / Bug, other_living=Other living thing, vehicle=Vehicle, avion=Plane, bateau=Boat, …] |  |
| `#ws-asset-style` | select:select-one [realistic=Realistic, pbr=PBR (high detail), stylized=Stylized (mid-poly), stylized-pbr=Stylized PBR, hand-painted=Hand-painted, cartoon=Cartoon, anime=Anime, painterly=Painterly, …] |  |
| `#ws-copy-prompt` | button | 📋 Copy — Copy prompt to clipboard |
| `#ws-enhance-prompt` | button | ✨ Enhance — Enhance the prompt with style and quality keywords |
| `#ws-prompt` | textarea:textarea | An orc warrior with leather armor... |
| `#ws-count` | select:select-one [1, 2, 4, 6] |  |
| `#ws-quality` | input:range |  |
| `#ws-img-buildstages` | input:checkbox | Construction stages (3 progressive versions) |
| `#ws-mv-mode-select` | select:select-one [2view] |  |
| `#ws-mv-6v-harmonize` | input:checkbox |  |
| `#ws-mv-6v-upscale` | input:checkbox |  |
| `#ws-auto-multiview` | input:checkbox |  |
| `#ws-generate-image` | button | Generate — Generate new reference images from your prompt. Existing versions are kept. |
| `#ws-image-expand-btn` | button | View image fullscreen |
| `#ws-img-prev` | button | Previous version |
| `#ws-img-next` | button | Next version |
| `#ws-copy-prompt-btn` | button | 📋 Copy prompt — Copy the prompt used to generate this image |
| `#ws-report-img-inline-btn` | button | ⚑ Report — Report inappropriate AI-generated content |
| `#ws-use-for-3d-btn` | button | Use this image for 3D → — Select this image as the source for 3D generation. |
| `#ws-export-img-btn` | button | 💾 Export image — Save this image to disk. |
| `#ws-cloud-share-img-btn` | button | ☁ Send to cloud — Send this image to your MyFabmesh web library |
| `#ws-modify-btn` | button | ✎ Modify — Rewrite the whole image from a prompt. Shape and framing may change. |
| `#ws-autoinpaint-btn` | button | 🪄 Auto Inpaint — Describe a zone in words; only that zone is found and repainted. |
| `#ws-removebg-btn` | button | ✂ Remove BG — Cut the subject out and make the background transparent. |
| `#ws-resolution-btn` | button | 🔬 Resolution — Enlarge the image. Recovers detail, invents nothing. |
| `#ws-style-btn` | button | 🎨 Style... ▾ — Repaint the image in a chosen style, keeping the subject. |
| `#ws-facefix-btn` | button | 😶 Face Fix — Detect the face and repaint it sharper. Best on portraits. |
| `#ws-outfit-btn` | button | 👗 Outfits — Extracts each piece of clothing on a transparent background (characters) |
| `#ws-symmetrize-auto-btn` | button | ⇋ Sym. Auto — Mirror the left half onto the right half, to make the subject symmetrical. |
| `#ws-multiview-btn` | button | 👁 Multi-Views — Generate 6 orthographic views from this image. |
| `#ws-buildstages-btn` | button | 🏗️ Construction stages — Builds a construction timeline (scaffolding → finished building) from the final image, shown like the multi-views |
| `#ws-variant-btn` | button | ✨ Variant — Create variants of the current image — re-roll seed or img2img with controlled strength |
| `#ws-recolor-btn` | button | 🎨 Recolor — Finds a part automatically and recolours it, keeping its shape (e.g. a red cape) |
| `#ws-age-btn` | button | ⏳ Age — Make the subject younger or older — keeps the shape, changes the apparent age |
| `#ws-clone-btn` | button | 📋 Clone Stamp — Copy pixels from one area onto another with a brush. |
| `#ws-mask-btn` | button | ✏ Draw Mask — Paint a zone by hand, then have just that zone repainted. |
| `#ws-crop-btn` | button | ✂ Crop — Trim the image. Removes pixels, adds none. |
| `#ws-select-btn` | button | ▣ Cut/Paste — Cut / copy a rectangular zone and move it elsewhere on the image |
| `#ws-extend-btn` | button | ⧈ Extend — Extend / outpaint — add margin around the image and fill it |
| `#ws-brightness-btn` | button | ☀ Brightness — Adjust brightness, contrast, saturation and sharpness. |
| `#ws-picker-btn` | button | 💧 Color Pick — Pick a colour from the image. |
| `#ws-blur-btn` | button | 💨 Blur Brush — Blur or sharpen locally with a brush. |
| `#ws-symmetrize-btn` | button | ⇋ Symmetrize — Mirror one half of the image onto the other, axis chosen by hand. |
| `#ws-paint-btn` | button | 🎨 Paint — Paint directly on the image with a brush. |

### etape:step-card-mesh (52)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#ws-3d-engine` | select:select-one [trellis2_native=MyFabmesh.AI 3D Native (mesh + PBR in on] |  |
| `#ws-3d-quality` | select:select-one [draft=512 px, standard=1024 px, high=2048 px (max)] |  |
| `#ws-3d-triangles` | select:select-one [500=500 (ultra low-poly), 1000=1K (low-poly stylized), 3000=3K (mobile game), 5000=5K (mobile HD), 0=~23K (native, best texture), 20k=~20K, 30k=~30K, 1=~50K (indie game), …] |  |
| `#ws-3d-buildstages` | input:checkbox | Construction stages (3 versions) |
| `#ws-3d-auto` | input:checkbox | Auto settings |
| `#ws-trellis2-preset` | select:select-one [fast=Fast (12 steps · 2048px), balanced=Balanced (24 steps · 2048px), quality=Quality (32 steps · 4096px), ultra_8k=Ultra 8K (32 steps · 4096→8192px)] |  |
| `#ws-trellis2-tris` | select:select-one [50000=50 K (crowds, mobile), 100000=100 K (game units), 250000=250 K, 500000=500 K (default), 1000000=1 M, 2000000=2 M, 3000000=3 M (ultra detailed), 10000000=10 M (maximum · very large file, ~400 MB, …] | Max triangles |
| `#ws-trellis2-tris-custom` | input:number | 5 000 to 10 000 000 triangles — unused credits are refunded if the mesh has fewer |
| `#ws-trellis2-multiref` | input:checkbox | Multi-reference |
| `#ws-trellis2-refine` | input:checkbox | Detail refine |
| `#ws-trellis2-rectify` | input:checkbox | Auto-rectify |
| `#ws-trellis2-smooth` | input:checkbox | Texture smooth |
| `#ws-trellis2-quality-plus` | input:checkbox | Sharp edges |
| `#ws-trellis2-ultra-q` | input:checkbox | Fine geometry |
| `#ws-trellis2-ultra-hd` | input:checkbox |  |
| `#ws-trellis2-face-fix` | input:checkbox | Face fix |
| `#ws-generate-mesh` | button | Generate 3D — Build a 3D mesh from the selected image. Quality and options are set just above. |
| `#ws-3d-source-back-clear` | button | Remove back photo — Drop the back photo — generation returns to single-view. |
| `#ws-mesh-canvas` | canvas |  |
| `#ws-mesh-expand-btn` | button | View 3D fullscreen |
| `#ws-report-mesh-btn` | button | ⚑ Report — Report inappropriate AI-generated content |
| `#ws-use-for-rig-btn` | button | Use this mesh for Rig → — Select this mesh as the source for rigging. |
| `#ws-mesh-export-btn` | button | 💾 Export... — Export the mesh (GLB, FBX, OBJ...). The original version is kept. |
| `#ws-mesh-blender-btn` | button | 🪨 Open in Blender |
| `#ws-mesh-folder-btn` | button | 📁 Show in folder — Show this file in the file explorer. |
| `#ws-cloud-share-mesh-btn` | button | ☁ Send to cloud — Send this mesh (GLB ≤50 MB) to your MyFabmesh web library |
| `#ws-mesh-smooth-btn` | button | ✨ Smooth — Soften the surface. Removes faceting, also removes fine detail. |
| `#ws-mesh-decimate-btn` | button | ▼ Triangle count — Reduce the mesh triangle count |
| `#ws-mesh-subdivide-btn` | button | ▲ Subdivide — Split each triangle to gain definition. The shape does not change. |
| `#ws-mesh-fixnormals-btn` | button | ↺ Fix Normals — Re-orient the faces. Fixes surfaces that look black or see-through. |
| `#ws-mesh-fillholes-btn` | button | ◉ Fill Holes — Stitch open boundary loops shut (texture-aware) |
| `#ws-mesh-watertight-btn` | button | 💧 Watertight — Rebuild a closed watertight shell (voxel remesh) — fuses all parts, removes texture (re-texture after) |
| `#ws-mesh-center-btn` | button | ◎ Set Pivot — Move the pivot point. Nothing else changes. |
| `#ws-mesh-retexture-btn` | button | 🔬 Re-bake from photo (HD) — Re-bake the WHOLE texture from the source photo at a chosen resolution (reprojects the photo onto the UVs) |
| `#ws-mesh-texvar-btn` | button | 🎨 Texture variants — Generate DIFFERENT texture looks (geometry untouched) — change the seed for a new variant |
| `#ws-mesh-enhance-tex-btn` | button | ✨ Sharpen texture (x2) — Sharpen / upscale the EXISTING baked texture (x2, no hallucination) — no re-generation |
| `#ws-mesh-detail-synth-btn` | button | ✨ Detail++ — Adds real detail to the texture |
| `#ws-mesh-trellis2-btn` | button | ⭐ Re-texture all — Re-paint the WHOLE texture with the 3D Native PBR engine (best quality) |
| `#ws-mesh-region-retex-btn` | button | 🎨 Re-texture a region — Re-texture only ONE part (detected automatically) with a prompt — geometry stays intact |
| `#ws-mesh-reshape-btn` | button | 🧬 Reshape a region — Rebuild ONE part of the model in 3D from a prompt (for example, replace the head). Runs on your graphics card. |
| `#ws-mesh-reshape-draw-btn` | button | 🖌 Reshape (draw) — Paint the part to rebuild straight on the 3D model, then describe what should replace it. Runs on your graphics card. |
| `#ws-mesh-segment-btn` | button | ✂ Segment parts — Split the mesh into semantic parts (head/torso/arms/legs — wheel/chassis/cabin). Runs locally, ~6-10 min. Adds a colored |
| `#ws-mesh-name-btn` | button | 🏷 Name the zones — Name the parts (wheel / turret / cannon — arm / leg / head). Requires a segmented mesh. |
| `#ws-mesh-explode-btn` | button | 💥 Explode / destroy — Fracture the mesh into shards and blast them outward over navigable stages (explosion / destruction). Texture preserved, |
| `#ws-mesh-sculpt-btn` | button | ✍ Sculpt — Reshape the surface by hand with a brush. |
| `#ws-mesh-paintvert-btn` | button | 🎨 Paint — Paint directly on the mesh. |
| `#ws-mesh-selectface-btn` | button | ▢ Select — Select faces to isolate, hide or work on them. |
| `#ws-mesh-clone3d-btn` | button | 🩹 Clone stamp — Clone one area of the texture onto another, directly on the model |
| `#ws-mesh-stages3d-btn` | button | 🏗️ 3D construction stages — Fabricate the 3D meshes of the construction stages (sliced building + frame + scaffolding), navigable and exportable |
| `#ws-mesh-resize-btn` | button | 📏 Resize / dimension — Resize, dimension or re-orient the mesh with a gizmo and on-screen rulers. Bakes a new version. |
| `#ws-mesh-aligntex-btn` | button | 🎯 Align Texture — Manually align source photos onto mesh |
| `#ws-mesh-material-btn` | button | ✨ Material adjust — Adjust material brightness, saturation, contrast, emissive, metallic, roughness |

### etape:step-card-rig (15)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#ws-rig-engine` | select:select-one [skintokens=MyFabmesh.AI Rig] |  |
| `#ws-rig-skeleton` | select:select-one [orc_m1=🤖 Biped humanoid (117 bones), ue5_mannequin=🤖 UE5 Mannequin std (161 bones), zebra=🐎 Equine quadruped (35 bones), lion=🦁 Feline quadruped (39 bones), wolf=🐺 Canine quadruped (34 bones), crocodile=🐊 Quadruped reptile (38 bones), elephant=🐘 Pachyderm (48 bones), deer=🦌 Cervid (31 bones), …] | SKELETON |
| `#ws-generate-rig-ai` | button | Generate Rig — Add a skeleton to the mesh automatically, so it can be animated. |
| `#ws-rig-source-canvas` | canvas |  |
| `#ws-rig-anim-select` | select:select-one [=No animation] |  |
| `#ws-rig-anim-play` | button | ▶ Play — Play the animation. |
| `#ws-rig-canvas` | canvas |  |
| `#ws-rig-expand-btn` | button | View rig fullscreen |
| `#ws-use-for-anim-btn` | button | Use this rig for Animation → — Select this rig as the source for animation. |
| `#ws-rig-unreal-btn` | button | 🎮 Export to Unreal |
| `#ws-rig-blender-btn` | button | 🪨 Edit in Blender |
| `#ws-rig-folder-btn` | button | 📁 Show in folder — Show this file in the file explorer. |
| `#ws-rig-reskin-btn` | button | 🍆 Re-skin only — Recompute the skin weights only. The skeleton is kept. |
| `#ws-lm-manual` | button | ✏ Skeleton points — Move the points the skeleton must reach (foot tips, jaw, ears, tail), then re-generate the rig. |
| `#ws-rig-test-btn` | button | ▶ Test animation — Play a test motion to check the rig holds up. |

### modal:about-modal (9)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#about-close` | button | Close |
| `#about-check-update` | button | Check for updates |
| `#about-report-btn` | button | ⚑ Report AI content |
| `#about-link-site` | a | Website |
| `#about-link-github` | a | GitHub |
| `#about-link-faq` | a | FAQ |
| `#about-link-privacy` | a | Privacy policy |
| `#about-link-licenses` | a | Third-party licenses |
| `#about-link-eula` | a | License agreement |

### modal:clone-modal (13)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#clone-modal-close` | button | Close |
| `#clone-brush-size` | input:range | Brush: 50 |
| `#clone-hardness` | input:range | Hard: 50 |
| `#clone-flip-toggle` | button | Flip: Off — Flip mode |
| `#clone-source-toggle` | button | Source: Modified — Source = modified image (your edits are clonable). Click for Original. |
| `#clone-loupe-toggle` | button | Magnifier |
| `#clone-recenter` | button | Recenter image (fit to view) |
| `#clone-undo` | button | Undo (Z) |
| `#clone-redo` | button | Redo |
| `#clone-reset` | button | 🧹 Clear — Clear all paint |
| `#clone-canvas` | canvas |  |
| `#clone-cancel` | button | Cancel |
| `#clone-save` | button | Save as new version |

### modal:history-modal (2)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#history-export-btn` | button | ⬇ Export Excel |
| `#history-close-btn` | button | Close |

### modal:lightbox-2 (4)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#lightbox-2-close` | button | Close |
| `#lightbox-2-prev` | button | Previous (←) |
| `#lightbox-2-next` | button | Next (→) |
| `#lightbox-2-use-3d` | button | Use this image for 3D → |

### modal:lightbox-3d (7)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#lightbox-3d-close` | button | Close |
| `#lightbox-3d-prev` | button | Previous (←) |
| `#lightbox-3d-next` | button | Next (→) |
| `#lightbox-3d-canvas` | canvas |  |
| `#lightbox-3d-use` | button | Use this for next step → |
| `#lb3d-lm-btn` | button | Show landmarks |
| `#lb3d-bones-btn` | button | Bones — Show skeleton |

### modal:lm-fullscreen (12)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#lm-fs-close` | button | Close |
| `#lm-fs-canvas` | canvas |  |
| `#lm-fs-canvas-b` | canvas |  |
| `#pts-ajout-coller` | input:checkbox | Stick to the mesh |
| `#pts-ajout-centrer` | input:checkbox | Centre in the thickness |
| `#lm-fs-undo` | button | ↶ Undo — Undo (Ctrl+Z) |
| `#lm-fs-redo` | button | ↷ Redo — Redo (Ctrl+Y) |
| `#pts-reinit` | button | ↺ Reset — Back to the points of this rig |
| `#pts-ajouter` | button | ＋ Add point — Then click the mesh where the new point goes |
| `#pts-regenerer` | button | ⟳ Re-generate rig with these points — Rig the mesh again: the skeleton will reach every point |
| `#pts-enregistrer-sans-ia` | button | 💾 Save moved joints — Saves a new version of the rig with the pink joints where you put them. The mesh does not change. |
| `#pts-voir-os` | input:checkbox | Show bones |

### modal:mask-modal (14)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#mask-modal-close` | button | Close |
| `#mask-brush-size` | input:range | Brush: 50 |
| `#mask-loupe-toggle` | button | Magnifier |
| `#mask-brush-mode` | button | Paint mode (B) |
| `#mask-eraser-mode` | button | Eraser mode (E) — radius follows brush size |
| `#mask-recenter` | button | Recenter image (fit to view) |
| `#mask-undo` | button | Undo (Z) |
| `#mask-redo` | button | Redo |
| `#mask-clear` | button | Clear whole mask |
| `#mask-base-canvas` | canvas |  |
| `#mask-overlay-canvas` | canvas |  |
| `#mask-prompt` | input:text | Replace with: |
| `#mask-cancel` | button | Cancel |
| `#mask-apply` | button | Apply Inpaint |

### modal:modal-age (4)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#age-slider` | input:range |  |
| `#age-guide` | input:text | e.g. grey beard, smooth skin... (optional) |
| `#age-cancel` | button | Cancel |
| `#age-go` | button | Apply |

### modal:modal-align-texture (16)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#at-preview-canvas` | canvas |  |
| `#at-tx` | input:range |  |
| `#at-ty` | input:range |  |
| `#at-tz` | input:range |  |
| `#at-scale` | input:range |  |
| `#at-roty` | input:range |  |
| `#at-vis` | input:range |  |
| `#at-opacity` | input:range |  |
| `#at-project-live` | input:checkbox |  |
| `#at-show-overlay` | input:checkbox |  |
| `#at-autofit` | input:checkbox |  |
| `#at-framefix` | input:checkbox |  |
| `#at-skipvflip` | input:checkbox |  |
| `#at-reset` | button | Reset defaults |
| `#at-cancel` | button | Cancel |
| `#at-reproject` | button | 🎯 Re-project |

### modal:modal-auto-inpaint (6)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#ai-target` | input:text | hat, shirt, background, sword... |
| `#ai-replace` | input:text | leather helmet, plain background... |
| `#ai-precision` | input:range |  |
| `#ai-dilate` | input:range |  |
| `#ai-cancel` | button | Cancel |
| `#ai-go` | button | Apply |

### modal:modal-blur (12)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#blur-close-x` | button | Close |
| `#blur-brush-size` | input:range | Brush: 30 |
| `#blur-strength` | input:range | Strength: 5 |
| `#blur-mode-blur` | button | Blur |
| `#blur-mode-sharpen` | button | Sharpen |
| `#blur-loupe-toggle` | button | Magnifier |
| `#blur-undo` | button | Undo |
| `#blur-redo` | button | Redo |
| `#blur-reset` | button | Reset |
| `#blur-canvas` | canvas |  |
| `#blur-cancel` | button | Cancel |
| `#blur-save` | button | Save as new version |

### modal:modal-brightness (8)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#bright-close-x` | button | Close |
| `#bright-brightness` | input:range | Brightness 100% |
| `#bright-contrast` | input:range | Contrast 100% |
| `#bright-saturation` | input:range | Saturation 100% |
| `#bright-sharpness` | input:range | Sharpness 100% |
| `#bright-reset` | button | Reset |
| `#bright-cancel` | button | Cancel |
| `#bright-apply` | button | Apply |

### modal:modal-buildstages-options (3)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#bs-count` | input:range |  |
| `#bs-cancel` | button | Cancel |
| `#bs-start` | button | Generate |

### modal:modal-calib-diagnose (2)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#calib-diagnose-cancel` | button | ⏹️ Cancel |
| `#calib-diagnose-close` | button | Close |

### modal:modal-calib-gallery (2)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#calib-gallery-refresh` | button | ↻ Refresh |
| `#calib-gallery-close` | button | Close |

### modal:modal-calib-log (3)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#calib-log-lines` | input:number | lines: |
| `#calib-log-refresh` | button | ↻ Reload |
| `#calib-log-close` | button | Close |

### modal:modal-calib-report (1)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#calib-report-close` | button | Close |

### modal:modal-colorpick (4)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#cpick-close-x` | button | Close |
| `#cpick-canvas` | canvas |  |
| `#cpick-copy` | button | Copy HEX |
| `#cpick-close` | button | Close |

### modal:modal-confirm (2)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#confirm-cancel` | button | Cancel |
| `#confirm-ok` | button | Confirm |

### modal:modal-crop (10)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#crop-close-x` | button | Close |
| `#crop-preset-free` | button | Free |
| `#crop-preset-1-1` | button | 1:1 |
| `#crop-preset-4-3` | button | 4:3 |
| `#crop-preset-16-9` | button | 16:9 |
| `#crop-preset-center` | button | Auto center |
| `#crop-canvas` | canvas |  |
| `#crop-overlay` | canvas |  |
| `#crop-cancel` | button | Cancel |
| `#crop-apply` | button | Apply Crop |

### modal:modal-explode-options (4)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#ex3d-frags` | input:range |  |
| `#ex3d-fill` | input:checkbox | Fill interior (solid shards) |
| `#ex3d-cancel` | button | Cancel |
| `#ex3d-start` | button | Detonate |

### modal:modal-export-mesh (5)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#exp-format` | select:select-one [glb=GLB (web/Three.js), gltf=GLTF + textures, fbx=FBX (Autodesk), obj=OBJ (universal), stl=STL (3D printing), ply=PLY (point cloud), fbx_unreal=FBX for Unreal Engine (cm + Y-up)] |  |
| `#exp-path` | input:text | (default: meshes/my_mesh.glb) |
| `#exp-browse` | button | Browse... |
| `#exp-cancel` | button | Cancel |
| `#exp-go` | button | Export |

### modal:modal-job-details (6)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#job-details-close-x` | button | Réduire (la tâche continue dans le panneau) |
| `#job-details-export-logs` | button | 📋 Export logs — Save all logs to a text file on the Desktop (to send for support) |
| `#job-details-goto-step` | button | → Go to generation |
| `#job-details-open-settings` | button | ⚙ Open Settings |
| `#job-details-unlock` | button | 🔓 Unlock |
| `#job-details-cancel` | button | Cancel task |

### modal:modal-live-logs (8)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#ll-file` | select:select-one [fabmesh=fabmesh (main), renderer, error, agent] |  |
| `#ll-filter` | input:text | filter (regex)... |
| `#ll-autoscroll` | input:checkbox | Auto-scroll |
| `#ll-pause` | button | ⏸️ Pause |
| `#ll-clear` | button | 🗑️ Clear |
| `#ll-copy` | button | 📋 Copy |
| `#ll-export` | button | 📋 Exporter — Enregistrer un .txt sur le Bureau (pour le support) |
| `#ll-close` | button | ✕ Close |

### modal:modal-material-adjust (11)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#mat-canvas` | canvas |  |
| `#mat-brightness` | input:range |  |
| `#mat-saturation` | input:range |  |
| `#mat-contrast` | input:range |  |
| `#mat-emissive` | input:range |  |
| `#mat-metallic` | input:range |  |
| `#mat-roughness` | input:range |  |
| `#mat-hue_shift` | input:range |  |
| `#mat-reset-btn` | button | ↺ Reset |
| `#mat-cancel-btn` | button | Cancel |
| `#mat-apply-btn` | button | Save as new version |

### modal:modal-mesh-edit (50)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#me-tool-sculpt` | button | ✍ Sculpt |
| `#me-tool-paint` | button | 🎨 Paint |
| `#me-tool-select` | button | ▢ Select |
| `#me-loupe-toggle` | button | Magnifier: show a zoomed loupe under the cursor (toggle) |
| `#me-undo` | button | Undo |
| `#me-redo` | button | Redo |
| `#me-close-x` | button | Close |
| `#me-sym-x` | button | Mirror edits across the X axis (left / right). |
| `#me-sym-y` | button | Mirror edits across the Y axis (up / down). |
| `#me-sym-z` | button | Mirror edits across the Z axis (front / back). |
| `#me-brush-size` | input:range |  |
| `#me-strength` | input:range |  |
| `#me-sculpt-push` | button | ▲ Push — Push the surface inwards. |
| `#me-sculpt-pull` | button | ▼ Pull — Pull the surface outwards. |
| `#me-sculpt-smooth` | button | ✨ Smooth — Even out the surface under the brush. |
| `#me-sculpt-flatten` | button | ▬ Flatten — Flatten the surface under the brush. |
| `#me-sculpt-grab` | button | ✋ Grab — Drag a whole region without deforming its detail. |
| `#me-sculpt-inflate` | button | ⊕ Inflate — Swell the surface along its normals. |
| `#me-sel-add` | button | ✎ Add — Brush: paint faces to select (drag). |
| `#me-sel-erase` | button | 🧹 Erase — Brush: paint to deselect faces (drag). |
| `#me-sel-wand` | button | ✨ Wand — Magic wand: click a face to select the whole connected flat region (within the Angle below). Ctrl = add. |
| `#me-sel-lasso` | button | ❉ Lasso — Lasso: draw a freehand loop; every face inside is selected. Ctrl = add. |
| `#me-sel-wand-angle` | input:range | Wand angle 20° |
| `#me-sel-grow` | button | ➕ Grow — Expand the selection by one ring of faces |
| `#me-sel-shrink` | button | ➖ Shrink — Contract the selection by one ring of faces |
| `#me-sel-all` | button | ▣ All — Select every face |
| `#me-sel-invert` | button | ↺ Invert — Invert the selection |
| `#me-sel-clear` | button | ✕ Clear — Deselect everything |
| `#me-sel-isolate` | button | ◉ Isolate — Show only the selected faces (toggle) |
| `#me-sel-hide` | button | 👁 Hide — Hide the selected faces (toggle) |
| `#me-sel-move` | button | ✥ Move (gizmo) — Show a gizmo to move / rotate / scale the selected faces. Click again to finish. (T=move, R=rotate, Y=scale) |
| `#me-move-translate` | button | ✥ Move — Translate (T) |
| `#me-move-rotate` | button | ↻ Rotate — Rotate (R) |
| `#me-move-scale` | button | ⇲ Scale — Scale (Y) |
| `#me-sel-duplicate` | button | ⧉ Duplicate — Duplicate the selected faces into a new layer |
| `#me-sel-crop` | button | ✂ Crop — Keep only the selection (delete the rest), or the opposite if 'Keep the rest' is on |
| `#me-sel-crop-keeprest` | input:checkbox | Garder le reste |
| `#me-sel-flip` | button | ⇄ Flip norm. — Flip the normals / winding of the selected faces (fix inside-out patches) |
| `#me-sel-smooth` | button | ∿ Smooth — Laplacian-smooth only the selected vertices |
| `#me-sel-delete` | button | 🗑 Delete — Delete the selected faces (Del) |
| `#me-paint-color` | input:color |  |
| `#me-paint-pick` | button | Pick color |
| `#me-paint-fill` | button | 🧹 Fill all |
| `#me-paint-smooth` | button | ✨ Smooth |
| `#me-paint-reset` | button | ↺ Reset paint |
| `#me-canvas` | canvas |  |
| `#me-lasso-canvas` | canvas |  |
| `#me-loupe-canvas` | canvas |  |
| `#me-cancel` | button | Cancel |
| `#me-save` | button | Save as new version |

### modal:modal-mesh-tool (4)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#mt-close-x` | button | Close |
| `#mt-canvas` | canvas |  |
| `#mt-cancel` | button | Cancel |
| `#mt-apply` | button | Apply |

### modal:modal-modify-image (5)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#mod-prompt` | textarea:textarea | make it red, add more details, anime style... |
| `#mod-engine` | select:select-one [local-sdxl=MyFabmesh.AI Image Engine (local)] |  |
| `#mod-strength` | input:range |  |
| `#mod-cancel` | button | Cancel |
| `#mod-apply` | button | Modify image |

### modal:modal-multiview-options (5)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#mv-opt-mode` | select:select-one [2view=Auto 2-view (back photo), 6view=6 views (front/right/back/left/top/botto] |  |
| `#mv-opt-harmonize` | input:checkbox | Harmonize Runs the 6 views through the harmonizer to recover the photorealistic style. Recommended. +30 s. |
| `#mv-opt-upscale` | input:checkbox | Upscale 768→1024 Augmente la résolution des 6 vues pour matcher l'image source. Rapide. +10s. |
| `#mv-opt-cancel` | button | Cancel |
| `#mv-opt-start` | button | Start |

### modal:modal-new-project (8)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#np-name` | input:text | orc_warrior |
| `#np-asset-type` | select:select-one [character=Character / Unit, creature=Creature / Beast, animal=Animal, insect=Insect / Bug, other_living=Other living thing, vehicle=Vehicle, avion=Plane, bateau=Boat, …] |  |
| `#np-asset-style` | select:select-one [realistic=Realistic, pbr=PBR (high detail), stylized=Stylized (mid-poly), stylized-pbr=Stylized PBR, hand-painted=Hand-painted, cartoon=Cartoon, anime=Anime, painterly=Painterly, …] |  |
| `#np-enhance-prompt` | button | ✨ Enhance — Enhance the prompt with style and quality keywords |
| `#np-prompt` | textarea:textarea | An orc warrior with leather armor, full-body pose... |
| `#np-cancel` | button | Cancel |
| `#np-unlock` | button | 🔓 Unlock |
| `#np-create` | button | Create project |

### modal:modal-outfit (5)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#of-mode` | select:select-one [ensemble=Une seule image : toute la tenue, pieces=Une image par pièce, deux=Les deux] |  |
| `#of-completer` | input:checkbox | Compléter les zones cachées |
| `#of-recadrer` | input:checkbox | Recadrer sur la pièce |
| `#of-cancel` | button | Annuler |
| `#of-go` | button | Extraire |

### modal:modal-paint (30)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#paint-loupe-toggle` | button | Magnifier |
| `#paint-emissive-toggle` | button | 💡 Emissive — Paint on a separate emissive layer (stored as T_emissive on the generated mesh) |
| `#paint-recenter` | button | Recenter image (fit to view) |
| `#paint-undo` | button | Undo |
| `#paint-redo` | button | Redo |
| `#paint-reset` | button | Reset |
| `#paint-close-x` | button | Close |
| `#paint-tool-sel-rect` | button | ▢ Rect |
| `#paint-tool-sel-lasso` | button | ✶ Lasso |
| `#paint-tool-wand` | button | ✦ Wand — Select an area of similar colour in one click. |
| `#paint-sel-invert` | button | ⇆ Invert — Invert selection |
| `#paint-sel-none` | button | ✕ None — Deselect (edit everywhere) |
| `#paint-tool-pen` | button | ✎ Pen |
| `#paint-tool-spray` | button | 💨 Spray |
| `#paint-tool-ink` | button | 🖌 Ink |
| `#paint-tool-line` | button | ╱ Line |
| `#paint-tool-smudge` | button | ☯ Smudge — Drag colour around as if with a finger. |
| `#paint-tool-fill` | button | ☵ Fill |
| `#paint-tool-eraser` | button | ⌫ Eraser |
| `#paint-color` | input:color | Pick color |
| `#paint-eyedropper` | button | Pick from image |
| `#paint-brush-size` | input:range |  |
| `#paint-opacity` | input:range |  |
| `#paint-hardness` | input:range |  |
| `#paint-tolerance` | input:range |  |
| `#paint-canvas` | canvas |  |
| `#paint-emissive-overlay` | canvas |  |
| `#paint-sel-overlay` | canvas |  |
| `#paint-cancel` | button | Cancel |
| `#paint-save` | button | Save as new version |

### modal:modal-paint-emissive (18)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#pe-canvas` | canvas |  |
| `#pe-mask-prompt` | input:text | ex. armure en métal doré poli |
| `#pe-mask-strength` | input:range |  |
| `#pe-color` | input:color |  |
| `#pe-intensity` | input:range |  |
| `#pe-brush-size` | input:range |  |
| `#pe-brush-opacity` | input:range |  |
| `#pe-brush-falloff` | input:range |  |
| `#pe-mode-paint` | button | 🖌 Paint |
| `#pe-mode-erase` | button | 🧽 Erase |
| `#pe-loupe-toggle` | button | Loupe (agrandisseur) |
| `#pe-undo` | button | Annuler (Ctrl+Z) |
| `#pe-redo` | button | Rétablir (Ctrl+Y) |
| `#pe-clear` | button | Tout effacer |
| `#pe-toggle-emissive` | button | 💡 Emissive ON — Show/hide the emissive texture on the mesh |
| `#pe-load-image-layer` | button | ⬇ Load from image layer — Re-project the emissive layer painted on the source image |
| `#pe-cancel` | button | Cancel |
| `#pe-apply-device` | button | 💾 Save new version |

### modal:modal-quit-jobs (4)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#quit-jobs-stop` | button | ■ Stop jobs & quit Kills every running subprocess (Python / Blender) and closes the app. |
| `#quit-jobs-pause` | button | ⏸️ Quit & pause jobs Freezes the jobs and closes the app. They resume automatically the next time you open MyFabmesh. |
| `#quit-jobs-keep` | button | ↷ Quit & keep jobs running Closes the app but leaves the jobs running in the background. |
| `#quit-jobs-cancel` | button | ✕ Cancel Return to the app to pause or finish the jobs yourself. |

### modal:modal-recolor (8)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#rc-mode` | select:select-one [general=Couleur générale — toute l'image, zone=Prompt de zone — une partie, whole-style=Toute l'image + style (prompt)] |  |
| `#rc-prompt` | input:text | cape, armor, helmet, axe... |
| `#rc-all-prompt` | input:text | e.g. "sunset gradient", "cyberpunk neon", "military green camo" |
| `#rc-strength` | input:range |  |
| `#rc-precision` | input:range |  |
| `#rc-dilate` | input:range |  |
| `#rc-cancel` | button | Cancel |
| `#rc-go` | button | Recolor |

### modal:modal-refine-mesh (5)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#rfn-prompt` | textarea:textarea | add wheels, make it taller, smoother surface... |
| `#rfn-format` | select:select-one [glb=GLB, fbx=FBX, obj=OBJ, stl=STL] |  |
| `#rfn-model` | select:select-one [claude=Claude (best), gpt-4o=GPT-4o, local=Local LLM] |  |
| `#rfn-cancel` | button | Cancel |
| `#rfn-go` | button | Refine |

### modal:modal-region-retex (10)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#rrx-close-x` | button | Close |
| `#rrx-part` | input:text | e.g. helmet, cape, shoulder pads |
| `#rrx-detect` | button | 🪄 Detect (AI) |
| `#rrx-prompt` | input:text | e.g. golden polished metal armor |
| `#rrx-brush` | input:range | Brush |
| `#rrx-strength` | input:range | Strength |
| `#rrx-clear` | button | Clear paint |
| `#rrx-canvas` | canvas |  |
| `#rrx-cancel` | button | Cancel |
| `#rrx-apply` | button | Apply |

### modal:modal-report (6)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#rp-close` | button | Close |
| `#rp-reason` | select:select-one [sexual=Sexual or adult content, violence=Violent or graphic content, hate=Hateful or discriminatory content, harassment=Harassment or bullying, minor=Content that appears to involve a minor, illegal=Illegal or dangerous content, misinformation=Misleading or deceptive content, copyright=Copyright or trademark concern, …] |  |
| `#rp-details` | textarea:textarea | What is wrong with this result? |
| `#rp-delete` | button | 🗑 Delete this content |
| `#rp-cancel` | button | Cancel |
| `#rp-send` | button | Send report |

### modal:modal-resize (20)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#rz-close` | button | Close |
| `#rz-canvas` | canvas |  |
| `#rz-uniform` | input:checkbox | Uniform scale (lock ratio) |
| `#rz-unit` | select:select-one [cm=Centimeters (cm), mm=Millimeters (mm), m=Meters (m), in=Inches (in)] |  |
| `#rz-dim-x` | input:number |  |
| `#rz-dim-y` | input:number |  |
| `#rz-dim-z` | input:number |  |
| `#rz-reset` | button | Reset |
| `#rz-x2` | button | Double uniform size |
| `#rz-half` | button | Halve uniform size |
| `#rz-mode-scale` | button | Scale — Gizmo: resize |
| `#rz-mode-rotate` | button | Rotate — Gizmo: rotate (5° steps) |
| `#rz-rot-x` | input:number | X° — Angle around X (°) |
| `#rz-rot-y` | input:number | Y° — Angle around Y (°) |
| `#rz-rot-z` | input:number | Z° — Angle around Z (°) |
| `#rz-rx90` | button | Turn 90° around X |
| `#rz-ry90` | button | Turn 90° around Y |
| `#rz-rz90` | button | Turn 90° around Z |
| `#rz-cancel` | button | Cancel |
| `#rz-apply` | button | Apply |

### modal:modal-resolution (3)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#res-downscale` | button | ↓ Downscale 0.5x |
| `#res-upscale` | button | ↑ Upscale 2x |
| `#res-close` | button | Close |

### modal:modal-settings (26)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#set-close-x` | button | Close |
| `#set-cloud-login` | button | Sign in |
| `#set-cloud-logout` | button | Sign out |
| `#set-account-history` | button | 📥 Usage history |
| `#set-account-topup` | button | + Top up |
| `#set-account-manage` | button | Manage my account online |
| `#lang-select` | select:select-one [en=English, zh=中文, hi=हिन्दी, es=Español, fr=Français, ar=العربية] | Interface language |
| `#set-compute-local` | button | Local (free) |
| `#set-compute-cloud` | button | Cloud (credits) |
| `#parental-toggle` | button | Unlock |
| `#set-crash-optin` | input:checkbox | Send anonymous crash reports |
| `#set-privacy-link` | a | Read the privacy policy |
| `#gpu-limits-reset` | button | Reset all limits to defaults |
| `#set-claude-connect` | button | 🤖 Connect to Claude Desktop |
| `#set-claude-disconnect` | button | Disconnect |
| `#set-api-token` | input:text |  |
| `#set-api-copy-token` | button | 📋 Copy |
| `#set-api-docs` | a | FABMESH_API.md |
| `#set-kill-sdxl` | button | Stop engine |
| `#set-kill-python` | button | Kill Processes |
| `#set-kill-all` | button | Kill All |
| `#set-open-logs` | button | 📁 Open logs folder |
| `#set-live-logs` | button | 🔍 Live logs viewer |
| `#set-export-logs` | button | 📋 Export logs to a file (for support) — Bundle all logs into one text file on your Desktop, to send for support |
| `#set-reconfigure` | button | ⚙️ Reconfigure MyFabmesh.AI |
| `#set-uninstall` | button | 🗑️ Uninstall MyFabmesh.AI |

### modal:modal-stages3d-options (9)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#bs3d-count` | input:range |  |
| `#bs3d-mat-mode` | select:select-one [auto=⚡ Auto (one preset for everything), manual=🔧 Manual (choose each component)] |  |
| `#bs3d-material` | select:select-one [wood=🏗️ Wood, metal=🔨 Metal (galvanized steel), aluminium=✨ Aluminium, bamboo=🌱 Bamboo] |  |
| `#bs3d-mat-scaffold` | select:select-one [wood=🏗️ Wood, metal=🔨 Metal (galvanized steel), aluminium=✨ Aluminium, bamboo=🌱 Bamboo] |  |
| `#bs3d-mat-frame` | select:select-one [wood=🏗️ Wood, metal=🔨 Metal (galvanized steel), aluminium=✨ Aluminium, bamboo=🌱 Bamboo] |  |
| `#bs3d-mat-planks` | select:select-one [wood=🏗️ Wood, metal=🔨 Metal (galvanized steel), aluminium=✨ Aluminium, bamboo=🌱 Bamboo] |  |
| `#bs3d-mat-formwork` | select:select-one [wood=🏗️ Wood, metal=🔨 Metal (galvanized steel), aluminium=✨ Aluminium, bamboo=🌱 Bamboo] |  |
| `#bs3d-cancel` | button | Cancel |
| `#bs3d-start` | button | Fabricate |

### modal:modal-symmetrize (17)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#sym-close` | button | Close |
| `#sym-dir-lr` | button | L → R |
| `#sym-dir-rl` | button | R → L |
| `#sym-mode-full` | button | Full |
| `#sym-mode-mask` | button | Mask |
| `#sym-brush-size` | input:range | Brush: 40 Paint Erase |
| `#sym-paint-mode` | button | Paint |
| `#sym-erase-mode` | button | Erase |
| `#sym-loupe-toggle` | button | Magnifier |
| `#sym-recenter` | button | Recenter view (fit) |
| `#sym-undo` | button | Undo |
| `#sym-redo` | button | Redo |
| `#sym-reset` | button | Reset |
| `#sym-canvas` | canvas |  |
| `#sym-overlay` | canvas |  |
| `#sym-cancel` | button | Cancel |
| `#sym-apply` | button | Apply Symmetrize |

### modal:modal-test-anim (3)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#anim-select` | select:select-one [idle=Idle, walk=Walk, run=Run] |  |
| `#anim-cancel` | button | Cancel |
| `#anim-go` | button | Open in Blender |

### modal:modal-variant (6)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#var-strength` | input:range |  |
| `#var-count` | input:range |  |
| `#var-tex-prompt` | input:text | e.g. brown horse, golden armor, leather instead of metal… (empty = free) |
| `#var-tex-mode` | input:checkbox | 🔒 Keep the shape (vary texture only) |
| `#var-cancel` | button | Cancel |
| `#var-apply` | button | Generate variant |

### modal:select-modal (15)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#select-modal-close` | button | Close |
| `#select-cut` | button | ✂ Cut — Cut the selection (transparent hole left behind) |
| `#select-copy` | button | 📋 Copy — Copy the selection |
| `#select-delete` | button | 🗑 Delete — Delete the selection (transparent hole, no floating piece) |
| `#select-drop` | button | 📌 Drop — Drop the floating piece here (Enter) |
| `#select-deselect` | button | ✖ Deselect — Deselect / cancel move (Esc) |
| `#select-mode-rect` | button | ▯ Rect — Selection rectangulaire |
| `#select-mode-lasso` | button | ⟳ Lasso — Selection libre au lasso |
| `#select-recenter` | button | Recenter image (fit to view) |
| `#select-undo` | button | Undo (Ctrl+Z) |
| `#select-redo` | button | Redo (Ctrl+Y) |
| `#select-canvas` | canvas |  |
| `#select-overlay` | canvas |  |
| `#select-cancel` | button | Cancel |
| `#select-save` | button | Save as new version |

### bloc:history-detail (1)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#history-detail-close` | button | ✕ Close |

### bloc:jobs-panel-2 (4)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#jobs-close-2` | button | Collapse jobs panel |
| `#jobs-onglet-encours` | button | Running0 |
| `#jobs-onglet-termines` | button | Finished21 |
| `#jobs-termines-effacer` | button | Clear |

### bloc:topbar (9)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#back-to-projects` | button | Back to projects |
| `#topbar-brand` | button | MyFabmesh .AI — Open the MyFabmesh website |
| `#topbar-market` | button | 🛒 Marketplace — Browse the marketplace |
| `#btn-refresh` | button | Refresh |
| `#btn-history` | button | My usage history |
| `#btn-report-ai` | button | Report inappropriate AI-generated content |
| `#btn-parental-lock` | button | Parental control — Parental control active — click to unlock |
| `#btn-about` | button | About MyFabmesh.AI |
| `#btn-settings` | button | Settings |

### bloc:update-toast (2)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#update-toast-install` | button | Restart & install |
| `#update-toast-close` | button | Dismiss |

### global (3)

| cible | type | libelle / info-bulle |
|---|---|---|
| `#pe-loupe-canvas` | canvas |  |
| `#jobs-bubble-2` | button | Show running jobs — 0 running |
| `#clone-loupe-canvas` | canvas |  |

## 4. Pont MCP (port 7555, `scripts/mcp_server.py`)

Serveur MCP separe (jeton `.mcp_bridge_token`), pour un client MCP ; la Control API couvre deja tout.
Actions : `generate-images`, `image-to-3d`, `auto-rig-ai`, `list-projects`, `remove-background`, `resume`, `number`

