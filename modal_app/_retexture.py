"""« Re-texture all (AI) » — portage cloud de scripts/trellis2_texturing_bridge.py.

Le bureau lance le bridge dans le venv du moteur 3D : il garde la GEOMETRIE
du maillage et regenere toute sa texture PBR depuis l'image de reference,
avec le pipeline de texturation du moteur (Trellis2TexturingPipeline, dans le
MEME fork que la generation : external/TRELLIS2_win/src, embarque dans
l'image Modal). Ce module reprend son `main()` a l'identique, sans la ligne de
commande : memes reglages par preset, meme chemin multi-references, meme
eclaircissement final.

Parite a surveiller a la main : le bridge est un script CLI autonome, il n'a
pas de bloc NOYAU PARTAGE. Toute modification de ses reglages (sampler,
presets, eclaircissement) doit etre reportee ici, et inversement.
"""
from __future__ import annotations

import io
import os
import time

import numpy as np
from PIL import Image

# Meme table que scripts/mesh_tools.py:_TRELLIS2_PRESETS (steps, taille
# d'atlas, resolution d'image pour DINOv3). « ultra_8k » cuit en 4096 comme
# « quality » : le client enchaine ensuite « Sharpen texture (x2) » -> 8192,
# exactement comme le bureau (un bake 8K sature la memoire).
PRESETS = {
    'fast':     {'steps': 12, 'texture_size': 2048, 'image_resolution': 1024},
    'balanced': {'steps': 24, 'texture_size': 2048, 'image_resolution': 1024},
    'quality':  {'steps': 32, 'texture_size': 4096, 'image_resolution': 2048},
    'ultra_8k': {'steps': 32, 'texture_size': 4096, 'image_resolution': 2048},
}


def log(msg):
    print(f'[retexture] {msg}', flush=True)


def prep_reference(image: Image.Image, label: str = 'image') -> Image.Image:
    """Comme _prep_image du bridge : detourage rembg seulement si l'image
    n'a pas deja une transparence utile."""
    image = image.convert('RGBA')
    if np.asarray(image)[:, :, 3].min() == 255:
        log(f'{label} sans alpha — detourage')
        import rembg
        image = rembg.remove(image)
    log(f'{label}: {image.size}')
    return image


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


def retexturer(pipeline, mesh_bytes: bytes, images: list, preset: str = 'fast',
               seed: int = 42) -> bytes:
    """Regenere la texture d'un maillage existant. Rend le GLB (octets).

    `pipeline` : Trellis2TexturingPipeline deja sur le GPU.
    `images`   : references PIL (face d'abord, puis dos / autres vues)."""
    import torch
    import trimesh

    reglages = PRESETS.get(str(preset), PRESETS['fast'])
    t0 = time.time()
    mesh = trimesh.load(io.BytesIO(mesh_bytes), file_type='glb', force='mesh', process=False)
    if isinstance(mesh, trimesh.Scene):
        mesh = list(mesh.geometry.values())[0]
    log(f'maillage : {len(mesh.vertices)} sommets / {len(mesh.faces)} faces, preset={preset}, graine={seed}')

    refs = [prep_reference(im, 'face' if i == 0 else f'vue_{i}') for i, im in enumerate(images)]

    # Parametres du sampler : ceux du bridge. Le preset fixe toujours `steps`
    # (le repli d'environnement 24 ne sert que sans preset, comme au bureau).
    sampler_params = {
        'steps': int(reglages['steps']),
        'guidance_strength': float(os.environ.get('FABMESH_TEX_GUIDANCE', '3.0')),
        'guidance_interval': [0.5, 1.0],
        'guidance_rescale': float(os.environ.get('FABMESH_TEX_RESCALE', '0.5')),
        'rescale_t': float(os.environ.get('FABMESH_TEX_RESCALE_T', '1.5')),
    }
    texture_size = int(reglages['texture_size'])
    resolution = 1024
    pipeline.image_cond_model.image_size = int(reglages['image_resolution'])

    torch.manual_seed(int(seed))
    if len(refs) > 1:
        # Multi-references : etapes internes appelees a la main, comme le bridge.
        cond = pipeline.get_cond(refs, resolution)
        mesh = pipeline.preprocess_mesh(mesh)
        shape_slat = pipeline.encode_shape_slat(mesh, resolution)
        tex_model = pipeline.models['tex_slat_flow_model_1024']
        tex_slat = pipeline.sample_tex_slat(cond, tex_model, shape_slat, sampler_params)
        pbr_voxel = pipeline.decode_tex_slat(tex_slat)
        output = pipeline.postprocess_mesh(mesh, pbr_voxel, resolution, texture_size)
    else:
        output = pipeline.run(mesh, refs[0], seed=int(seed), texture_size=texture_size,
                              tex_slat_sampler_params=sampler_params)
    log(f'texturation en {time.time() - t0:.1f}s')

    eclaircir_atlas(output)
    try:
        aligner_metal_sur_source(output, trimesh.load(io.BytesIO(mesh_bytes), file_type='glb'))
    except Exception as e:
        log(f'alignement du metal ignore : {type(e).__name__}: {e}')
    buf = io.BytesIO()
    if hasattr(output, 'export'):
        output.export(buf, file_type='glb', extension_webp=True)
    else:
        raise RuntimeError('le pipeline de texturation n a rendu aucun maillage exportable')
    out = buf.getvalue()
    log(f'TOTAL {time.time() - t0:.1f}s, {len(out)} octets')
    return out
