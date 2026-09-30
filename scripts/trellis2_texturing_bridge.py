"""FabMesh -- TRELLIS-2 texturing bridge.

Wraps microsoft/TRELLIS.2-4B's Trellis2TexturingPipeline:
  input  = (mesh.glb, reference_image.png[, back_image.png, ...])
  output = textured.glb with PBR materials

Runs in the TRELLIS2_win venv.

CLI:
    python trellis2_texturing_bridge.py <mesh.glb> <image.png> <out.glb>
        [--seed 42]
        [--steps 12]                 sampler steps (12=default fast, 24=quality)
        [--texture-size 2048]        baked tex resolution (2048|4096)
        [--resolution 1024]          internal voxel/feature resolution (512|1024)
        [--image-resolution 1024]    source image resize before DINOv3 (default 1024)
        [--back-image PATH]          optional 2nd reference photo (back/side)
        [--extra-image PATH ...]     even more references (sides, etc.)
        [--guidance 1.0]             guidance_strength override
"""
from __future__ import annotations
import os
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
import sys
import time
import argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRELLIS2_SRC = os.path.join(ROOT, 'external', 'TRELLIS2_win', 'src')
sys.path.insert(0, TRELLIS2_SRC)

# Aucun appel reseau quand les modeles sont deja sur le disque (2026-09-28),
# AVANT tout import HF. Voir scripts/hf_hors_ligne.py. La config (--config)
# est lue ici dans argv : argparse ne tourne que plus bas.
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import hf_hors_ligne
    _cfg = 'texturing_pipeline.json'
    if '--config' in sys.argv[:-1]:
        _cfg = sys.argv[sys.argv.index('--config') + 1]
    hf_hors_ligne.hors_ligne_si_complet(
        hf_hors_ligne.manquants_trellis2(_cfg),
        log=lambda m: print(f'[trellis2_tex] {m}', flush=True))
except Exception as _e:
    print(f'[trellis2_tex] verification du cache HF impossible : {_e}', flush=True)


def log(msg):
    print(f'[trellis2_tex] {msg}', flush=True)


# --- NOYAU PARTAGE : DEBUT (re-texture : finitions) ---
# Copie identique dans scripts/trellis2_texturing_bridge.py (source, bureau)
# et modal_app/_retexture.py (cloud) ; build/check-noyaux-partages.mjs refuse
# une construction si les deux divergent. Utilise la fonction `log` du module.
def eclaircir_atlas(output):
    """Luminosite x1,5, saturation x1,3, contraste x1,1 sur le baseColor : le
    PBR du moteur sort sous-expose dans les visionneuses glTF. Desactivable par
    FABMESH_TRELLIS2_SKIP_BRIGHTEN=1."""
    import os
    if os.environ.get('FABMESH_TRELLIS2_SKIP_BRIGHTEN') == '1':
        return
    try:
        from PIL import ImageEnhance
        geoms = (list(output.geometry.values())
                 if hasattr(output, 'geometry') else [output])
        n = 0
        for m in geoms:
            material = getattr(getattr(m, 'visual', None), 'material', None)
            tex = getattr(material, 'baseColorTexture', None) if material is not None else None
            if tex is None:
                continue
            tex = ImageEnhance.Brightness(tex).enhance(1.5)
            tex = ImageEnhance.Color(tex).enhance(1.3)
            material.baseColorTexture = ImageEnhance.Contrast(tex).enhance(1.1)
            n += 1
        if n:
            log(f'post-process: brightness x1.5, sat x1.3, contrast x1.1 ({n} material(s))')
    except Exception as e:
        log(f'auto-brighten skipped: {type(e).__name__}: {e}')


def _metal_moyen(obj):
    """Metal EFFECTIF moyen (canal B x metallicFactor) sur la zone couverte de
    l'atlas (le vide est noir : le compter ecraserait la moyenne). None si le
    maillage n'a pas de carte metal/rugosite."""
    import numpy as np
    geoms = list(obj.geometry.values()) if hasattr(obj, 'geometry') else [obj]
    total, poids = 0.0, 0
    for m in geoms:
        material = getattr(getattr(m, 'visual', None), 'material', None)
        mr = getattr(material, 'metallicRoughnessTexture', None) if material is not None else None
        if mr is None:
            continue
        metal = np.asarray(mr.convert('RGB')).astype(np.float32)[..., 2] / 255.0
        base = getattr(material, 'baseColorTexture', None)
        if base is not None:
            lum = np.asarray(base.convert('RGB').resize(mr.size)).astype(np.float32).mean(axis=2)
            couvert = lum > 8
        else:
            couvert = np.ones(metal.shape, dtype=bool)
        if not couvert.any():
            continue
        facteur = getattr(material, 'metallicFactor', None)
        facteur = 1.0 if facteur is None else float(facteur)
        total += float(metal[couvert].sum()) * facteur
        poids += int(couvert.sum())
    return (total / poids) if poids else None


def aligner_metal_sur_source(output, source):
    """Une re-texture ne doit pas changer la NATURE des materiaux.

    MESURE DU 2026-09-27 (banc cloud, personnage en peau et fourrure) : le
    maillage d'origine avait un metal moyen de 0,08 ; la re-texture sortait
    0,77 (76 % de la surface au-dessus de 0,5, mediane 0,87). En PBR un metal
    n'a pas de composante diffuse : le personnage aurait rendu sombre et
    metallise. La regle de la generation (metal > 0,8 ET rugosite > 0,85 sur
    80 % de la surface) ne le voyait pas (32 %).

    Si l'origine n'etait PAS metallique (< 0,3) et que la re-texture l'est
    devenue (> 0,5), on ramene le metal au niveau de l'origine par le seul
    `metallicFactor` (la texture n'est pas touchee). Un objet reellement
    metallique a l'origine (epee, armure) ne declenche pas la regle."""
    m_src = _metal_moyen(source)
    m_out = _metal_moyen(output)
    if m_src is None or m_out is None:
        return
    if not (m_out > 0.5 and m_src < 0.3):
        return
    facteur = max(0.05, m_src / m_out)
    geoms = list(output.geometry.values()) if hasattr(output, 'geometry') else [output]
    for m in geoms:
        material = getattr(getattr(m, 'visual', None), 'material', None)
        if material is None or getattr(material, 'metallicRoughnessTexture', None) is None:
            continue
        actuel = getattr(material, 'metallicFactor', None)
        material.metallicFactor = (1.0 if actuel is None else float(actuel)) * facteur
    log(f'metal aligne sur la source : {m_out:.2f} -> {m_out * facteur:.2f} '
        f'(origine {m_src:.2f}, metallicFactor x{facteur:.3f})')
# --- NOYAU PARTAGE : FIN ---


def _prep_image(path, log_label='image'):
    """Load + rembg if needed."""
    from PIL import Image
    import numpy as np
    image = Image.open(path).convert('RGBA')
    if np.asarray(image)[:, :, 3].min() == 255:
        log(f'{log_label} no alpha — rembg...')
        import rembg
        image = rembg.remove(image)
    log(f'{log_label}: {image.size}')
    return image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mesh', help='Input mesh GLB')
    ap.add_argument('image', help='Reference image PNG (front)')
    ap.add_argument('out', help='Output textured GLB')
    ap.add_argument('--config', default='texturing_pipeline.json')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--steps', type=int, default=None,
                    help='Sampler steps (default 12 from config, 24 for quality)')
    ap.add_argument('--texture-size', type=int, default=None,
                    help='Output texture resolution (default 2048, max 4096)')
    ap.add_argument('--resolution', type=int, default=None,
                    help='Internal voxel/feature resolution (512 or 1024)')
    ap.add_argument('--image-resolution', type=int, default=None,
                    help='Source image resize before DINOv3 (1024 default)')
    ap.add_argument('--back-image', default=None,
                    help='Optional 2nd reference image (back/side photo)')
    ap.add_argument('--extra-image', action='append', default=[],
                    help='Additional reference images (can repeat)')
    ap.add_argument('--guidance', type=float, default=None,
                    help='Guidance strength override (default 1.0)')
    args = ap.parse_args()

    t0 = time.time()
    log(f'mesh:  {args.mesh}')
    log(f'image: {args.image}')
    log(f'out:   {args.out}')

    import trimesh
    from PIL import Image
    from trellis2.pipelines import Trellis2TexturingPipeline

    # Progress markers consumed by the main process stderr parser
    # so the Electron UI's progress bar moves linearly between
    # trellis2_start (65%) and texture_done (95%).
    print('LOCAL_TRELLIS2_PROGRESS: 67 trellis2_loading', flush=True)
    log('loading Trellis2TexturingPipeline from microsoft/TRELLIS.2-4B...')
    t_load = time.time()
    import trellis2_sans_detourage; trellis2_sans_detourage.appliquer()   # detourage deja fait en amont : ne pas charger BiRefNet (timm + kornia)
    pipeline = Trellis2TexturingPipeline.from_pretrained(
        'microsoft/TRELLIS.2-4B', config_file=args.config)
    pipeline.rembg_model = None  # rembg pre-process upstream
    pipeline.cuda()
    log(f'pipeline loaded in {time.time()-t_load:.1f}s')
    print('LOCAL_TRELLIS2_PROGRESS: 72 trellis2_ready', flush=True)

    mesh = trimesh.load(args.mesh, force='mesh', process=False)
    if isinstance(mesh, trimesh.Scene):
        mesh = list(mesh.geometry.values())[0]
    log(f'mesh: {len(mesh.vertices)}v / {len(mesh.faces)}f')

    # Collect all reference images (front + back + extras).
    images = [_prep_image(args.image, 'front')]
    if args.back_image:
        images.append(_prep_image(args.back_image, 'back'))
    for i, p in enumerate(args.extra_image):
        images.append(_prep_image(p, f'extra_{i}'))
    log(f'total references: {len(images)}')

    # Build sampler params, defaulting to the SHARPENED bake (steps 24,
    # guidance 3.0) the native pipeline now uses — env-overridable. The
    # pipeline.json defaults (steps 12, guidance 1.0 ~= near-unconditional) are
    # too weak and produce a soft texture. CLI flags still win when given.
    sampler_params = {
        'steps': (args.steps if args.steps is not None
                  else int(os.environ.get('FABMESH_TEX_STEPS', '24'))),
        'guidance_strength': (args.guidance if args.guidance is not None
                              else float(os.environ.get('FABMESH_TEX_GUIDANCE', '3.0'))),
        'guidance_interval': [0.5, 1.0],
        # Audit fixes (see trellis2_native_full_pipeline.py): CFG-rescale 0->0.5 (anti
        # color-wash) + rescale_t 3->1.5 (reallocate steps to the detail region).
        'guidance_rescale': float(os.environ.get('FABMESH_TEX_RESCALE', '0.5')),
        'rescale_t': float(os.environ.get('FABMESH_TEX_RESCALE_T', '1.5')),
    }

    # Build run() kwargs.
    run_kwargs = {'seed': args.seed}
    if args.resolution is not None:
        run_kwargs['resolution'] = args.resolution
    if args.texture_size is not None:
        run_kwargs['texture_size'] = args.texture_size
    if sampler_params:
        run_kwargs['tex_slat_sampler_params'] = sampler_params

    # Optional: override image_size for DINOv3 feature extraction.
    if args.image_resolution is not None:
        pipeline.image_cond_model.image_size = args.image_resolution
        log(f'  DINOv3 image_size = {args.image_resolution}')

    print('LOCAL_TRELLIS2_PROGRESS: 75 sampling_start', flush=True)
    log(f'running texturing (run_kwargs={run_kwargs})...')
    t_run = time.time()
    import torch
    torch.manual_seed(args.seed)
    # The run() method takes ONE image in its signature; pipelines that
    # accept multi-image references handle them inside get_cond([list]).
    # We pass image=images[0] and patch the conditioning afterwards if
    # multi-image was provided.
    if len(images) > 1:
        # Multi-reference: call internal stages manually to feed all images.
        cond = pipeline.get_cond(images, 1024 if (args.resolution or 1024) == 1024 else 512)
        log(f'  multi-cond shape: {cond["cond"].shape}')
        mesh = pipeline.preprocess_mesh(mesh)
        shape_slat = pipeline.encode_shape_slat(mesh, args.resolution or 1024)
        tex_model_key = ('tex_slat_flow_model_1024'
                         if (args.resolution or 1024) == 1024
                         else 'tex_slat_flow_model_512')
        tex_model = pipeline.models[tex_model_key]
        print('LOCAL_TRELLIS2_PROGRESS: 80 sampling_diffusion', flush=True)
        tex_slat = pipeline.sample_tex_slat(
            cond, tex_model, shape_slat, sampler_params)
        print('LOCAL_TRELLIS2_PROGRESS: 86 sampling_done', flush=True)
        pbr_voxel = pipeline.decode_tex_slat(tex_slat)
        print('LOCAL_TRELLIS2_PROGRESS: 88 postprocess_start', flush=True)
        output = pipeline.postprocess_mesh(
            mesh, pbr_voxel,
            args.resolution or 1024,
            args.texture_size or 2048)
    else:
        print('LOCAL_TRELLIS2_PROGRESS: 80 sampling_diffusion', flush=True)
        output = pipeline.run(mesh, images[0], **run_kwargs)
        print('LOCAL_TRELLIS2_PROGRESS: 88 postprocess_done', flush=True)
    log(f'texturing done in {time.time()-t_run:.1f}s')
    print('LOCAL_TRELLIS2_PROGRESS: 91 brightening', flush=True)

    # Auto-brighten the baseColor texture before export (TRELLIS-2 PBR looks
    # under-lit in glTF viewers) — noyau partage avec le cloud, voir plus haut.
    eclaircir_atlas(output)
    # La re-texture ne doit pas rendre metallique un maillage qui ne l'etait
    # pas (mesure du 2026-09-27 : 0,08 -> 0,77, personnage noirci).
    try:
        aligner_metal_sur_source(output, trimesh.load(args.mesh))
    except Exception as e:
        log(f'metal alignment skipped: {type(e).__name__}: {e}')

    log(f'exporting to {args.out}')
    if hasattr(output, 'export'):
        try:
            from acceleration_glb import webp_rapide; webp_rapide(output)   # meme acceleration que le cloud
        except ImportError:
            pass
        output.export(args.out, extension_webp=True)
    else:
        output.export(args.out)
    log(f'TOTAL: {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main()
