"""Auto-rectify: strict orthographic FRONT (or 3/4 ISO) view generation,
multi-seed with silhouette symmetry scoring.

Verbatim port of `scripts/generate_front_strict.py`. Used by the cloud
when the user uploads a reference image that is NOT a clean orthographic
front (most "concept art" downloads are 3/4 angle): we re-generate from
the prompt + optional IPAdapter anchor, then pick the seed with the
highest horizontal-symmetry IoU on the rembg silhouette.

Two modes :
  - 'front' (default) — STRICT_FRONT_TAIL + NEG_FRONT, max symmetry.
    For humanoids / characters / weapons. Cascades cleanly into
    MV-Adapter + ControlNet OpenPose downstream.
  - 'iso' — ISO_TAIL + NEG_ISO, max ASYMMETRY (capped to avoid
    accidental back/side views). For vehicles / non-bipedal creatures
    where TRELLIS-2 single-shot needs depth cues to avoid trapu meshes.

Reuses the MyFabmeshBackview pipeline (RealVisXL + ControlNet OpenPose
+ IPAdapter). The ControlNet is NEUTRALIZED at call time by passing a
black image with cn_scale=0.0 — the conv stack still runs but its
output is zeroed, so the diffusion path is identical to a plain
StableDiffusionXLPipeline. This lets us avoid spinning up a second
@app.cls (would add another 15 GB snapshot for zero functional gain).
"""
from PIL import Image
import numpy as np
import torch


STRICT_FRONT_TAIL = (
    ', strict orthographic front view, perfectly head-on, '
    'symmetric horizontal mirror, zero rotation, no tilt, '
    'no perspective distortion, centered subject, plain white '
    'background, even studio lighting, sharp focus, 8k, masterpiece'
)
ISO_TAIL = (
    ', 3/4 isometric view, three-quarter angle, slight rotation '
    'showing both front and side, slight elevation showing the top, '
    'classic Objaverse render angle, full subject visible with '
    'depth cues, plain white background, even studio lighting, '
    'sharp focus, 8k, masterpiece'
)
NEG_FRONT = (
    'side view, profile view, three quarter view, back view, '
    '3/4 angle, rotated, perspective view, tilted, asymmetric, '
    'cropped, blurry, deformed, multiple subjects, watermark, '
    'low quality, frame, border, signature'
)
NEG_ISO = (
    'strict front view, flat front view, head-on, profile view, '
    'back view, top-down view, perspective distortion, fish-eye, '
    'cropped, blurry, deformed, multiple subjects, watermark, '
    'low quality, frame, border, signature'
)


def symmetry_score(img: Image.Image) -> float:
    """Return [0,1] horizontal-symmetry IoU of the rembg silhouette.
    Verbatim port of generate_front_strict.py:symmetry_score."""
    from rembg import remove
    rgba = remove(img.convert('RGBA'))
    arr = np.array(rgba)
    alpha = arr[..., 3].astype(np.float32) / 255.0
    if alpha.sum() < 100:
        return 0.0
    ys, xs = np.where(alpha > 0.05)
    y0, y1 = ys.min(), ys.max()
    x0, x1 = xs.min(), xs.max()
    crop = arr[y0:y1 + 1, x0:x1 + 1]
    crop_alpha = crop[..., 3].astype(np.float32) / 255.0
    flipped = crop_alpha[:, ::-1]
    a_bin = (crop_alpha > 0.5)
    f_bin = (flipped > 0.5)
    inter = np.logical_and(a_bin, f_bin).sum()
    union = np.logical_or(a_bin, f_bin).sum()
    return float(inter / union) if union > 0 else 0.0


def sur_blanc(im):
    """Compose une image a transparence sur fond BLANC. `convert('RGB')` seul
    aplatit la transparence en NOIR : l'empreinte IP-Adapter portait alors un
    fond noir alors que la consigne demande « plain white background »."""
    if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
        fond = Image.new('RGB', im.size, (255, 255, 255))
        fond.paste(im, mask=im.split()[-1])
        return fond
    return im.convert('RGB')


def ressemblance(pipe, ref_img, imgs):
    """Cosinus CLIP entre la reference et chaque candidat, avec l'encodeur
    d'image de l'IP-Adapter DEJA charge (aucun modele en plus). None si
    indisponible."""
    try:
        from transformers import CLIPImageProcessor
        enc = pipe.image_encoder
        proc = getattr(pipe, 'feature_extractor', None) or CLIPImageProcessor()
        x = proc(images=[sur_blanc(ref_img)] + [sur_blanc(i) for i in imgs],
                 return_tensors='pt').pixel_values.to('cuda', torch.float16)
        with torch.no_grad():
            e = enc(x).image_embeds.float()
        e = torch.nn.functional.normalize(e, dim=1)
        return [float((e[0] * e[k + 1]).sum()) for k in range(len(imgs))]
    except Exception as ex:
        print(f'[rectify] ressemblance non mesuree ({type(ex).__name__}: {ex})', flush=True)
        return None


def choisir(candidates, sims, tolerance=0.05):
    """(score, img, seed) -> index retenu. Le score (symetrie en face,
    asymetrie bornee en 3/4) ne sert plus qu'a ECARTER les dessins mal
    orientes ; parmi ceux a moins de `tolerance` du meilleur, on garde celui
    qui RESSEMBLE le plus a la reference. Avant (2026-09-27) : le plus
    symetrique l'emportait, meme s'il avait perdu la moitie du costume."""
    meilleur = max(c[0] for c in candidates)
    if not sims:
        return max(range(len(candidates)), key=lambda k: candidates[k][0])
    eligibles = [k for k, c in enumerate(candidates) if c[0] >= meilleur - tolerance]
    return max(eligibles, key=lambda k: sims[k])


def generate(
    pipe,                            # StableDiffusionXLControlNetPipeline (on CUDA)
    prompt: str,
    ref_img: Image.Image = None,     # optional — IPAdapter identity anchor
    mode: str = 'front',
    seeds: int = 3,
    steps: int = 30,
    guidance: float = 7.0,
    size: int = 1024,
    ip_scale: float = 0.7,
) -> Image.Image:
    """Multi-seed RealVisXL rectify with symmetry scoring. Returns the
    best candidate, post-processed (rembg + center @ ~92% canvas height).

    The pipe is the MyFabmeshBackview's ControlNet pipeline; we feed it
    a black image with controlnet_conditioning_scale=0.0 to neutralize
    the ControlNet branch (output is zeroed, no semantic effect)."""
    from modal_app._tpose import remove_bg_and_center

    if mode == 'iso':
        full_prompt = prompt.strip().rstrip('.,') + ISO_TAIL
        neg = NEG_ISO
    else:
        full_prompt = prompt.strip().rstrip('.,') + STRICT_FRONT_TAIL
        neg = NEG_FRONT

    # Neutralized ControlNet input — all-black 1024² (ControlNet still
    # runs its forward but cn_scale=0 zeroes the residuals into UNet).
    blank_skel = Image.new('RGB', (size, size), (0, 0, 0))

    # IPAdapter scale: 0.7 (preserve identity) when ref_img provided,
    # 0.0 (disable) otherwise. Required because the pipeline carries
    # IPAdapter weights from previous back_view/tpose calls otherwise.
    try:
        pipe.set_ip_adapter_scale(ip_scale if ref_img is not None else 0.0)
    except Exception:
        pass

    # Compel long-prompt encoding — bypasses the 77-token CLIP cap. ISO_TAIL
    # is ~58 tok, STRICT_FRONT_TAIL is ~47 tok, and BLIP-captioned source
    # prompts routinely overflow the budget, silently dropping the view-anchor
    # tokens (workflow wb66mnlri). Encoded ONCE before the loop since
    # (full_prompt, neg) are seed-independent. Falls back to vanilla pipe()
    # with truncated prompts if Compel fails.
    embeds = None
    try:
        from modal_app._sdxl_prompt_utils import encode_sdxl_long_prompt
        embeds = encode_sdxl_long_prompt(pipe, full_prompt, neg)
    except Exception as _ce:
        print(f'[rectify] Compel fallback ({_ce}); using truncated prompts',
              flush=True)

    candidates = []
    for i in range(seeds):
        seed = 1000 + i * 137  # same reproducible spread as desktop
        gen = torch.Generator('cuda').manual_seed(seed)
        base_kwargs = dict(
            image=blank_skel,
            controlnet_conditioning_scale=0.0,
            num_inference_steps=steps,
            guidance_scale=guidance,
            height=size,
            width=size,
            generator=gen,
        )
        if ref_img is not None:
            base_kwargs['ip_adapter_image'] = ref_img
        if embeds is not None:
            try:
                img = pipe(**embeds, **base_kwargs).images[0]
            except Exception as _pe:
                print(f'[rectify] embeds call failed ({_pe}); '
                      f'falling back to prompt= path', flush=True)
                embeds = None
                img = pipe(
                    prompt=full_prompt, negative_prompt=neg, **base_kwargs,
                ).images[0]
        else:
            img = pipe(
                prompt=full_prompt, negative_prompt=neg, **base_kwargs,
            ).images[0]
        sym = symmetry_score(img)
        # Front: maximize symmetry. ISO: maximize asymmetry but cap at
        # sym>=0.85 (would already be ~front), so reward
        # (1-sym) only when sym is meaningfully off-axis.
        if mode == 'iso':
            score = (1.0 - sym) if sym < 0.85 else 0.0
        else:
            score = sym
        candidates.append((score, img, seed))

    sims = ressemblance(pipe, ref_img, [c[1] for c in candidates]) if ref_img is not None else None
    for k, (sc, _, sd) in enumerate(candidates):
        print(f'[rectify]   seed={sd} score={sc:.3f}'
              + (f' ressemblance={sims[k]:.3f}' if sims else ''), flush=True)
    k = choisir(candidates, sims)
    best_score, best_img, best_seed = candidates[k]
    print(f'[rectify] mode={mode} best seed={best_seed} score={best_score:.3f} '
          + (f'ressemblance={sims[k]:.3f} ' if sims else '')
          + f'(over {seeds} seeds)', flush=True)
    return remove_bg_and_center(best_img, size=size)
