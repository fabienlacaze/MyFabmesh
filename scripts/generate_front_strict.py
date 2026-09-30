"""Generate a strict ORTHOGRAPHIC FRONT or 3/4 ISO view from a text
prompt OR an existing image — works on any subject type.

Companion to `generate_front_tpose.py` which uses ControlNet OpenPose
(humanoid skeleton, irrelevant for cars/creatures/objects).

Two modes :
  --mode front (default) — strict orthographic front, scored by
    horizontal symmetry IoU of the rembg-masked silhouette. Best for
    humanoids (compatible with MV-Adapter, ControlNet OpenPose).
  --mode iso — 3/4 ISO angle (azim ~35°, elev ~25°), scored by
    *asymmetry* (orthographic-3/4 views are intentionally NOT mirror
    symmetric). Best for vehicles / objects / non-bipedal creatures
    where TRELLIS-2 single-shot needs depth cues to fix mesh
    proportions (a strict front yields trapu/compact meshes because
    the model has no length info).

When `--from-image <ref>` is given, the reference is used as IPAdapter
identity anchor (preserves color/silhouette while reorienting).

Licensing: RealVis XL (RAIL++-M), IPAdapter (Apache), rembg (MIT).
All commercial-safe.

Usage:
    python generate_front_strict.py <prompt> <output.png>
        [--mode front|iso] [--seeds 3] [--steps 30] [--guidance 7.0]
    python generate_front_strict.py --from-image <ref.png> <output.png>
        [--mode front|iso] [--seeds 3]
"""
import argparse
import os
import sys
import time

# Plafonds RAM / VRAM REELS (2026-09-30), AVANT torch : voir scripts/cloisonnement_memoire.py.
# (le Python embarque n'a pas le dossier du script sur sys.path : on l'ajoute)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cloisonnement_memoire as _cm
_cm.appliquer('front_strict', cle='front_strict', log=lambda m: print(f'[front-strict] {m}', flush=True))

import numpy as np
import torch
from PIL import Image


SCRIPTS = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    print(f'[front-strict] {msg}', flush=True)


# Reuse the rembg + center helper from generate_front_tpose.py to keep
# the output format identical (1024² white canvas, subject ~92% height).
sys.path.insert(0, SCRIPTS)
from generate_front_tpose import remove_bg_and_center


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
    """Return a [0, 1] score of horizontal symmetry on the rembg-masked
    foreground. 1.0 = perfectly symmetric, 0.0 = no symmetry."""
    from rembg import remove
    rgba = remove(img.convert('RGBA'))
    arr = np.array(rgba)
    alpha = arr[..., 3].astype(np.float32) / 255.0
    if alpha.sum() < 100:
        return 0.0  # no subject
    # Crop to subject bbox to make the comparison shift-invariant.
    ys, xs = np.where(alpha > 0.05)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    crop = arr[y0:y1 + 1, x0:x1 + 1]
    crop_alpha = crop[..., 3].astype(np.float32) / 255.0
    # Compare alpha to its horizontal flip (where the subject is, not
    # the texture — silhouette symmetry is what defines orthographic front).
    flipped = crop_alpha[:, ::-1]
    # IoU-style score on the binarized masks.
    a_bin = (crop_alpha > 0.5)
    f_bin = (flipped > 0.5)
    inter = np.logical_and(a_bin, f_bin).sum()
    union = np.logical_or(a_bin, f_bin).sum()
    return float(inter / union) if union > 0 else 0.0



def sur_blanc(im):
    """(Meme code que modal_app/_rectify.py.) Compose une image a transparence sur fond BLANC. `convert('RGB')` seul
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
        log(f'ressemblance non mesuree ({type(ex).__name__}: {ex})')
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


def load_pipeline(use_ipadapter_image_ref=None):
    from diffusers import StableDiffusionXLPipeline
    log('loading RealVisXL + (optional IPAdapter)')
    kwargs = {
        'torch_dtype': torch.float16,
        'variant': 'fp16',
        'use_safetensors': True,
    }
    if use_ipadapter_image_ref is not None:
        from transformers import CLIPVisionModelWithProjection
        kwargs['image_encoder'] = CLIPVisionModelWithProjection.from_pretrained(
            'h94/IP-Adapter', subfolder='models/image_encoder',
            torch_dtype=torch.float16)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        'SG161222/RealVisXL_V4.0', **kwargs)
    pipe.unet.to(torch.float16)
    pipe.vae.to(torch.float16)
    pipe.text_encoder.to(torch.float16)
    pipe.text_encoder_2.to(torch.float16)
    if use_ipadapter_image_ref is not None:
        pipe.load_ip_adapter(
            'h94/IP-Adapter', subfolder='sdxl_models',
            weight_name='ip-adapter-plus_sdxl_vit-h.safetensors')
        # 0.7 = preserve identity + still let the prompt re-orient
        # the subject toward strict front.
        pipe.set_ip_adapter_scale(0.7)
    pipe.enable_model_cpu_offload()
    log('pipeline ready')
    return pipe


def generate(prompt, out_path, ref_image=None, seeds=3, steps=30,
             guidance=7.0, size=1024, mode='front'):
    if mode == 'iso':
        full_prompt = prompt.strip().rstrip('.,') + ISO_TAIL
        neg = NEG_ISO
    else:
        full_prompt = prompt.strip().rstrip('.,') + STRICT_FRONT_TAIL
        neg = NEG_FRONT
    log(f'mode={mode}')
    log(f'prompt: "{full_prompt[:200]}..."')
    log(f'seeds={seeds} steps={steps} guidance={guidance}')

    ipadapter_ref = None
    if ref_image is not None:
        ipadapter_ref = sur_blanc(Image.open(ref_image))   # transparence -> BLANC, pas noir
        log(f'using ref image as IPAdapter anchor: {ref_image}')

    pipe = load_pipeline(use_ipadapter_image_ref=ipadapter_ref)

    candidates = []
    t0 = time.time()
    for i, base_seed in enumerate(range(seeds)):
        seed = 1000 + base_seed * 137  # spread seeds reproducibly
        gen = torch.Generator('cuda').manual_seed(seed)
        call_kwargs = dict(
            prompt=full_prompt, negative_prompt=neg,
            num_inference_steps=steps, guidance_scale=guidance,
            height=size, width=size, generator=gen,
        )
        if ipadapter_ref is not None:
            call_kwargs['ip_adapter_image'] = ipadapter_ref
        img = pipe(**call_kwargs).images[0]
        sym = symmetry_score(img)
        # Front: maximize symmetry. ISO: maximize asymmetry, but cap at
        # 0.6 so we don't reward extreme back/side views (those are
        # too asymmetric and not what we want either).
        if mode == 'iso':
            score = (1.0 - sym) if sym < 0.85 else 0.0
            log(f'  candidate {i+1}/{seeds} seed={seed} '
                f'sym={sym:.3f} iso_score={score:.3f}')
        else:
            score = sym
            log(f'  candidate {i+1}/{seeds} seed={seed} symmetry={score:.3f}')
        candidates.append((score, img, seed))

    # Le plus RESSEMBLANT parmi les mieux orientes (voir choisir).
    sims = ressemblance(pipe, ipadapter_ref, [c[1] for c in candidates]) if ipadapter_ref is not None else None
    if sims:
        log('  ressemblance : ' + ', '.join(f'seed={c[2]} {s:.3f}' for c, s in zip(candidates, sims)))
    best_score, best_img, best_seed = candidates[choisir(candidates, sims)]
    log(f'best: seed={best_seed} score={best_score:.3f} '
        f'(after {time.time()-t0:.1f}s)')

    log('post-processing: rembg + center')
    final = remove_bg_and_center(best_img, size=size)
    final.save(out_path)
    log(f'saved -> {out_path}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('prompt_or_first', nargs='?')
    ap.add_argument('output')
    ap.add_argument('--from-image', dest='from_image', default=None)
    ap.add_argument('--mode', choices=['front', 'iso'], default='front')
    ap.add_argument('--seeds', type=int, default=3)
    ap.add_argument('--steps', type=int, default=30)
    ap.add_argument('--guidance', type=float, default=7.0)
    args = ap.parse_args()
    # Plafond VRAM = limite de l'utilisateur moins ce que les autres occupent deja ;
    # plafond RAM ramene au budget (voir cloisonnement_memoire).
    _cm.plafonner_vram(torch)

    if args.from_image is not None:
        if not os.path.isfile(args.from_image):
            log(f'ERROR: --from-image not found: {args.from_image}')
            sys.exit(2)
        # DESCRIPTION DU SUJET (2026-09-27). main.js passe le mot « auto » :
        # il servait TEL QUEL de consigne (« auto » = voiture pour le modele),
        # et le cloud envoyait « subject ». Le personnage etait redessine a
        # partir d'une vague empreinte d'image. On decrit l'image (BLIP-1,
        # scripts/caption_image.py) ; « subject » seulement en dernier recours.
        prompt = args.prompt_or_first
        if not prompt or prompt.strip().lower() in ('auto', 'subject'):
            try:
                from caption_image import caption
                prompt = (caption(args.from_image) or '').strip() or 'subject'
                torch.cuda.empty_cache()   # le descripteur ne reste pas en VRAM pendant SDXL
                log(f'description : {prompt[:200]}')
            except Exception as e:
                log(f'description impossible ({e}) -> subject')
                prompt = 'subject'
        generate(prompt, args.output, ref_image=args.from_image,
                 seeds=args.seeds, steps=args.steps, guidance=args.guidance,
                 mode=args.mode)
    else:
        if not args.prompt_or_first:
            log('ERROR: prompt required (or use --from-image)')
            sys.exit(2)
        generate(args.prompt_or_first, args.output, ref_image=None,
                 seeds=args.seeds, steps=args.steps, guidance=args.guidance,
                 mode=args.mode)
    _cm.terminer('ok')


if __name__ == '__main__':
    main()
