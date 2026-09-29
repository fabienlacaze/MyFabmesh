"""BANC (2026-09-29) : outil Variant, forme verrouillee (tex_variant), sur une VRAIE image. Compare
l'ancien prompt (palette de robes d'animaux, tiree au hasard) a des palettes par type d'objet.
Memes reglages que la page a 50 % : gris 0,333, ControlNet 0,375, 28 pas. Application ephemere
(image Modal de production, rien n'est deploye), ~0,10 $.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal_app.test_variante <cle R2 de l'image> <dossier> [force 0-1]
"""
import io
import json
import sys

import modal

from modal_app import app as A

banc = modal.App("myfabmesh-banc-variante")

NEG = 'deformed, distorted, changed shape, different pose, extra parts, missing parts, blurry, low quality'
NEG_PEAU = (NEG + ', different person, different face, animal head, werewolf, nude, nsfw, green skin, '
            'blue skin, grey skin, colored skin, body paint, monochrome, color tint')


@banc.function(image=A.image, gpu="L40S", timeout=1200)
def variantes(url: str, cas: list) -> list:
    import time
    import urllib.request
    from PIL import Image
    from modal_app._tex_variant import generate
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 myfabmesh-banc"})
    src = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGB')
    pipe = A._charger_pipe_tile(decharger_cpu=False)
    sorties = []
    for c in cas:
        t = time.time()
        f = c.get('force', 0.5)
        gris = max(0.0, min(1.0, (f - 0.3) / 0.6)) * c.get('facteur_gris', 1.0)
        out = generate(pipe, src, prompt=c['prompt'], strength=f, seed=c['seed'],
                       cn_scale=0.5 - 0.25 * f, neg_prompt=c['neg'], gris=gris)
        b = io.BytesIO()
        out.save(b, 'JPEG', quality=88)
        sorties.append({'nom': c['nom'], 'dt': round(time.time() - t, 1), 'jpg': b.getvalue()})
    return sorties


if __name__ == "__main__":
    cle, dossier = sys.argv[1], sys.argv[2]
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
    url = s3.generate_presigned_url('get_object', Params={'Bucket': 'myfabmesh-meshes', 'Key': cle}, ExpiresIn=3600)
    ancien = 'olive green coloring, new color scheme, natural realistic texture, high quality, detailed'
    def tenue(t):
        return (f'{SUJET}, same face, wearing {t} clothing, different clothing materials and colors, '
                'natural realistic skin tone, photorealistic, high quality, detailed')
    force = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
    SUJET = sys.argv[4] if len(sys.argv) > 4 else 'same person'   # prompt du projet (la page le connait)
    cas = []
    famille = sys.argv[5] if len(sys.argv) > 5 else 'personnage'
    if famille == 'personnage':
        for i, t in enumerate(['grey fur and bone', 'dark brown leather and bronze', 'red wool cloth and iron',
                               'deep blue dyed cloth and silver', 'black fur and gold', 'white linen and tan leather',
                               'charcoal wool and copper', 'crimson cloth and black leather']):
            cas.append({'nom': f'{i}_{t.replace(" ", "_")}', 'prompt': tenue(t), 'neg': NEG_PEAU,
                        'force': force, 'facteur_gris': 0.5, 'seed': 11 + i})
    else:   # objets, vehicules, batiments : ancienne palette (robes d'animaux) contre MATIERES
        for i, t in enumerate(['white with black spots', 'brindle striped']):
            cas.append({'nom': f'a{i}_ancien_{t.replace(" ", "_")}', 'force': force, 'seed': 21 + i, 'neg': NEG,
                        'prompt': f'{t} coloring, new color scheme, natural realistic texture, high quality, detailed'})
        for i, t in enumerate(['weathered oak wood and wrought iron', 'white marble and gold trim', 'dark slate stone',
                               'pale birch wood', 'terracotta and cream plaster', 'black lacquer and silver']):
            cas.append({'nom': f'{i}_{t.replace(" ", "_")}', 'force': force, 'seed': 31 + i, 'neg': NEG,
                        'prompt': f'{SUJET}, {t}, new materials and colors, realistic texture, high quality, detailed'})
    with modal.enable_output():
        with banc.run():
            res = variantes.remote(url, cas)
    for r in res:
        open(f"{dossier}/{r['nom']}.jpg", 'wb').write(r['jpg'])
        print(r['nom'], r['dt'], 's')
