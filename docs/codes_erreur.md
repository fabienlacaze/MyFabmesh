# Dictionnaire des codes d'erreur MyFabmesh

> GENERE par `node build/lister-codes-erreur.mjs` (source des familles : `build/codes_erreur_familles.json`). Ne pas editer a la main.

Quand une etape echoue, la liste des travaux affiche **Error** (au lieu de « Aller a ») : la fenetre donne l'image, les parametres, le **code** (ref `E..`, HTTP, cf-ray), son explication et le **message exact**. Retrouver ce message ci-dessous, ou la famille (`E01`...), donne la cause probable et la correction.

## Comment diagnostiquer

1. Copier l'erreur (bouton de la fenetre) : nom du travail, projet, heure, code, parametres.
2. Identifier la famille ci-dessous (`ref`).
3. Lire les journaux : `PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal app logs myfabmesh-cloud --since 30m --search "<mot>"` (Modal), `node build/fab-web.mjs travaux` (compte), R2 / Supabase (CLAUDE.md, section 2).
4. Un echec ne coute rien : les routes remboursent (colonne « Rembourse »).

## Familles

| Ref | HTTP | Titre | Rembourse |
|---|---|---|---|
| E01 | 503 | Le serveur du site a manque de ressources | oui |
| E02 | 400 | Une description manque | oui |
| E03 | 402 | Credits insuffisants | oui |
| E04 | 429 | Une limite d'utilisation est atteinte | oui |
| E05 | 401 | Session expiree ou absente | oui |
| E06 | 400 | Refus du filtre de contenu | oui |
| E07 | 422 | L'outil ne peut rien faire sur ce modele | oui |
| E08 | 524 | L'etape a pris trop de temps | oui |
| E09 | — | Probleme de reseau | non |
| E10 | 5xx | Un service de calcul a echoue | oui |
| E11 | 503 | Service non configure ou coupe | oui |
| E12 | 400 | Requete invalide | oui |
| E13 | 403 | Acces refuse | non |
| E14 | 404 | Ressource introuvable | non |
| E99 | — | Erreur inconnue | non |

### E01 — Le serveur du site a manque de ressources

- **Symptome** : « HTTP 503 … Worker exceeded resource limits » avec un identifiant cf-ray, surtout sur Re-texture a region, Etapes de construction 3D, outils de maillage (gros GLB de 50 a 100 Mo).
- **Cause** : Un GLB renvoye en base64 dans du JSON par Modal fait coexister dans la memoire du worker Cloudflare (128 Mo) la chaine base64, la chaine atob() et le Uint8Array, et la boucle octet par octet depasse le temps CPU.
- **Correction** : Verifier que Modal est deploye avec `_rendre_glb` (modal_app/app.py) : le journal doit montrer « [glb] televerse directement dans R2 ». Verifier que le worker envoie `r2_put_url` (handleMeshOp, _opAtlasGpu, handleConstructionStages3d) et que R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY sont poses. Si l'URL PUT est absente, le repli base64 se declenche et l'erreur revient sur les gros fichiers : `python -m modal deploy modal_app/app.py` puis `build/rechauffer_apres_deploy.py`.
- **Rembourse** : oui

### E02 — Une description manque

- **Symptome** : « prompt required » (client ou worker).
- **Cause** : L'outil exige un texte et le champ est vide. (Cas particulier corrige le 25/10 : Dessiner un masque avec « Remplacer par » vide = supprimer la zone, le champ vide est accepte.)
- **Correction** : Cote client : verifier le garde du shim (cloud/public/app/meshyAPI-cloud.js) ; cote worker : verifier la route (handleModifyImage, handleMaskInpaint...). Un champ vide ne doit etre refuse que si l'outil ne sait pas en faire quelque chose.
- **Rembourse** : oui

### E03 — Credits insuffisants

- **Symptome** : « insufficient credits — <outil> costs N » (HTTP 402).
- **Cause** : Le solde du compte (table profiles.credits) est inferieur au prix de l'etape.
- **Correction** : Verifier le solde (`node build/fab-web.mjs moi`), le prix applique (`/api/pricing`, surcharges `_meta/pricing.json` dans R2) ; recharger ou offrir des credits depuis /admin2.
- **Rembourse** : oui

### E04 — Une limite d'utilisation est atteinte

- **Symptome** : « daily budget reached », « user limit reached », 429.
- **Cause** : Plafond global Modal (MAX_DAILY_MODAL_SPEND_USD), plafond par compte (MAX_USER_DAILY_SPEND_USD / MAX_PAID_USER_DAILY_SPEND_USD, 40 appels par jour) ou limite de debit.
- **Correction** : Lire le message : _spendRefusalMessage() nomme le plafond reel. Compteurs : `_meta/modal_spend/<jour>`, `_meta/userspend_cap/<uid>/<jour>`, `_meta/userdaily/<uid>/<jour>` dans R2. Plafonds : cloud/wrangler.toml (le plafond payant est a 250 $ temporairement depuis le 25/10 : le remettre a 15.00).
- **Rembourse** : oui

### E05 — Session expiree ou absente

- **Symptome** : HTTP 401 / « unauthorized ».
- **Cause** : Le cookie mfm-session est absent ou expire, ou la cle API de fab-web est invalide.
- **Correction** : Se reconnecter. Pour les outils en ligne de commande : `node build/fab-web.mjs cle` (cle API creee dans les reglages du site).
- **Rembourse** : oui

### E06 — Refus du filtre de contenu

- **Symptome** : « prompt blocked by content filter ».
- **Cause** : Le texte ou l'image a ete refuse par le filtre de securite (cloud/src/nsfw_filter.ts, copies generees pour le bureau et Modal).
- **Correction** : Reformuler. Si c'est un faux positif : ajouter un cas a tests/main/collisions-mots-courants.test.mjs puis corriger cloud/src/nsfw_filter.ts et regenerer les miroirs (`node build/miroir-moderation.mjs --sync`, `python build/moderation_modal/gen_module.py`).
- **Rembourse** : oui

### E07 — L'outil ne peut rien faire sur ce modele

- **Symptome** : HTTP 422 avec une explication (pas de texture cuite, zone trop petite, aucun trou...).
- **Cause** : Refus EXPLIQUE d'une operation qui ne changerait rien ou abimerait le maillage (le worker rembourse).
- **Correction** : Lire le message : il dit quoi changer (texturer d'abord, peindre une zone plus grande...). Aucune panne a corriger.
- **Rembourse** : oui

### E08 — L'etape a pris trop de temps

- **Symptome** : HTTP 524 ou « timeout » (Cloudflare coupe chaque sous-requete a 100 s).
- **Cause** : Demarrage a froid d'un conteneur Modal (instantane non pret apres un deploiement) ou conteneur sature.
- **Correction** : `python build/rechauffer_apres_deploy.py --manches 3` apres chaque `modal deploy` ; verifier le maintien a chaud (`scaledown_window=300`) ; lire `modal app logs myfabmesh-cloud --source system`. Le rejeu avec `_cle_rejeu` rattache l'essai au calcul deja lance (un 524 n'annule pas Modal).
- **Rembourse** : oui

### E09 — Probleme de reseau

- **Symptome** : « Failed to fetch » dans le navigateur.
- **Cause** : Connexion coupee (VPN, Wi-Fi), rechargement de la page pendant le travail, ou worker injoignable.
- **Correction** : Verifier la connexion ; `curl -s https://myfabmesh-cloud.fabien65400.workers.dev/api/health` doit repondre 200 ; desactiver le VPN si le message revient (« socket connection closed »).
- **Rembourse** : non

### E10 — Un service de calcul a echoue

- **Symptome** : « <outil> failed (credits refunded) », « Service <op> HTTP 5xx ».
- **Cause** : Exception ou redemarrage du conteneur Modal qui execute l'etape (memoire GPU, dependance absente, modele non charge).
- **Correction** : `PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal app logs myfabmesh-cloud --since 30m --search "<mot>"` : la trace Python donne la cause. Si une dependance manque : build/check_modal_deps.py. Redeployer + rechauffer.
- **Rembourse** : oui

### E11 — Service non configure ou coupe

- **Symptome** : HTTP 503 « <service> backend unavailable (not configured) », « R2 binding required », « Modal is switched off (kill switch) ».
- **Cause** : Une URL Modal (MODAL_*_URL) ou un secret manque dans l'environnement du worker, le bucket R2 n'est pas lie, ou l'interrupteur « Calcul GPU » de /admin2 est coupe.
- **Correction** : `cd cloud && npx wrangler secret list` ; poser le secret manquant (l'URL des moteurs d'images doit finir par /text2image) ; /admin2 > Sante > interrupteur Modal ; verifier [[r2_buckets]] dans wrangler.toml.
- **Rembourse** : oui

### E12 — Requete invalide

- **Symptome** : HTTP 400 « <champ> required », « host not allowed », « must be … ».
- **Cause** : Le client a envoye un champ manquant ou hors bornes, ou une URL qui n'est pas d'un hote de confiance (garde SSRF isTrustedAssetHost).
- **Correction** : Comparer le corps envoye (meshyAPI-cloud.js) a la route (docs/pilotage_web.md). C'est presque toujours un defaut du client : ajouter un test.
- **Rembourse** : oui

### E13 — Acces refuse

- **Symptome** : HTTP 403.
- **Cause** : Compte suspendu, route reservee a l'administrateur, ou signature d'URL invalide ou expiree.
- **Correction** : Verifier le statut du compte (/admin2 > Utilisateurs) ; les URL R2 signees expirent (champ exp) : redemander la ressource.
- **Rembourse** : non

### E14 — Ressource introuvable

- **Symptome** : HTTP 404.
- **Cause** : Projet, maillage ou fichier supprime ou deplace ; ancienne URL.
- **Correction** : Recharger la liste des projets ; verifier la cle dans R2 (voir CLAUDE.md, section 2).
- **Rembourse** : non

### E99 — Erreur inconnue

- **Symptome** : Message sans correspondance.
- **Cause** : Cas pas encore classe.
- **Correction** : Copier l'erreur depuis la fenetre « Error » (bouton « Copier l'erreur »), la rechercher dans docs/codes_erreur.md (inventaire complet), puis ajouter une famille a build/codes_erreur_familles.json si elle revient.
- **Rembourse** : non

## Inventaire complet — worker (`cloud/src/worker.ts`)

768 messages distincts. Colonnes : statut HTTP, message (les valeurs dynamiques sont notees `{…}`), fonction qui le leve (ligne), famille.

| HTTP | Message | Fonction (ligne) | Famille |
|---|---|---|---|
| 400 | {…} must be <= {…}; higher resolutions are not yet supported (upstream UV unwrap is baked at 2K — re-baking at 4K corrupts the texture). | handleMeshOp (14269) | E12 |
| 400 | {…} needs params.image_url | handleMeshOp (14252) | E12 |
| 400 | 8 pieces au maximum par appel | handleOutfit (13960) | E12 |
| 400 | a painted-on-3D area and a chosen view cannot be combined | handleMeshReshape (14695) | E12 |
| 400 | a reason is required | handleMarketReport (6459) | E12 |
| 400 | access_token required | handleAuthInstallSession (4456) | E12 |
| 400 | already {…} free items this month — remove one first | handleAdminMarketOffert (6162) | E12 |
| 400 | asset_kind must be mesh, image, rig or animation | handleMarketPublish (5767) | E12 |
| 400 | assetUrl required | handleMarketPublish (5822) | E12 |
| 400 | at most 10 active API keys — revoke one first | handleApiKeysCreate (2757) | E12 |
| 400 | backImageUrl host not allowed | handleMeshRetexture (14568) | E12 |
| 400 | bad job_id | handleInternalMeshDone (12575) | E12 |
| 400 | bad json | handleApiKeysRevoke (2774) | E12 |
| 400 | bad json | handleReportContent (3720) | E12 |
| 400 | bad json | handleAuthInstallSession (4453) | E12 |
| 400 | bad json | handleContactSubmit (4636) | E12 |
| 400 | bad json | handleAdminContactReply (5114) | E12 |
| 400 | bad json | handleAdminModalUsageIngest (5340) | E12 |
| 400 | bad json | handleMarketPublish (5741) | E12 |
| 400 | bad json | handleMarketRate (6405) | E12 |
| 400 | bad json | handleMarketReport (6455) | E12 |
| 400 | bad json | handleAdminMarketKillSwitchSet (6630) | E12 |
| 400 | bad json | handleMarketCheckout (7422) | E12 |
| 400 | bad json | handleCheckoutReconcile (8494) | E12 |
| 400 | bad json | handleStripeWebhook (8574) | E12 |
| 400 | bad json | handleInternalMeshDone (12572) | E12 |
| 400 | bad json | handleAdminLogin (19870) | E12 |
| 400 | bad json | handleAdminTotpConfirm (22283) | E12 |
| 400 | bad key | handleSignedR2 (1635) | E12 |
| 400 | bad key | handleMeshLight (15352) | E12 |
| 400 | bad multipart | handleReportContent (3701) | E12 |
| 400 | bad multipart | handleContactSubmit (4610) | E12 |
| 400 | bad part request | handleMeshOpClientMulti (15405) | E12 |
| 400 | bad request | handleMeshLight (15333) | E12 |
| 400 | bad request | handleMeshOpClientMulti (15415) | E12 |
| 400 | bad signature | handleStripeWebhook (8571) | E12 |
| 400 | base64 and filename required | handleUploadMesh (15992) | E12 |
| 400 | base64 decode failed: {…} | handleUploadImage (15890) | E12 |
| 400 | base64 decode failed: {…} | handleUploadMesh (16002) | E12 |
| 400 | base64 is empty | handleUploadMesh (16004) | E12 |
| 400 | body required | handleMeDelete (4249) | E12 |
| 400 | body required | handleAdminCancelJob (21541) | E12 |
| 400 | body required | handleAdminBanUser (21603) | E12 |
| 400 | body required | handleAdminAdjustCredits (21652) | E12 |
| 400 | body required | handleAdminReconcilePayment (21849) | E12 |
| 400 | body required | handleAdminForceLogoutAll (22351) | E12 |
| 400 | body required | handleAdminRevokeSessions (22797) | E12 |
| 400 | body required | handleAdminSetPricing (22888) | E12 |
| 400 | body required | handleAdminServicesToggle (23167) | E12 |
| 400 | cannot fetch imagePath (HTTP {…}) | handleGenerate (9208) | E12 |
| 400 | cannot fetch imagePath: {…} | handleGenerate (9223) | E12 |
| 400 | cannot purchase your own listing | handleMarketCheckout (7444) | E12 |
| 400 | cibles required | handleAdminWarmSwitch (23001) | E12 |
| 400 | client header required | handleSupportLogs (17450) | E12 |
| 400 | code_required | handleAdminResetVerify (20084) | E12 |
| 400 | code_required | _consumeAdminResetTicket (20109) | E12 |
| 400 | code_required | handleAdminResetPassword (20162) | E12 |
| 400 | confirm field must be "DELETE" | handleMeDelete (4250) | E12 |
| 400 | Consent to immediate delivery is required before payment (Art. L221-28 13°). | handleCheckout (8112) | E12 |
| 400 | consigne too long | handleAutoInpaint (13615) | E12 |
| 400 | currency {…} not supported — listings are priced in EUR | handleMarketPublish (5763) | E12 |
| 400 | dataUrl required | handleUploadImage (15873) | E12 |
| 400 | dataUrl required | handleThumbsUpload (18026) | E12 |
| 400 | delta must be a non-zero integer | handleAdminAdjustCredits (21656) | E12 |
| 400 | delta out of range (max ±10000) | handleAdminAdjustCredits (21658) | E12 |
| 400 | email required | handleContactSubmit (4645) | E12 |
| 400 | email required | handleMockLogin (10085) | E12 |
| 400 | empty body | handleUploadRig (16106) | E12 |
| 400 | empty body | handleLocomotionUpload (18459) | E12 |
| 400 | empty report | handleSupportLogs (17456) | E12 |
| 400 | enable must be true to unlock (or false with pin "lock" to re-lock) | handleParentalToggle (17266) | E12 |
| 400 | enter the 6-digit code from your authenticator app | handleMeMfa (1816) | E12 |
| 400 | error reports are only accepted for failed operations | handleClientLog (17515) | E12 |
| 400 | factor_id required | handleMeMfa (1813) | E12 |
| 400 | file field required | handleAnimUpload (18503) | E12 |
| 400 | format must be one of {…} | handleMeshConvert (15154) | E12 |
| 400 | frontImageUrl host not allowed:  | handleGenerateBackView (13240) | E12 |
| 400 | frontImageUrl required for back-view generation | handleGenerateBackView (13239) | E12 |
| 400 | glbBase64 required | handleMeshOpClientResult (15487) | E12 |
| 400 | graine / tirage: small non-negative integers expected | handleAutoRig (16445) | E12 |
| 400 | https:// only | handleProxyImage (19386) | E12 |
| 400 | id required | handleApiKeysRevoke (2776) | E12 |
| 400 | id required | handleProjectsDelete (10059) | E12 |
| 400 | id required | handleMeshesDelete (10618) | E12 |
| 400 | id required | handleJobCancel (11134) | E12 |
| 400 | id required | handleAdminCreationTexte (23558) | E12 |
| 400 | image bytes do not match the claimed format | handleUploadImage (15908) | E12 |
| 400 | image required | handleRemoveBackground (11228) | E12 |
| 400 | image required (File or imagePath URL) | handleGenerate (9226) | E12 |
| 400 | imagePath host not allowed | handleGenerate (9189) | E12 |
| 400 | imagePath is not an image (content-type: {…}) | handleGenerate (9211) | E12 |
| 400 | imagePathBack host not allowed | handleGenerate (9197) | E12 |
| 400 | imageUrl host not allowed | handleMarketPublish (5848) | E12 |
| 400 | imageUrl host not allowed | handleRemoveBackground (11216) | E12 |
| 400 | imageUrl host not allowed:  | handleModifyImage (13361) | E12 |
| 400 | imageUrl host not allowed:  | handleSegmentPreview (13453) | E12 |
| 400 | imageUrl host not allowed:  | handleAutoInpaint (13609) | E12 |
| 400 | imageUrl host not allowed:  | handleTexVariant (13757) | E12 |
| 400 | imageUrl host not allowed:  | handleRecolor (13852) | E12 |
| 400 | imageUrl host not allowed:  | handleOutfit (13951) | E12 |
| 400 | imageUrl host not allowed:  | handleMaskInpaint (14036) | E12 |
| 400 | imageUrl host not allowed:  | handleFaceFixImage (14156) | E12 |
| 400 | imageUrl host not allowed:  | handleMeshRetexture (14567) | E12 |
| 400 | imageUrl host not allowed:  | handleUpscaleImage (19467) | E12 |
| 400 | imageUrl or imagePath required | handleSegmentPreview (13452) | E12 |
| 400 | imageUrl or imagePath required | handleAutoInpaint (13608) | E12 |
| 400 | imageUrl or imagePath required | handleTexVariant (13756) | E12 |
| 400 | imageUrl or imagePath required | handleRecolor (13851) | E12 |
| 400 | imageUrl or imagePath required | handleOutfit (13950) | E12 |
| 400 | imageUrl or imagePath required | handleMaskInpaint (14035) | E12 |
| 400 | imageUrl or imagePath required | handleFaceFixImage (14155) | E12 |
| 400 | imageUrl or imagePath required | handleUpscaleImage (19466) | E12 |
| 400 | imageUrl required | handleRemoveBackground (11210) | E12 |
| 400 | imageUrl required | handleModifyImage (13359) | E12 |
| 400 | imageUrl required (reference image) | handleMeshRetexture (14565) | E12 |
| 400 | imageUrl required for image listings | handleMarketPublish (5842) | E12 |
| 400 | invalid base64 | handleThumbsUpload (18033) | E12 |
| 400 | invalid dataUrl (allowed: png/jpeg/webp) | handleUploadImage (15882) | E12 |
| 400 | invalid email | handleContactSubmit (4648) | E12 |
| 400 | invalid JSON body | handleAutoRig (16393) | E12 |
| 400 | invalid JSON body | handleMeshSegment (16880) | E12 |
| 400 | invalid JSON body | handleAutoAnim (18731) | E12 |
| 400 | invalid JSON body | handleAnimateFromReference (19075) | E12 |
| 400 | invalid JSON body | handleLandmarks (23663) | E12 |
| 400 | invalid key (must be a log path) | handleAdminLogsGet (18404) | E12 |
| 400 | invalid licence | handleMarketPublish (5770) | E12 |
| 400 | invalid licence | handleMarketUpdate (5957) | E12 |
| 400 | invalid maskDataUrl (expected data:image/...;base64,...) | handleMaskInpaint (14042) | E12 |
| 400 | invalid meshKey | handleThumbsUpload (18021) | E12 |
| 400 | invalid sourceUrl | handleAnimCopy (18610) | E12 |
| 400 | invalid url | handleAnimDelete (18685) | E12 |
| 400 | invalid url | handleProxyImage (19385) | E12 |
| 400 | invalid view: {…} | handleMeshReshape (14693) | E12 |
| 400 | job_id required | handleAutoRigStatus (16645) | E12 |
| 400 | job_id required | handleMeshSegmentStatus (17028) | E12 |
| 400 | job_id required | handleAutoAnimStatus (18899) | E12 |
| 400 | job_id required | handleAnimateFromReferenceStatus (19208) | E12 |
| 400 | jobId required | handleAdminCancelJob (21544) | E12 |
| 400 | JSON body required | handleParentalToggle (17256) | E12 |
| 400 | JSON body required | handleClientLog (17499) | E12 |
| 400 | key required | handleAdminLogsGet (18400) | E12 |
| 400 | key required | handleAdminDeleteImage (23761) | E12 |
| 400 | landmarks object required | handleLandmarks (23691) | E12 |
| 400 | Le prix doit \u00eatre gratuit (0) ou d\u2019au moins 50 centimes. | handleMarketPublish (5781) | E12 |
| 400 | listing_id required | handleMarketReport (6458) | E12 |
| 400 | mask decode failed: {…} | handleMaskInpaint (14049) | E12 |
| 400 | mask required (PNG data URL) | handleMeshReshape (14701) | E12 |
| 400 | maskDataUrl required | handleMaskInpaint (14037) | E12 |
| 400 | mesh bytes are not a valid GLB (missing glTF magic) | handleUploadMesh (16017) | E12 |
| 400 | mesh has no URL | handleMarketPublish (5798) | E12 |
| 400 | mesh not ready | handleMarketPublish (5797) | E12 |
| 400 | mesh_url host not allowed | handleAutoRig (16400) | E12 |
| 400 | mesh_url host not allowed | handleMeshSegment (16885) | E12 |
| 400 | mesh_url required | handleAutoRig (16396) | E12 |
| 400 | mesh_url required | handleMeshSegment (16883) | E12 |
| 400 | mesh_url required | handleLandmarks (23665) | E12 |
| 400 | meshKey required | handleThumbsUpload (18017) | E12 |
| 400 | meshUrl and vueUrl required | handleMeshReshape (14689) | E12 |
| 400 | meshUrl host not allowed:  | handleMeshOp (14284) | E12 |
| 400 | meshUrl host not allowed:  | _opAtlasGpu (14438) | E12 |
| 400 | meshUrl host not allowed:  | handleMeshRetexture (14566) | E12 |
| 400 | meshUrl host not allowed:  | handleMeshNameParts (14880) | E12 |
| 400 | meshUrl host not allowed:  | handleConstructionStages3d (14983) | E12 |
| 400 | meshUrl host not allowed:  | handleMeshConvert (15159) | E12 |
| 400 | meshUrl host not allowed:  | handleCopyMeshToProject (19547) | E12 |
| 400 | meshUrl or meshId required | handleMeshOp (14281) | E12 |
| 400 | meshUrl or meshId required | handleConstructionStages3d (14982) | E12 |
| 400 | meshUrl or meshId required | handleCopyMeshToProject (19541) | E12 |
| 400 | meshUrl required | _opAtlasGpu (14437) | E12 |
| 400 | meshUrl required | handleMeshRetexture (14564) | E12 |
| 400 | meshUrl required | handleMeshNameParts (14879) | E12 |
| 400 | meshUrl required | handleMeshConvert (15157) | E12 |
| 400 | message required | handleContactSubmit (4647) | E12 |
| 400 | mock disabled | handleMockCheckout (10067) | E12 |
| 400 | mock disabled | handleMockLogin (10083) | E12 |
| 400 | mock disabled | handleMockLogout (10094) | E12 |
| 400 | Montant invalide : 100 000 $ au maximum. | handleAdminModalSetBudget (5254) | E12 |
| 400 | multipart body required | handleAnimUpload (18501) | E12 |
| 400 | name required | handleContactSubmit (4644) | E12 |
| 400 | name required | handleDescribeAsset (24862) | E12 |
| 400 | newPassword must be at least 20 characters | handleAdminResetPassword (20167) | E12 |
| 400 | newPassword too long (max 256) | handleAdminResetPassword (20170) | E12 |
| 400 | no listings in cart | handleMarketCheckout (7424) | E12 |
| 400 | no purchasable listings (free or already owned) | handleMarketCheckout (7453) | E12 |
| 400 | not a GLB file (magic mismatch) | handleAnimUpload (18554) | E12 |
| 400 | not a valid GLB (missing glTF magic) | handleUploadRig (16152) | E12 |
| 400 | not a valid GLB (missing glTF magic) | handleLocomotionUpload (18486) | E12 |
| 400 | only approved listings can be offered | handleAdminMarketOffert (6160) | E12 |
| 400 | only your own segmented meshes can be named | handleMeshNameParts (14884) | E12 |
| 400 | op must be "save" or "load" | handleLandmarks (23703) | E12 |
| 400 | opType must be one of {…} | handleMeshOp (14237) | E12 |
| 400 | opType must be one of {…} (client-side ops only) | handleMeshOpClientResult (15485) | E12 |
| 400 | pack inconnu sur cette session | handleCheckoutReconcile (8530) | E12 |
| 400 | params.image_url host not allowed | handleMeshOp (14291) | E12 |
| 400 | parts required | handleMeshOpClientMulti (15423) | E12 |
| 400 | password required | handleAdminLogin (19872) | E12 |
| 400 | path required | handleUserAssetsDelete (17768) | E12 |
| 400 | paths required | handleUserAssetsRecord (18073) | E12 |
| 400 | payload is not a valid GLB (magic bytes missing) | handleMeshOpClientMulti (15434) | E12 |
| 400 | payload is not a valid GLB (magic bytes missing) | handleMeshOpClientResult (15525) | E12 |
| 400 | payment row has no user_id | handleAdminReconcilePayment (21915) | E12 |
| 400 | PIN must be 4 to 64 characters | handleParentalToggle (17273) | E12 |
| 400 | points: 1 to 64 finite [x, y, z] expected | handleAutoRig (16412) | E12 |
| 400 | poster must be an image | handleMarketPosterUpload (7878) | E12 |
| 400 | preview of a paid listing is too detailed: {…} triangles (maximum {…}). Upload a lightweight demonstration copy, not the sold file. | handleMarketPreviewUpload (7853) | E12 |
| 400 | preview of a paid listing must be a readable GLB file | handleMarketPreviewUpload (7851) | E12 |
| 400 | preview of a paid listing must be a static copy: skins and animations are not allowed | handleMarketPreviewUpload (7856) | E12 |
| 400 | preview type does not match the listing | handleMarketPreviewUpload (7846) | E12 |
| 400 | price_cents: integer 0 to 1000000 expected | handleAdminMarketPrice (6684) | E12 |
| 400 | prices object required | handleAdminSetPricing (22897) | E12 |
| 400 | projectName and kind required | handleUserAssetsRecord (18069) | E12 |
| 400 | projectName required | handleCloudProjectsDelete (10910) | E12 |
| 400 | projectName required | handleProjectCreate (18144) | E12 |
| 400 | prompt or refImageUrl required | handleRectifyImage (19590) | E02 |
| 400 | prompt required | handleGenerateImage (12944) | E02 |
| 400 | prompt required | handleModifyImage (13363) | E02 |
| 400 | prompt required (ex : « cape rouge ») | handleRecolor (13854) | E02 |
| 400 | prompt required (what should replace the part) | handleMeshReshape (14697) | E02 |
| 400 | protected key — use the proper endpoint | handleAdminDeleteImage (23766) | E12 |
| 400 | rating must be an integer 1-5 | handleMarketRate (6408) | E12 |
| 400 | reason invalide | handleReportContent (3724) | E12 |
| 400 | reason required | handleAdminAdjustCredits (21660) | E12 |
| 400 | recolor intensity must be between 0 and 1 | handleMeshOp (14244) | E12 |
| 400 | recolor mask must be a PNG | handleMeshOp (14247) | E12 |
| 400 | recolor mask too large | handleMeshOp (14246) | E12 |
| 400 | recolor needs params.color as #rrggbb | handleMeshOp (14242) | E12 |
| 400 | ref_anim_url host not allowed:  | handleAnimateFromReference (19082) | E12 |
| 400 | ref_anim_url required | handleAnimateFromReference (19080) | E12 |
| 400 | refImageUrl host not allowed | handleGenerateImage (13003) | E12 |
| 400 | refImageUrl host not allowed | handleRectifyImage (19595) | E12 |
| 400 | reply body required | handleAdminContactReply (5116) | E12 |
| 400 | Requête illisible. | handleAdminModalSetBudget (5249) | E12 |
| 400 | rig_url host not allowed:  | handleAutoAnim (18735) | E12 |
| 400 | rig_url host not allowed:  | handleAnimateFromReference (19081) | E12 |
| 400 | rig_url required | handleAutoAnim (18734) | E12 |
| 400 | rig_url required | handleAnimateFromReference (19079) | E12 |
| 400 | rigUrl host not allowed | handleMeshNameParts (14881) | E12 |
| 400 | screenshot_{…} bytes don't match its declared type | handleContactSubmit (4632) | E12 |
| 400 | screenshot_{…} unsupported type: {…} | handleContactSubmit (4623) | E12 |
| 400 | secret + code required | handleAdminTotpConfirm (22286) | E12 |
| 400 | service must be modal\|site\|stripe\|all | handleAdminServicesToggle (23171) | E10 |
| 400 | session_id invalide | handleCheckoutReconcile (8496) | E12 |
| 400 | sessionId required | handleAdminReconcilePayment (21851) | E12 |
| 400 | source required | handleMeshOpClientMulti (15397) | E12 |
| 400 | sourceUrl host not allowed | handleAnimCopy (18608) | E12 |
| 400 | sourceUrl required | handleAnimCopy (18594) | E12 |
| 400 | squelette: 1 to 512 joints with valid parents expected | handleAutoRig (16458) | E12 |
| 400 | squelette: cycle in parents | handleAutoRig (16463) | E12 |
| 400 | stem required | handleStages3dList (15103) | E12 |
| 400 | subject required | handleContactSubmit (4646) | E12 |
| 400 | targetProject required | handleCopyMeshToProject (19524) | E12 |
| 400 | targetText required | handleSegmentPreview (13454) | E12 |
| 400 | targetText required | handleAutoInpaint (13611) | E12 |
| 400 | this item is not free this month | handleMarketClaim (6183) | E12 |
| 400 | this listing is already free | handleAdminMarketOffert (6161) | E12 |
| 400 | ticket_expired | _consumeAdminResetTicket (20114) | E12 |
| 400 | title required | handleMarketPublish (5769) | E12 |
| 400 | title required | handleMarketUpdate (5943) | E12 |
| 400 | tool required | handleToolCharge (15966) | E12 |
| 400 | Un compte administrateur ne peut pas être bloqué : il serait verrouillé hors de l administration. | handleAdminBanUser (21615) | E12 |
| 400 | unknown action | handleMeshOpClientMulti (15445) | E12 |
| 400 | unknown pack | handleCheckout (8099) | E12 |
| 400 | unknown pack | handleMockCheckout (10072) | E12 |
| 400 | unknown pack_id '{…}' — cannot determine the payout | handleAdminReconcilePayment (21899) | E12 |
| 400 | url host not allowed | handleMeshReshape (14690) | E12 |
| 400 | url host not allowed | handleAnimDelete (18683) | E12 |
| 400 | url required | handleAnimDelete (18672) | E12 |
| 400 | url required | handleProxyImage (19382) | E12 |
| 400 | usage must be a non-negative number | handleAdminModalUsageIngest (5348) | E12 |
| 400 | userId required | handleAdminBanUser (21606) | E12 |
| 400 | userId required | handleAdminAdjustCredits (21654) | E12 |
| 400 | username required | handleAdminLogin (19874) | E12 |
| 400 | version header required | handleSupportLogs (17452) | E12 |
| 400 | Vous ne pouvez pas bloquer votre propre compte : vous seriez verrouillé hors de l administration. | handleAdminBanUser (21611) | E12 |
| 400 | wrong code — check the time on your phone and try again | handleMeMfa (1820) | E12 |
| 401 | admin_password_required | _requireAdmin (19809) | E12 |
| 401 | current_code_required | handleAdminTotpConfirm (22298) | E12 |
| 401 | invalid access_token | handleAuthInstallSession (4465) | E12 |
| 401 | invalid code | handleAdminTotpConfirm (22306) | E12 |
| 401 | invalid credentials | handleAdminLogin (19894) | E12 |
| 401 | invalid current code | handleAdminTotpConfirm (22303) | E12 |
| 401 | invalid or revoked API key | _avecCleApi (2650) | E12 |
| 401 | invalid password | handleAdminAdjustCredits (21665) | E12 |
| 401 | invalid password | handleAdminReconcilePayment (21856) | E12 |
| 401 | invalid password | handleAdminForceLogoutAll (22357) | E12 |
| 401 | invalid password | handleAdminRevokeSessions (22801) | E12 |
| 401 | invalid totp | handleAdminLogin (19948) | E12 |
| 401 | invalid_code | handleAdminResetVerify (20088) | E12 |
| 401 | no refresh cookie | handleAuthRefresh (4501) | E05 |
| 401 | sign in to claim this item | handleMarketClaim (6177) | E05 |
| 401 | ticket_invalid | _consumeAdminResetTicket (20135) | E12 |
| 401 | totp_required | handleAdminLogin (19940) | E12 |
| 401 | unauthorized | handleMeMfa (1776) | E05 |
| 401 | unauthorized | handleApiKeysList (2743) | E05 |
| 401 | unauthorized | handleApiKeysCreate (2753) | E05 |
| 401 | unauthorized | handleApiKeysRevoke (2772) | E05 |
| 401 | unauthorized | handleMeExport (4175) | E05 |
| 401 | unauthorized | handleMeDelete (4247) | E05 |
| 401 | unauthorized | handleMePublishedAssets (4809) | E05 |
| 401 | unauthorized | handleMeEarnings (4878) | E05 |
| 401 | unauthorized | handleMeReplies (4958) | E05 |
| 401 | unauthorized | handleMeInbox (4992) | E05 |
| 401 | unauthorized | handleMeInboxRead (5062) | E05 |
| 401 | unauthorized | handleAdminModalUsageIngest (5333) | E05 |
| 401 | unauthorized | handleMarketPublish (5728) | E05 |
| 401 | unauthorized | handleMarketUpdate (5926) | E05 |
| 401 | unauthorized | handleMarketUnpublish (5984) | E05 |
| 401 | unauthorized | handleMarketRate (6400) | E05 |
| 401 | unauthorized | handleMarketReport (6449) | E05 |
| 401 | unauthorized | handleSellerPayoutPref (6952) | E05 |
| 401 | unauthorized | handleMarketSellerOnboard (7260) | E05 |
| 401 | unauthorized | handleMarketSellerStatus (7299) | E05 |
| 401 | unauthorized | handleMarketSellerDashboard (7337) | E05 |
| 401 | unauthorized | handleMarketCheckout (7401) | E05 |
| 401 | unauthorized | handleMarketOwned (7736) | E05 |
| 401 | unauthorized | handleMarketDownload (7797) | E05 |
| 401 | unauthorized | handleMarketPreviewUpload (7835) | E05 |
| 401 | unauthorized | handleMarketPosterUpload (7868) | E05 |
| 401 | unauthorized | handleCheckout (8095) | E05 |
| 401 | unauthorized | handleCheckoutReconcile (8491) | E05 |
| 401 | unauthorized | handleGenerate (9162) | E05 |
| 401 | unauthorized | handleJob (9783) | E05 |
| 401 | unauthorized | handleProjects (9975) | E05 |
| 401 | unauthorized | handleProjectsDelete (10057) | E05 |
| 401 | unauthorized | handleMockCheckout (10069) | E05 |
| 401 | unauthorized | handleCloudProjects (10127) | E05 |
| 401 | unauthorized | handleListMeshes (10290) | E05 |
| 401 | unauthorized | handleMeshesDelete (10616) | E05 |
| 401 | unauthorized | handleMeActiveJobs (10807) | E05 |
| 401 | unauthorized | handleMeWipeAllProjects (10843) | E05 |
| 401 | unauthorized | handleCloudProjectsDelete (10908) | E05 |
| 401 | unauthorized | handleJobCancel (11132) | E05 |
| 401 | unauthorized | handleRemoveBackground (11200) | E05 |
| 401 | unauthorized | handleInternalMeshDone (12573) | E05 |
| 401 | unauthorized | handleGenerateImage (12907) | E05 |
| 401 | unauthorized | handleGenerateBackView (13228) | E05 |
| 401 | unauthorized | handleModifyImage (13345) | E05 |
| 401 | unauthorized | handleSegmentPreview (13443) | E05 |
| 401 | unauthorized | handleAutoInpaint (13589) | E05 |
| 401 | unauthorized | handleTexVariant (13745) | E05 |
| 401 | unauthorized | handleRecolor (13840) | E05 |
| 401 | unauthorized | handleOutfit (13938) | E05 |
| 401 | unauthorized | handleMaskInpaint (14025) | E05 |
| 401 | unauthorized | handleFaceFixImage (14145) | E05 |
| 401 | unauthorized | handleMeshOp (14210) | E05 |
| 401 | unauthorized | _opAtlasGpu (14428) | E05 |
| 401 | unauthorized | handleMeshRetexture (14556) | E05 |
| 401 | unauthorized | handleMeshReshape (14681) | E05 |
| 401 | unauthorized | handleMeshNameParts (14870) | E05 |
| 401 | unauthorized | handleConstructionStages3d (14953) | E05 |
| 401 | unauthorized | handleStages3dList (15099) | E05 |
| 401 | unauthorized | handleMeshConvert (15137) | E05 |
| 401 | unauthorized | handleMeshLight (15275) | E05 |
| 401 | unauthorized | handleMeshOpClientMulti (15386) | E05 |
| 401 | unauthorized | handleMeshOpClientResult (15450) | E05 |
| 401 | unauthorized | handleModalStatus (15602) | E05 |
| 401 | unauthorized | handleUploadImage (15869) | E05 |
| 401 | unauthorized | handleToolCharge (15962) | E05 |
| 401 | unauthorized | handleUploadMesh (15987) | E05 |
| 401 | unauthorized | handleUploadRig (16104) | E05 |
| 401 | unauthorized | handleAutoRig (16384) | E05 |
| 401 | unauthorized | handleAutoRigStatus (16628) | E05 |
| 401 | unauthorized | handleMeshSegment (16871) | E05 |
| 401 | unauthorized | handleMeshSegmentStatus (17012) | E05 |
| 401 | unauthorized | handleParentalStatus (17239) | E05 |
| 401 | unauthorized | handleParentalToggle (17253) | E05 |
| 401 | unauthorized | handleAgeStart (17338) | E05 |
| 401 | unauthorized | handleAgeStatus (17390) | E05 |
| 401 | unauthorized | handleClientLog (17492) | E05 |
| 401 | unauthorized | handleUserAssetsDelete (17765) | E05 |
| 401 | unauthorized | handleUserAssetsMigrateFromJobs (17807) | E05 |
| 401 | unauthorized | handleUserAssetsReassignOrphans (17914) | E05 |
| 401 | unauthorized | handleThumbsUpload (18010) | E05 |
| 401 | unauthorized | handleUserAssetsRecord (18057) | E05 |
| 401 | unauthorized | handleProjectCreate (18136) | E05 |
| 401 | unauthorized | handleProjectShells (18205) | E05 |
| 401 | unauthorized | handleClientLogList (18423) | E05 |
| 401 | unauthorized | handleLocomotionUpload (18457) | E05 |
| 401 | unauthorized | handleAnimUpload (18498) | E05 |
| 401 | unauthorized | handleAnimCopy (18590) | E05 |
| 401 | unauthorized | handleAnimDelete (18669) | E05 |
| 401 | unauthorized | handleAutoAnim (18722) | E05 |
| 401 | unauthorized | handleAutoAnimStatus (18883) | E05 |
| 401 | unauthorized | handleAnimateFromReference (19058) | E05 |
| 401 | unauthorized | handleAnimateFromReferenceStatus (19192) | E05 |
| 401 | unauthorized | handleUpscaleImage (19457) | E05 |
| 401 | unauthorized | handleCopyMeshToProject (19516) | E05 |
| 401 | unauthorized | handleRectifyImage (19572) | E05 |
| 401 | unauthorized | _requireAdmin (19802) | E05 |
| 401 | unauthorized | handleAdminLogin (19837) | E05 |
| 401 | unauthorized | handleHistoryCsv (20223) | E05 |
| 401 | unauthorized | handleHistoryXls (21377) | E05 |
| 401 | unauthorized | handleHistoryJson (21423) | E05 |
| 401 | unauthorized | handleHistoryDetail (21467) | E05 |
| 401 | unauthorized | handleLandmarks (23659) | E05 |
| 401 | unauthorized | handleHeartbeat (24279) | E05 |
| 401 | unauthorized | handlePrewarm (24295) | E05 |
| 401 | unauthorized | handleLineageMeta (24330) | E05 |
| 401 | unauthorized | handleTranslate (24574) | E05 |
| 401 | unauthorized | handleDescribeAsset (24845) | E05 |
| 401 | unauthorized — sign in with your admin Supabase account first | handleAdminResetRequest (20043) | E05 |
| 401 | unauthorized — sign in with your admin Supabase account first | handleAdminResetVerify (20077) | E05 |
| 401 | unauthorized — sign in with your admin Supabase account first | handleAdminResetPassword (20143) | E05 |
| 402 | insufficient credits | handleGenerate (9306) | E03 |
| 402 | insufficient credits | handleAutoRig (16491) | E03 |
| 402 | insufficient credits | handleMeshSegment (16913) | E03 |
| 402 | insufficient credits | handleAutoAnim (18795) | E03 |
| 402 | insufficient credits | handleAnimateFromReference (19107) | E03 |
| 402 | insufficient credits — export costs {…} credit{…} | handleMeshConvert (15180) | E03 |
| 402 | insufficient credits — importing costs {…} credit{…} | handleAnimUpload (18567) | E03 |
| 402 | insufficient credits — publishing costs {…} credit{…} | handleMarketPublish (5903) | E03 |
| 402 | insufficient credits — re-texture costs {…} | handleMeshRetexture (14583) | E03 |
| 402 | insufficient credits — reshape costs {…} | handleMeshReshape (14733) | E03 |
| 402 | insufficient credits — this tool costs {…} credit{…} | handleMeshOpClientMulti (15438) | E03 |
| 402 | insufficient credits — this tool costs {…} credit{…} | handleMeshOpClientResult (15510) | E03 |
| 402 | insufficient credits — this tool costs {…} credit{…} | handleUploadImage (15935) | E03 |
| 402 | insufficient credits — this tool costs {…} credit{…} | handleToolCharge (15974) | E03 |
| 402 | insufficient credits — this tool costs {…} credit{…} | handleUploadMesh (16069) | E03 |
| 402 | insufficient credits — this tool costs {…} credit{…} | handleUploadRig (16137) | E03 |
| 402 | purchase required | handleMarketDownload (7799) | E12 |
| 403 | bad origin | handleParentalToggle (17254) | E13 |
| 403 | bad origin | handleAgeStart (17339) | E13 |
| 403 | bad origin | _routeur (26091) | E13 |
| 403 | can only copy your own animation files | handleAnimCopy (18615) | E13 |
| 403 | can only delete your own animation files | handleAnimDelete (18690) | E13 |
| 403 | cannot rate your own listing | handleMarketRate (6417) | E13 |
| 403 | captcha verification failed | handleGenerate (9174) | E13 |
| 403 | expired | handleSignedR2 (1673) | E13 |
| 403 | forbidden | handleSignedR2 (1639) | E13 |
| 403 | forbidden | handleMeshLight (15284) | E13 |
| 403 | forbidden | handleAutoRigStatus (16652) | E13 |
| 403 | forbidden | handleMeshSegmentStatus (17032) | E13 |
| 403 | forbidden | handleAutoAnimStatus (18902) | E13 |
| 403 | forbidden | handleAnimateFromReferenceStatus (19211) | E13 |
| 403 | forbidden | _requireAdmin (19804) | E13 |
| 403 | forbidden | _consumeAdminResetTicket (20116) | E13 |
| 403 | forbidden — your Supabase email is not in the admin allow-list | handleAdminResetRequest (20045) | E13 |
| 403 | forbidden — your Supabase email is not in the admin allow-list | handleAdminResetVerify (20079) | E13 |
| 403 | forbidden — your Supabase email is not in the admin allow-list | handleAdminResetPassword (20145) | E13 |
| 403 | image must belong to your account | handleMarketPublish (5856) | E12 |
| 403 | not allowed with an API key — use the web app for account, keys and payments | _avecCleApi (2646) | E13 |
| 403 | not your listing | handleMarketUpdate (5935) | E13 |
| 403 | not your listing | handleMarketUnpublish (5991) | E13 |
| 403 | not your listing | handleMarketPreviewUpload (7841) | E13 |
| 403 | not your listing | handleMarketPosterUpload (7874) | E13 |
| 403 | path is not under your account | handleUserAssetsDelete (17772) | E13 |
| 403 | PIN mismatch | handleParentalToggle (17285) | E13 |
| 403 | proxy: host {…} not allowed | handleProxyImage (19410) | E13 |
| 403 | Reporting and rating are reserved for accounts at least {…} days old or that have already completed a generation. | _verifierEligibiliteSignalement (22443) | E13 |
| 403 | session rattachee a un autre compte | handleCheckoutReconcile (8510) | E13 |
| 403 | this {…} must be one of your own | handleMarketPublish (5829) | E12 |
| 403 | totp_disable_unavailable | handleAdminTotpDisable (22339) | E13 |
| 404 | {…} not found | handleMarketPublish (5831) | E14 |
| 404 | asset not found in storage | handleMarketDownload (7814) | E14 |
| 404 | asset URL missing | handleMarketDownload (7803) | E14 |
| 404 | job not found | handleAdminCancelJob (21550) | E14 |
| 404 | listing not found | handleMarketUpdate (5930) | E14 |
| 404 | listing not found | handleMarketUnpublish (5988) | E14 |
| 404 | listing not found | handleAdminMarketOffert (6158) | E14 |
| 404 | listing not found | handleMarketClaim (6185) | E14 |
| 404 | listing not found | handleMarketGet (6299) | E14 |
| 404 | listing not found | handleMarketRate (6412) | E14 |
| 404 | listing not found | handleMarketReport (6466) | E14 |
| 404 | listing not found | handleAdminMarketApprove (6651) | E14 |
| 404 | listing not found | handleAdminMarketPrice (6687) | E14 |
| 404 | listing not found | handleAdminMarketReject (6720) | E14 |
| 404 | listing not found | handleMarketDownload (7789) | E14 |
| 404 | listing not found | handleMarketPreviewUpload (7838) | E14 |
| 404 | listing not found | handleMarketPosterUpload (7871) | E14 |
| 404 | listing not visible | handleMarketClaim (6187) | E14 |
| 404 | listing not visible | handleMarketGet (6302) | E14 |
| 404 | listing not visible | handleMarketRate (6416) | E14 |
| 404 | listing not visible | handleMarketDownload (7792) | E14 |
| 404 | mesh not found | handleMarketPublish (5807) | E14 |
| 404 | mesh not found | handleAdminDeleteMesh (23807) | E14 |
| 404 | mesh not found in your account | handleCopyMeshToProject (19536) | E14 |
| 404 | mesh not found in your account or R2 | handleMeshesDelete (10760) | E14 |
| 404 | message not found | handleAdminContactRead (4766) | E14 |
| 404 | message not found | handleAdminContactReply (5119) | E14 |
| 404 | no connect account | handleMarketSellerDashboard (7339) | E14 |
| 404 | no route for {…} {…} | _routeur (26388) | E14 |
| 404 | no such key | handleApiKeysRevoke (2778) | E14 |
| 404 | no thumbnail | handleMarketPoster (6103) | E14 |
| 404 | not found | handleSignedR2 (1666) | E14 |
| 404 | not found | handleMeMfa (1834) | E14 |
| 404 | not found | handleMarketPoster (6059) | E14 |
| 404 | not found | handleMarketPreview (7900) | E14 |
| 404 | not found | handleJobCancel (11144) | E14 |
| 404 | not found | handleMeshLight (15277) | E14 |
| 404 | not found | handleAdminLogsGet (18407) | E14 |
| 404 | not found | handleHistoryDetail (21475) | E14 |
| 404 | not found | handleAdminCreationTexte (23571) | E14 |
| 404 | not found and no R2 binding | handleMeshesDelete (10672) | E14 |
| 404 | payment not found | handleAdminReconcilePayment (21864) | E14 |
| 404 | source not found in R2 | handleAnimCopy (18619) | E14 |
| 404 | user not found | handleAdminAdjustCredits (21671) | E14 |
| 409 | insufficient credits — the balance would go negative | handleAdminAdjustCredits (21680) | E03 |
| 409 | job already {…} | handleAdminCancelJob (21553) | E99 |
| 409 | Paiement remboursé ou en litige : les crédits ont été repris, il ne peut pas être rapproché (rien ne sera versé). | handleAdminReconcilePayment (21868) | E99 |
| 409 | payment is {…} min old — the Stripe webhook  | handleAdminReconcilePayment (21894) | E99 |
| 409 | This exact file is already published by another account. Only original files can be listed. | handleMarketPublish (5872) | E99 |
| 409 | You already have an active subscription.  | handleCheckout (8186) | E99 |
| 409 | You already published this asset. View it on /market or remove it from /admin to re-list. | handleMarketPublish (5864) | E99 |
| 411 | content-length required | handleUploadRig (16110) | E12 |
| 411 | content-length required | handleLocomotionUpload (18463) | E12 |
| 413 | animation too large (95 MB max) | handleLocomotionUpload (18464) | E12 |
| 413 | asset too large (>60 MB) | handleReportContent (3711) | E12 |
| 413 | file too large (max 50 MB) | handleAnimUpload (18504) | E12 |
| 413 | glb too large (>100 MB) | handleMeshOpClientResult (15466) | E12 |
| 413 | glb too large (>250 MB) | handleMeshOpClientResult (15493) | E12 |
| 413 | image too large (5 MB max) | handleUploadImage (15895) | E12 |
| 413 | imagePath too large ({…} bytes, max {…}) | handleGenerate (9215) | E12 |
| 413 | imagePath too large after read | handleGenerate (9219) | E12 |
| 413 | landmarks payload too large (>64 KB) | handleLandmarks (23693) | E12 |
| 413 | log too large (max 1 MB) | handleClientLog (17496) | E12 |
| 413 | logs too large (max 300 KB) | handleSupportLogs (17454) | E12 |
| 413 | mask too large | handleMeshReshape (14702) | E12 |
| 413 | mesh too large (50 MB max) | handleUploadMesh (16009) | E12 |
| 413 | part too large | handleMeshOpClientMulti (15407) | E12 |
| 413 | poster size out of range | handleMarketPosterUpload (7876) | E99 |
| 413 | preview size out of range | handleMarketPreviewUpload (7843) | E99 |
| 413 | preview too large (>5 MB) | handleReportContent (3716) | E12 |
| 413 | proxy: image too large | handleProxyImage (19430) | E12 |
| 413 | rig too large (95 MB max) | handleUploadRig (16111) | E12 |
| 413 | screenshot_{…} too large (>5 MB) | handleContactSubmit (4620) | E12 |
| 413 | thumb too large (max 512 KB) | handleThumbsUpload (18034) | E12 |
| 415 | not an FBX file (magic mismatch) | handleAnimUpload (18518) | E99 |
| 415 | proxy: not a supported raster image | handleProxyImage (19435) | E99 |
| 422 | {…} (credits refunded) | handleMeshOp (14400) | E07 |
| 429 | API key daily credit cap reached ({…}/{…} credits today) | _avecCleApi (2662) | E04 |
| 429 | Contact form is rate-limited today, please try again tomorrow. | handleContactSubmit (4601) | E04 |
| 429 | daily animation copy quota reached, try again tomorrow | handleAnimCopy (18626) | E04 |
| 429 | daily animation copy volume reached, try again tomorrow | handleAnimCopy (18629) | E04 |
| 429 | Daily conversion limit reached for this account.  | handleMeshConvert (15173) | E04 |
| 429 | daily mesh upload quota reached | handleUploadMesh (16043) | E04 |
| 429 | daily mesh upload quota reached | handleUploadRig (16128) | E04 |
| 429 | daily mesh upload quota reached | handleLocomotionUpload (18474) | E04 |
| 429 | daily upload quota reached | handleUploadImage (15922) | E04 |
| 429 | the support inbox is full for today — please try again tomorrow | handleSupportLogs (17476) | E04 |
| 429 | too many failed attempts; try again in an hour | handleAdminLogin (19860) | E04 |
| 429 | too many failed attempts; try again in an hour | handleAdminAdjustCredits (21662) | E04 |
| 429 | too many failed attempts; try again in an hour | handleAdminReconcilePayment (21853) | E04 |
| 429 | too many failed attempts; try again in an hour | handleAdminTotpConfirm (22300) | E04 |
| 429 | too many failed attempts; try again in an hour | handleAdminForceLogoutAll (22354) | E04 |
| 429 | too many failed attempts; try again in an hour | handleAdminRevokeSessions (22798) | E04 |
| 429 | Too many messages from this IP today. Try again tomorrow. | handleContactSubmit (4600) | E04 |
| 429 | too many reports from this address — please try again later | handleSupportLogs (17473) | E04 |
| 429 | too many reports today from this account | handleMarketReport (6461) | E04 |
| 429 | too_many_attempts | _consumeAdminResetTicket (20131) | E04 |
| 429 | trop de signalements depuis cette adresse | handleReportContent (3732) | E04 |
| 429 | you have reached the per-user daily generation limit. | handleGenerate (9301) | E04 |
| 429 | you have reached the per-user daily generation limit. | handleMeshRetexture (14578) | E04 |
| 429 | you have reached the per-user daily generation limit. | handleMeshReshape (14728) | E04 |
| 429 | you have reached the per-user daily generation limit. | handleAutoRig (16486) | E04 |
| 429 | you have reached the per-user daily generation limit. | handleMeshSegment (16905) | E04 |
| 429 | you have reached the per-user daily generation limit. | handleAutoAnim (18789) | E04 |
| 429 | you have reached the per-user daily generation limit. | handleAnimateFromReference (19101) | E04 |
| 500 | admin password not configured (set via env ADMIN_PASSWORD or /api/admin/reset-password) | handleAdminLogin (19841) | E11 |
| 500 | contact list failed:  | handleAdminContactList (4755) | E10 |
| 500 | cr\u00e9dit impossible, r\u00e9essayez dans un instant | handleCheckoutReconcile (8555) | E10 |
| 500 | dispute update failed | handleStripeWebhook (8806) | E10 |
| 500 | internal: {…} | _routeur (26449) | E10 |
| 500 | job creation failed (credits refunded) | handleMeshRetexture (14612) | E10 |
| 500 | job creation failed (credits refunded) | handleMeshReshape (14777) | E10 |
| 500 | job creation failed:  | handleGenerate (9614) | E10 |
| 500 | listing parse failed | handleMarketDownload (7791) | E10 |
| 500 | listing parse failed | handleMarketPreviewUpload (7840) | E10 |
| 500 | listing parse failed | handleMarketPosterUpload (7873) | E10 |
| 500 | mesh path needs storage (no imagePath URL provided) | handleGenerate (9366) | E10 |
| 500 | modal credits failed:  | handleAdminModalCredits (5233) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleAutoRig (16386) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleAutoRigStatus (16630) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleMeshSegment (16873) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleMeshSegmentStatus (17014) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleAutoAnim (18724) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleAutoAnimStatus (18885) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleAnimateFromReference (19060) | E10 |
| 500 | MODAL_SHARED_SECRET not set | handleAnimateFromReferenceStatus (19194) | E10 |
| 500 | no webhook secret | handleStripeWebhook (8567) | E10 |
| 500 | publish failed (credits refunded) | handleMarketPublish (5910) | E10 |
| 500 | R2 binding required | handleMeshLight (15276) | E11 |
| 500 | R2 binding required | handleMeshOpClientMulti (15387) | E11 |
| 500 | R2 binding required | handleMeshOpClientResult (15529) | E11 |
| 500 | R2 binding required | handleUploadImage (15870) | E11 |
| 500 | R2 binding required | handleUploadMesh (15988) | E11 |
| 500 | R2 binding required | handleUploadRig (16105) | E11 |
| 500 | R2 binding required | handleAutoRig (16387) | E11 |
| 500 | R2 binding required | handleAutoRigStatus (16631) | E11 |
| 500 | R2 binding required | handleMeshSegment (16874) | E11 |
| 500 | R2 binding required | handleMeshSegmentStatus (17015) | E11 |
| 500 | R2 binding required | handleSupportLogs (17449) | E11 |
| 500 | R2 binding required | handleClientLog (17489) | E11 |
| 500 | R2 binding required | handleThumbsUpload (18011) | E11 |
| 500 | R2 binding required | handleAdminLogsList (18233) | E11 |
| 500 | R2 binding required | handleAdminLogsGet (18397) | E11 |
| 500 | R2 binding required | handleClientLogList (18421) | E11 |
| 500 | R2 binding required | handleLocomotionUpload (18458) | E11 |
| 500 | R2 binding required | handleAnimUpload (18499) | E11 |
| 500 | R2 binding required | handleAnimCopy (18591) | E11 |
| 500 | R2 binding required | handleAnimDelete (18670) | E11 |
| 500 | R2 binding required | handleAutoAnim (18725) | E11 |
| 500 | R2 binding required | handleAutoAnimStatus (18886) | E11 |
| 500 | R2 binding required | handleAnimateFromReference (19061) | E11 |
| 500 | R2 binding required | handleAnimateFromReferenceStatus (19195) | E11 |
| 500 | R2 binding required | handleAdminResetVerify (20081) | E11 |
| 500 | R2 binding required | handleAdminResetPassword (20147) | E11 |
| 500 | R2 binding required | handleLandmarks (23660) | E11 |
| 500 | R2 binding required | handleAdminUserRigs (23713) | E11 |
| 500 | R2 binding required to forward mask | handleMaskInpaint (14051) | E11 |
| 500 | R2 copy failed: {…} | handleAnimCopy (18651) | E10 |
| 500 | R2 list failed: {…} | handleAdminUserRigs (23734) | E10 |
| 500 | R2 put failed: {…} | handleClientLog (17562) | E10 |
| 500 | R2 upload failed | handleUploadRig (16158) | E10 |
| 500 | R2 upload failed | handleLocomotionUpload (18491) | E10 |
| 500 | R2 upload failed: {…} | handleAnimUpload (18536) | E10 |
| 500 | refund handling failed | handleStripeWebhook (9012) | E10 |
| 500 | REPLICATE_API_TOKEN not set | handleRemoveBackground (11201) | E10 |
| 500 | storage not configured | handleContactSubmit (4591) | E11 |
| 500 | storage not configured | handleAdminContactList (4713) | E11 |
| 500 | storage not configured | handleAdminContactRead (4763) | E11 |
| 500 | storage not configured | handleAdminContactDelete (4783) | E11 |
| 500 | storage not configured | handleMeReplies (4959) | E11 |
| 500 | storage not configured | handleMeInbox (4993) | E11 |
| 500 | storage not configured | handleMeInboxRead (5063) | E11 |
| 500 | storage not configured | handleAdminContactReply (5112) | E11 |
| 500 | storage not configured | handleAdminModalCredits (5152) | E11 |
| 500 | storage not configured | handleAdminModalSetBudget (5247) | E11 |
| 500 | storage not configured | handleAdminModalUsageIngest (5335) | E11 |
| 500 | storage not configured | handleMarketPublish (5729) | E11 |
| 500 | storage not configured | handleMarketUpdate (5927) | E11 |
| 500 | storage not configured | handleMarketUnpublish (5985) | E11 |
| 500 | storage not configured | handleAdminMarketOffert (6150) | E11 |
| 500 | storage not configured | handleMarketClaim (6178) | E11 |
| 500 | storage not configured | handleMarketRate (6401) | E11 |
| 500 | storage not configured | handleMarketReport (6450) | E11 |
| 500 | storage not configured | handleMarketAuthorPage (6511) | E11 |
| 500 | storage not configured | handleAdminMarketKillSwitchSet (6628) | E11 |
| 500 | storage not configured | handleAdminMarketApprove (6648) | E11 |
| 500 | storage not configured | handleAdminMarketPrice (6680) | E11 |
| 500 | storage not configured | handleAdminMarketReject (6714) | E11 |
| 500 | storage not configured | handleSellerPayoutPref (6953) | E11 |
| 500 | storage not configured | handleMarketSellerOnboard (7262) | E11 |
| 500 | storage not configured | handleMarketCheckout (7403) | E11 |
| 500 | storage not configured | handleMarketDownload (7787) | E11 |
| 500 | storage not configured | handleMarketPreviewUpload (7836) | E11 |
| 500 | storage not configured | handleMarketPosterUpload (7869) | E11 |
| 500 | storage not configured | handleAdminMarketDelete (7941) | E11 |
| 500 | storage not configured | handleAdminRevokeSessions (22803) | E11 |
| 500 | storage not configured | handleAdminDeleteImage (23758) | E11 |
| 500 | STRIPE_SECRET_KEY not set | handleMarketSellerOnboard (7261) | E10 |
| 500 | STRIPE_SECRET_KEY not set | handleMarketCheckout (7402) | E10 |
| 500 | STRIPE_SECRET_KEY not set | handleCheckout (8118) | E10 |
| 500 | STRIPE_SECRET_KEY not set | handleCheckoutReconcile (8492) | E10 |
| 500 | supabase not configured | handleAuthInstallSession (4461) | E11 |
| 500 | supabase not configured | handleAuthRefresh (4505) | E11 |
| 500 | transient credit failure | handleStripeWebhook (8725) | E10 |
| 502 | {…} failed (credits refunded) | _opAtlasGpu (14540) | E10 |
| 502 | add_credits RPC failed — nothing was granted, retry | handleAdminReconcilePayment (21922) | E10 |
| 502 | age verification service unavailable | handleAgeStart (17349) | E10 |
| 502 | age verification service unavailable | handleAgeStatus (17397) | E10 |
| 502 | assembly failed: {…} | handleMeshOpClientMulti (15427) | E10 |
| 502 | attachments delete failed:  | handleAdminContactDelete (4797) | E10 |
| 502 | auto-inpaint failed (credits refunded): {…} | handleAutoInpaint (13733) | E10 |
| 502 | auto-rig spawn failed (credits refunded): {…} | handleAutoRig (16535) | E10 |
| 502 | back view generation failed (credits refunded): {…} | handleGenerateBackView (13325) | E10 |
| 502 | background-remover failed:  | handleRemoveBackground (11325) | E10 |
| 502 | background-remover returned no url | handleRemoveBackground (11280) | E10 |
| 502 | client-side mesh op upload failed: {…} | handleMeshOpClientResult (15569) | E10 |
| 502 | construction stages failed (credits refunded) | handleConstructionStages3d (15090) | E10 |
| 502 | container service unavailable | handleAdminWarmSwitch (23007) | E10 |
| 502 | conversion failed (HTTP {…}) {…} | handleMeshConvert (15200) | E10 |
| 502 | conversion failed: {…} | handleMeshConvert (15231) | E10 |
| 502 | conversion returned no data | handleMeshConvert (15205) | E10 |
| 502 | could not send the code: {…} | handleAdminResetRequest (20051) | E10 |
| 502 | credit RPC failed | handleAdminAdjustCredits (21681) | E10 |
| 502 | face-fix failed (credits refunded): {…} | handleFaceFixImage (14201) | E10 |
| 502 | generation failed (credits refunded) | handleGenerate (9721) | E10 |
| 502 | image generation failed (credits refunded): {…} | handleGenerateImage (13181) | E10 |
| 502 | mask preview failed (credit refunded): {…} | handleSegmentPreview (13520) | E10 |
| 502 | mask upload failed (credits refunded) | handleMeshReshape (14755) | E10 |
| 502 | mask-inpaint failed (credits refunded): {…} | handleMaskInpaint (14137) | E10 |
| 502 | mesh {…} failed (credits refunded) | handleMeshOp (14402) | E10 |
| 502 | mesh start failed (credits refunded): {…} | handleGenerate (9709) | E10 |
| 502 | mesh-segment spawn failed (credits refunded): {…} | handleMeshSegment (16943) | E10 |
| 502 | Modal anim-start: no job_id | handleAutoAnim (18830) | E10 |
| 502 | Modal animation backend HTTP {…} | handleAutoAnim (18824) | E10 |
| 502 | Modal animation backend unreachable: {…} | handleAutoAnim (18838) | E10 |
| 502 | Modal FBX retarget backend HTTP {…} | handleAnimateFromReference (19132) | E10 |
| 502 | Modal FBX retarget backend unreachable: {…} | handleAnimateFromReference (19146) | E10 |
| 502 | Modal fbx-retarget-start: no job_id | handleAnimateFromReference (19138) | E10 |
| 502 | modify failed (credits refunded): {…} | handleModifyImage (13429) | E10 |
| 502 | naming failed (credits refunded) | handleMeshNameParts (14940) | E10 |
| 502 | outfit failed (credits refunded): {…} | handleOutfit (14017) | E10 |
| 502 | proxy fetch failed: {…} | handleProxyImage (19449) | E10 |
| 502 | proxy: bad redirect | handleProxyImage (19423) | E10 |
| 502 | proxy: no response | handleProxyImage (19427) | E10 |
| 502 | proxy: redirect refused | handleProxyImage (19421) | E10 |
| 502 | proxy: redirect to a non-allowed host refused | handleProxyImage (19424) | E10 |
| 502 | R2 upload failed | handleUploadImage (15948) | E10 |
| 502 | re-texture could not start (credits refunded) | handleMeshRetexture (14634) | E10 |
| 502 | recolor failed (credits refunded): {…} | handleRecolor (13926) | E10 |
| 502 | rectify failed (credits refunded): {…} | handleRectifyImage (19663) | E10 |
| 502 | reshape could not start (credits refunded) | handleMeshReshape (14796) | E10 |
| 502 | screenshot write failed: {…} | handleContactSubmit (4676) | E10 |
| 502 | session introuvable chez Stripe | handleCheckoutReconcile (8501) | E10 |
| 502 | storage write failed:  | handleLandmarks (23700) | E10 |
| 502 | storage write failed: {…} | handleContactSubmit (4694) | E10 |
| 502 | stripe account_links failed:  | handleMarketSellerOnboard (7291) | E10 |
| 502 | stripe accounts failed:  | handleMarketSellerOnboard (7278) | E10 |
| 502 | stripe checkout failed | handleMarketCheckout (7509) | E10 |
| 502 | stripe login_links failed:  | handleMarketSellerDashboard (7342) | E10 |
| 502 | supabase did not return access_token | handleAuthRefresh (4539) | E10 |
| 502 | tex-variant failed (credits refunded): {…} | handleTexVariant (13826) | E10 |
| 502 | upscale failed (credits refunded): {…} | handleUpscaleImage (19505) | E10 |
| 503 | {…} backend unavailable (not configured) | _opAtlasGpu (14430) | E11 |
| 503 | account deletion could not start (temporary error) - nothing was deleted, please try again | handleMeDelete (4260) | E11 |
| 503 | age verification unavailable | handleAgeStart (17340) | E11 |
| 503 | age verification unavailable | handleAgeStatus (17395) | E11 |
| 503 | animation backend unavailable | handleAutoAnim (18723) | E11 |
| 503 | animation backend unavailable | handleAutoAnimStatus (18884) | E11 |
| 503 | auth service unavailable, retry | handleAuthRefresh (4516) | E11 |
| 503 | authentication service unavailable | handleMeMfa (1780) | E11 |
| 503 | auto-inpaint backend unavailable | handleAutoInpaint (13591) | E11 |
| 503 | auto-rig backend unavailable | handleAutoRig (16385) | E11 |
| 503 | auto-rig backend unavailable | handleAutoRigStatus (16629) | E11 |
| 503 | construction backend unavailable | handleConstructionStages3d (14954) | E11 |
| 503 | could not revoke sessions (storage busy), please retry | handleAdminRevokeSessions (22816) | E11 |
| 503 | could not verify your account right now, please try again in a moment | _verifierEligibiliteSignalement (22441) | E11 |
| 503 | could not verify your account right now, please try again in a moment | _verifierEligibiliteOffert (22469) | E11 |
| 503 | export backend unavailable | handleMeshConvert (15138) | E11 |
| 503 | face-fix backend unavailable | handleFaceFixImage (14146) | E11 |
| 503 | fbx retarget backend unavailable | handleAnimateFromReference (19059) | E11 |
| 503 | fbx retarget backend unavailable | handleAnimateFromReferenceStatus (19193) | E11 |
| 503 | mask preview backend unavailable | handleSegmentPreview (13444) | E11 |
| 503 | mask-inpaint backend unavailable | handleMaskInpaint (14026) | E11 |
| 503 | mesh-op backend unavailable | handleMeshOp (14211) | E11 |
| 503 | mesh-segment backend unavailable | handleMeshSegment (16872) | E11 |
| 503 | mesh-segment backend unavailable | handleMeshSegmentStatus (17013) | E11 |
| 503 | Modal is switched off (kill switch): switch it on first | handleAdminWarmSwitch (23004) | E10 |
| 503 | Modal is switched off (kill switch): switch it on first | handleAdminWarm (23032) | E10 |
| 503 | modify backend unavailable (not configured) | handleModifyImage (13347) | E11 |
| 503 | naming backend unavailable (not configured) | handleMeshNameParts (14872) | E11 |
| 503 | outfit backend unavailable | handleOutfit (13939) | E11 |
| 503 | Payments are temporarily unavailable. Please try again later. | handleMarketCheckout (7418) | E11 |
| 503 | Payments are temporarily unavailable. Please try again later. | handleCheckout (8128) | E11 |
| 503 | preview not ready | handleMarketPreview (7914) | E11 |
| 503 | purchases temporarily disabled by admin | _routeur (26084) | E11 |
| 503 | R2 binding required | _opAtlasGpu (14432) | E11 |
| 503 | R2 binding required | handleMeshNameParts (14874) | E11 |
| 503 | R2 binding required | handleConstructionStages3d (14955) | E11 |
| 503 | R2 binding required | handleStages3dList (15100) | E11 |
| 503 | re-texture backend unavailable (not configured) | handleMeshRetexture (14558) | E11 |
| 503 | recolor backend unavailable | handleRecolor (13841) | E11 |
| 503 | rectify backend unavailable (not configured) | handleRectifyImage (19574) | E11 |
| 503 | reshape backend unavailable (not configured) | handleMeshReshape (14683) | E11 |
| 503 | Sales are not open yet: this service is still missing legally  | _venteBloqueeParMentions (8086) | E11 |
| 503 | Service backend temporarily disabled by admin | _routeur (26068) | E11 |
| 503 | service temporarily unavailable, please retry | _routeur (26446) | E11 |
| 503 | site temporarily disabled by admin | _refusSiteCoupe (4441) | E11 |
| 503 | site temporarily disabled by admin | _routeur (26064) | E11 |
| 503 | stockage indisponible | handleReportContent (3739) | E11 |
| 503 | subscription plan {…} not yet configured (missing {…}) | handleCheckout (8142) | E11 |
| 503 | subscription price could not be verified — please try again later | handleCheckout (8177) | E11 |
| 503 | subscription price is not in EUR — purchase blocked | handleCheckout (8173) | E11 |
| 503 | subscription price mismatch — purchase blocked, please contact support | handleCheckout (8170) | E11 |
| 503 | subscription price unavailable — please try again later | handleCheckout (8165) | E11 |
| 503 | tex-variant backend unavailable | handleTexVariant (13746) | E11 |
| 503 | upscale backend unavailable | handleUpscaleImage (19458) | E11 |

## Inventaire complet — Modal (`modal_app/app.py`)

48 messages distincts.

| HTTP | Message | Ligne | Famille |
|---|---|---|---|
| 400 | (detail dynamique) | 3664 | E12 |
| 400 | %s too long | 234 | E12 |
| 400 | 8 pieces au maximum par appel | 2466 | E12 |
| 400 | a painted-on-3D area and a chosen view cannot be combined | 3621 | E12 |
| 400 | bad job_id | 3844 | E12 |
| 400 | convert failed: {…} | 3941 | E12 |
| 400 | front_image_url required | 1675 | E12 |
| 400 | il faut demander l'ensemble, les pieces, ou les deux | 2461 | E12 |
| 400 | image_url required | 1935 | E12 |
| 400 | invalid json body | 228 | E12 |
| 400 | invalid view: {…} | 3619 | E12 |
| 400 | invalid view: view must be an object | 3615 | E12 |
| 400 | job_id and index required | 3842 | E12 |
| 400 | job_id required | 3752 | E12 |
| 400 | job_id required for cancel | 3679 | E12 |
| 400 | mask decode: {…} | 2386 | E12 |
| 400 | mask_url required for mask_inpaint | 1988 | E12 |
| 400 | mesh_url and front_image_url required | 3633 | E12 |
| 400 | mesh_url and mask_b64 required | 2380 | E12 |
| 400 | mesh_url required | 2155 | E12 |
| 400 | mesh_url required for op_type= | 3652 | E12 |
| 400 | mesh_url, vue_url, mask_url or uv_mask_url, prompt required | 3609 | E02 |
| 400 | op must be 'modify', 'auto_inpaint', 'mask_inpaint', 'face_fix_image', 'upscale', 'segment', 'recolor' or 'tex_variant' | 1937 | E12 |
| 400 | pieces inconnues: %s (connues: %s) | 2455 | E12 |
| 400 | prompt or ref_image_url required | 1734 | E02 |
| 400 | prompt required | 1363 | E02 |
| 400 | prompt required for mask_inpaint | 1989 | E02 |
| 400 | prompt required for modify | 1950 | E02 |
| 400 | prompt required for recolor | 2050 | E02 |
| 400 | scale must be 2 or 4 | 2113 | E12 |
| 400 | target_text required for auto_inpaint | 1965 | E12 |
| 400 | target_text required for segment | 2087 | E12 |
| 400 | unknown op_type '{…}' (allowed: generate, {…}) | 3648 | E12 |
| 400 | unsupported format '{…}'  | 3916 | E12 |
| 401 | auth | 190 | E05 |
| 403 | (detail dynamique) | 1369 | E13 |
| 404 | not ready | 3886 | E14 |
| 410 | mesh failed | 3883 | E99 |
| 422 | (detail dynamique) | 1977 | E07 |
| 422 | no baked texture to re-texture | 2406 | E07 |
| 422 | no baked texture to sharpen (or already at 8192) | 2244 | E07 |
| 422 | painted area too small | 2415 | E07 |
| 422 | this mesh has no baked texture to vary | 2188 | E07 |
| 500 | construction3d: {…} | 3588 | E10 |
| 500 | convert failed: {…} | 3943 | E10 |
| 500 | naming failed: {…} | 2321 | E10 |
| 500 | sheet split missing back cell | 2544 | E10 |
| 502 | (detail dynamique) | 1680 | E10 |

## Cote client (navigateur)

Les messages `<champ> required` / `mask required` du shim (`cloud/public/app/meshyAPI-cloud.js`) sont des garde-fous avant l'envoi : famille E12 (ou E02 pour `prompt required`). `_expliquerErreur()` (index2.js) classe le message recu avec les memes familles.
