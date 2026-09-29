"""BANC (2026-09-29) : Face Fix image sur de VRAIES images (animaux, personnage, type inconnu). Application
ephemere (image Modal de production, rien n'est deploye), ~0,10 $. Ecrit, par cas, l'image avant/apres
(tete agrandie) dans <dossier>.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_face_fix_image <dossier> <cle:type> [<cle:type> ...]
"""
import io
import sys

import modal

from modal_app import app as A

banc = modal.App("myfabmesh-banc-face-fix")


@banc.function(image=A.image, gpu="L40S", timeout=1200)
def essais(cas: list) -> list:
    import time
    import urllib.request
    import torch
    from PIL import Image
    from transformers import CLIPSegProcessor, CLIPSegForImageSegmentation
    from diffusers import StableDiffusionXLInpaintPipeline
    import modal_app._face_fix_image as F

    proc = CLIPSegProcessor.from_pretrained('CIDAS/clipseg-rd64-refined')
    try:
        proc.image_processor.size = {'height': 512, 'width': 512}     # comme la production
    except Exception:
        pass
    seg = CLIPSegForImageSegmentation.from_pretrained('CIDAS/clipseg-rd64-refined').to('cuda').eval()
    pipe = StableDiffusionXLInpaintPipeline.from_pretrained(
        'diffusers/stable-diffusion-xl-1.0-inpainting-0.1', torch_dtype=torch.float16, variant='fp16').to('cuda')
    pipe.enable_attention_slicing()
    pipe.enable_vae_tiling()
    sorties = []
    for c in cas:
        req = urllib.request.Request(c['url'], headers={"User-Agent": "Mozilla/5.0 myfabmesh-banc"})
        src = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGB')
        t = time.time()
        try:
            out = F.generate(pipe, src, strength=c.get('force', 0.45), seg_processor=proc, seg_model=seg,
                             asset_type=c['type'])
            err = None
        except ValueError as e:
            out, err = None, str(e)
        r = {'nom': c['nom'], 'type': c['type'], 'dt': round(time.time() - t, 1), 'erreur': err}
        if out is not None:
            # zone modifiee : difference avant/apres, pour cadrer l'agrandissement
            import numpy as np
            d = np.abs(np.asarray(out, np.int16) - np.asarray(src, np.int16)).sum(axis=2) > 12
            ys, xs = np.where(d)
            if len(xs):
                x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
                m = 20
                boite = (max(0, x0 - m), max(0, y0 - m), min(src.width, x1 + m), min(src.height, y1 + m))
            else:
                boite = (0, 0, src.width, src.height)
            a, b = src.crop(boite), out.crop(boite)
            planche = Image.new('RGB', (a.width * 2 + 10, a.height), 'white')
            planche.paste(a, (0, 0)); planche.paste(b, (a.width + 10, 0))
            buf = io.BytesIO(); planche.save(buf, 'JPEG', quality=90)
            r['jpg'] = buf.getvalue()
            r['boite'] = [int(v) for v in boite]
        sorties.append(r)
    return sorties


if __name__ == "__main__":
    dossier = sys.argv[1]
    cfg = {}
    for l in io.open('cloud/.env.local', encoding='utf-8'):
        l = l.strip()
        if l and not l.startswith('#') and '=' in l:
            k, v = l.split('=', 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    import boto3
    s3 = boto3.client('s3', endpoint_url='https://%s.r2.cloudflarestorage.com' % cfg['R2_ACCOUNT_ID'],
                      aws_access_key_id=cfg['R2_ACCESS_KEY_ID'], aws_secret_access_key=cfg['R2_SECRET_ACCESS_KEY'],
                      region_name='auto')
    cas = []
    for i, arg in enumerate(sys.argv[2:]):
        cle, typ = arg.rsplit(':', 1)
        typ, _, force = typ.partition('@')          # « animal@0.3 » : force de la retouche
        url = s3.generate_presigned_url('get_object', Params={'Bucket': 'myfabmesh-meshes', 'Key': cle}, ExpiresIn=3600)
        cas.append({'nom': f'{i}_{typ or "inconnu"}{"_" + force if force else ""}', 'url': url, 'type': typ,
                    'force': float(force) if force else 0.45})
    with modal.enable_output():
        with banc.run():
            res = essais.remote(cas)
    for r in res:
        if r.get('jpg'):
            open(f"{dossier}/{r['nom']}.jpg", 'wb').write(r.pop('jpg'))
        print(r)
