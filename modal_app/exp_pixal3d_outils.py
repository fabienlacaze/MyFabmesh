"""OUTILS PURS du banc Pixal3D (18/10/2026) : ni torch ni modal, donc testables sur CPU (build/bancs/noyaux/test_pixal3d_outils.py).

Deux pieces, utilisees par modal_app/exp_pixal3d.py DANS le conteneur GPU :

  - Accumulateur + decomposer() : chronometre, pour la duree d'un bloc, des methodes / fonctions choisies d'un code qu'on ne veut pas modifier
    (ici o_voxel.postprocess.to_glb, la meme fonction que dans notre image TRELLIS.2) et les RESTAURE toujours ensuite, meme apres une exception.
    Sert a repondre a « ou passe le temps de l'export GLB » sans toucher au code de l'auteur.
  - SondeMemoire : pic de memoire GPU occupee sur TOUT le peripherique (pilote), echantillonne en arriere-plan. Raison : torch.cuda.max_memory_allocated()
    ne voit que l'allocateur de PyTorch ; les allocations directes des extensions CUDA (CuMesh, cuBVH, nvdiffrast) lui echappent, et un « pic memoire »
    qui les ignore sous-estime ce qu'il faut reserver sur la carte.

Ne conclut rien sur la qualite : ce sont des durees et des octets.
"""
import contextlib
import functools
import threading
import time


class Accumulateur:
    """Somme des durees (s) et nombre d'appels par etiquette."""

    def __init__(self):
        self.s = {}
        self.n = {}
        self.ignorees = []            # cibles introuvables (le code de l'auteur a change) : signalees, jamais fatales

    def ajouter(self, etiquette, duree):
        self.s[etiquette] = self.s.get(etiquette, 0.0) + float(duree)
        self.n[etiquette] = self.n.get(etiquette, 0) + 1

    def resume(self):
        """{etiquette: {"s": ..., "appels": ...}} du plus long au plus court."""
        return {k: {"s": round(self.s[k], 3), "appels": self.n[k]} for k in sorted(self.s, key=lambda e: -self.s[e])}

    def total(self):
        return round(sum(self.s.values()), 3)


def _envelopper(fonction, etiquette, acc, sync, horloge):
    @functools.wraps(fonction)
    def enveloppe(*a, **k):
        sync()
        t0 = horloge()
        try:
            return fonction(*a, **k)
        finally:
            sync()
            acc.ajouter(etiquette, horloge() - t0)
    enveloppe.__pixal_original__ = fonction
    return enveloppe


@contextlib.contextmanager
def decomposer(cibles, acc, sync=lambda: None, horloge=time.perf_counter):
    """cibles : liste de (objet, nom_d_attribut, etiquette). Pendant le bloc, objet.nom_d_attribut est remplace par une enveloppe qui mesure sa duree
    (sync() avant et apres : sur GPU, torch.cuda.synchronize, sinon le temps d'un noyau asynchrone serait compte dans l'appel suivant) ;
    a la sortie les originaux sont TOUJOURS remis, y compris apres une exception. Une cible absente est ignoree (acc.ignorees).
    Piege evite : ne jamais envelopper un appelant ET son appele avec des etiquettes differentes sans le savoir (les durees s'additionneraient deux fois)."""
    poses = []
    try:
        for objet, attribut, etiquette in cibles:
            try:
                original = getattr(objet, attribut)
            except AttributeError:
                acc.ignorees.append(etiquette)
                continue
            try:
                setattr(objet, attribut, _envelopper(original, etiquette, acc, sync, horloge))
            except (AttributeError, TypeError):
                acc.ignorees.append(etiquette)         # attribut en lecture seule (type natif, __slots__...)
                continue
            poses.append((objet, attribut, original))
        yield acc
    finally:
        for objet, attribut, original in reversed(poses):
            try:
                setattr(objet, attribut, original)
            except (AttributeError, TypeError):
                pass


class SondeMemoire:
    """Pic d'une grandeur (Go de memoire GPU occupee) echantillonnee toutes les `pas` secondes par un fil d'arriere-plan.
    lire() -> float (Go) ; en production : (total - libre) de torch.cuda.mem_get_info(), vu du pilote."""

    def __init__(self, lire, pas=0.2):
        self._lire = lire
        self._pas = pas
        self.pic = 0.0
        self.echantillons = 0
        self._arret = threading.Event()
        self._verrou = threading.Lock()
        self._fil = None

    def _echantillonner(self):
        try:
            v = float(self._lire())
        except Exception:
            return
        with self._verrou:
            self.echantillons += 1
            if v > self.pic:
                self.pic = v

    def demarrer(self):
        if self._fil is not None:
            return self
        self._arret.clear()

        def boucle():
            while not self._arret.is_set():
                self._echantillonner()
                self._arret.wait(self._pas)

        self._fil = threading.Thread(target=boucle, name="sonde-memoire", daemon=True)
        self._fil.start()
        return self

    def reinitialiser(self):
        """Remet le pic a zero PUIS prend un echantillon immediat (la valeur courante est un minorant du pic de l'etape qui commence)."""
        with self._verrou:
            self.pic = 0.0
        self._echantillonner()

    def lire_pic(self):
        self._echantillonner()
        with self._verrou:
            return self.pic

    def arreter(self):
        self._arret.set()
        if self._fil is not None:
            self._fil.join(timeout=2.0)
            self._fil = None


# ----------------------------------------------------------------------------------------------- noms (logique pure)
def nom_etape_sampler(description):
    """Description tqdm passee par pixal3d_image_to_3d.py a sampler.sample(..., tqdm_desc=...) -> nom d'etape du tableau de durees.
    Descriptions de l'auteur (f7cf384) : « Sampling sparse structure (proj) », « Sampling shape SLat (proj) » (512), « Sampling HR shape SLat (proj, 1536) »,
    « Sampling texture SLat (proj) ». L'ordre des tests compte : « HR shape » contient « shape »."""
    d = description or ""
    if "sparse structure" in d:
        return "echantillonnage structure creuse (SS)"
    if "texture" in d:
        return "echantillonnage texture 1024"
    if "HR shape" in d:
        return "echantillonnage forme HR " + d.split(",")[-1].strip(" )")
    if "shape" in d:
        return "echantillonnage forme LR 512"
    return "echantillonnage : " + d


def chemin_glb_volume(nom, etiquette, passe, suffixe):
    """Chemin, sur le volume Modal, du GLB d'une passe (suffixe '' = export principal, '_1m' = export a 1 M de faces)."""
    return "/cache/out/pixal3d_%s%s_p%d%s.glb" % (nom, etiquette, int(passe), suffixe)


def nom_glb_local(nom, etiquette, passe, derniere, suffixe):
    """Nom du fichier telecharge dans C:/tmp/trellis_cloud/glb. La DERNIERE passe (chaude) porte le nom attendu par le comparateur
    (pixal3d_orc.glb, pixal3d_orc_1m.glb, pixal3d_photo.glb) ; les passes precedentes gardent leur numero (pixal3d_orc_passe1.glb)."""
    if derniere:
        return "pixal3d_%s%s%s.glb" % (nom, etiquette, suffixe)
    return "pixal3d_%s%s_passe%d%s.glb" % (nom, etiquette, int(passe), suffixe)
