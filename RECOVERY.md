# RECOVERY — rebuild FabMesh / MyFabmesh.AI from zero

If the machine dies, this is the full "new PC → working project" procedure for
all three surfaces (**desktop**, **cloud**, **admin**). Everything needed is
either in this repo or re-downloadable. The only thing GitHub does **NOT**
hold is your **secrets** — they exist ONLY on the owner's PC (Step 1) and must
be regenerated from each provider if that PC is lost.

> Rule of thumb: **code + recipe = GitHub** (this repo). **Big binaries
> (models, venvs, node_modules) = re-downloaded** by the wizards. **Secrets =
> the owner's PC only (regenerate from providers)**. **Cloud user data (R2 + Supabase DB) = lives in the
> cloud**, survives a dead PC.

---

## 0. Prerequisites (new machine)
- Windows 11, NVIDIA GPU (project tuned for RTX 5080 / sm_120, CUDA 12.8).
- Git, Node.js 20+, Python 3.11, the NVIDIA driver.
- Account access: **HuggingFace**, **Cloudflare**, **Supabase**, **Stripe**,
  **Modal**, **Replicate** (for regenerating/reading secrets).

## 1. Secrets (NOT on GitHub, NOT backed up anywhere — read this)
The secret files (`cloud/.env.local`, `.env`, `.mcp_bridge_token`,
`.test_api_token`, `config.json`) are gitignored and exist **only on the
owner's PC**. Correction (2026-10-03): an earlier version of this document
promised an encrypted copy `secrets.sealed` in the repo. That file does not
exist (`git ls-files` shows nothing) and no script restores one. If the PC is
lost, **every secret must be regenerated from its provider**:

| secret | where to regenerate |
|---|---|
| Cloudflare API token, Worker secrets (`wrangler secret put <NAME>`) | Cloudflare dashboard > My Profile > API Tokens; `npx wrangler secret list` shows the names to re-create |
| R2 access keys (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) | Cloudflare > R2 > Manage API tokens |
| `R2_URL_SIGNING_SECRET`, `ADMIN_PASSWORD` (>= 20 chars) | invent new values, then `wrangler secret put`; old signed URLs and admin cookies stop working |
| Supabase service role / anon keys, DB password | Supabase dashboard > Project settings > API / Database |
| Stripe secret + webhook signing secret | Stripe dashboard > Developers > API keys / Webhooks |
| Modal tokens | modal.com > Settings > Tokens (`modal token set`) |
| HuggingFace, Replicate tokens | the provider's token page |
| SMTP (Brevo) key | Brevo dashboard > SMTP & API |

**What must be kept OUTSIDE the PC** (paper, password manager, another
device): the recovery codes / second factor of the administrator mailbox, and
the account access (login + 2FA recovery) for **Cloudflare, Supabase, Modal,
Stripe and GitHub**. Without them nobody can regenerate the secrets above.
GitHub Actions secrets (Settings > Secrets) hold only what the manual workflows
need; they are write-only and cannot be read back.

## 2. Clone the repo
```
git clone https://github.com/fabienlacaze/MyFabmesh.git
cd MyFabmesh
```

---

## 3. DESKTOP (Electron app + local GPU pipeline)
```
npm install                       # Electron + renderer deps (package.json)
```
First run launches the in-app **wizard**, or run it manually:
```
python scripts/wizard_install_deps.py   # torch 2.7.0/cu128, kaolin, flash-attn,
                                         # xformers, diffusers, transformers, hf_hub
python scripts/wizard_download.py        # HF weights (~17 GB, see Appendix A)
python scripts/install_kaolin_shim.py    # Apache-2.0 kaolin rasterizer shim
```

### 3a. External models (gitignored — re-clone + re-apply our patches)
For each model: clone upstream, then copy our edits back from `external_patches/`.
```
# TRELLIS-2 (image→3D, texturing)
git clone https://github.com/microsoft/TRELLIS.2 external/TRELLIS2_win/src
# create external/TRELLIS2_win/.venv (the wizard handles torch/flash-attn/kaolin)
xcopy /E external_patches\TRELLIS2_win\* external\TRELLIS2_win\   # restore our edits
python scripts/apply_trellis2_ram_patches.py                      # or re-derive them

# StableFast3D
git clone https://github.com/Stability-AI/stable-fast-3d external/StableFast3D
copy external_patches\StableFast3D\sf3d\models\tokenizers\dinov2.py ^
     external\StableFast3D\sf3d\models\tokenizers\dinov2.py

# MV-Adapter (+ its own venv .venv-mvadapter, diffusers 0.30)
git clone https://github.com/huanngzh/MV-Adapter external/MV-Adapter
xcopy /E external_patches\MV-Adapter\* external\MV-Adapter\

# UniRig (legacy rigging fallback)
git clone https://github.com/VAST-AI-Research/UniRig external/UniRig
copy external_patches\UniRig\src\model\unirig_ar.py external\UniRig\src\model\unirig_ar.py

# Hi3DGen
git clone https://github.com/Stable-X/Hi3DGen external/Hi3DGen
# Puppeteer (primary rigging engine — NEVER modified, clean clone)
git clone --recursive https://github.com/Seed3D/Puppeteer external/Puppeteer
```
Validate: `python scripts/wizard_smoke_test.py`.

### 3b. Launch desktop
```
npm start    # (or: unset ELECTRON_RUN_AS_NODE; node_modules/.bin/electron .)
```

---

## 4. CLOUD (Cloudflare Worker + Next.js) + 4b. ADMIN
Production is deployed **from the owner's PC** (since 2026-10-03 the GitHub
workflow `.github/workflows/cloud-deploy.yml` is manual-only, a fallback):
```
cd cloud
npm install
npm run build            # MUST run before deploy — copies public/app → out/
npm run deploy           # NOT `npx wrangler deploy`: the predeploy guards only run via npm
```
Never put a `| tail` between build and deploy (a failed build would look like
a success). Needs Cloudflare auth + the bindings in `cloud/wrangler.toml`.
- Config in git: `cloud/wrangler.toml`, `cloud/next.config.mjs`,
  `cloud/package.json`.
- **Admin** = `/admin2` (`cloud/public/**`, served by the same Worker), in git.
- **Admin lock-out rescue**: the password stored in R2
  (`_meta/admin_password.json`, set by the rotation screen) takes precedence
  over the `ADMIN_PASSWORD` Worker secret (see `_getAdminPasswordSource` in
  `cloud/src/worker.ts`). If you are locked out:
  ```
  npx wrangler r2 object delete myfabmesh-meshes/_meta/admin_password.json --remote
  ```
  then log in with the value of the `ADMIN_PASSWORD` secret (must be >= 20
  characters; set it first with `npx wrangler secret put ADMIN_PASSWORD` if
  needed). The user name falls back to `ADMIN_USERNAME`, then `admin`. Note
  that the stored name and password hash are lost by the deletion: rotate them
  again from the admin screen once back in.
- **Database**: re-apply schema from `cloud/sql/schema.sql` +
  `cloud/supabase/migrations/*` (`supabase db push`). User rows/projects live
  in Supabase cloud — they survive a dead PC.
- **R2 assets** (user meshes/images) live in Cloudflare R2 — survive a dead PC.

### 4c. Modal GPU backend (cloud generation/animation)
```
modal deploy modal_app/app.py        # needs `modal token set` (your Modal acct)
# see modal_app/PUPPETEER_DEPLOY.md for the Puppeteer animation engine
```

---

## 5. Sauvegardes (what exists, and its limit)
- **Nightly automatic backup in R2** under `_backup/` (kept 14 days), added on
  2026-10-03 to the Worker's cron (`cloud/src/worker.ts`). Check the prefix
  exists and is recent before relying on it.
- **Full manual copy** to the owner's PC (outside the public repo):
  ```
  cd cloud
  python scripts/sauvegarde-donnees.py            # all of R2 + Supabase tables + auth accounts
  python scripts/sauvegarde-donnees.py --leger    # Supabase + R2 system prefixes + inventory only
  ```
  Destination: `MeshyMyself_sauvegardes/<date>/` next to the repo. Needs
  `cloud/.env.local`. Read-only on production.
- **Backup branches** (`backup-<desc>-<date>`) are pushed to GitHub before any
  structural change (code only, no data, no secrets).
- **Known limit**: everything lives with the same providers (R2 and the
  nightly copy are both Cloudflare; Supabase is one project) or on the same PC
  (the manual copies and the secrets). A Cloudflare account loss, or the loss
  of the PC plus an account, loses data. Periodically copy the manual backup
  to an external disk or another cloud, and keep the provider recovery codes
  off the PC (Step 1).

---

## Appendix A — HuggingFace weights (via `scripts/wizard_download.py`)
| key | repo | ~MB |
|---|---|---|
| trellis2 | `microsoft/TRELLIS.2-4B` | 4100 |
| realvis | `SG161222/RealVisXL_V4.0` | 6500 |
| sdxl_inp | `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` | 6500 |
| cn_pose | `xinsir/controlnet-openpose-sdxl-1.0` | 2400 |
| ipadapter | `h94/IP-Adapter` | 700 |
| florence2 | `microsoft/Florence-2-large` | 1700 |
| blip1 | `Salesforce/blip-image-captioning-large` | 990 |

## Appendix B — what is intentionally NOT in git (and how to re-get it)
- `external/` (~46 GB: model src + venvs + weights) → Step 3a + wizards.
- `node_modules/`, `cloud/node_modules/` → `npm install`.
- `.venv*`, `__pycache__` → wizards / pip.
- `meshes/`, `images/`, `logs/`, `dist/`, `cloud/.next`, `cloud/out` → app
  output / build artifacts; regenerate by running the app / `npm run build`.
- **Secrets** (`.env`, tokens, `config.json`) → regenerate from each provider (Step 1).

## Appendix C — our patches to vendored models
`external_patches/` holds a copy of every file we hand-edit inside the
gitignored `external/` models (TRELLIS-2 Blackwell/sdpa fixes, MV-Adapter,
StableFast3D, UniRig). After a fresh clone of a model, copy the matching files
back. See `external_patches/README.md`.
