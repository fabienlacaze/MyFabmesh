"""Detourage u2net SANS importer rembg (2026-09-28).

Pourquoi : `import rembg` importe pymatting, qui compile ses noyaux numba A L'IMPORT —
87,7 s mesurees sur l'image Modal (modal_app/test_rembg_import.py), a chaque conteneur
neuf, pour des noyaux qui ne servent qu'au « alpha matting », jamais utilise ici. C'etait
l'essentiel des 70-83 s de « [mesh] image prepared » et du premier rectify / T-pose d'un
conteneur (un rectify a froid depassait ainsi les 100 s de Cloudflare, etait annule, relance…).

Ce module refait A L'IDENTIQUE le chemin par defaut de `rembg.remove(img, session=u2net)` :
memes poids (/root/.u2net/u2net.onnx, integres a l'image par app.py), meme normalisation,
memes redimensionnements LANCZOS, meme decoupe (`Image.composite` sur fond transparent).
Egalite pixel a pixel verifiee contre rembg sur l'image Modal (test_rembg_import.py).
Poids absents (autre image) : repli sur rembg lui-meme.
"""
import os

import numpy as np
from PIL import Image, ImageOps

POIDS_U2NET = os.path.join(
    os.environ.get("U2NET_HOME", os.path.expanduser(os.path.join("~", ".u2net"))), "u2net.onnx")

_SESSION = None


def _session():
    global _SESSION
    if _SESSION is None:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        if "OMP_NUM_THREADS" in os.environ:                 # meme reglage que rembg.new_session
            n = int(os.environ["OMP_NUM_THREADS"])
            opts.inter_op_num_threads = n
            opts.intra_op_num_threads = n
        # CPU : le fournisseur CUDA d'onnxruntime ne se charge pas dans nos images (libcudnn 9
        # absente) et rembg retombait deja sur le CPU — memes calculs.
        _SESSION = ort.InferenceSession(POIDS_U2NET, sess_options=opts,
                                        providers=["CPUExecutionProvider"])
    return _SESSION


def masque(img: Image.Image) -> Image.Image:
    """Masque u2net (mode L, taille de l'image) — rembg U2netSession.predict."""
    s = _session()
    im = np.array(img.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS))
    im = im / max(np.max(im), 1e-6)
    t = np.zeros((im.shape[0], im.shape[1], 3))
    for c, (m, e) in enumerate(zip((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))):
        t[:, :, c] = (im[:, :, c] - m) / e
    entree = {s.get_inputs()[0].name: np.expand_dims(t.transpose((2, 0, 1)), 0).astype(np.float32)}
    pred = s.run(None, entree)[0][:, 0, :, :]
    ma, mi = np.max(pred), np.min(pred)
    pred = np.squeeze((pred - mi) / (ma - mi))
    m = Image.fromarray((pred.clip(0, 1) * 255).astype("uint8"), mode="L")
    return m.resize(img.size, Image.Resampling.LANCZOS)


def detourer(img: Image.Image) -> Image.Image:
    """Equivalent de `rembg.remove(img)` (u2net, sans alpha matting) : image RGBA."""
    if not os.path.exists(POIDS_U2NET):
        import rembg
        return rembg.remove(img)
    img = ImageOps.exif_transpose(img)
    return Image.composite(img, Image.new("RGBA", img.size, 0), masque(img))
