"""Detourage u2net SANS importer rembg (2026-09-28), puis union avec Lucida (2026-10-03).

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

2026-10-03 : le masque est desormais l'UNION de u2net et de Lucida (egeorcun/lucida, MIT, sur GPU).
POURQUOI : mesure sur Modal (modal_app/test_lucida_vs_u2net.py, 36 images reelles). Sur les personnages en T-pose a fond gris,
u2net PERD en mediane 21,7 % de ce que Lucida garde (avant-bras, mains, ARMES) : avant la 3D (_mesh.prep_image), dans l'image de
T-pose LIVREE au client (_tpose.remove_bg_and_center la colle sur un canevas blanc) et dans _rectify. Mais Lucida echoue sur
d'autres images (l'ane gris sur blanc : 81 % du masque u2net manquant). Chaque modele se trompe par DEFAUT de sujet, jamais par
exces : le bon masque est l'union (modal_app/fusion_masques.py, noyau partage avec le bureau).

detourer() reste LE SEUL point d'entree (meme signature, meme type de retour : image RGBA). Le mode vient de la variable
FABMESH_DETOURAGE, relue A CHAQUE APPEL :
    "union" (defaut, ou "auto") : alpha = fusionner_alphas(u2net, Lucida) ;
    "u2net"                     : u2net seul, comme avant (octet pour octet) ;
    "lucida"                    : Lucida seul (repli u2net).
Lucida est FACULTATIF : pas de carte CUDA (on ne l'execute JAMAIS sur le processeur : 10 a 20 s par image), poids absents de
l'image, code distant qui ne se charge pas, erreur d'inference -> u2net seul, exactement le resultat d'avant. L'echec de
chargement est memorise (une tentative par processus, un seul message ; l'absence de carte, elle, n'est pas memorisee : une
carte peut arriver avec un instantane GPU restaure) et detourer() ne leve jamais a cause de Lucida.
Les poids (844 Mo) sont lus dans le cache LOCAL de l'image (app.py les y integre) ; FABMESH_LUCIDA_TELECHARGER=1 autorise le
telechargement (bancs seulement) ; FABMESH_LUCIDA_REVISION epingle la revision du depot si app.py l'a epinglee.
precharger() charge Lucida des le demarrage du conteneur : a appeler dans le crochet de demarrage, avant la prise d'instantane.
"""
import gc
import os
import sys
import threading
import time

import numpy as np
from PIL import Image, ImageOps

try:
    from modal_app.fusion_masques import diagnostic_masques, fusionner_alphas, mode_detourage
except ImportError:
    # module charge PAR CHEMIN (bancs : spec_from_file_location, racine du depot absente de sys.path) : on prend le voisin du fichier
    import importlib.util as _iu
    _spec = _iu.spec_from_file_location(
        "fusion_masques_voisin", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fusion_masques.py"))
    _voisin = _iu.module_from_spec(_spec)
    _spec.loader.exec_module(_voisin)
    diagnostic_masques, fusionner_alphas, mode_detourage = (
        _voisin.diagnostic_masques, _voisin.fusionner_alphas, _voisin.mode_detourage)

POIDS_U2NET = os.path.join(
    os.environ.get("U2NET_HOME", os.path.expanduser(os.path.join("~", ".u2net"))), "u2net.onnx")

_SESSION = None

DEPOT_LUCIDA = "egeorcun/lucida"
_VERROU_CHARGEMENT = threading.Lock()   # un seul chargement de Lucida, meme si deux fils arrivent ensemble
_VERROU_INFERENCE = threading.Lock()    # une inference Lucida a la fois (une seule instance du modele sur la carte)
_LUCIDA = None                          # enveloppe du modele charge (_ModeleLucida), ou None
_LUCIDA_ESSAYE = False                  # True des que le chargement a ete tente, reussi OU NON : jamais retente
_SANS_CARTE_SIGNALE = False             # le message « pas de carte » n'est journalise qu'une fois par processus


class _PasDeCarte(RuntimeError):
    """Aucune carte CUDA dans ce processus : Lucida est indisponible MAINTENANT, mais rien n'a ete tente (pas un echec de
    chargement). Non memorise : une carte peut etre attachee plus tard (restauration d'un instantane GPU)."""


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


def _journal(message):
    print(message, flush=True)


def _ms(depuis):
    return int((time.time() - depuis) * 1000)


class _ModeleLucida(object):
    """Lucida charge sur la carte. TOUT ce qui touche aux tenseurs est ici : le reste du module ne voit que alpha()."""

    def __init__(self, modele, torch, peripherique):
        self.modele = modele
        self.torch = torch
        self.peripherique = peripherique
        self._pretraitement = None

    def alpha(self, img_rgb):
        """Masque (ndarray uint8, forme (hauteur, largeur), 255 = sujet) d'une image PIL RGB.

        EXACTEMENT le chemin du banc modal_app/test_lucida_vs_u2net.py : Resize 1024 x 1024 + ToTensor + Normalize ImageNet,
        modele(x)[-1].sigmoid(), retour a la taille de l'image. Les tenseurs de la carte sont ramenes sur le processeur
        puis liberes (le cache de l'allocateur reste a la disposition des autres modeles du conteneur)."""
        from torchvision import transforms
        if self._pretraitement is None:
            self._pretraitement = transforms.Compose([
                transforms.Resize((1024, 1024)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
            ])
        x = self._pretraitement(img_rgb).unsqueeze(0).to(self.peripherique)
        try:
            with self.torch.no_grad():
                p = self.modele(x)[-1].sigmoid().cpu()
        finally:
            del x
            if str(self.peripherique).startswith("cuda"):
                try:
                    # rend les ~2 Go d'activations a la carte : le maillage 3D et les pipelines d'image du meme processus
                    # ne doivent pas payer le pic de Lucida (mesure : 3,2 Go de pic, 0,85 Go de poids)
                    self.torch.cuda.empty_cache()
                except Exception:
                    pass
        a = transforms.functional.resize(p[0], img_rgb.size[::-1]).squeeze(0)
        return (a.numpy().clip(0, 1) * 255).astype("uint8")


def _preparer_dependances_lucida():
    """Le code distant de Lucida importe kornia (un seul appel, en entrainement). Absent de l'image, il est remplace par les
    substituts PUR TORCH de modal_app/lucida_shims.py SI ce fichier est livre ; sinon rien : transformers refusera alors le
    chargement et Lucida sera declare indisponible (u2net seul)."""
    try:
        import kornia  # noqa: F401
        return
    except Exception:
        pass
    try:
        from modal_app import lucida_shims
    except Exception:
        return
    lucida_shims.installer(log=lambda m: _journal("[detourage] substituts kornia/timm : %s" % m))


def _construire_lucida():
    """Charge Lucida sur la carte et rend son enveloppe. LEVE si c'est impossible (_charger_lucida memorise l'echec)."""
    import torch
    if not torch.cuda.is_available():
        # jamais sur le processeur : 10 a 20 s par image, bien plus cher que ce que le masque rapporte
        raise _PasDeCarte("pas de carte CUDA (Lucida sur processeur : 10 a 20 s par image, jamais utilise)")
    _preparer_dependances_lucida()
    from transformers import AutoModelForImageSegmentation
    options = {
        "trust_remote_code": True,
        # poids lus dans le cache LOCAL de l'image ; le reseau seulement sur demande explicite (bancs)
        "local_files_only": os.environ.get("FABMESH_LUCIDA_TELECHARGER") != "1",
    }
    if os.environ.get("FABMESH_LUCIDA_REVISION"):
        options["revision"] = os.environ["FABMESH_LUCIDA_REVISION"]
    modele = AutoModelForImageSegmentation.from_pretrained(DEPOT_LUCIDA, **options)
    modele.to("cuda")
    modele.float()
    modele.eval()
    return _ModeleLucida(modele, torch, "cuda")


def _charger_lucida():
    """Rend l'enveloppe de Lucida, ou None s'il est indisponible. Chargement PARESSEUX, UNE seule fois par processus.

    Le verrou garantit un seul chargement meme si deux fils arrivent ensemble ; l'ECHEC est memorise lui aussi (une seule
    tentative, un seul message de journal, pas de nouvel essai a chaque image : un chargement rate coute des secondes).
    Seule exception : l'absence de carte CUDA n'est PAS un echec de chargement (rien n'est tente, aucun cout) : elle n'est pas
    memorisee, pour qu'un processus qui recoit sa carte plus tard (instantane GPU restaure) charge Lucida alors. Un seul
    message de journal, comme pour un echec."""
    global _LUCIDA, _LUCIDA_ESSAYE, _SANS_CARTE_SIGNALE
    if _LUCIDA_ESSAYE:
        return _LUCIDA
    with _VERROU_CHARGEMENT:
        if _LUCIDA_ESSAYE:
            return _LUCIDA
        t0 = time.time()
        try:
            _LUCIDA = _construire_lucida()
            _journal("[detourage] Lucida charge en %.1f s" % (time.time() - t0))
        except _PasDeCarte as e:
            if not _SANS_CARTE_SIGNALE:
                _SANS_CARTE_SIGNALE = True
                _journal("[detourage] Lucida indisponible, u2net seul : %s" % e)
            return None
        except Exception as e:
            _LUCIDA = None
            _journal("[detourage] Lucida indisponible, u2net seul : %s: %s" % (type(e).__name__, str(e)[:300]))
        _LUCIDA_ESSAYE = True       # APRES _LUCIDA : un fil qui voit le drapeau voit aussi le modele
        return _LUCIDA


def precharger():
    """Charge Lucida des maintenant, pour que le premier detourage d'un conteneur n'en paie pas le chargement.

    A appeler au demarrage du conteneur : dans le crochet de prise d'instantane, le modele (~0,85 Go de memoire de carte) est
    restaure avec le reste ; sinon, dans le crochet de demarrage apres restauration. Rend True si Lucida est pret. Sans effet
    (False) quand FABMESH_DETOURAGE=u2net. Ne leve JAMAIS : sans Lucida, detourer() utilise u2net seul."""
    try:
        if mode_detourage(os.environ.get("FABMESH_DETOURAGE")) == "u2net":
            return False
        return _charger_lucida() is not None
    except Exception:
        return False


def reinitialiser_lucida():
    """Oublie le modele charge ET l'echec memorise : repartir d'un processus neuf (bancs et tests seulement)."""
    global _LUCIDA, _LUCIDA_ESSAYE, _SANS_CARTE_SIGNALE
    with _VERROU_CHARGEMENT:
        _LUCIDA = None
        _LUCIDA_ESSAYE = False
        _SANS_CARTE_SIGNALE = False
    gc.collect()
    try:
        torch = sys.modules.get("torch")
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def masque_lucida(img: Image.Image):
    """Masque Lucida (image PIL « L », taille de l'image), ou None s'il est indisponible ou si l'inference echoue.

    Ne leve JAMAIS : l'appelant se replie sur u2net. Les inferences sont serialisees par un verrou. Un masque qui n'est pas un
    uint8 de la forme (hauteur, largeur) de l'image est refuse (None) plutot que de corrompre le detourage."""
    try:
        lucida = _charger_lucida()
        if lucida is None:
            return None
        rgb = img.convert("RGB")
        with _VERROU_INFERENCE:
            alpha = lucida.alpha(rgb)
        largeur, hauteur = rgb.size
        if not isinstance(alpha, np.ndarray) or alpha.dtype != np.uint8 or alpha.shape != (hauteur, largeur):
            attendu = "uint8 (%d, %d)" % (hauteur, largeur)
            recu = "%s %s" % (getattr(alpha, "dtype", type(alpha).__name__), getattr(alpha, "shape", "?"))
            raise ValueError("masque inattendu : %s au lieu de %s" % (recu, attendu))
        return Image.fromarray(alpha)
    except Exception as e:
        _journal("[detourage] Lucida : inference impossible, u2net seul : %s: %s" % (type(e).__name__, str(e)[:300]))
        return None


def _decouper(img, m):
    """Decoupe `img` selon le masque `m` (image « L ») sur fond transparent : le geste de rembg.remove, inchange."""
    return Image.composite(img, Image.new("RGBA", img.size, 0), m)


def detourer(img: Image.Image) -> Image.Image:
    """Equivalent de `rembg.remove(img)` (u2net, sans alpha matting) : image RGBA.

    Depuis le 2026-10-03 le masque est l'UNION de u2net et de Lucida (voir le haut du module). FABMESH_DETOURAGE=u2net, ou
    Lucida indisponible, redonnent exactement le resultat d'avant. Ne leve jamais a cause de Lucida."""
    if not os.path.exists(POIDS_U2NET):
        import rembg
        return rembg.remove(img)
    img = ImageOps.exif_transpose(img)
    mode = mode_detourage(os.environ.get("FABMESH_DETOURAGE"))   # relue A CHAQUE APPEL : on peut basculer sans redemarrer
    if mode == "u2net":
        return _decouper(img, masque(img))
    t0 = time.time()
    if mode == "lucida":
        m_lucida = masque_lucida(img)
        if m_lucida is not None:
            _journal("[detourage] lucida seul en %d ms" % _ms(t0))
            return _decouper(img, m_lucida)
        m_u2 = masque(img)
        _journal("[detourage] lucida indisponible, u2net seul en %d ms" % _ms(t0))
        return _decouper(img, m_u2)
    m_u2 = masque(img)
    try:
        m_lucida = masque_lucida(img)
        if m_lucida is None:
            _journal("[detourage] lucida indisponible, u2net seul en %d ms" % _ms(t0))
            return _decouper(img, m_u2)
        a_u2 = np.asarray(m_u2)
        a_lucida = np.asarray(m_lucida)
        m_union = Image.fromarray(fusionner_alphas(a_u2, a_lucida))
        d = diagnostic_masques(a_u2, a_lucida)
    except Exception as e:
        _journal("[detourage] union impossible, u2net seul : %s: %s" % (type(e).__name__, str(e)[:300]))
        return _decouper(img, m_u2)
    ligne = "[detourage] union : u2net %.1f %%, lucida %.1f %%, union %.1f %% en %d ms" % (
        100 * d["aire_u2"], 100 * d["aire_lucida"], 100 * d["aire_union"], _ms(t0))
    if d["lucida_defaillant"]:
        ligne += " ; lucida en defaut"
    if d["u2net_defaillant"]:
        ligne += " ; u2net en defaut"
    _journal(ligne)
    return _decouper(img, m_union)
