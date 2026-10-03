# Piloter le site web (serveur cloud) depuis une session

> **Fichier GENERE** par `node build/lister-routes-web.mjs` depuis `cloud/src/worker.ts` — ne pas
> editer a la main ; relancer apres tout ajout de route.

## Principe

Le site web (`https://myfabmesh-cloud.fabien65400.workers.dev`) n'est qu'une page qui appelle ces routes.
`build/fab-web.mjs` les appelle directement, **connecte a un compte** : les travaux lances apparaissent dans
le site de ce compte (projets, tuiles « Running jobs ») et **ses credits sont debites**. Les calculs GPU passent
par Modal : ils sont refuses tant que le budget du jour ou le plafond du compte est atteint.

## Outil : `build/fab-web.mjs`

```bash
node build/fab-web.mjs login <email>        # a lancer par l'UTILISATEUR dans un terminal : mot de passe saisi
                                            # masque, jamais transmis a la session ; FABWEB_PASSWORD sinon
node build/fab-web.mjs moi                  # compte connecte + credits
node build/fab-web.mjs tarifs               # grille vivante (GET /api/pricing)
node build/fab-web.mjs routes [mot]         # routes de ce listing, filtrees
node build/fab-web.mjs GET /api/projects
node build/fab-web.mjs POST /api/<route> '{"...":"..."}' --payer   # route payante : --payer obligatoire
node build/fab-web.mjs travaux              # travaux en cours du compte
node build/fab-web.mjs telecharger <url> <fichier>
node build/fab-web.mjs logout
```

Session : `~/.fabmesh/web_session.json` (hors du depot, qui est PUBLIC), rafraichie automatiquement
(jeton 1 h, rafraichissement 30 jours). Cookie envoye : `mfm-session=<access_token>`, exactement comme le site.

Pour **lancer un outil** : trouver sa route ci-dessous (colonne « appelee par » = methode de
`cloud/public/app/meshyAPI-cloud.js`, dont le corps montre le JSON exact que le site envoie), puis
`POST` avec le meme JSON. Les tarifs indiques sont les valeurs PAR DEFAUT ; `_meta/pricing.json` les surcharge.

**177 routes** — 20 publiques, 108 avec compte, 49 admin, 33 payantes.

## Compte, session, credits, achats (20)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `POST /api/auth/install-session` | public | — | — | POST /api/auth/install-session — body { access_token, refresh_token, expires_in? } Client just did supabase.auth.signInWithPassword(); this endpoint copies the resulting access_token into a HttpOnly cookie so future requests can authenticate WITHOUT exposing t [worker.ts:4185] |
| `POST /api/auth/refresh` | public | — | — | POST /api/auth/refresh — exchange the long-lived refresh cookie for a new access_token + refresh_token pair and re-set both HttpOnly cookies. The renderer pings this every ~50 min (before the 1-hour access_token TTL) so a user keeps their session as long as th [worker.ts:4232] |
| `POST /api/auth/signout` | public | — | — | POST /api/auth/signout — clear both HttpOnly cookies. Idempotent. [worker.ts:4308] |
| `POST /api/checkout` | compte | — | — | — [worker.ts:7687] |
| `POST /api/checkout/reconcile` | compte | — | — | POST /api/checkout/reconcile — filet quand le webhook Stripe n'arrive pas. Body: { session_id: "cs_..." }. POURQUOI (audit du 2026-08-23). Le tunnel d'achat reposait ENTIEREMENT sur la livraison du webhook. Stripe reessaie, mais pas indefiniment : un secret de [worker.ts:8085] |
| `GET /api/me` | compte | — | `getConfig` | — [worker.ts:7563] |
| `GET /api/me/active-jobs` | compte | — | — | GET /api/me/active-jobs — return the user's in-flight jobs so the client can re-attach them on hard refresh / first boot. Without this, a refresh during a long Modal job (~3 min anim, ~100s mesh) silently loses the progress widget client-side even though the j [worker.ts:10399] |
| `POST /api/me/delete` | compte | — | — | POST /api/me/delete — RGPD Art. 17 (Right to be forgotten). Cascades: delete every R2 object under <user.id> , delete jobs + payments rows, delete the auth.users entry (which cascades to profiles via the FK ON DELETE CASCADE in schema.sql). Body must carry `co [worker.ts:3979] |
| `GET /api/me/earnings` | compte | — | — | GET /api/me/earnings — totals + recent sales for the seller. Walks _market/sales/, filters by seller_user_id, sums payout_credits and amount_cents per currency. Returns the 10 most recent sales hydrated with the listing title. [worker.ts:4610] |
| `GET /api/me/export` | compte | — | — | — [worker.ts:3907] |
| `GET /api/me/inbox` | compte | — | — | GET /api/me/inbox — unified inbox: in-app notifications + admin contact replies. Auth required. [worker.ts:4724] |
| `POST /api/me/inbox/read` | compte | — | — | POST /api/me/inbox/read body { ids: string[] } — mark items as read. Idempotent; missing ids are skipped silently. [worker.ts:4794] |
| `GET /api/me/mfa` | compte | — | — | ═══ DOUBLE AUTHENTIFICATION DEPUIS L'APPLI (2026-09-28) ═══ La page /account (Next.js) gerait la 2FA avec le client Supabase du navigateur. Elle est supprimee (user : « reintegre ces elements dans l'appli ») et l'appli web n'embarque pas ce client : le worker [worker.ts:1559] |
| `POST /api/me/mfa/:param` | compte | — | — | ═══ DOUBLE AUTHENTIFICATION DEPUIS L'APPLI (2026-09-28) ═══ La page /account (Next.js) gerait la 2FA avec le client Supabase du navigateur. Elle est supprimee (user : « reintegre ces elements dans l'appli ») et l'appli web n'embarque pas ce client : le worker [worker.ts:1559] |
| `GET /api/me/published-assets` | compte | — | — | GET /api/me/published-assets — list every marketplace listing the current user owns. The renderer uses this to badge home grid cards that are already on the marketplace (pending / approved / rejected), so the user doesn't have to remember what they published. [worker.ts:4541] |
| `GET /api/me/replies` | compte | — | — | GET /api/me/replies — current user only. Returns every contact message they sent that has an admin reply attached, so they can read the response on /account without us emailing them. [worker.ts:4690] |
| `POST /api/me/wipe-all-projects` | compte | — | — | — [worker.ts:10435] |
| `GET /api/pricing` | public | — | — | GET /api/pricing — PUBLIC. Returns the live credit costs so the UI can render accurate cost pills and add-on hints without re- deploying the static bundle every time the admin tunes a price. [worker.ts:21752] |
| `GET /api/pricing/availability` | public | — | — | Public endpoint — returns which packs can currently be purchased. Subscription packs require STRIPE_PRICE_<PACKID> to be set as a Worker secret; without it /api/checkout returns 503, so the buy page should hide those cards. One-shot (payment-mode) packs are al [worker.ts:7621] |
| `POST /api/stripe-webhook` | public | — | — | — [worker.ts:8160] |

## Admin (jeton admin requis) (48)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `GET /api/admin/argent-recent` | admin | — | — | GET /api/admin/argent-recent?heures=6 — ADMIN ONLY. L'argent sur une fenetre COURTE (1 a 72 h) pour /admin2 (user : « rajoutes 6h et 24h, il en manque dans Argent »). La facture Modal reelle n'existe que PAR JOUR (releve horaire cumule sur la journee) : sur un [worker.ts:22264] |
| `GET /api/admin/audience.json` | admin | — | — | GET /api/admin/audience.json — ADMIN ONLY. Repartition par PAYS et par PROVENANCE (application de bureau / navigateur), sur une fenetre glissante. POURQUOI CET ECRAN EXISTE. Le 20 aout 2026, le premier vrai visiteur venu du Microsoft Store a lance huit generat [worker.ts:19351] |
| `GET /api/admin/audit` | admin | — | — | GET /api/admin/audit?day=YYYY-MM-DD — returns the day's JSONL log. Defaults to today. Capped at 1 MB body size. [worker.ts:22146] |
| `GET /api/admin/badges` | admin | — | — | GET /api/admin/badges — ADMIN ONLY. Three integers for the tab badges. Replaces the dashboard's 30-second poller that used to hit /api/admin/market/list (N+1 R2 reads over every listing), /api/admin/contact-messages (N+1 over every message) and /api/admin/jobs [worker.ts:20918] |
| `GET /api/admin/contact-messages` | admin | — | — | GET /api/admin/contact-messages — list every stored message, newest first. [worker.ts:4443] |
| `GET /api/admin/creation-texte` | admin | — | — | GET /api/admin/creation-texte?type=image\|3d&id=<id> — ADMIN ONLY. Le texte SAISI d'UNE creation (prompt, description...), sur demande explicite. Chaque lecture est inscrite dans le journal d'audit (action `view_prompt`) : voir ce que quelqu'un a ecrit est un a [worker.ts:22468] |
| `GET /api/admin/creations` | admin | — | — | GET /api/admin/creations?onglet=projets\|images\|3d\|rigs\|animations&n=60&heures=720[&uid=][&projet=] — ADMIN ONLY. Ce que les comptes ont CREE, par type (user : « il faut plusieurs onglets par type : projets, images, 3d... » et « a droite de la vue, les parametr [worker.ts:22347] |
| `POST /api/admin/force-logout-all` | admin | — | — | POST /api/admin/force-logout-all — invalidate every active Supabase session by stamping a minimum-iat. Requires the admin password as a second factor so a stolen cookie alone can't nuke every login. Admin emails (ADMIN_EMAILS) are excluded from the kick — othe [worker.ts:21308] |
| `GET /api/admin/history.csv` | admin | — | — | GET /api/admin/history.csv — ADMIN ONLY. Every operation across every user, with margin per row. Same columns as the user CSV PLUS cost_usd, cost_eur, revenue_eur, margin_eur, user_email. [worker.ts:19237] |
| `GET /api/admin/history.xlsx` | admin | — | — | GET /api/admin/history.xlsx — ADMIN ONLY full export with margin. [worker.ts:22770] |
| `GET /api/admin/images/recent` | admin | — | — | GET /api/admin/images/recent?n=48&jours=3[&uid=<userId>] — ADMIN ONLY. Les dernieres images generees (tous comptes, ou un seul avec `uid`). POURQUOI CETTE ROUTE (2026-10-02, user : « comment je vois ce que les gens ont genere (image ca me suffit) ») : /admin2 [worker.ts:22206] |
| `GET /api/admin/jobs/active` | admin | — | — | GET /api/admin/jobs/active — ADMIN ONLY. Returns every job whose status is still in-flight (starting / processing / queued). Joined with profiles so the UI can show the user email next to each row. [worker.ts:20470] |
| `POST /api/admin/jobs/cancel` | admin | — | — | POST /api/admin/jobs/cancel body: { jobId } Refunds credits + marks the job canceled. Modal-side the GPU keeps running for ~30 s until the container is reused; we accept that cost — there's no public Modal API to abort a running spawn. [worker.ts:20498] |
| `GET /api/admin/live` | admin | — | — | GET /api/admin/live — ADMIN. Instantane « temps reel » de l'activite (2026-10-01, user : « tous ces menus ne me permettent pas de voir en temps reel, ca manque »). Interroge par l'onglet Live toutes les 3 s : qui est en ligne (battement < 5 min), les travaux e [worker.ts:21968] |
| `POST /api/admin/login` | admin | — | — | — [worker.ts:18795] |
| `POST /api/admin/logout` | admin | — | — | POST /api/admin/logout — clear the admin cookie. Idempotent. [worker.ts:19168] |
| `GET /api/admin/logs/get` | admin | — | — | GET /api/admin/logs/get?key=<key> — fetches the content of one log. ADMIN-only. Returns text/plain. [worker.ts:17377] |
| `GET /api/admin/logs/list` | admin | — | — | GET /api/admin/logs/list — lists client logs in R2, optionally filtered by ?uid=<userId> or ?email=<email>. ADMIN-only. Returns up to ?limit=N (default 50, max 200) most-recent log keys with their metadata. [worker.ts:17214] |
| `GET /api/admin/market/killswitch` | admin | — | — | GET /api/admin/market/killswitch — ADMIN. Read current state. [worker.ts:6252] |
| `POST /api/admin/market/killswitch` | admin | — | — | POST /api/admin/market/killswitch body { enabled: boolean, reason: string } — ADMIN. Toggle marketplace ON/OFF. `enabled=true` means marketplace is KILLED (admin-side intuition). [worker.ts:6262] |
| `GET /api/admin/market/list` | admin | — | — | GET /api/admin/market/list — ADMIN. Returns ALL listings (every status) so the admin sees pending entries that need review. [worker.ts:6235] |
| `GET /api/admin/modal-credits` | admin | — | — | GET /api/admin/modal-credits — la carte « Coût GPU (Modal) » de l'admin. Reecrite le 2026-09-30 (« Prevision de coupure ») : le user ne comprenait pas « relevee il y a 774 min » ni « environ 0 jour(s) ». La reponse porte : - `prevision` : le calcul UNIQUE (src [worker.ts:4883] |
| `POST /api/admin/modal-credits/total` | admin | — | — | POST /api/admin/modal-credits/total body { total: number, apercu?: boolean } — la limite mensuelle, reglee depuis la fenetre « Changer la limite » de la carte (a recopier depuis « Usage limit » sur modal.com : aucune API ne permet de la lire). `apercu: true` r [worker.ts:4978] |
| `GET /api/admin/modal-status` | admin | — | — | GET /api/admin/modal-status — ADMIN. Meme reponse que /api/modal-status (etat chaud / froid des conteneurs), mais sous la garde admin : la page admin la lit sans dependre d'une route « utilisateur », et elle reste atteignable quand le coupe-circuit « Site » es [worker.ts:22050] |
| `POST /api/admin/modal-usage` | admin | — | — | — [worker.ts:5056] |
| `GET /api/admin/payments` | admin | — | — | GET /api/admin/payments — ADMIN ONLY. Historique COMPLET des achats Stripe. Ajoute le 2026-09-27 : « je n'ai pas de suivi des achats Stripe realises » (user). L'admin n'affichait qu'un total encaisse et la liste des paiements NON rapproches ; rien ne permettai [worker.ts:20689] |
| `POST /api/admin/payments/reconcile` | admin | — | — | POST /api/admin/payments/reconcile body { sessionId, password } ADMIN ONLY. Finish a half-processed Stripe payment: grant the pack's credits and complete the accounting row. Idempotent under double-click because we CLAIM the row FIRST (`.eq('credits', 0)` cond [worker.ts:20805] |
| `GET /api/admin/payments/unreconciled` | admin | — | — | GET /api/admin/payments/unreconciled — ADMIN ONLY. _processPayment (Stripe webhook) INSERTs a placeholder row { credits: 0, amount_eur: 0 } before calling add_credits, then patches it. Any crash/timeout in between leaves money taken and credits missing — and n [worker.ts:20752] |
| `GET /api/admin/pricing` | admin | — | — | GET /api/admin/pricing — current credit costs + defaults. [worker.ts:21792] |
| `POST /api/admin/pricing` | admin | — | — | POST /api/admin/pricing — overwrite the whole R2 pricing object. Requires ADMIN_PASSWORD on every save — second factor on top of the admin cookie, same as the services toggle. [worker.ts:21804] |
| `POST /api/admin/reset-password` | admin | — | — | — [worker.ts:19102] |
| `POST /api/admin/reset-request` | admin | — | — | POST /api/admin/reset-request — declenche l'envoi du code Supabase. [worker.ts:19002] |
| `POST /api/admin/reset-verify` | admin | — | — | POST /api/admin/reset-verify — valide le code recu par mail et rend un ticket. Etape intermediaire, calquee sur la page utilisateur qui verifie le code AVANT d'afficher le choix du mot de passe. [worker.ts:19036] |
| `POST /api/admin/revoke-sessions` | admin | — | — | POST /api/admin/revoke-sessions body { password } — ADMIN. Invalide tous les cookies admin emis jusqu'ici (sauf celui que cette reponse renvoie). [worker.ts:21713] |
| `GET /api/admin/sante.json` | admin | — | — | GET /api/admin/sante.json — ADMIN. Ce qui est CONFIGURE et ce qui manque. POURQUOI. Trois protections de ce service sont aujourd'hui inertes, et AUCUNE ne le dit : l'alerte de budget n'a pas de cle Resend, le poller d'usage n'est declenche par rien, et la cais [worker.ts:19503] |
| `GET /api/admin/services` | admin | — | — | GET /api/admin/services — current state of the kill switches. [worker.ts:22064] |
| `POST /api/admin/services` | admin | — | — | POST /api/admin/services body: { service: 'modal'\|'site', enabled, password } Requires the ADMIN_PASSWORD on every flip — second factor on top of the admin session cookie, so a stolen cookie alone can't kill the site. [worker.ts:22079] |
| `GET /api/admin/stats.json` | admin | — | — | — [worker.ts:19657] |
| `POST /api/admin/totp/confirm` | admin | — | — | POST /api/admin/totp/confirm body: { secret, code } Verifies the code against the (un-persisted) secret. On success saves it to R2 — every subsequent admin login now requires TOTP. [worker.ts:21240] |
| `POST /api/admin/totp/disable` | admin | — | — | POST /api/admin/totp/disable body: { password, code } Removes TOTP. Requires both password AND a valid current code so even with the admin cookie alone an attacker can't bypass 2FA. [worker.ts:21280] |
| `POST /api/admin/totp/setup` | admin | — | — | POST /api/admin/totp/setup — generates a fresh secret + otpauth URI. NOT persisted yet — the admin must scan it AND submit a confirming code via /api/admin/totp/confirm before we save it. [worker.ts:21152] |
| `GET /api/admin/totp/status` | admin | — | — | GET /api/admin/totp/status — { enrolled: bool, enrolled_at, email }. [worker.ts:21136] |
| `GET /api/admin/traces` | admin | — | — | GET /api/admin/traces?email=\|uid=&limit=&failed=1[&minutes=N][&statuts=failed] — ADMIN. `minutes` = fenetre (tuile « Echecs » d'Activite), `statuts` = liste stricte (sans `canceled`). La trace SERVEUR de chaque generation / operation, pour tous les comptes. Aj [worker.ts:17308] |
| `GET /api/admin/users` | admin | — | — | GET /api/admin/users — ADMIN ONLY. Profiles + ban flag + per-user aggregates. Query: ?withAssets=1 opts into the R2 asset scan (images_count). The R2 scan used to run UNCONDITIONALLY: up to 5 MESHES.list() calls per user × 500 users = ~2500 subrequests in a si [worker.ts:21002] |
| `POST /api/admin/users/ban` | admin | — | — | POST /api/admin/users/ban body: { userId, ban: boolean } Stores the ban list in R2 (no schema migration needed). The banlist cache in getSessionUser is invalidated immediately so the user is locked out on their next request. [worker.ts:20560] |
| `POST /api/admin/users/credits` | admin | variable (voir le handler) | — | POST /api/admin/users/credits body { userId, delta, reason, password } ADMIN ONLY. Grant (delta > 0) or deduct (delta < 0) credits on one account. Same second-factor pattern as handleAdminSetPricing: Supabase admin session (_requireAdmin) + the admin password. [worker.ts:20608] |
| `POST /api/admin/warm` | admin | — | — | POST /api/admin/warm body: { cibles?: ('text2image'\|'image_op'\|'rectify'\|'mesh')[] } — ADMIN (2026-10-01, user : « il faut que je puisse commander le warm des containers dans l'appli / services »). Reveille a la demande les conteneurs Modal, SANS les gardes de [worker.ts:21946] |
| `POST /api/admin/warm-switch` | admin | — | — | POST /api/admin/warm-switch body: { cibles: { <cle>: true\|false, ... } } — ADMIN. [worker.ts:21912] |

## Marketplace (21)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `GET /api/market/:param` | compte | — | — | GET /api/market/<id> — PUBLIC. Single listing details. [worker.ts:5939] |
| `POST /api/market/:param/claim` | compte | — | — | POST /api/market/<id>/claim — recuperer gratuitement un article du mois. [worker.ts:5818] |
| `GET /api/market/author/:param` | public | — | — | GET /api/market/author/<userId> — PUBLIC. Aggregated public profile: approved listings (with rating stats), sales totals per currency, member_since (earliest listing). [worker.ts:6148] |
| `POST /api/market/checkout` | compte | — | — | POST /api/market/checkout body { listing_ids: string[] } — create a Stripe Checkout Session bundling every paid listing in the user's cart. Returns { url } for the client to redirect to. Free listings are filtered out server-side (downloads via /api/market/dow [worker.ts:7033] |
| `GET /api/market/download/:param` | compte | — | — | GET /api/market/download/<listing_id> — proxies the asset bytes through the worker with Content-Disposition: attachment so the browser actually downloads instead of opening inline. Returning a 302 to a cross-origin R2 URL strips the HTML `download` attribute a [worker.ts:7409] |
| `GET /api/market/list` | public | — | — | — [worker.ts:5903] |
| `PATCH /api/market/listing/:param` | compte | — | — | PATCH /api/market/listing/<id> body { title?, description?, price_cents?, licence? } — author edits one of their own listings. Resets status to pending so an admin re-reviews the changes. [worker.ts:5574] |
| `POST /api/market/listing/:param/rate` | compte | — | — | POST /api/market/listing/<id>/rate body { rating: 1-5 } — authed. Buyers/visitors rate an approved listing. One rating per user (overwrite). Authors cannot rate their own listing. [worker.ts:6039] |
| `GET /api/market/owned` | compte | — | — | GET /api/market/owned — listings the current user has bought. Lists every `_market/owners/<listing_id>/<user_id>.json` for this user and hydrates the listing. [worker.ts:7372] |
| `POST /api/market/poster-upload/:param` | compte | — | — | POST /api/market/poster-upload/<id> — le VENDEUR depose la miniature de sa fiche 3D, photographiee par son navigateur a la publication (image, 2 Mo max). [worker.ts:7472] |
| `GET /api/market/poster/:param` | public | — | — | GET /api/market/poster/<id> — MINIATURE D'UNE FICHE MAILLAGE (2026-09-27). La vitrine chargeait le maillage ENTIER (35 Mo, texture 8K) dans chaque carte, sans image d'attente : carte noire pendant le chargement, ou pour de bon si la carte graphique sature. La [worker.ts:5701] |
| `POST /api/market/preview-upload/:param` | compte | — | — | POST /api/market/preview-upload/<id> — le VENDEUR depose la copie filigranee fabriquee par son navigateur a la publication (2026-09-28 : gratuit, sans Modal). Type verifie par les octets : GLB pour une fiche 3D, image sinon. [worker.ts:7451] |
| `GET /api/market/preview/:param` | public | — | — | GET /api/market/preview/<id> — PUBLIC, fiches approuvees. Gratuite : le fichier. Payante : la copie filigranee (voir _genererApercu), jamais le fichier vendu. L'apercu 3D (et l'image) de la vitrine lisait `asset_url` tel quel : une cle nue ou une URL signee pe [worker.ts:7495] |
| `POST /api/market/publish` | compte | market_publish = 1 | — | POST /api/market/publish — author publishes one of their own succeeded meshes, an image, a rig or an animation they own. Body shapes: mesh: { asset_kind:'mesh', jobId, title, description, price_cents, currency, licence } image: { asset_kind:'image', imageUrl, [worker.ts:5388] |
| `POST /api/market/report` | compte | — | — | POST /api/market/report body { listing_id, reason } — authed. EU DSA notice-and-action: any signed-in user can flag an approved listing as illegal/infringing. Stores one report per user (overwrite), emails the admin, and AUTO-HIDES the listing once distinct re [worker.ts:6088] |
| `POST /api/market/seller/dashboard` | compte | — | — | POST /api/market/seller/dashboard — Express dashboard login link. [worker.ts:6973] |
| `GET /api/market/seller/earnings` | compte | — | — | GET /api/market/seller/earnings — alias for handleMeEarnings (seller scope already matches), surfaced under the /market/seller namespace so the UI doesn't need to mix /api/me and /api/market endpoints. [worker.ts:6987] |
| `POST /api/market/seller/onboard` | compte | — | — | POST /api/market/seller/onboard — create (or reuse) an Express account for the current user and return an onboarding URL. [worker.ts:6896] |
| `GET/POST /api/market/seller/payout-pref` | compte | — | — | GET\|POST /api/market/seller/payout-pref body { mode: 'credits'\|'cash' } [worker.ts:6588] |
| `GET /api/market/seller/status` | compte | — | — | GET /api/market/seller/status — return the Connect onboarding state, refreshing from Stripe on every call so the UI sees the latest flags. [worker.ts:6935] |
| `POST /api/market/unpublish/:param` | compte | — | — | POST /api/market/unpublish/<id> — author retracts a listing. [worker.ts:5625] |

## Images (15)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `POST /api/age/start` | compte | — | `ageStart` | POST /api/age/start — ouvre une verification (piece d'identite + selfie hebergees par Stripe). Reponse : { ok, url } (a ouvrir dans le navigateur). [worker.ts:16323] |
| `GET /api/age/status` | compte | — | `ageStatus` | GET /api/age/status — relit la verification chez Stripe et, si elle est reussie, enregistre « majeur verifie » (rien d'autre). [worker.ts:16375] |
| `POST /api/auto-inpaint` | compte | auto_inpaint = 6 | `autoInpaint` | Auto-inpaint HTTP handler — desktop "Auto Inpaint" tool. NSFW pre-filter applied to the user-supplied prompt; credits refunded if CLIPSeg can't find target_text. [worker.ts:12893] |
| `POST /api/face-fix-image` | compte | face_fix_image = 4 | `faceFixImage` | Image-level face fix — OpenCV Haar Cascade picks the face bbox, SDXL Inpaint polishes it. Costs 2 credits, refund if no face found. [worker.ts:13344] |
| `POST /api/generate` | compte | calcule par creditCost() | `imageTo3D` | — [worker.ts:8756] |
| `POST /api/generate-back-view` | compte | back_view = 6 | `generateBackView` | — [worker.ts:12626] |
| `POST /api/generate-image` | compte | text2image = 6 | `generateImages` | — [worker.ts:12406] |
| `POST /api/mask-inpaint` | compte | mask_inpaint = 6 | `maskInpaint` | Manual mask inpaint — user paints the mask in the renderer's Draw Mask modal, we forward image + mask URLs to image_op. [worker.ts:13238] |
| `POST /api/modify-image` | compte | modify = 3 | `img2img` | Modify (img2img) endpoint — desktop "Modify image" tool ported to the cloud. Takes an existing image URL + a prompt and returns a variation via SDXL img2img on RealVisXL. [worker.ts:12734] |
| `POST /api/outfit` | compte | outfit_complete = 19, outfit = 3 | `outfitCutout` | Habits seuls — reserve au type d'asset « character ». Le type d'asset n'est PAS verifie ici : le worker ne le connait pas de facon fiable (il vit dans le projet cote client). Le bouton est masque hors « character » dans l'interface ; cette route reste utilisab [worker.ts:13151] |
| `POST /api/recolor` | compte | recolor = 3 | `recolor` | Recolorier — detecte la partie nommee (CLIPSeg) et ne change QUE sa teinte, en preservant la luminance : les plis et les ombres restent. L'outil n'existait que sur le bureau. Deux chemins existaient la-bas ; seul celui du virage HSV est portable, l'autre deman [worker.ts:13065] |
| `POST /api/rectify-image` | compte | rectify = 9 | — | Auto-rectify endpoint — re-generate an orthographic FRONT (or 3/4 ISO) view from a prompt and/or a reference image, using multi-seed silhouette symmetry scoring. Verbatim feature port of `generate_front_strict.py`. Requires Modal (no Replicate fallback). [worker.ts:18541] |
| `POST /api/segment-preview` | compte | segment = 3 | `segmentMask` | Mask preview — detect-only CLIPSeg for the Auto Inpaint "Preview mask" button. ONE GPU call on demand (not live-on-keystroke, which would be cost-prohibitive on serverless). Returns the soft mask as an R2 image URL the renderer overlays on the source. Cheap (1 [worker.ts:12823] |
| `POST /api/translate` | compte | — | `translatePrompt` | — [worker.ts:23311] |
| `POST /api/upscale-image` | compte | upscale = 3 | `imageQuickEdit` | AI upscale endpoint — LANCZOS x2/x4 + SDXL refine pass. Way nicer output than the desktop's pure-LANCZOS quick edit. Costs 2 credits. [worker.ts:18426] |

## Mesh 3D et textures (17)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `POST /api/mesh-convert` | compte | export = 1 | `exportMesh` | Export-format conversion: GLB -> FBX / OBJ / STL / PLY / glTF / USD / Alembic / Collada, via Blender on Modal. Deliberately NOT an opType on handleMeshOp. That handler bills a credit and files its output back into the project as a new mesh — correct for an *ed [worker.ts:14234] |
| `POST /api/mesh-enhance-tex` | public | — | `enhanceMeshTexture` | POST /api/mesh-enhance-tex — « Sharpen texture (x2) », portage de scripts/texture_upscale.py : Real-ESRGAN x4plus ramene a x2. [worker.ts:13928] |
| `POST /api/mesh-light/…` | compte | — | — | — [worker.ts:14372] |
| `POST /api/mesh-name-parts` | compte | name_parts = 5 | `nameParts` | POST /api/mesh-name-parts — « Name the zones (AI) », portage de l'IPC bureau 'name-parts'. Nomme les sous-parties d'un maillage SEGMENTE (roue / tourelle — bras / jambe) et ecrit le fichier annexe `<maillage>.parts.json` a cote du maillage dans R2, comme le bu [worker.ts:13973] |
| `POST /api/mesh-op` | compte | align_texture = 3, watertight_hd = 2, mesh_op_simple = 1 | `alignTexture`, `generateExplode3d`, `materialAdjust`, `meshTool`, `resizeMesh` | POST /api/mesh-op — sync CPU mesh transformation via trimesh on Modal. Routes through mesh_start with op_type set so we don't burn a Modal Web Function slot. Returns the new GLB mirrored to R2. [worker.ts:13409] |
| `POST /api/mesh-op/client-multi` | compte | manual_tool = 1 | — | — [worker.ts:14483] |
| `POST /api/mesh-op/client-result` | compte | paint_emissive, paint_mesh, clone3d, skin_paint | — | — [worker.ts:14547] |
| `POST /api/mesh-region-retex` | public | — | `regionRetex` | POST /api/mesh-region-retex — « Re-texture a region (AI) », portage de l'IPC bureau 'mesh:region-retex' (face_inpaint_atlas.py --uv-mask). Le masque est peint sur le maillage 3D, donc deja en espace UV. [worker.ts:13942] |
| `POST /api/mesh-reshape` | compte | reshape = 23 | `reshapeRegion` | — [worker.ts:13804] |
| `POST /api/mesh-retexture` | compte | retex_* (retex_fast = 4, retex_balanced = 5, retex_quality = 7, retex_ultra_8k = 7) | `meshTool` | — [worker.ts:13712] |
| `POST /api/mesh-segment` | compte | mesh_segment = 15 | `meshSegmentAI` | POST /api/mesh-segment — spawn a SAMPart3D part-segmentation job on Modal. Body: { mesh_url: string, scale?: number, projectName?: string } - mesh_url : HTTPS URL of the source GLB (must pass isTrustedAssetHost). - scale : granularity 0.0 (fine/many parts) → 2 [worker.ts:15855] |
| `GET/POST /api/mesh-segment-status` | compte | — | `meshSegmentAI` | POST/GET /api/mesh-segment-status?job_id=<id> — one poll tick. Mirror of handleAutoRigStatus. On 'done' it STREAMS the segmented GLB from Modal /segment-fetch straight into R2 under `${user.id}/mesh-op/${projectSlug}/${ts}_segment.glb` — that prefix is auto-li [worker.ts:15996] |
| `POST /api/mesh-texvar` | public | — | `meshTool` | POST /api/mesh-texvar — « Texture variants », portage de mesh_tools.texture_var : SDXL + ControlNet-Tile sur l'atlas. [worker.ts:13910] |
| `GET /api/meshes` | compte | — | `listMeshes` | List every succeeded mesh the user has generated. Used by the Projects home page to show meshes that don't belong to any image folder yet. [worker.ts:9879] |
| `POST /api/meshes/delete` | compte | — | `deleteMesh` | — [worker.ts:10208] |
| `GET /api/stages3d-list` | compte | — | `checkStages3dDir` | GET /api/stages3d-list?stem=<newStem> — list the stage GLBs previously fabricated for a chantier3d mesh version (cloud port of the desktop's check-stages3d-dir disk fallback). [worker.ts:14196] |
| `POST /api/tex-variant` | compte | tex_variant = 3 | `texVariant` | Variante de texture a structure verrouillee — et moteur de l'outil « Age ». ControlNet-Tile tient la geometrie : l'image source sert d'image de controle. Le levier est `cnScale` — haut, la silhouette ne bouge pas (variante de texture) ; bas, les proportions pe [worker.ts:12982] |

## Rig et animation (8)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `POST /api/animate` | compte | anim = 5 | `autoAnimAI` | POST /api/animate — spawn an AnyTop animation job on Modal. Body: { rig_url: string, anim_type?: string, prompt?: string, engine?: string } Returns: { success, job_id, status:'queued', creditsRemaining } Mirrors handleAutoRig 1:1 in shape; only the upstream Mo [worker.ts:17704] |
| `POST /api/animate-from-reference` | compte | anim = 5 | — | POST /api/animate-from-reference — spawn an FBX reference-animation retarget job on Modal. Body: { rig_url: string, ref_anim_url: string, source_skeleton_id_hint?: 'auto'\|'ue5_mannequin'\|'orc_m1', target_family?: 'humanoid_puppeteer', clip_name?: string, proje [worker.ts:18027] |
| `GET/POST /api/animate-from-reference-status` | compte | — | — | POST or GET /api/animate-from-reference-status?job_id=<id> Mirror of handleAutoAnimStatus targeting the FBX-retarget Modal app. Streams the result GLB into R2 with a `_fbxref_` discriminator in the filename so the project loader (index2.js:645 isAnimation filt [worker.ts:18161] |
| `GET/POST /api/animate-status` | compte | — | `autoAnimAI` | POST or GET /api/animate-status?job_id=<id> — poll the Modal anim output volume. Stream the GLB into R2 on done. Mirror of handleAutoRigStatus + the rig-fetch streaming pattern (commit 9dacdd0). [worker.ts:17852] |
| `POST /api/animations/copy` | compte | — | — | POST /api/animations/copy — body { sourceUrl, animType, projectName, batchId? }. Copies an existing R2 animation blob to a new key without the GLB ever touching the client (which was hitting Cloudflare's 100 MB request body cap on large animated meshes via /up [worker.ts:17572] |
| `POST /api/animations/delete` | compte | — | — | POST /api/animations/delete — body { url }. Removes the R2 blob AND the corresponding jobs row (asset_type='animation' with mesh_url matching the deleted URL). Without the jobs delete the vignette reappears on the next refresh because handleListMeshes queries [worker.ts:17651] |
| `POST /api/animations/upload` | compte | manual_tool = 1 | — | — [worker.ts:17480] |
| `POST /api/animations/upload-locomotion` | compte | — | `uploadLocomotion` | Moteur de marche procedural (2026-09-28) : le GLB « locomotion » (plusieurs allures) est calcule dans le NAVIGATEUR ; on le range tel quel, en flux (un rig pese 60-70 Mo, au-dela des 50 Mo de /api/animations/upload qui lit tout en memoire). GRATUIT : aucun GPU [worker.ts:17439] |

## Projets, fichiers, versions (11)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `GET /api/history.csv` | compte | — | — | GET /api/history.csv — PUBLIC user export. Shows the user their own activity (date, type, status, duration, credits spent). Does NOT reveal cost or margin — those are business-internal numbers and live on /api/admin/history.csv only. [worker.ts:19182] |
| `GET /api/history.json` | compte | — | — | GET /api/history.json — same data the popup shows the user (rendered as a table in cloud/public/app/index.html). Now includes jobs that are still running (status: queued/starting/processing/ running) so the user can see in-flight work + cancel it. [worker.ts:20382] |
| `GET /api/history.xlsx` | compte | — | — | GET /api/history.xlsx — PUBLIC user export in proper Excel format (real OOXML, no warning on open). Same columns as /api/history.csv (no margin), Excel-shaped. [worker.ts:20336] |
| `POST /api/jobs/cancel` | compte | — | `cancelJob` | Annule un job en cours : arrete le conteneur Modal, marque le job annule, rembourse les credits. [worker.ts:10724] |
| `GET /api/projects` | compte | — | `listProjects` | — [worker.ts:9564] |
| `POST /api/projects/create` | compte | — | `flashTaskbar` | POST /api/projects/create — MATÉRIALISER UN PROJET DÈS SA CRÉATION. MESURE DU 2026-09-25 : le user crée « orc woman » dans l'interface, demande une image... et rien n'est sauvegardé. Vérifié en base : zéro job et zéro user_asset portent ce nom, ses deux images [worker.ts:17118] |
| `POST /api/projects/delete` | compte | — | — | — [worker.ts:9646] |
| `GET /api/projects/shells` | compte | — | `listProjectShells` | GET /api/projects/shells — noms des projets crees VIDES (coquilles `jobs` de type 'project'). Aucune liste ne les relisait (handleListMeshes exige un mesh_url) : un projet vide disparaissait au rechargement (2026-09-28). Un projet supprime a son project_name r [worker.ts:17187] |
| `POST /api/upload-image` | compte | manual_tool = 1 | `duplicateImageVersion`, `flashTaskbar`, `renderMeshFront`, `saveImageDataUrl` | POST /api/upload-image — body: { dataUrl, suffix? }. Decodes a data URL (PNG from a canvas modal — Clone Stamp, Mask, Blur, Paint save), uploads to R2 under the user's namespace, returns the public URL. Replaces `blob:` URLs that don't survive a page reload. [worker.ts:14854] |
| `POST /api/upload-mesh` | compte | manual_tool = 1 | `saveBuffer` | POST /api/upload-mesh — accept a client-side sculpted/edited GLB and persist it to R2 under a per-user prefix so the mesh strip can pick it up. Mirrors handleUploadImage (auth, R2 binding, quota counter, filename sanitisation) but tuned for binary glTF: 50 MB [worker.ts:14972] |
| `POST /api/upload-rig` | compte | manual_tool = 1 | `uploadRig` | POST /api/upload-rig?filename=&projectName=&tool= — corps = le GLB BRUT. POURQUOI UNE SECONDE ROUTE (2026-09-28). /api/upload-mesh recoit du base64 dans du JSON et le decode en memoire, plafonne a 50 Mo — or 82 des 106 rigs presents dans R2 pesaient plus (medi [worker.ts:15089] |

## Divers (37)

| route | acces | tarif (credits) | appelee par | description |
|---|---|---|---|---|
| `GET /api/api-keys` | compte | — | `apiKeysCreate`, `apiKeysList` | GET /api/api-keys — cles du compte (jamais la cle : prefixe, nom, plafond, dates). Cookie seulement. [worker.ts:2517] |
| `POST /api/api-keys` | compte | — | `apiKeysCreate`, `apiKeysList` | POST /api/api-keys {nom, plafond} — cree une cle ; elle n'est renvoyee qu'UNE fois. Cookie seulement. [worker.ts:2527] |
| `POST /api/api-keys/revoke` | compte | — | `apiKeysRevoke` | POST /api/api-keys/revoke {id} — revoque une cle du compte (effet immediat). Cookie seulement. [worker.ts:2546] |
| `POST /api/auto-rig` | compte | reskin = 6, rig = 10 | `autoRigAI` | POST /api/auto-rig — spawn a Puppeteer auto-rig job on Modal. Body: { mesh_url: string, skeleton?: string } - mesh_url : HTTPS URL of the source GLB (must pass isTrustedAssetHost). - skeleton : optional target skeleton name (e.g. "orc_m1"). Currently ignored b [worker.ts:15368] |
| `GET/POST /api/auto-rig-status` | compte | — | `autoRigAI` | POST /api/auto-rig-status?job_id=<id> — one poll tick. Calls Modal's rig-status; on terminal state, finalises the job: - 'pending' → still running, browser keeps polling. - 'failed' → refunds credits + modal spend, deletes the record. - 'done' → decodes base64 [worker.ts:15612] |
| `POST /api/client-log` | compte | — | — | — [worker.ts:16475] |
| `GET /api/client-log/list` | compte | — | — | GET /api/client-log/list — returns the recent log keys for the current user. Useful for me (the agent) to find the latest log without listing the entire R2 bucket. Query: ?limit=20 (max 100). [worker.ts:17404] |
| `GET /api/cloud-projects` | compte | — | `listImageFolders` | Lists the user's projects (grouped from the jobs table). One project = all jobs sharing the same `project_name` (or, when null, a stable name derived from the job id slice — "Project ab12cd"). Each project bundles its meshes (succeeded jobs with mesh_url) and [worker.ts:9716] |
| `POST /api/cloud-projects/delete` | compte | — | `deleteImageFolder`, `deleteProject` | — [worker.ts:10500] |
| `POST /api/construction-stages-3d` | compte | construction3d = 2 | `generateConstructionStages3d` | POST /api/construction-stages-3d — fabricate REAL 3D construction-stage meshes (Manor Lords style) on Modal CPU (trimesh), then mirror every stage GLB to R2 one at a time (a 5-stage castle is ~200MB total, far beyond one Worker JSON response). Mirrors the desk [worker.ts:14056] |
| `POST /api/contact` | compte | — | — | POST /api/contact — public endpoint for messages from the About → Contact form. Stores each message as a JSON file under `_meta/contact/<timestamp>_<random>.json` so the admin can list them from /admin > Messages. No auth required (anonymous visitors should be [worker.ts:4324] |
| `POST /api/copy-mesh-to-project` | compte | — | `copyMeshToProject`, `createProjectFromMesh` | Attach an existing mesh URL to a (possibly new) project for the current user. Used by both copyMeshToProject and createProjectFromMesh — the two desktop operations are the same thing in the cloud DB model (project = grouping by name on jobs). No GPU call, no M [worker.ts:18485] |
| `GET /api/debug-auth` | admin | — | — | Debug-only endpoint — returns what the Worker actually sees from the browser's cookie jar and Supabase token validation. Useful for tracing sign-in regressions without redeploying. [worker.ts:7579] |
| `POST /api/describe-asset` | compte | — | — | — [worker.ts:23344] |
| `GET/HEAD /api/health` | public | — | — | — [worker.ts:24366] |
| `POST/GET /api/heartbeat` | compte | — | — | — [worker.ts:23178] |
| `POST /api/internal/mesh-done` | public | — | — | POST /api/internal/mesh-done — LIVRAISON IMMEDIATE (2026-09-27). Modal l'appelle a la fin d'une generation (reussie ou en echec) : on livre ou on echoue + rembourse TOUT DE SUITE, sans attendre le sondage du navigateur (onglet en arriere-plan, page rechargee) [worker.ts:12078] |
| `POST /api/landmarks` | compte | — | `loadLandmarks`, `saveLandmarks` | POST /api/landmarks — JSON-only landmarks persistence keyed by mesh slug. Body: { mesh_url, landmarks?, op: 'save' \| 'load' } Stored under R2 at `<user.id>/landmarks/<slug>.json`. Slug = the mesh URL's basename minus extension, sanitised. Bounded to 64 KB per [worker.ts:22573] |
| `POST /api/lineage-meta` | compte | — | `getLineageMeta` | — [worker.ts:23240] |
| `POST /api/mock-checkout` | compte | — | — | — [worker.ts:9657] |
| `POST /api/mock-login` | public | — | — | — [worker.ts:9673] |
| `POST /api/mock-logout` | public | — | — | — [worker.ts:9684] |
| `GET /api/modal-status` | compte | — | — | GET /api/modal-status — returns whether MyFabmeshBackview is warm (best-effort, based on the timestamp of our last successful call). Used by the renderer to size progress bars and show a warm/cold pill in modals. [worker.ts:14697] |
| `GET /api/parental/status` | compte | — | `getParentalStatus` | GET /api/parental/status — current user state. [worker.ts:16224] |
| `POST /api/parental/toggle` | compte | — | `toggleUnrestricted` | POST /api/parental/toggle — body { pin, enable }. Lever le filtre exige : (1) l'age verifie, (2) un PIN CHOISI APRES cette verification, (3) pas plus de PIN_ECHECS_MAX essais par fenetre de 15 min (compteur atomique). Re-verrouiller reste libre : cela ne peut [worker.ts:16238] |
| `POST /api/prewarm` | compte | — | — | POST /api/prewarm — a signed-in client (desktop app entering Cloud mode, or the web app opening the image panel) asks us to start booting the text2image container NOW, so its first real click lands warm. Returns immediately; the ping runs in waitUntil. Auth is [worker.ts:23204] |
| `GET /api/proxy-image` | public | — | `flashTaskbar` | GET /api/proxy-image?url=<encoded> — server-side fetch of an image URL, returned as-is so the browser sees a same-origin response and bypasses CORS entirely. Used by every canvas tool that needs to pull bytes back into a <canvas> (Crop, Brightness, Sym, Mask, [worker.ts:18348] |
| `POST /api/remove-background` | compte | remove_background = 1 | `removeBackground` | Background removal proxy. We POST an image URL (or raw blob) and the Worker forwards to Replicate "851-labs/background-remover", waits for the result, and returns the output URL. Free for now (no credit cost — see commit message for rationale). [worker.ts:10792] |
| `POST /api/report-content` | compte | — | — | POST /api/report-content — signalement d'un contenu généré par l'IA. EXIGÉ PAR LA CERTIFICATION MICROSOFT STORE, politique 11.16 « Live Generative AI Content » : tout produit qui présente à l'utilisateur du contenu créé par un modèle génératif doit lui offrir [worker.ts:3419] |
| `POST /api/support-logs` | public | — | — | — [worker.ts:16435] |
| `POST /api/thumbs/upload` | compte | — | `saveThumbnail` | POST /api/thumbs/upload — stores a mesh thumbnail in R2 instead of the client's localStorage (where a single PNG dataURL was eating 100-200 KB and saturating the 5 MB origin cap). Body: {meshKey, dataUrl} where dataUrl is a data:image/png\|webp;base64,... or ra [worker.ts:16992] |
| `POST /api/tool-charge` | compte | variable (voir le handler) | `chargeTool` | POST /api/tool-charge body { tool } — debite un outil manuel qui n'enregistre aucun resultat (Color Pick). Voir manual_tool. [worker.ts:14947] |
| `POST /api/user-assets/delete` | compte | — | `deleteFile` | POST /api/user-assets/delete — delete a single user_asset row (and optionally its R2 blob). Body: { path: string } where path is either a public R2 URL or a raw R2 key. [worker.ts:16747] |
| `POST /api/user-assets/migrate-from-jobs` | compte | — | `materialAdjust` | POST /api/user-assets/migrate-from-jobs — one-shot backfill that recovers per-project image associations from existing jobs.options (which holds `sourceImage` for every mesh generated from an image). Why this exists: before user_assets, the client kept the ima [worker.ts:16789] |
| `POST /api/user-assets/reassign-orphans` | compte | — | `materialAdjust` | POST /api/user-assets/reassign-orphans — second-pass migration that redistributes images currently parked under project='_orphans' into their real projects, using timestamp proximity: every image's R2 key embeds a unix_ms (e.g. <uid>/front/1779658476855_<seed> [worker.ts:16896] |
| `POST /api/user-assets/record` | compte | — | `flashTaskbar`, `materialAdjust` | POST /api/user-assets/record — generic record-an-asset endpoint the client calls after every successful image generation so the R2 path is persisted in Supabase user_assets (replaces localStorage cache). Body: { projectName, kind, paths: string[]\|string, paren [worker.ts:17039] |
| `GET /download/track` | public | — | — | GET /download/track — increment the desktop-downloads counters in R2. Two counters in parallel: an all-time total and a per-day series so the admin dashboard can chart downloads alongside revenue/cost. Public endpoint (no auth) — call from the marketing site's [worker.ts:22860] |

