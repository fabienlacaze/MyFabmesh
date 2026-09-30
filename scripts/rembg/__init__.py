"""Remplacement LEGER de `rembg` : detourage u2net par onnxruntime seul (2026-09-30).

Pourquoi ce module existe (installation de zero sur un PC sous Smart App Control) :
  * `import rembg` importe pymatting, qui importe numba, dont la DLL native (`_helperlib`) est BLOQUEE par Smart App Control
    (« An Application Control policy has blocked this file ») -> toute generation 3D echouait a l'etape image_prep ;
  * rembg n'installe aucun moteur onnxruntime de lui-meme (« No onnxruntime backend found ») ;
  * sur le cloud, `import rembg` coutait 88 s par conteneur neuf (compilation des noyaux numba) : `modal_app/_detourage.py` avait deja refait
    le meme calcul avec onnxruntime seul, pixel pour pixel identique a rembg (test_rembg_import.py).

Ce paquet est place dans `scripts/` : les scripts sont lances depuis ce dossier (sys.path[0]), donc `import rembg` / `from rembg import remove, new_session`
prennent CE module, sans rien changer aux ~10 scripts qui l'appellent. Seul le chemin par defaut de rembg est reproduit (u2net, sans alpha matting, memes
normalisation et redimensionnements LANCZOS, meme decoupe). Les poids `u2net.onnx` (Apache 2.0, 176 Mo, SHA-256 verifie) sont telecharges une fois dans
U2NET_HOME (defaut ~/.u2net) s'ils manquent.
"""
import hashlib
import io
import os
import ssl
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageOps

__all__ = ['remove', 'new_session']

_URL_U2NET = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx'
_SHA256_U2NET = '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491'


def _dossier_poids():
    return os.environ.get('U2NET_HOME') or os.path.join(os.path.expanduser('~'), '.u2net')


def _sha256(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest()


def _poids_u2net():
    """Chemin de u2net.onnx ; telecharge (et verifie) si absent."""
    dossier = _dossier_poids()
    chemin = os.path.join(dossier, 'u2net.onnx')
    if os.path.isfile(chemin) and os.path.getsize(chemin) > 100_000_000:
        return chemin
    os.makedirs(dossier, exist_ok=True)
    cafile = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    ctx = ssl.create_default_context(cafile=cafile) if cafile and os.path.isfile(cafile) else ssl.create_default_context()
    tmp = chemin + '.part'
    print('[rembg] telechargement du modele de detourage (176 Mo)...', file=sys.stderr, flush=True)
    try:
        with urllib.request.urlopen(_URL_U2NET, context=ctx, timeout=120) as r, open(tmp, 'wb') as out:
            while True:
                bloc = r.read(1 << 20)
                if not bloc:
                    break
                out.write(bloc)
        if _sha256(tmp) != _SHA256_U2NET:
            raise RuntimeError('somme de controle du modele de detourage incorrecte')
        os.replace(tmp, chemin)
    except Exception as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise RuntimeError(
            'Impossible de telecharger le modele de detourage (u2net.onnx). Verifiez la connexion Internet, ou placez le fichier dans ' + dossier + ' (' + str(e) + ')')
    return chemin


class _Session:
    def __init__(self, nom='u2net'):
        if nom not in ('u2net', None):
            raise ValueError('modele de detourage non pris en charge : ' + str(nom) + ' (seul u2net est fourni)')
        import onnxruntime as ort
        opts = ort.SessionOptions()
        if 'OMP_NUM_THREADS' in os.environ:                 # meme reglage que rembg.new_session
            n = int(os.environ['OMP_NUM_THREADS'])
            opts.inter_op_num_threads = n
            opts.intra_op_num_threads = n
        # CPU : identique a ce que rembg utilisait deja sans cuDNN, aucune dependance CUDA
        self._s = ort.InferenceSession(_poids_u2net(), sess_options=opts, providers=['CPUExecutionProvider'])

    def masque(self, img):
        """Masque u2net (mode L, taille de l'image) — rembg U2netSession.predict."""
        s = self._s
        im = np.array(img.convert('RGB').resize((320, 320), Image.Resampling.LANCZOS))
        im = im / max(np.max(im), 1e-6)
        t = np.zeros((im.shape[0], im.shape[1], 3))
        for c, (m, e) in enumerate(zip((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))):
            t[:, :, c] = (im[:, :, c] - m) / e
        entree = {s.get_inputs()[0].name: np.expand_dims(t.transpose((2, 0, 1)), 0).astype(np.float32)}
        pred = s.run(None, entree)[0][:, 0, :, :]
        ma, mi = np.max(pred), np.min(pred)
        pred = np.squeeze((pred - mi) / (ma - mi))
        m = Image.fromarray((pred.clip(0, 1) * 255).astype('uint8'), mode='L')
        return m.resize(img.size, Image.Resampling.LANCZOS)


_SESSION_DEFAUT = None


def new_session(model_name='u2net', *args, **kwargs):
    return _Session(model_name)


def remove(data, session=None, *args, **kwargs):
    """Equivalent de `rembg.remove(data, session=...)` (u2net, sans alpha matting).
    Accepte une image PIL, des octets (renvoie des octets PNG) ou un tableau numpy (renvoie un tableau)."""
    global _SESSION_DEFAUT
    if session is None:
        if _SESSION_DEFAUT is None:
            _SESSION_DEFAUT = _Session('u2net')
        session = _SESSION_DEFAUT
    if isinstance(data, Image.Image):
        img, retour = data, 'pil'
    elif isinstance(data, (bytes, bytearray)):
        img, retour = Image.open(io.BytesIO(data)), 'octets'
    elif isinstance(data, np.ndarray):
        img, retour = Image.fromarray(data), 'numpy'
    else:
        raise ValueError('type non pris en charge : ' + str(type(data)))
    img = ImageOps.exif_transpose(img)
    if img.mode not in ('RGB', 'RGBA', 'L'):
        img = img.convert('RGBA')
    sortie = Image.composite(img.convert('RGBA'), Image.new('RGBA', img.size, 0), session.masque(img))
    if retour == 'pil':
        return sortie
    if retour == 'numpy':
        return np.asarray(sortie)
    tampon = io.BytesIO()
    sortie.save(tampon, format='PNG')
    return tampon.getvalue()
