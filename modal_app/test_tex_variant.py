"""Banc de la variante de texture « Keep the shape » sur la VRAIE image Modal (hors production).

Compare l'ancien reglage (controle Tile en couleurs, cn 0.45, sans prompt) au nouveau (controle
desature selon la force, cn plus bas, teinte tiree de la graine) sur une image source.

    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_tex_variant.py --fichier <image locale> --sortie C:/tmp/texvar
Cout : un L40S quelques minutes (~0,10 $).
"""
import modal

from modal_app.app import image

app = modal.App("myfabmesh-test-texvar", image=image)


@app.function(gpu="L40S", timeout=1200)
def essai(source: bytes, reglages: list) -> list:
    import io
    import time

    from PIL import Image

    from modal_app._tex_variant import generate
    from modal_app.app import _charger_pipe_tile

    src = Image.open(io.BytesIO(source)).convert('RGB')
    pipe = _charger_pipe_tile(False)
    sorties = []
    for r in reglages:
        t = time.time()
        img = generate(pipe, src, r['prompt'], strength=r['strength'], seed=r['seed'],
                       cn_scale=r['cn'], gris=r['gris'])
        b = io.BytesIO()
        img.save(b, 'PNG')
        sorties.append({'nom': r['nom'], 'png': b.getvalue(), 's': round(time.time() - t, 1)})
    return sorties


@app.local_entrypoint()
def main(fichier: str, sortie: str = 'C:/tmp/texvar'):
    import os
    os.makedirs(sortie, exist_ok=True)
    palettes = ['jet black', 'white with black spots', 'golden brown']
    reglages = [{'nom': 'ancien_90', 'prompt': '', 'strength': 0.9, 'seed': 471681, 'cn': 0.45, 'gris': 0.0}]
    for i, (graine, teinte) in enumerate(zip((101, 202, 303), palettes)):
        reglages.append({'nom': f'nouveau_90_{i}', 'prompt': f'{teinte} coloring, new color scheme, natural realistic texture, high quality, detailed',
                         'strength': 0.9, 'seed': graine, 'cn': 0.5 - 0.25 * 0.9, 'gris': 1.0})
    for r in essai.remote(open(fichier, 'rb').read(), reglages):
        with open(os.path.join(sortie, r['nom'] + '.png'), 'wb') as f:
            f.write(r['png'])
        print(r['nom'], r['s'], 's')
