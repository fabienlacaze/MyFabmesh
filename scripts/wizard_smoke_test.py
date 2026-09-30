"""Final functional test for the FabMesh first-run wizard.

Loads the minimal stack for the chosen install mode and runs a tiny
operation to confirm everything works. Exits 0 on success, nonzero
on failure (Electron picks up the error and shows it in the wizard).

The old version only did `import diffusers` and reported green — a
box missing the pre-compiled CUDA wheels (spconv / cumm / o_voxel /
cumesh / flex_gemm) or the TRELLIS-2 source still passed, then the
first real generation crashed. That "green but broken" outcome is
exactly what this test now prevents: it imports the 5 CUDA wheels for
real and constructs the TRELLIS-2 pipeline class from source so a
missing native extension fails HERE, in ~10-20s, with a clear message.

We still avoid a full image-to-3D run (would take ~60s + 12 GB VRAM):
we import + resolve, we do not generate.

Usage:
    python wizard_smoke_test.py --mode {lite|standard|full}
"""
import argparse
import os
import sys
import time

# Python EMBARQUE (fichier ._pth) : le dossier du script n'est pas dans sys.path. Les verifications importent les modules de
# scripts/ exactement comme les outils de l'appli (texture_upscale, trellis2_sans_detourage).
_ICI = os.path.dirname(os.path.abspath(__file__))
if _ICI not in sys.path:
    sys.path.insert(0, _ICI)


def log(msg):
    print(msg, flush=True)


def check_torch_cuda():
    log('[smoke] checking PyTorch + CUDA...')
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError(
            'CUDA not available. Possible causes:\n'
            ' - NVIDIA driver too old (need >= 550)\n'
            ' - PyTorch CUDA build mismatch with installed driver\n'
            ' - No NVIDIA GPU detected')
    name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    log(f'[smoke]   CUDA OK: {name} ({vram_gb:.1f} GB VRAM)')
    # TRELLIS-2 needs ~15 GB and OOMs below ~12 GB. Below the floor there is
    # no viable local engine — the wizard should have picked Cloud upstream,
    # but re-check here so a hand-forced local install fails loudly.
    if vram_gb < 11.5:
        raise RuntimeError(
            f'GPU has only {vram_gb:.1f} GB VRAM. TRELLIS-2 needs ~12 GB to '
            'run without OOM. Use Cloud mode instead of local generation.')
    # Tiny tensor op to confirm we can actually allocate + compute
    x = torch.randn(256, 256, device='cuda')
    y = (x @ x.T).sum().item()
    log(f'[smoke]   matmul OK (sanity sum: {y:.0f})')
    del x


# The 5 pre-compiled CUDA wheels TRELLIS-2 links at runtime. `import
# diffusers` succeeds without ANY of these, which is why the old smoke-test
# lied. Import each for real: a missing / ABI-broken wheel raises here.
#   (module_to_import, pip_wheel_name, what_it_does)
_TRELLIS_CUDA_WHEELS = [
    ('spconv',    'spconv-cu128', 'sparse 3D convolution backend'),
    ('cumm',      'cumm-cu128',   'CUDA matrix kernels (spconv dependency)'),
    ('o_voxel',   'o-voxel',      'voxel post-process / GLB baker'),
    ('cumesh',    'cumesh',       'CUDA mesh extraction'),
    ('flex_gemm', 'flex-gemm',    'fused GEMM kernels'),
]


def _trellis2_src_dir():
    """Where the TRELLIS-2 python package lives. Packaged app passes
    FABMESH_TRELLIS2_SRC (extraResources copy); dev falls back to the
    in-repo external/ checkout. Mirrors trellis2_native_full_pipeline.py."""
    scripts = os.path.dirname(os.path.abspath(__file__))
    return os.environ.get('FABMESH_TRELLIS2_SRC') or os.path.abspath(
        os.path.join(scripts, '..', 'external', 'TRELLIS2_win', 'src'))


def check_cuda_wheels():
    """Import the 5 native CUDA wheels TRELLIS-2 cannot run without."""
    log('[smoke] checking native CUDA wheels...')
    import importlib
    missing = []
    for mod, wheel, desc in _TRELLIS_CUDA_WHEELS:
        try:
            importlib.import_module(mod)
            log(f'[smoke]   {mod} OK ({desc})')
        except Exception as e:
            # Keep the module name + the pip wheel name so the user (or a
            # support ticket) knows exactly which wheel to reinstall.
            missing.append(f'{mod} (wheel: {wheel}) — {type(e).__name__}: {e}')
    if missing:
        raise RuntimeError(
            'TRELLIS-2 native CUDA wheels missing or broken:\n  - '
            + '\n  - '.join(missing)
            + '\nReinstall the engine dependencies (wizard "Repair" / '
            'wizard_install_deps.py). These wheels are cp311/win_amd64 and '
            'must match the bundled PyTorch cu128 build.')


def check_trellis_loadable():
    """Actually build the TRELLIS-2 image-to-3D pipeline CLASS from source
    and confirm the 4B weights are present in the HF cache. This exercises
    the full import chain (which pulls in the native wheels again) and the
    on-disk model — without running a 60s generation."""
    log('[smoke] checking 3D core (TRELLIS-2)...')
    # 1) diffusers/transformers must import (pure-python floor).
    try:
        import importlib
        importlib.import_module('diffusers')
        importlib.import_module('transformers')
    except Exception as e:
        raise RuntimeError(f'3D core python deps failed to import: {e}')

    # 2) The TRELLIS-2 source package must import (this transitively imports
    #    spconv/o_voxel/cumesh/flex_gemm — a second, structural check).
    src = _trellis2_src_dir()
    if not os.path.isdir(src):
        raise RuntimeError(
            f'TRELLIS-2 source not found at {src}. The engine files were not '
            'installed (set FABMESH_TRELLIS2_SRC or reinstall).')
    if src not in sys.path:
        sys.path.insert(0, src)
    try:
        from trellis2.pipelines import Trellis2ImageTo3DPipeline  # noqa: F401
        log('[smoke]   TRELLIS-2 pipeline class imported OK')
    except Exception as e:
        raise RuntimeError(
            f'TRELLIS-2 pipeline import failed: {type(e).__name__}: {e}. '
            'This usually means a native CUDA wheel is missing/mismatched or '
            'the TRELLIS-2 source tree is incomplete.')
    # Detourage INTERNE du moteur 3D : sans la coquille de trellis2_sans_detourage, from_pretrained construit le modele de
    # detourage du moteur (~1 Go, code distant exigeant timm + kornia, bloque par Smart App Control) : 3e echec de la
    # premiere generation du 2026-09-30. On construit ici ce que le pipeline construira : instantane si le correctif est la.
    try:
        import trellis2_sans_detourage
        trellis2_sans_detourage.appliquer()
        from trellis2.pipelines import rembg as _rembg_interne
        if not isinstance(_rembg_interne.BiRefNet(model_name='ZhengPeng7/BiRefNet'), trellis2_sans_detourage._SansDetourage):
            raise RuntimeError('the 3D engine would still load its own background remover')
        log('[smoke]   internal background remover of the 3D engine disabled (image already cut out)')
    except Exception as e:
        raise RuntimeError(f'3D engine background-remover bypass failed: {type(e).__name__}: {e}')

    # 3) The 4B weights must already be in the HF cache (wizard_download
    #    pulled microsoft/TRELLIS.2-4B). try_to_load_from_cache never touches
    #    the network, so this stays fast and offline-safe.
    from huggingface_hub import try_to_load_from_cache
    cfg = try_to_load_from_cache('microsoft/TRELLIS.2-4B', 'pipeline.json')
    if not cfg:
        raise RuntimeError(
            'TRELLIS-2 weights (microsoft/TRELLIS.2-4B) not found in cache. '
            'The model download did not complete — re-run the download step.')
    log('[smoke]   TRELLIS-2 weights present in cache')


def check_dinov3_loadable():
    """DINOv3 (facebook/dinov3-vitl16-pretrain-lvd1689m) is TRELLIS-2's image
    backbone, pulled lazily on the first run. Meta gates the canonical repo,
    so a client with no Meta token would hit GatedRepoError at generation
    time. wizard_download now stages a non-gated mirror into the canonical
    cache folder; verify it landed so the failure surfaces HERE, not mid-gen."""
    log('[smoke] checking DINOv3 backbone...')
    from huggingface_hub import try_to_load_from_cache
    for repo in ('facebook/dinov3-vitl16-pretrain-lvd1689m',
                 os.environ.get('FABMESH_DINOV3_REPO', '') or None):
        if not repo:
            continue
        p = try_to_load_from_cache(repo, 'config.json')
        if p:
            log(f'[smoke]   DINOv3 backbone present ({repo})')
            return
    raise RuntimeError(
        'DINOv3 backbone (facebook/dinov3-vitl16-pretrain-lvd1689m) not in '
        'cache. TRELLIS-2 will fail with GatedRepoError on first generation. '
        'Re-run the model download (wizard_download stages a non-gated '
        'mirror), or set FABMESH_DINOV3_URL to a self-hosted copy.')


def check_blip_loadable():
    log('[smoke] checking vision module...')
    from huggingface_hub import try_to_load_from_cache
    p = try_to_load_from_cache(
        'Salesforce/blip-image-captioning-large', 'config.json')
    if not p:
        raise RuntimeError('vision module not in cache (download incomplete?)')
    log(f'[smoke]   vision module OK')


def check_background_remover():
    # Le detourage (scripts/rembg, onnxruntime seul) a fait echouer TOUTE premiere generation 3D d'une installation neuve (2026-09-30) sans que ce test
    # le voie : on l'execute pour de vrai sur une petite image (telecharge aussi les poids u2net, 176 Mo, s'ils manquent : le reseau est teste ici,
    # pas a la premiere generation).
    log('[smoke] checking background remover...')
    from PIL import Image
    import rembg
    sortie = rembg.remove(Image.new('RGB', (96, 96), (200, 30, 30)), session=rembg.new_session('u2net'))
    if sortie.mode != 'RGBA' or sortie.size != (96, 96):
        raise RuntimeError('background remover returned an unexpected image')
    log('[smoke]   background remover OK')


# Modules des OUTILS d'image (2026-09-30) : Detail++, affinage de texture, decodeur de tous les pipelines du serveur d'images. Meme
# liste que les lignes vae_fix / cn_tile / cn_union de wizard_download.MODELS (fichiers de ALLOW_PATTERNS). FACULTATIFS comme au
# telechargement : absents, une ligne d'information (jamais un echec) ; Detail++ le redira clairement a l'usage.
_MODULES_DETAIL = [
    ('image decoder', 'madebyollin/sdxl-vae-fp16-fix'),
    ('texture refine module', 'xinsir/controlnet-tile-sdxl-1.0'),
    ('Detail++ module', 'xinsir/controlnet-union-sdxl-1.0'),
]


def check_image_detail_modules():
    from huggingface_hub import try_to_load_from_cache
    manquants = [nom for nom, depot in _MODULES_DETAIL
                 if not all(isinstance(try_to_load_from_cache(depot, f), str)
                            for f in ('config.json', 'diffusion_pytorch_model.safetensors'))]
    if manquants:
        log('[smoke] image detail modules: not installed (optional, Settings > Reconfigure downloads them): '
            + ', '.join(manquants))
        return
    log('[smoke] checking image detail modules...')
    log('[smoke]   image detail modules OK')


def check_writer():
    """Redacteur local (fenetre New project) : moteur ONNX importable ET modele present. Sans chargement du modele (quelques
    secondes de plus) : l'import prouve que Smart App Control laisse passer la bibliotheque."""
    log('[smoke] checking writing assistant...')
    import onnxruntime_genai  # noqa: F401
    from huggingface_hub import try_to_load_from_cache
    p = try_to_load_from_cache('onnx-community/Qwen3-4B-ONNX',
                               'onnxruntime/cpu_and_mobile/cpu-int4-kld-block-128/genai_config.json')
    if not isinstance(p, str):
        raise RuntimeError('writing assistant model not in cache (download incomplete?)')
    log('[smoke]   writing assistant OK')


def check_mesh_tools():
    log('[smoke] checking mesh tools...')
    import importlib
    manquants = []
    for m in ('fast_simplification', 'xatlas', 'trimesh', 'pygltflib', 'cv2', 'scipy', 'onnxruntime'):
        try:
            importlib.import_module(m)
        except Exception as e:
            manquants.append(f'{m} ({type(e).__name__}: {e})')
    if manquants:
        raise RuntimeError('missing or blocked mesh tools: ' + '; '.join(manquants))
    log('[smoke]   mesh tools OK')


def check_texture_upscaler():
    # Enhance texture et l'option Ultra 8K (texture_upscale.py) echouaient sur toute installation neuve : la bibliotheque de
    # l'agrandisseur importe un module retire de torchvision 0.17+ (audit du 2026-09-30). Meme chargement que l'outil,
    # sans telecharger les poids (~0,4 s).
    log('[smoke] checking texture upscaler...')
    import texture_upscale
    texture_upscale.charger_esrgan()
    log('[smoke]   texture upscaler OK')


def report_prompt_translator():
    """Traduction des prompts : FACULTATIVE (etape de l'assistant qui n'arrete jamais l'installation) -> simple ligne de
    journal, jamais un echec. Import REEL des parties natives (une DLL peut s'installer puis etre bloquee par Smart App Control)
    et de `argostranslate.translate`, la chaine qu'utilise l'appli (stanza, remplacant neutre de minisbd) : `package` seul
    s'importait meme quand la traduction ne pouvait pas se charger."""
    try:
        import ctranslate2  # noqa: F401
        import sentencepiece  # noqa: F401
        from argostranslate import package, translate  # noqa: F401
        modeles = sorted(f'{p.from_code}->{p.to_code}' for p in package.get_installed_packages())
        log(f'[smoke] prompt translator: ready (models: {", ".join(modeles) or "none yet, downloaded at first use"})')
    except Exception as e:
        log(f'[smoke] prompt translator: not available (optional, prompts stay in their language): {type(e).__name__}: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', required=True)
    args = ap.parse_args()

    t0 = time.time()
    log(f'[smoke] mode={args.mode}')

    try:
        # ORDRE DU LOGICIEL (2026-09-30) : moteur d'IA, puis images, puis 3D — la page de verification remplit sa barre dans cet ordre.
        check_torch_cuda()
        if args.mode in ('standard', 'full', 'lite'):
            check_writer()
        check_dinov3_loadable()
        if args.mode in ('standard', 'full', 'lite'):
            check_blip_loadable()
        check_background_remover()
        if args.mode in ('standard', 'full'):
            check_image_detail_modules()
        check_cuda_wheels()
        check_mesh_tools()
        check_texture_upscaler()
        check_trellis_loadable()
        report_prompt_translator()
        log(f'[smoke] all checks passed in {time.time() - t0:.1f}s')
        sys.exit(0)
    except Exception as e:
        log(f'[smoke] FAILED: {e}')
        sys.exit(1)


if __name__ == '__main__':
    main()
