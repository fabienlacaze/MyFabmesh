"""BANC (15/10/2026, repris le 18/10/2026) : Pixal3D (Tencent ARC / Tsinghua, SIGGRAPH 2026) contre TRELLIS.2, sur les MEMES entrees.

Application EPHEMERE `myfabmesh-exp-pixal3d` (aucun `modal deploy`), image construite pour Pixal3D, GPU L40S (A100-80GB si la memoire manque).
Rien n'est ecrit dans Supabase, R2 ni dans les projets de l'utilisateur. Les poids et les caches sont sur le volume `exp-pixal3d-cache`.

Entrees (RGBA deja detourees, memes que les essais TRELLIS.2) :
    C:/tmp/trellis_cloud/entrees/orc_rgba_union_sans_socle.png   (orc, graine d'essai 42 ici : Pixal3D n'a pas la meme structure de bruit)
    C:/tmp/trellis_cloud/entrees/photo_reference.png             (photo du proprietaire, detouree : JAMAIS commitee, jamais copiee dans le depot)
Sorties (C:/tmp/trellis_cloud/glb/) : la DERNIERE passe porte le nom attendu par le comparateur (pixal3d_orc.glb, pixal3d_orc_1m.glb, pixal3d_photo.glb), les passes
precedentes pixal3d_<entree>_passe<k>.glb, une variante pixal3d_<entree><etiquette>.glb ; resultats : pixal3d_resultats_<entrees><etiquette>.json (un fichier par
execution), mesures : pixal3d_mesures.json (FUSIONNE a chaque appel), couts : pixal3d_couts.json. Les GLB de la photo sont effaces du volume des qu'ils sont telecharges.

Etapes (chacune reprenable ; `PYTHONUTF8=1 PYTHONIOENCODING=utf-8` obligatoires sous Windows) :
    python -m modal run "modal_app/exp_pixal3d.py::main" --etape verif       # versions, depots HF (licences, tailles), poids, chargement, ~0,3 $
    ... --etape licences                                                     # CPU : textes complets des fiches HF (README, LICENSE, NOTICE) + historique des revisions, ~0 $
    ... --etape importes                                                     # L4, sans poids : distributions pip CHARGEES a l'inference + leurs licences, ~0,02 $
    ... --etape gener --entrees orc --repeter 2 --natif                      # orc : passe 1 (froide : compilation / reglage Triton) puis passe 2 (chaude)
    ... --etape gener --entrees photo --repeter 2                            # photo : passe froide puis chaude
    ... --etape gener --entrees photo --fov 0.349 --etiquette _fov20         # champ de vision IMPOSE (rad) au lieu de l'estimation de MoGe-2 (README : cameras a 20 degres)
    ... --etape gener --max-tokens 98304 --etiquette _t98k                   # variante : plafond de jetons double (resolution effective non reduite)
    ... --etape gener --entrees orc --remesh-project 0.9 --etiquette _proj09 # reglage d'export de la PRODUCTION TRELLIS.2 (defaut de to_glb) au lieu de 0 (auteur de Pixal3D)
    ... --etape mesurer [--tout]                                             # mesures CPU locales des GLB (modal_app/exp_pixal3d_mesures.py) ; --tout : tout refaire
    ... --etape nettoyer [--tout]                                            # vide les sorties du volume (--tout : poids et caches aussi)
    EXP_GPU=A100-80GB ... pour la carte 80 Go.

Ce que fait Pixal3D (README + inference.py du depot, lus le 15 et le 18/10/2026, commit f7cf384 du 01/09/2026, derniere poussee du depot) :
  - branche `master` = version « Trellis.2 backbone » (le README dit `main`) ; flux en cascade 512 -> 1024 -> 1536 (pipeline_type 1536_cascade, plafond de
    49 152 jetons : la resolution baisse de 128 en 128 jusqu'a 1024 si le sujet en demande plus) ; geometrie + couleur PBR (couleur, metal, rugosite, alpha) ;
  - conditionnement « pixel-aligne » : DINOv3 ViT-L/16 + suréchantillonneur NAF (natten) retro-projetes dans la grille 3D avec une camera DEVINEE par MoGe-2
    (FOV) ; sortie alignee sur la vue d'entree ; sortie via o_voxel.postprocess.to_glb (TRELLIS.2) : remaillage dual-contouring + decimation + UV (CuMesh) +
    cuisson (nvdiffrast) + ajustement par BVH (cumesh.cuBVH) ;
  - mode multi-vues (`inference_mv.py`, 01/09/2026) : poids `ckpts/*_mv` du meme depot, cameras connues (transforms.json). NON mesure ici (une seule vue).

Environnement : torch 2.6.0 / cu124 / Python 3.10 = celui du Space HF de l'auteur (requirements-hfdemo.txt) ET le `setup.sh --new-env` de TRELLIS.2, PAS la base
torch 2.4.1 / Python 3.11 de modal_app/app.py (natten 0.17.5 a une roue officielle torch 2.6 / cu124 sur la page des versions de SHI-Labs/NATTEN, 474 Mo,
sha256 daa43925... ; flash-attn 2.7.4.post1 aussi). Aucune dependance au fork TRELLIS2_win.
Ecarts assumes avec le depot de l'auteur : natten 0.17.5 (API na2d_qk / na2d_av : NAF essaie d'abord cette API, celle de ses auteurs, puis na2d de natten >= 0.20)
au lieu de la 0.21.0 compilee ; MoGe fige au dernier commit d'avant V3 (0744441, 02/11/2025) car `git+https://github.com/microsoft/MoGe.git` (requirements.txt)
pointe aujourd'hui sur MoGe-3 (V3 du 19/08/2026, autres dependances) ; FlexGEMM v1.0.0 (version eprouvee par notre image TRELLIS.2 ; l'auteur publie lui aussi
une roue flex_gemm-1.0.0) ; flash-attn 2.7.4.post1 en roue au lieu de 2.7.3 compile (setup.sh de TRELLIS.2).

OU EST nvdiffrast (NVIDIA Source Code License « 1-Way Commercial » = usage NON commercial pour un tiers ; installe POUR LE BANC SEULEMENT) :
  - chemin d'inference de Pixal3D : UNIQUEMENT via `import o_voxel` (o_voxel/__init__.py importe postprocess.py) -> postprocess.py:10 (import), :230
    (dr.RasterizeCudaContext), :237 (dr.rasterize), :249 (dr.interpolate) ; to_glb s'en sert pour cuire l'atlas. `import o_voxel` est fait par inference.py:17 et par
    pixal3d/models/sc_vaes/fdg_vae.py:20 : nvdiffrast est donc IMPORTE a chaque inference, meme sans cuisson ;
  - hors inference (entrainement / visualisation, jamais charges par le pipeline) : pixal3d/renderers/mesh_renderer.py:45 et :85, pbr_mesh_renderer.py:22, :57,
    :220, :262 (imports differes dans les fonctions) + `from nvdiffrec_render.light import EnvironmentLight` (pbr_mesh_renderer.py:46) ;
    pixal3d/pipelines/trellis2_texturing.py:13 (import de tete, pipeline de texturage TRELLIS.2 non utilise par Pixal3D, charge a la demande seulement).
  Substitution propre (non essayee ici) : le meme remplacement que notre image TRELLIS.2 (modal_app/app.py, mesh_image) — repointer l'UNIQUE import
  `import nvdiffrast.torch as dr` de o_voxel/postprocess.py sur le module de compatibilite kaolin (Apache-2.0, trellis2/renderers/nvdiffrast_kaolin_compat.py : RasterizeCudaContext,
  rasterize, interpolate suffisent a to_glb) + le faux paquet `nvdiffrast` paresseux que kaolin sonde ; ou external_patches/TRELLIS2_win/o_voxel_patch.py (PyTorch pur).

Historique : 15/10 l'etape `verif` a tourne (image construite en ~13 min de CPU, chargement du pipeline 81,8 s, MoGe-2 10,8 s, 19,4 Go de VRAM, 0,26 $ factures) ;
la generation n'avait JAMAIS ete lancee. 18/10 : relecture critique (sonde de memoire du PERIPHERIQUE et pic reserve par etape, decomposition de l'export GLB, etape
« upsample » visible, plafond de jetons parametrable, une sortie par passe, resultats par execution, mesures fusionnees, paquets reellement charges, etape `licences`),
puis executions : orc (2 passes + 1 M de faces), photo (2 passes), 2e serie en conteneurs neufs a caches disque remplis, photo a champ de vision impose. Resultats, durees,
couts et licences : entree du 18/10/2026 de AGENT_LOG.md. Tests des parties pures : build/bancs/noyaux/test_pixal3d_outils.py et test_pixal3d_mesures.py.
"""
import contextlib
import io
import json
import os
import re
import subprocess
import sys
import time
import traceback

import modal

APP_NOM = "myfabmesh-exp-pixal3d"
GPU = os.environ.get("EXP_GPU", "L40S")
TARIFS_GPU_S = {"L40S": 0.000542, "A100-80GB": 0.000694, "A100": 0.000583, "H100": 0.001097}      # $/s (Modal, ordre de grandeur)
SORTIE = "C:/tmp/trellis_cloud"
ENTREES = {
    "orc": SORTIE + "/entrees/orc_rgba_union_sans_socle.png",
    "photo": SORTIE + "/entrees/photo_reference.png",
}

# ------------------------------------------------------------------ versions figees (lues sur GitHub le 15/10/2026, reverifiees le 18/10/2026)
PIXAL3D_COMMIT = "f7cf38429b0bd264f1995f0f8743a88b1c728b94"      # master, 01/09/2026 « feat: support multi-view image input » (derniere poussee du depot)
TRELLIS2_COMMIT = "75fbf0183001ed9876c8dbb35de6b68552ee08bd"     # main ; o-voxel/ inchange depuis la sortie initiale du 09/12/2025 (aucun commit ne le touche ensuite)
CUMESH_COMMIT = "12289e1"                                         # 09/05/2026, tete de main (avant la sortie de Pixal3D le 12/05) ; sous-module cubvh : voir la licence
FLEXGEMM_TAG = "v1.0.0"                                           # tag utilise par notre image TRELLIS.2 (mesh_image)
NVDIFFRAST_TAG = "v0.4.0"                                         # setup.sh de TRELLIS.2
MOGE_COMMIT = "0744441"                                           # 02/11/2025 ; HEAD = V3 du 19/08/2026 (dependances changees)
URL_FLASH = ("https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/"
             "flash_attn-2.7.4.post1+cu12torch2.6cxx11abiFALSE-cp310-cp310-linux_x86_64.whl")
URL_NATTEN = ("https://github.com/SHI-Labs/NATTEN/releases/download/v0.17.5/"
              "natten-0.17.5%2Btorch260cu124-cp310-cp310-linux_x86_64.whl")
URL_UTILS3D = "https://github.com/LDYang694/Storages/releases/download/20260430/utils3d-0.0.2-py3-none-any.whl"   # README Pixal3D, etape 4

DEPOTS_HF = [          # depots lus par le chemin d'inference (+ ceux a comparer) : licence, tags, tailles, empreintes
    "TencentARC/Pixal3D",
    "Ruicheng/moge-2-vitl",
    "camenduru/dinov3-vitl16-pretrain-lvd1689m",
    "facebook/dinov3-vitl16-pretrain-lvd1689m",
    "microsoft/TRELLIS-image-large",
    "ZhengPeng7/BiRefNet",
    "briaai/RMBG-2.0",
]

# parametres d'echantillonnage = valeurs par defaut de inference.py::run_inference
SS = {"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.7, "rescale_t": 5.0}
SHAPE = {"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.5, "rescale_t": 3.0}
TEX = {"steps": 12, "guidance_strength": 1.0, "guidance_rescale": 0.0, "rescale_t": 3.0}
ROT_EXPORT = [[-1, 0, 0, 0], [0, 0, -1, 0], [0, -1, 0, 0], [0, 0, 0, 1]]          # inference.py : rotation appliquee au GLB avant l'export
MAX_JETONS_DEFAUT = 49152                                                          # inference.py : max_num_tokens

vol = modal.Volume.from_name("exp-pixal3d-cache", create_if_missing=True)
SECRETS = [modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])]

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.10")
    .apt_install("git", "ninja-build", "build-essential", "libjpeg-dev", "libeigen3-dev",
                 "libgl1", "libglib2.0-0", "libsm6", "libxext6", "libxrender-dev")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", extra_options="--index-url https://download.pytorch.org/whl/cu124")
    .pip_install("wheel>=0.42", "setuptools>=68", "packaging", "ninja")
    .env({"CC": "gcc", "CXX": "g++", "CUDA_HOME": "/usr/local/cuda", "TORCH_CUDA_ARCH_LIST": "8.0;8.9", "FORCE_CUDA": "1", "MAX_JOBS": "4"})
    # --- extensions CUDA (memes recettes que mesh_image de modal_app/app.py, sources amont, versions figees)
    .run_commands(
        "git clone --recursive https://github.com/JeffreyXiang/CuMesh.git /opt/CuMesh"
        " && cd /opt/CuMesh && git checkout %s && git submodule update --init --recursive" % CUMESH_COMMIT,
        "pip install /opt/CuMesh --no-build-isolation --no-deps",
    )
    .run_commands(
        "git clone --depth 1 --branch %s --recursive https://github.com/JeffreyXiang/FlexGEMM.git /opt/FlexGEMM" % FLEXGEMM_TAG,
        "pip install /opt/FlexGEMM --no-build-isolation --no-deps",
    )
    .run_commands(
        "git clone https://github.com/microsoft/TRELLIS.2.git /opt/TRELLIS.2 && cd /opt/TRELLIS.2 && git checkout %s" % TRELLIS2_COMMIT,
        # le sous-module Eigen d'o-voxel est vide dans un clone sans --recursive : on le remplit depuis libeigen3-dev (recette de mesh_image)
        "mkdir -p /opt/TRELLIS.2/o-voxel/third_party/eigen && cp -r /usr/include/eigen3/Eigen /opt/TRELLIS.2/o-voxel/third_party/eigen/Eigen",
        "pip install /opt/TRELLIS.2/o-voxel --no-build-isolation --no-deps",
    )
    .run_commands(
        # BANC SEULEMENT : nvdiffrast (licence NVIDIA non commerciale). Le plugin CUDA se compile au premier usage (cache sur le volume).
        "git clone --depth 1 --branch %s https://github.com/NVlabs/nvdiffrast.git /opt/nvdiffrast" % NVDIFFRAST_TAG,
        "pip install /opt/nvdiffrast --no-build-isolation --no-deps",
    )
    # --- dependances Python du depot (requirements.txt de l'auteur, hors gradio et MoGe)
    .pip_install(
        "numpy==2.2.6", "scipy", "pillow==12.0.0", "imageio==2.37.2", "imageio-ffmpeg==0.6.0", "tqdm==4.67.1", "easydict==1.13",
        "opencv-python-headless==4.12.0.88", "trimesh==4.10.1", "transformers==4.57.3", "zstandard==0.25.0", "kornia==0.8.2",
        "timm==1.0.22", "diffusers==0.37.1", "accelerate==1.13.0", "plyfile==1.1.3",
        "einops", "safetensors", "huggingface_hub>=0.34,<1.0", "click", "matplotlib", "requests",
    )
    .run_commands(
        "pip install --no-deps '%s'" % URL_FLASH,
        "pip install --no-deps '%s'" % URL_NATTEN,
    )
    .run_commands(
        "git clone https://github.com/microsoft/MoGe.git /opt/MoGe && cd /opt/MoGe && git checkout %s" % MOGE_COMMIT,
        "pip install --no-deps /opt/MoGe",
        "pip install --force-reinstall --no-deps '%s'" % URL_UTILS3D,
        "git clone https://github.com/TencentARC/Pixal3D.git /opt/Pixal3D && cd /opt/Pixal3D && git checkout %s" % PIXAL3D_COMMIT,
    )
    .run_commands(
        # GARDES DE CONSTRUCTION : presence seulement (flex_gemm interroge le GPU a l'import, absent a la construction)
        "python -c \"import importlib.util as u; m=[p for p in ['cumesh','o_voxel','flex_gemm','flash_attn','natten','nvdiffrast',"
        "'transformers','moge','utils3d','trimesh','cv2','kornia','timm','easydict','einops','scipy','huggingface_hub'] "
        "if u.find_spec(p) is None]; assert not m, m; print('paquets presents')\"",
        "python -c \"import torch, triton, numpy; print('torch', torch.__version__, 'cuda', torch.version.cuda, 'triton', triton.__version__, 'numpy', numpy.__version__)\"",
    )
    .env({"HF_HOME": "/cache/hf", "TORCH_HOME": "/cache/torch", "TORCH_EXTENSIONS_DIR": "/cache/torch_ext", "TRITON_CACHE_DIR": "/cache/triton",
          "ATTN_BACKEND": "flash_attn", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True", "OPENCV_IO_ENABLE_OPENEXR": "1"})
    .add_local_python_source("modal_app")
)
# image LEGERE (CPU) pour l'etape `licences` : lire des fiches HF n'exige ni torch ni les extensions CUDA
image_legere = modal.Image.debian_slim(python_version="3.11").pip_install("huggingface_hub>=0.34,<1.0")
app = modal.App(APP_NOM, image=image)


# ================================================================================ utilitaires du conteneur
def _log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def _j(o):
    from modal_app.exp_pixal3d_mesures import _j as j
    return j(o)


def _cmd(*args, **kw):
    try:
        return subprocess.run(list(args), capture_output=True, text=True, timeout=kw.get("timeout", 120)).stdout.strip()
    except Exception as e:
        return "ERREUR %r" % (e,)


def _gpu_occupe_Go():
    """Memoire GPU occupee sur TOUT le peripherique, vue du pilote (cudaMemGetInfo), en Go."""
    import torch
    libre, total = torch.cuda.mem_get_info()
    return (total - libre) / 1e9


class Chrono:
    """Duree et pics memoire de chaque etape (synchronise la carte avant et apres). Deux pics : celui de l'allocateur de PyTorch
    (`pic_alloue_Go`) et celui du PERIPHERIQUE (`pic_peripherique_Go`, sonde en arriere-plan : voit aussi CuMesh, cuBVH, nvdiffrast, Triton)."""

    def __init__(self, sonde=None):
        self.etapes = []
        self.pic_global_Go = 0.0
        self.pic_reserve_global_Go = 0.0
        self.pic_peripherique_global_Go = 0.0
        self.sonde = sonde

    @contextlib.contextmanager
    def etape(self, nom, **extra):
        import torch
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()
        if self.sonde is not None:
            self.sonde.reinitialiser()
        t0 = time.time()
        try:
            yield
        finally:
            torch.cuda.synchronize()
            dt = time.time() - t0
            pic = torch.cuda.max_memory_allocated() / 1e9
            pic_res = torch.cuda.max_memory_reserved() / 1e9
            self.pic_global_Go = max(self.pic_global_Go, pic)
            self.pic_reserve_global_Go = max(self.pic_reserve_global_Go, pic_res)
            ligne = dict({"etape": nom, "s": round(dt, 2), "pic_alloue_Go": round(pic, 2), "pic_reserve_Go": round(pic_res, 2)}, **extra)
            if self.sonde is not None:
                pic_p = self.sonde.lire_pic()
                self.pic_peripherique_global_Go = max(self.pic_peripherique_global_Go, pic_p)
                ligne["pic_peripherique_Go"] = round(pic_p, 2)
            self.etapes.append(ligne)
            _log("[etape] %-44s %7.1f s   pic torch %5.1f Go   pic carte %s" % (nom, dt, pic, ("%5.1f Go" % ligne["pic_peripherique_Go"]) if "pic_peripherique_Go" in ligne else "  -"))


def _preparer_env():
    """Variables et fichiers a mettre en place AVANT l'import de torch / de inference.py."""
    os.makedirs("/cache/out", exist_ok=True)
    for d in ("hf", "torch", "torch_ext", "triton"):
        os.makedirs("/cache/" + d, exist_ok=True)
    if "/opt/Pixal3D" not in sys.path:
        sys.path.insert(0, "/opt/Pixal3D")
    # inference.py fixe FLEX_GEMM_AUTOTUNE_CACHE_PATH sur <depot>/autotune_cache.json : copie entrante / sortante vers le volume
    # (le reglage des noyaux Triton coute 2-4 min par tranche de taille inconnue, voir CLAUDE.md section 12)
    if os.path.exists("/cache/pixal3d_autotune_cache.json"):
        subprocess.run(["cp", "/cache/pixal3d_autotune_cache.json", "/opt/Pixal3D/autotune_cache.json"])


def _sauver_caches():
    if os.path.exists("/opt/Pixal3D/autotune_cache.json"):
        subprocess.run(["cp", "/opt/Pixal3D/autotune_cache.json", "/cache/pixal3d_autotune_cache.json"])
    vol.commit()


def _versions():
    import importlib.metadata as md
    v = {"python": sys.version.split()[0]}
    for p in ["torch", "torchvision", "triton", "flash_attn", "natten", "transformers", "numpy", "scipy", "trimesh", "Pillow", "opencv-python-headless",
              "kornia", "timm", "diffusers", "accelerate", "huggingface_hub", "safetensors", "einops", "utils3d", "moge", "o_voxel", "cumesh", "flex_gemm",
              "nvdiffrast"]:
        try:
            v[p] = md.version(p)
        except Exception:
            v[p] = None
    import torch
    v["cuda_torch"] = torch.version.cuda
    v["gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    v["vram_totale_Go"] = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1) if torch.cuda.is_available() else None
    v["nvidia_smi"] = _cmd("nvidia-smi", "--query-gpu=name,memory.total,driver_version,compute_cap", "--format=csv,noheader")
    for nom, chemin in [("Pixal3D", "/opt/Pixal3D"), ("TRELLIS.2", "/opt/TRELLIS.2"), ("CuMesh", "/opt/CuMesh"), ("FlexGEMM", "/opt/FlexGEMM"),
                        ("nvdiffrast", "/opt/nvdiffrast"), ("MoGe", "/opt/MoGe")]:
        v["commit_" + nom] = _cmd("git", "-C", chemin, "rev-parse", "HEAD")
    return v


def _licences_pip():
    """Licence declaree par les metadonnees de CHAQUE paquet installe (champ License / License-Expression / classifieurs)."""
    import importlib.metadata as md
    sortie = {}
    for d in md.distributions():
        m = d.metadata
        nom = m.get("Name")
        if not nom:
            continue
        lic = m.get("License-Expression")
        if not lic:
            brut = (m.get("License") or "").strip()
            lic = brut.splitlines()[0][:100] if brut else None
        classes = [c.split("::")[-1].strip() for c in (m.get_all("Classifier") or []) if c.startswith("License ::")]
        sortie[nom] = {"version": d.version, "licence": lic or None, "classifieurs": classes[:3]}
    return dict(sorted(sortie.items(), key=lambda kv: kv[0].lower()))


def _licences_depots_locaux():
    """Premiers mots de chaque fichier de licence des sources compilees (au commit fige), y compris les sous-modules de CuMesh (cubvh...)."""
    sortie = {}
    for racine in ["/opt/Pixal3D", "/opt/TRELLIS.2", "/opt/CuMesh", "/opt/FlexGEMM", "/opt/nvdiffrast", "/opt/MoGe"]:
        trouves = subprocess.run(
            ["find", racine, "-maxdepth", "6", "(", "-iname", "LICENSE*", "-o", "-iname", "COPYING*", "-o", "-iname", "NOTICE*", ")", "-type", "f",
             "-not", "-path", "*/.git/*", "-not", "-path", "*/eigen/*"],
            capture_output=True, text=True).stdout.split()
        for chemin in sorted(trouves)[:40]:
            try:
                with open(chemin, encoding="utf-8", errors="replace") as fh:
                    t = fh.read(900)
                sortie[chemin] = " ".join(t.split())[:330]
            except Exception as e:
                sortie[chemin] = "ERREUR %r" % (e,)
    return sortie


def _inventaire_hf():
    from huggingface_hub import HfApi, hf_hub_download
    api = HfApi()
    sortie = {}
    for repo in DEPOTS_HF:
        r = {}
        try:
            info = api.model_info(repo, files_metadata=True)
            cd = getattr(info, "card_data", None)
            try:
                lic = cd.to_dict().get("license") if cd is not None else None
            except Exception:
                lic = getattr(cd, "license", None)
            fichiers = []
            for s in (info.siblings or []):
                lfs = getattr(s, "lfs", None)
                sha = None
                if lfs:
                    sha = lfs.get("sha256") if isinstance(lfs, dict) else getattr(lfs, "sha256", None)
                fichiers.append({"nom": s.rfilename, "Mo": round((s.size or 0) / 1e6, 1), "sha256": sha})
            r.update({"licence_fiche": lic, "tags_licence": [t for t in (info.tags or []) if t.startswith("license")], "gated": info.gated,
                      "sha_depot": info.sha, "derniere_modification": str(info.last_modified), "n_fichiers": len(fichiers),
                      "total_Go": round(sum(f["Mo"] for f in fichiers) / 1000.0, 2), "fichiers": fichiers[:60]})
            for nom in [f["nom"] for f in fichiers if f["nom"].upper().split(".")[0] in ("LICENSE", "NOTICE", "README", "LICENCE") and f["Mo"] < 0.3][:3]:
                try:
                    with open(hf_hub_download(repo, nom), encoding="utf-8", errors="replace") as fh:
                        r["texte_" + nom] = fh.read(2600)
                except Exception as e:
                    r["texte_" + nom] = "ILLISIBLE %r" % (str(e)[:120],)
        except Exception as e:
            r["erreur"] = repr(e)[:300]
        sortie[repo] = r
    # le miroir DINOv3 est-il octet pour octet celui de Meta ? (empreintes SHA-256 du fichier de poids)
    try:
        a = {f["nom"]: f["sha256"] for f in sortie["camenduru/dinov3-vitl16-pretrain-lvd1689m"].get("fichiers", [])}
        b = {f["nom"]: f["sha256"] for f in sortie["facebook/dinov3-vitl16-pretrain-lvd1689m"].get("fichiers", [])}
        comm = [n for n in a if n in b and n.endswith(".safetensors")]
        sortie["_dinov3_miroir_identique_a_meta"] = {n: (a[n] == b[n] and a[n] is not None) for n in comm}
    except Exception as e:
        sortie["_dinov3_miroir_identique_a_meta"] = "inconnu : %r" % (e,)
    return sortie


def _telecharger_poids():
    """Telecharge pipeline.json puis SEULEMENT les points de controle de la cascade mono-vue (pas les *_mv)."""
    from huggingface_hub import hf_hub_download, snapshot_download
    local = "/cache/pixal3d_weights"
    chemin = hf_hub_download("TencentARC/Pixal3D", "pipeline.json", local_dir=local)
    cfg = json.load(open(chemin, encoding="utf-8"))
    modeles = cfg["args"]["models"]
    modifie = False
    for k, v in list(modeles.items()):                       # references absolues au depot lui-meme -> relatives (sinon double telechargement)
        if isinstance(v, str) and v.startswith("TencentARC/Pixal3D/"):
            modeles[k] = v[len("TencentARC/Pixal3D/"):]
            modifie = True
    if modifie:
        with open(chemin, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, indent=1)
    voulus = ["sparse_structure_flow_model", "sparse_structure_decoder", "shape_slat_flow_model_512", "shape_slat_flow_model_1024",
              "shape_slat_decoder", "tex_slat_flow_model_512", "tex_slat_flow_model_1024", "tex_slat_decoder"]
    motifs, externes = ["pipeline.json"], {}
    for k in voulus:
        v = modeles.get(k)
        if v is None:
            continue
        if v.startswith("ckpts/"):
            motifs += [v + ".json", v + ".safetensors"]
        else:
            externes[k] = v                                  # autre depot HF (ex. microsoft/TRELLIS-image-large) : lu au chargement
    t0 = time.time()
    snapshot_download("TencentARC/Pixal3D", local_dir=local, allow_patterns=motifs)
    octets = 0
    for m in motifs:
        p = os.path.join(local, m)
        if os.path.exists(p):
            octets += os.path.getsize(p)
    return {"dossier": local, "duree_s": round(time.time() - t0, 1), "Go_telecharges": round(octets / 1e9, 2), "fichiers_voulus": motifs,
            "modeles_externes": externes, "pipeline_json": cfg}


def _neutraliser_rembg(cfg):
    """Entrees RGBA deja detourees : le modele de detourage n'est jamais appele. On ne charge ni BiRefNet ni RMBG-2.0 (briaai, non commercial) :
    on met une coquille vide a leur place (meme methode que notre image TRELLIS.2) et on releve ce que pipeline.json demandait."""
    import pixal3d.pipelines.rembg as rb
    demande = cfg["args"].get("rembg_model", {})

    class RembgInutile:
        def __init__(self, *a, **k):
            self.args = (a, k)

        def to(self, *_):
            return None

        def cuda(self):
            return None

        def cpu(self):
            return None

        def __call__(self, image):
            raise RuntimeError("detourage desactive dans le banc : entrees RGBA")

    setattr(rb, demande.get("name", "BiRefNet"), RembgInutile)
    return demande


def _charger_modele(chrono, low_vram=False):
    """Pipeline + MoGe-2, comme inference.py::init_pipeline / load_moge_model."""
    import importlib.util
    _preparer_env()
    spec = importlib.util.spec_from_file_location("pixal3d_inference", "/opt/Pixal3D/inference.py")
    inf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(inf)                              # fixe aussi FLEX_GEMM_AUTOTUNE_CACHE_PATH sur le depot
    poids = _telecharger_poids()
    rembg_demande = _neutraliser_rembg(poids["pipeline_json"])
    with chrono.etape("chargement_pipeline (8 modeles + 4 DINOv3 + NAF)"):
        pipeline = inf.init_pipeline(poids["dossier"], low_vram=low_vram)
    with chrono.etape("chargement_MoGe-2"):
        moge = inf.load_moge_model(device="cuda")
    return inf, pipeline, moge, {"poids": {k: v for k, v in poids.items() if k != "pipeline_json"}, "rembg_demande_par_pipeline_json": rembg_demande}


def _instrumenter(pipeline, chrono):
    """Chronometre chaque etape de pipeline.run sans toucher au code de l'auteur (enveloppes d'instance, sans imbrication)."""
    jetons = {}

    def envelopper(objet, nom_methode, nom_etape, extra=None):
        orig = getattr(objet, nom_methode)

        def f(*a, **k):
            nom = nom_etape(a, k) if callable(nom_etape) else nom_etape
            with chrono.etape(nom):
                r = orig(*a, **k)
            if extra:
                extra(nom, a, k, r)
            return r
        setattr(objet, nom_methode, f)

    def nom_sampler(a, k):
        from modal_app.exp_pixal3d_outils import nom_etape_sampler
        return nom_etape_sampler(k.get("tqdm_desc", ""))

    def noter_jetons(nom, a, k, r):
        noise = a[1] if len(a) > 1 else k.get("noise")
        c = getattr(noise, "coords", None)
        jetons[nom] = int(c.shape[0]) if c is not None else list(getattr(noise, "shape", []))

    for s in (pipeline.sparse_structure_sampler, pipeline.shape_slat_sampler, pipeline.tex_slat_sampler):
        envelopper(s, "sample", nom_sampler, noter_jetons)

    envelopper(pipeline, "get_proj_cond_ss", "conditionnement SS (DINOv3 + NAF + projection)")
    try:                                  # etape 3a de pipeline.run : jusqu'ici invisible, elle porte le reglage des noyaux Triton a froid (72 a 191 s)
        envelopper(pipeline.models["shape_slat_decoder"], "upsample", "upsample LR -> HR (decodeur de forme, convolutions creuses)")
    except Exception as e:
        _log("etape upsample non instrumentee :", repr(e)[:160])

    def nom_cond(a, k):
        m = a[0] if a else k.get("image_cond_model")
        if m is pipeline.image_cond_model_shape_512:
            return "conditionnement forme 512 (DINOv3 + NAF)"
        if m is pipeline.image_cond_model_shape_1024:
            return "conditionnement forme 1024 (DINOv3 + NAF)"
        return "conditionnement texture 1024 (DINOv3 + NAF 1024)"
    envelopper(pipeline, "get_proj_cond_shape", nom_cond)
    envelopper(pipeline, "decode_latent", "decodage des latents (forme + texture + fill_holes)")
    return jetons


def _cibles_export():
    """Appels couteux de o_voxel.postprocess.to_glb a chronometrer (modal_app/exp_pixal3d_outils.decomposer). Appelants de plus haut niveau seulement :
    pas de `read` / `init` (ils sont aussi appeles DANS uv_unwrap et le remaillage, les durees s'additionneraient deux fois)."""
    import cv2
    import cumesh
    import cumesh.remeshing as remaillage
    import o_voxel.postprocess as pp
    return [
        (cumesh.CuMesh, "fill_holes", "cumesh.fill_holes"),
        (cumesh.cuBVH, "__init__", "cumesh.cuBVH (construction)"),
        (remaillage, "remesh_narrow_band_dc", "cumesh.remesh_narrow_band_dc (dual contouring)"),
        (cumesh.CuMesh, "simplify", "cumesh.simplify (decimation)"),
        (cumesh.CuMesh, "uv_unwrap", "cumesh.uv_unwrap (depliage UV)"),
        (pp.dr, "rasterize", "nvdiffrast.rasterize (atlas)"),
        (pp.dr, "interpolate", "nvdiffrast.interpolate"),
        (cumesh.cuBVH, "unsigned_distance", "cuBVH.unsigned_distance (projection sur le maillage brut)"),
        (pp, "grid_sample_3d", "flex_gemm.grid_sample_3d (couleur / PBR par voxel)"),
        (cv2, "inpaint", "cv2.inpaint (retouches d'atlas, CPU)"),
    ]


SUSPECTS = ["plyfile", "easydict", "nvdiffrast", "nvdiffrec_render", "kornia", "timm", "diffusers", "imageio", "gradio", "rembg", "moge", "natten", "flash_attn",
            "cumesh", "flex_gemm", "o_voxel", "utils3d", "transformers", "xformers", "spconv", "torchsparse", "kaolin"]


def _paquets_charges():
    """Distributions pip dont au moins un module de premier niveau est EN MEMOIRE, avec leur licence declaree + modules suspects charges ou non. Les modules de premier
    niveau sont lus dans `top_level.txt` ou, a defaut, deduits des fichiers installes (Python 3.10 : `packages_distributions()` ignore les paquets sans `top_level.txt`)."""
    import importlib.metadata as md
    from modal_app.exp_pixal3d_outils import tops_de_distribution
    licences = _licences_pip()
    tops_en_memoire = {m.split(".")[0] for m in list(sys.modules) if m and not m.startswith("_")}
    charges = {}
    for d in md.distributions():
        nom = d.metadata.get("Name")
        if not nom or nom not in licences:
            continue
        try:
            tops = tops_de_distribution(d.read_text("top_level.txt"), [str(f) for f in (d.files or [])])
        except Exception:
            continue
        via = sorted(tops & tops_en_memoire)
        if via:
            charges[nom] = dict(licences[nom], via=via[:4])
    return {"distributions_chargees": dict(sorted(charges.items(), key=lambda kv: kv[0].lower())), "suspects": {m: (m in sys.modules) for m in SUSPECTS},
            "n_modules": len(sys.modules)}


def _rgba_vers_pil(octets):
    from PIL import Image
    return Image.open(io.BytesIO(octets))


def _un_passage(nom, png, inf, pipeline, moge, chrono, jetons, params, passe, derniere, etiquette=""):
    """Une generation complete : pretraitement, camera MoGe-2, cascade, export GLB. Rend le dict de mesures (les GLB sont sur le volume)."""
    import numpy as np
    import o_voxel
    import torch
    from modal_app.exp_pixal3d_outils import Accumulateur, decomposer

    res = {"nom": nom, "passe": passe}
    chrono.etapes.clear()
    jetons.clear()
    chrono.pic_global_Go = 0.0
    chrono.pic_reserve_global_Go = 0.0
    chrono.pic_peripherique_global_Go = 0.0
    t_total = time.time()
    img = _rgba_vers_pil(png)
    res["entree"] = {"mode": img.mode, "taille": list(img.size)}
    with chrono.etape("pretraitement_image (recadrage + fond noir)"):
        pre = pipeline.preprocess_image(img)
    res["entree_preparee"] = {"taille": list(pre.size)}
    tmp = "/tmp/pre_%s.png" % nom
    pre.save(tmp)
    if params["fov"] > 0:
        camera = {"camera_angle_x": float(params["fov"]), "mesh_scale": 1.0}
        camera["distance"] = inf.distance_from_fov(camera["camera_angle_x"], torch.tensor([-1.0, 0.0, 0.0]),
                                                   torch.tensor([0.0, 511.0]), 1.0, 512)["distance_from_x"]
        res["camera_source"] = "fov manuel %.3f rad" % params["fov"]
    else:
        with chrono.etape("estimation_camera (MoGe-2)"):
            camera = inf.get_camera_params_wild_moge(tmp, moge, device="cuda", mesh_scale=1.0, extend_pixel=0, image_resolution=512)
        res["camera_source"] = "MoGe-2"
    res["camera"] = camera
    os.remove(tmp)

    pipeline_type = "%d_cascade" % params["resolution"]
    t_run = time.time()
    torch.cuda.synchronize()
    mesh_list, (shape_slat, tex_slat, reso) = pipeline.run(
        pre, camera_params=camera, seed=params["seed"], sparse_structure_sampler_params=SS, shape_slat_sampler_params=SHAPE,
        tex_slat_sampler_params=TEX, preprocess_image=False, return_latent=True, pipeline_type=pipeline_type, max_num_tokens=params["max_tokens"])
    torch.cuda.synchronize()
    res["duree_pipeline_run_s"] = round(time.time() - t_run, 1)
    res["resolution_demandee"] = params["resolution"]
    res["resolution_effective"] = int(reso)
    res["max_jetons"] = params["max_tokens"]
    res["jetons"] = dict(jetons)
    mesh = mesh_list[0]
    res["maillage_brut"] = {"sommets": int(mesh.vertices.shape[0]), "faces": int(mesh.faces.shape[0]),
                            "voxels_couleur": int(mesh.coords.shape[0]), "canaux_couleur": int(mesh.attrs.shape[1])}
    _log("maillage brut :", res["maillage_brut"], "resolution effective", reso)
    del shape_slat, tex_slat
    torch.cuda.empty_cache()

    sorties = {}
    cibles = [("", params["faces"])] + ([("_1m", 1_000_000)] if (params["natif"] and derniere) else [])
    res["export_decomposition"] = {}
    for suffixe, nb_faces in cibles:
        glb, atlas_utilise = None, None
        for atlas_essai in ([params["atlas"]] + ([2048] if params["atlas"] > 2048 else [])):
            acc = Accumulateur()
            try:
                with chrono.etape("export_glb%s (remaillage + decimation %d + UV + cuisson %d)" % (suffixe, nb_faces, atlas_essai)):
                    try:
                        cadre = decomposer(_cibles_export(), acc, sync=torch.cuda.synchronize)
                    except Exception as e:                       # l'instrumentation ne doit JAMAIS faire perdre la generation
                        _log("decomposition de l'export indisponible :", repr(e)[:200])
                        cadre = contextlib.nullcontext()
                    with cadre:
                        glb = o_voxel.postprocess.to_glb(
                            vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
                            attr_layout=pipeline.pbr_attr_layout, grid_size=reso, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                            decimation_target=nb_faces, texture_size=atlas_essai, remesh=True, remesh_band=1, remesh_project=params["remesh_project"], use_tqdm=False)
                atlas_utilise = atlas_essai
                break
            except torch.cuda.OutOfMemoryError:
                _log("MEMOIRE INSUFFISANTE a l'export (atlas %d)" % atlas_essai)
                torch.cuda.empty_cache()
                res.setdefault("replis", []).append("export%s : memoire GPU insuffisante avec un atlas de %d" % (suffixe, atlas_essai))
        if glb is None:
            raise RuntimeError("export GLB impossible, meme avec un atlas de 2048 (memoire GPU)")
        res["export_decomposition"][suffixe or "principal"] = {"appels": acc.resume(), "total_mesure_s": acc.total(), "cibles_introuvables": list(acc.ignorees)}
        glb.apply_transform(np.array(ROT_EXPORT, dtype=np.float64))
        from modal_app.exp_pixal3d_outils import chemin_glb_volume
        chemin = chemin_glb_volume(nom, etiquette, passe, suffixe)
        with chrono.etape("ecriture_glb%s (WebP)" % suffixe):
            glb.export(chemin, extension_webp=True)
        sorties[suffixe or "principal"] = {"chemin": chemin, "octets": os.path.getsize(chemin), "faces_cible": nb_faces, "atlas_demande": params["atlas"],
                                          "atlas_utilise": atlas_utilise, "faces": int(len(glb.faces)), "sommets": int(len(glb.vertices))}
        del glb
        torch.cuda.empty_cache()
    res["glb"] = sorties
    res["duree_totale_s"] = round(time.time() - t_total, 1)
    res["etapes"] = [dict(e) for e in chrono.etapes]
    res["pic_alloue_global_Go"] = round(chrono.pic_global_Go, 2)
    res["pic_peripherique_global_Go"] = round(chrono.pic_peripherique_global_Go, 2)
    res["pic_reserve_global_Go"] = round(chrono.pic_reserve_global_Go, 2)
    del mesh, mesh_list
    return res


# ================================================================================ fonctions Modal
@app.function(gpu=GPU, timeout=3000, secrets=SECRETS, volumes={"/cache": vol})
def verifier() -> dict:
    """Versions, licences, depots HF, poids, chargement complet sur la carte, chauffe du plugin nvdiffrast. Aucune generation."""
    import torch
    t0 = time.time()
    _preparer_env()
    out = {"gpu_demande": GPU}
    chrono = Chrono()
    out["versions"] = _versions()
    _log("versions :", json.dumps(out["versions"], indent=0)[:1800])
    out["licences_pip"] = _licences_pip()
    out["licences_depots_locaux"] = _licences_depots_locaux()
    out["depots_hf"] = _inventaire_hf()
    for repo, r in out["depots_hf"].items():
        if isinstance(r, dict):
            _log("[HF] %-48s licence=%s tags=%s gated=%s fichiers=%s total=%s Go" % (repo, r.get("licence_fiche"), r.get("tags_licence"), r.get("gated"),
                                                                                 r.get("n_fichiers"), r.get("total_Go")))
    try:
        inf, pipeline, moge, info = _charger_modele(chrono)
        out["chargement"] = info
        _log("pipeline.json :", json.dumps(info["poids"]["modeles_externes"]), "| rembg demande :", info["rembg_demande_par_pipeline_json"])
        out["vram_apres_chargement_Go"] = round(torch.cuda.memory_allocated() / 1e9, 2)
        # chauffe du plugin nvdiffrast (compilation JIT, cache sur le volume) et du rasteriseur
        with chrono.etape("chauffe nvdiffrast (compilation du plugin CUDA)"):
            import nvdiffrast.torch as dr
            ctx = dr.RasterizeCudaContext()
            pos = torch.tensor([[[-0.5, -0.5, 0, 1], [0.5, -0.5, 0, 1], [0, 0.5, 0, 1]]], device="cuda", dtype=torch.float32)
            tri = torch.tensor([[0, 1, 2]], dtype=torch.int32, device="cuda")
            rast, _ = dr.rasterize(ctx, pos, tri, resolution=[64, 64])
            out["nvdiffrast_pixels_couverts"] = int((rast[..., 3] > 0).sum().item())
        out["natten"] = {}
        try:
            import natten
            out["natten"] = {"version": getattr(natten, "__version__", None), "HAS_LIBNATTEN": getattr(natten, "HAS_LIBNATTEN", None)}
        except Exception as e:
            out["natten"] = {"erreur": repr(e)[:200]}
        out["etapes"] = chrono.etapes
    except Exception:
        out["erreur"] = traceback.format_exc()[-6000:]
        _log("ECHEC :", out["erreur"])
    _sauver_caches()
    out["duree_totale_s"] = round(time.time() - t0, 1)
    return _j(out)


@app.function(gpu=GPU, timeout=3000, secrets=SECRETS, volumes={"/cache": vol})
def generer(entrees: dict, faces: int = 500000, atlas: int = 4096, resolution: int = 1536, seed: int = 42, fov: float = -1.0,
            natif: bool = False, repeter: int = 1, max_tokens: int = MAX_JETONS_DEFAUT, etiquette: str = "", remesh_project: float = 0.0) -> dict:
    """Pour chaque entree (nom -> octets PNG RGBA) : cascade Pixal3D + export GLB sur le volume. Le modele est charge UNE fois, puis `repeter` passes
    par image (la passe 1 paie la compilation / le reglage des noyaux Triton, la derniere est « chaude »). L'export a 1 M de faces (reglage par defaut
    de l'auteur) n'est fait qu'a la derniere passe, si `natif`."""
    import gc
    import torch
    from modal_app.exp_pixal3d_outils import SondeMemoire
    t0 = time.time()
    _preparer_env()
    repeter = max(1, int(repeter))
    out = {"gpu_demande": GPU, "parametres": dict(faces=faces, atlas=atlas, resolution=resolution, seed=seed, fov=fov, natif=natif, repeter=repeter,
                                                  max_tokens=max_tokens, etiquette=etiquette, remesh_project=remesh_project), "images": {}}
    torch.zeros(1, device="cuda")                       # contexte CUDA cree ICI (fil principal) avant que la sonde ne lise la carte
    sonde = SondeMemoire(_gpu_occupe_Go).demarrer()
    try:
        chrono = Chrono(sonde)
        inf, pipeline, moge, info = _charger_modele(chrono)
        out["chargement"] = info
        out["etapes_chargement"] = [dict(e) for e in chrono.etapes]
        out["vram_apres_chargement_Go"] = round(torch.cuda.memory_allocated() / 1e9, 2)
        out["carte_occupee_apres_chargement_Go"] = round(_gpu_occupe_Go(), 2)
        jetons = _instrumenter(pipeline, chrono)
        params = dict(faces=faces, atlas=atlas, resolution=resolution, seed=seed, fov=fov, natif=natif, max_tokens=max_tokens, remesh_project=remesh_project)
        for nom, png in entrees.items():
            passes = []
            for k in range(repeter):
                derniere = (k == repeter - 1)
                _log("=" * 20, "image", nom, "passe", k + 1, "/", repeter)
                try:
                    r = _un_passage(nom, png, inf, pipeline, moge, chrono, jetons, params, k + 1, derniere, etiquette)
                except torch.cuda.OutOfMemoryError:
                    _log("MEMOIRE INSUFFISANTE : repli en mode low_vram (modeles charges a la demande)")
                    gc.collect()
                    torch.cuda.empty_cache()
                    pipeline.low_vram = True
                    try:
                        r = _un_passage(nom, png, inf, pipeline, moge, chrono, jetons, params, k + 1, derniere, etiquette)
                        r["repli"] = "low_vram apres manque de memoire"
                    except Exception:
                        r = {"nom": nom, "passe": k + 1, "erreur": traceback.format_exc()[-5000:]}
                except Exception:
                    r = {"nom": nom, "passe": k + 1, "erreur": traceback.format_exc()[-5000:]}
                    _log("ECHEC", nom, r["erreur"][-1500:])
                passes.append(r)
                gc.collect()
                torch.cuda.empty_cache()
                vol.commit()
            out["images"][nom] = {"passes": passes, "final": passes[-1]}
        out["paquets_charges"] = _paquets_charges()
        _sauver_caches()
    finally:
        sonde.arreter()
    out["duree_totale_s"] = round(time.time() - t0, 1)
    out["cout_estime_usd"] = round(out["duree_totale_s"] * TARIFS_GPU_S.get(GPU, 0.0007), 3)
    return _j(out)


@app.function(gpu="L4", timeout=900, secrets=SECRETS, volumes={"/cache": vol})
def importes() -> dict:
    """Importe TOUT le chemin d'inference de Pixal3D (inference.py, pipeline, extracteurs DINOv3 / NAF, MoGe-2, o_voxel, CuMesh, FlexGEMM) SANS charger de poids ni generer,
    puis releve les distributions pip chargees. Carte L4 (24 Go) : il suffit d'un GPU pour que les extensions se chargent. Coute ~0,02 $."""
    import importlib.util
    t0 = time.time()
    _preparer_env()
    out = {}
    try:
        spec = importlib.util.spec_from_file_location("pixal3d_inference", "/opt/Pixal3D/inference.py")
        inf = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(inf)                                # pixal3d.pipelines, o_voxel (-> nvdiffrast, plyfile, trimesh, cv2), torch
        out["etapes"] = ["inference.py"]
        from moge.model.v2 import MoGeModel                         # noqa: F401  (load_moge_model)
        from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor  # noqa: F401  (transformers.DINOv3ViTModel)
        import pixal3d.pipelines.pixal3d_image_to_3d  # noqa: F401
        out["etapes"] += ["moge", "DinoV3ProjFeatureExtractor", "pixal3d_image_to_3d"]
        import torch
        try:                                                        # code de NAF (torch.hub, cache du volume), SANS ses poids : importe natten, einops
            torch.hub.load("valeoai/NAF", "naf", pretrained=False, device="cpu", trust_repo=True)
            out["etapes"].append("NAF (sans poids)")
        except Exception as e:
            out["naf_erreur"] = repr(e)[:300]
        out["paquets_charges"] = _paquets_charges()
    except Exception:
        out["erreur"] = traceback.format_exc()[-4000:]
    out["duree_totale_s"] = round(time.time() - t0, 1)
    return _j(out)


@app.function(image=image_legere, secrets=SECRETS, timeout=900)
def licences_hf() -> dict:
    """CPU seulement : textes COMPLETS des fiches et licences HF utiles a l'avis de licence (la fiche de Pixal3D porte `extra_gated_eu_disallowed: true`)."""
    from huggingface_hub import hf_hub_download
    voulus = {
        "TencentARC/Pixal3D": ["README.md", "LICENSE", "NOTICE", "pipeline.json"],
        "Ruicheng/moge-2-vitl": ["README.md"],
        "camenduru/dinov3-vitl16-pretrain-lvd1689m": ["README.md", "LICENSE.md"],
        "briaai/RMBG-2.0": ["README.md"],
        "ZhengPeng7/BiRefNet": ["README.md"],
    }
    sortie = {}
    for repo, fichiers in voulus.items():
        for f in fichiers:
            try:
                with open(hf_hub_download(repo, f), encoding="utf-8", errors="replace") as fh:
                    sortie[repo + "/" + f] = fh.read()
            except Exception as e:
                sortie[repo + "/" + f] = "ILLISIBLE : %r" % (str(e)[:300],)
    sortie["_historique"] = _historique_hf()
    return sortie


def _historique_hf():
    """Revisions du depot de poids (date, titre) ; pour les plus anciennes, la LICENSE de CHAQUE revision et les empreintes SHA-256 des poids, afin de savoir
    QUAND la licence est devenue MIT et si les OCTETS des poids ont change depuis. Ne leve jamais."""
    from huggingface_hub import HfApi, hf_hub_download
    api = HfApi()
    sortie = {}
    for repo in ("TencentARC/Pixal3D", "Ruicheng/moge-2-vitl", "camenduru/dinov3-vitl16-pretrain-lvd1689m"):
        r = {}
        try:
            commits = list(api.list_repo_commits(repo))
            r["revisions"] = [{"id": c.commit_id, "date": str(c.created_at), "titre": (c.title or "")[:120]} for c in commits][:60]
            if repo == "TencentARC/Pixal3D":
                detail = []
                for c in sorted(commits, key=lambda c: c.created_at)[:12]:
                    d = {"id": c.commit_id[:10], "date": str(c.created_at), "titre": (c.title or "")[:100]}
                    try:
                        with open(hf_hub_download(repo, "LICENSE", revision=c.commit_id), encoding="utf-8", errors="replace") as fh:
                            txt = fh.read()
                        d["LICENSE_debut"] = " ".join(txt.split())[:260]
                        d["LICENSE_mentionne_academique"] = "academic" in txt.lower()
                        d["LICENSE_mentionne_UE"] = "european union" in txt.lower()
                    except Exception as e:
                        d["LICENSE_debut"] = "ILLISIBLE : %r" % (str(e)[:120],)
                    try:
                        with open(hf_hub_download(repo, "README.md", revision=c.commit_id), encoding="utf-8", errors="replace") as fh:
                            tete = fh.read(500)
                        d["README_extra_gated_eu_disallowed"] = "extra_gated_eu_disallowed" in tete
                        d["README_license_front_matter"] = [l for l in tete.splitlines()[:8] if l.startswith("license")]
                    except Exception as e:
                        d["README_license_front_matter"] = "ILLISIBLE : %r" % (str(e)[:120],)
                    try:
                        info = api.model_info(repo, revision=c.commit_id, files_metadata=True)
                        d["poids_sha256"] = {s.rfilename: ((s.lfs.get("sha256") if isinstance(s.lfs, dict) else getattr(s.lfs, "sha256", None)) or "")[:16]
                                             for s in (info.siblings or []) if s.rfilename.endswith(".safetensors")}
                        d["gated"] = info.gated
                    except Exception as e:
                        d["poids_sha256"] = "ILLISIBLE : %r" % (str(e)[:120],)
                    detail.append(d)
                r["detail_revisions_anciennes"] = detail
        except Exception as e:
            r["erreur"] = repr(e)[:300]
        sortie[repo] = r
    return sortie


# ================================================================================ cote local
def _ecrire_json(chemin, obj):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1, ensure_ascii=False)


def _journal_cout(etape, duree_s):
    chemin = SORTIE + "/pixal3d_couts.json"
    cur = json.load(open(chemin, encoding="utf-8")) if os.path.exists(chemin) else {"appels": [], "total_estime_usd": 0.0}
    c = round(duree_s * TARIFS_GPU_S.get(GPU, 0.0007), 3)
    cur["appels"].append({"etape": etape, "gpu": GPU, "duree_s": duree_s, "estime_usd": c, "date": time.strftime("%Y-%m-%d %H:%M:%S")})
    cur["total_estime_usd"] = round(sum(a["estime_usd"] for a in cur["appels"]), 3)
    _ecrire_json(chemin, cur)
    print("cout estime de cet appel : %.2f $ ; cumul GPU estime du banc : %.2f $ (plafond 5 $, arret a 4 $ ; la facture Modal compte aussi les constructions d'image)" % (c, cur["total_estime_usd"]))


def _telecharger_du_volume(chemin_volume, dest):
    with open(dest, "wb") as fh:
        for morceau in vol.read_file(chemin_volume):
            fh.write(morceau)
    return os.path.getsize(dest)


@app.local_entrypoint()
def main(etape: str = "verif", entrees: str = "orc,photo", faces: int = 500000, atlas: int = 4096, resolution: int = 1536, seed: int = 42,
         fov: float = -1.0, natif: bool = False, repeter: int = 1, max_tokens: int = MAX_JETONS_DEFAUT, etiquette: str = "", tout: bool = False,
         remesh_project: float = 0.0):
    os.makedirs(SORTIE + "/glb", exist_ok=True)
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))          # racine du depot : `modal_app` importable cote local
    from modal_app.exp_pixal3d_outils import cameras_par_glb, nom_glb_local
    if etape == "verif":
        r = verifier.remote()
        _ecrire_json(SORTIE + "/pixal3d_verif.json", r)
        print("verif : %.0f s ; erreur : %s" % (r.get("duree_totale_s", -1), "AUCUNE" if "erreur" not in r else r["erreur"][-800:]))
        _journal_cout("verif", r.get("duree_totale_s", 0))
    elif etape == "importes":
        r = importes.remote()
        _ecrire_json(SORTIE + "/pixal3d_importes.json", r)
        print("importes : %.0f s ; erreur : %s ; modules suspects : %s" % (r.get("duree_totale_s", -1), "AUCUNE" if "erreur" not in r else r["erreur"][-600:],
                                                                         (r.get("paquets_charges") or {}).get("suspects")))
        _journal_cout("importes", r.get("duree_totale_s", 0))
    elif etape == "licences":
        r = licences_hf.remote()
        _ecrire_json(SORTIE + "/pixal3d_licences_hf.json", r)
        print({k: len(v) for k, v in r.items()})
    elif etape == "gener":
        noms = [n.strip() for n in entrees.split(",") if n.strip()]
        contenu = {n: open(ENTREES[n], "rb").read() for n in noms}
        r = generer.remote(contenu, faces=faces, atlas=atlas, resolution=resolution, seed=seed, fov=fov, natif=natif, repeter=repeter,
                           max_tokens=max_tokens, etiquette=etiquette, remesh_project=remesh_project)
        _ecrire_json(SORTIE + "/pixal3d_resultats_%s%s.json" % ("+".join(noms), etiquette), r)       # un fichier par jeu d'entrees : le suivant n'ecrase pas le precedent
        _journal_cout("gener%s %s x%d" % (etiquette, "+".join(noms), repeter), r.get("duree_totale_s", 0))
        for n, bloc in r["images"].items():
            for p in bloc["passes"]:
                if "erreur" in p:
                    print(n, "passe", p.get("passe"), "ECHEC :", p["erreur"][-900:])
                    continue
                derniere = (p["passe"] == bloc["final"]["passe"])      # apres la serialisation, "final" est une copie : on compare les numeros
                for suff, g in p["glb"].items():
                    dest = SORTIE + "/glb/" + nom_glb_local(n, etiquette, p["passe"], derniere, "" if suff == "principal" else suff)
                    octets = _telecharger_du_volume(g["chemin"].replace("/cache", "", 1), dest)
                    print(n, "passe", p["passe"], suff, "->", dest, "%.1f Mo" % (octets / 1e6), "| faces", g["faces"], "| atlas", g["atlas_utilise"],
                          "| resolution effective", p["resolution_effective"], "| duree de la passe %.0f s" % p["duree_totale_s"],
                          "| pic carte %.1f Go" % p.get("pic_peripherique_global_Go", -1))
                    if n == "photo":                                    # photo d'une personne : on n'en laisse rien sur le volume
                        vol.remove_file(g["chemin"].replace("/cache", "", 1))
    elif etape == "mesurer":
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from modal_app.exp_pixal3d_mesures import mesurer_glb
        cams, cams_glb = {}, {}
        for f in sorted(os.listdir(SORTIE)):                           # une camera par GLB (celle de SA passe), repli : une par entree
            if f.startswith("pixal3d_resultats") and f.endswith(".json"):                                          # ancien et nouveau nommage
                res_f = json.load(open(os.path.join(SORTIE, f), encoding="utf-8"))
                cams_glb.update(cameras_par_glb(res_f))
                for n, bloc in res_f.get("images", {}).items():
                    for p in bloc.get("passes", []):
                        if "camera" in p:
                            cams.setdefault(n, p["camera"])
        chemin_mesures = SORTIE + "/pixal3d_mesures.json"
        mesures = json.load(open(chemin_mesures, encoding="utf-8")) if os.path.exists(chemin_mesures) else {}          # FUSION : on n'efface pas les mesures deja faites
        for cle, v in list(mesures.items()):                                                                              # camera deja mesuree = reprise si les resultats ont ete ecrases
            m = re.match(r"^pixal3d_(orc|photo)", cle)
            cam = (v.get("alignement_entree") or {}).get("camera") if isinstance(v, dict) else None
            if m and cam:
                cams.setdefault(m.group(1), cam)
        for f in sorted(os.listdir(SORTIE + "/glb")):
            m = re.match(r"^pixal3d_(orc|photo)(.*)\.glb$", f)
            if m:
                n = m.group(1)
                if f[:-4] in mesures and "erreur" not in mesures[f[:-4]] and "orientation" in mesures[f[:-4]] and not tout:
                    continue                                                                                              # deja mesure (--tout pour refaire)
                try:
                    cam = cams_glb.get(f[:-4], cams.get(n))                                                           # camera de CE fichier, sinon celle de l'entree
                    mesures[f[:-4]] = mesurer_glb(SORTIE + "/glb/" + f, ENTREES[n] if cam else None, cam)
                except Exception as e:                                                                                    # fichier tronque / illisible : signale, jamais fatal
                    mesures[f[:-4]] = {"erreur": repr(e)[:300]}
                    print("MESURE IMPOSSIBLE :", f, repr(e)[:200])
        # references TRELLIS.2 (memes entrees, 1792, 500 K faces, atlas 4096) mesurees avec LA MEME regle
        for cle, f, n in (("trellis_orc_1792", "hr_G1792_tranches_t4096_f500000.glb", "orc"), ("trellis_photo_1792", "hr_photo_G1792_tranches_t4096_f500000.glb", "photo"),
                          ("trellis_orc_1536", "cmp_G1536_T1.glb", "orc")):
            p = SORTIE + "/glb/" + f
            if os.path.exists(p) and (cle not in mesures or "erreur" in mesures[cle] or "orientation" not in mesures[cle] or tout):
                mesures[cle] = mesurer_glb(p, ENTREES[n])             # sans camera : orientation + IoU de silhouette ajustee, pas d'alignement perspectif
        _ecrire_json(SORTIE + "/pixal3d_mesures.json", mesures)
        print(json.dumps({k: {"Mo": round(v.get("octets", 0) / 1e6, 1), "faces": v.get("topologie", {}).get("faces_utiles"),
                              "composantes": v.get("topologie", {}).get("composantes"), "part_plus_grande": v.get("topologie", {}).get("plus_grande_composante_part_faces"),
                              "aretes_de_bord": v.get("topologie", {}).get("aretes_de_bord"), "non_manifold": v.get("topologie", {}).get("aretes_non_manifold"),
                              "aire_retournee_pct": v.get("topologie", {}).get("pct_aire_normales_opposees"),
                              "arete_max_rel_diag": v.get("topologie", {}).get("arete_max_rel_diag"),
                              "couverture_atlas": v.get("atlas", {}).get("couverture"), "iou": (v.get("alignement_entree") or {}).get("iou")}
                          for k, v in mesures.items()}, indent=1))
    elif etape == "nettoyer":
        try:
            for e in vol.listdir("/out"):
                vol.remove_file("/out/" + os.path.basename(e.path))
        except Exception as e:
            print("sorties :", repr(e)[:150])
        if tout:
            for d in ("/pixal3d_weights", "/hf", "/torch", "/torch_ext", "/triton"):
                try:
                    vol.remove_file(d, recursive=True)
                except Exception as e:
                    print(d, repr(e)[:120])
        print("nettoye")
    else:
        print("etape inconnue :", etape)
        sys.exit(2)
