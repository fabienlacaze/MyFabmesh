"""Lucida (egeorcun/lucida, MIT) — background removal / matting.

A BiRefNet fine-tune that beats u2net on hard edges: glass/transparency,
hair/fur, text/logos, glow, illustration/line-art. Pure PyTorch via HF
transformers (trust_remote_code) — no custom CUDA, runs on RTX 5080 (sm_120).

2026-10-03 — rendu accessible sur le bureau. Le code distant du modele fait
`from timm.layers import ...` et `from kornia.filters import laplacian` ;
kornia est ABSENT du Python de l'appli et sa DLL (kornia_rs) est bloquee par
Smart App Control, qu'on ne contourne JAMAIS. scripts/lucida_shims.py fournit des
substituts PUR TORCH, enregistres seulement si le vrai paquet ne s'importe pas.
Les poids (844 Mo) sont cherches, dans l'ordre : FABMESH_LUCIDA_DIR, le cache de
l'appli (HF_HUB_CACHE / HF_HOME), puis le cache HF par defaut de l'utilisateur
(~/.cache/huggingface/hub). Jamais de telechargement silencieux : sans poids,
LucidaAbsent (« poids Lucida absents ») et l'appelant se rabat sur u2net ;
FABMESH_LUCIDA_TELECHARGER=1 l'autorise (provisionnement, reseau requis).
float32 par defaut ; FABMESH_LUCIDA_FP16=1 passe le modele en demi-precision (carte seulement).

Usage (ligne de commande, inchange) :
    python lucida_matte.py <image_path> [<output_png>]

Output: an RGBA PNG (original RGB + Lucida alpha). If <output_png> is omitted,
writes <image>_lucida.png next to the input. Code retour 2 : poids absents.

Usage (bibliotheque) :
    matte(in_path, out_path)      -> ecrit le PNG RGBA
    matte_image(img_pil)          -> image « L » (alpha, taille de l'image d'entree)
    liberer()                     -> rend la memoire (modele, ramasse-miettes, cache CUDA)
"""
import gc
import os
import sys

# Le Python embarque de l'appli (fichier ._pth) n'a PAS le dossier du script sur sys.path :
# sans cette ligne, `import lucida_shims` echouerait quand ce fichier est lance comme script.
_ICI = os.path.dirname(os.path.abspath(__file__))
if _ICI not in sys.path:
    sys.path.insert(0, _ICI)

DEPOT = "egeorcun/lucida"
DOSSIER_DEPOT = "models--egeorcun--lucida"
FICHIERS_CODE = ("config.json", "birefnet.py", "BiRefNet_config.py")   # sans eux, from_pretrained ne trouve pas la classe
FICHIERS_POIDS = ("model.safetensors", "pytorch_model.bin")

# Cle du journal des pics de memoire (logs/memoire_pics.jsonl) : NEUTRE, jamais un nom de moteur (l'interface peut
# afficher le libelle d'un type de calcul : regle de l'exploitant sur les noms de moteurs).
CLE_JOURNAL = "background_removal"

_MODELE = None      # (modele, peripherique, demi_precision)
_T = None           # transformation d'entree, construite a la premiere utilisation
_CM = None          # cloisonnement_memoire (plafond de VRAM) : pose par main() seulement, jamais en usage bibliotheque


class LucidaAbsent(RuntimeError):
    """Les poids de Lucida ne sont sur aucun disque consulte (et le telechargement n'est pas autorise)."""


# ---------------------------------------------------------------------------
# Recherche des poids (aucun import lourd, aucun reseau)
# ---------------------------------------------------------------------------
def _taille(chemin):
    try:
        return os.path.getsize(chemin)
    except OSError:
        return 0


def _dossier_complet(d):
    """True si `d` contient de quoi charger Lucida SANS rien telecharger : config, code distant et poids."""
    if not os.path.isdir(d):
        return False
    if not all(os.path.isfile(os.path.join(d, f)) for f in FICHIERS_CODE):
        return False
    return any(_taille(os.path.join(d, p)) > 0 for p in FICHIERS_POIDS)


def _instantanes(hub):
    """Dossiers snapshots/<revision> du depot dans un cache hub, la revision que `main` designe d'abord."""
    base = os.path.join(hub, DOSSIER_DEPOT)
    try:
        noms = sorted(os.listdir(os.path.join(base, "snapshots")))
    except OSError:
        return []
    try:
        with open(os.path.join(base, "refs", "main"), "r", encoding="utf-8") as f:
            principal = f.read().strip()
    except OSError:
        principal = ""
    noms.sort(key=lambda n: (n != principal, n))
    return [os.path.join(base, "snapshots", n) for n in noms]


def _premier_complet(hub):
    for d in _instantanes(hub):
        if _dossier_complet(d):
            return d
    return None


def _hubs_de_l_appli(env):
    """Caches hub configures par l'environnement (l'appli installee pose HF_HOME et HF_HUB_CACHE), dans l'ordre."""
    hubs = []
    for var in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
        if env.get(var):
            hubs.append(env[var])
    if env.get("HF_HOME"):
        hubs.append(os.path.join(env["HF_HOME"], "hub"))
    return hubs


def trouver_poids(env=None, home=None):
    """(dossier, origine) d'un instantane COMPLET de Lucida (config + code distant + poids) ; LucidaAbsent sinon.

    Ordre : 1) FABMESH_LUCIDA_DIR (le dossier du modele, ou un cache hub qui le contient) ; 2) le cache de l'appli
    (HF_HUB_CACHE / HUGGINGFACE_HUB_CACHE / HF_HOME) ; 3) le cache HF par defaut de l'utilisateur
    (~/.cache/huggingface/hub), ou d'anciennes versions ont laisse les poids. Un dossier incomplet est ignore : le
    suivant est essaye. `env` et `home` servent aux tests."""
    env = os.environ if env is None else env
    home = os.path.expanduser("~") if home is None else home
    vus, cherches = set(), []

    def essayer(origine, dossier):
        cle = os.path.normcase(os.path.abspath(dossier))
        if cle in vus:
            return None
        vus.add(cle)
        cherches.append(f"{origine} ({dossier})")
        return _premier_complet(dossier)

    explicite = env.get("FABMESH_LUCIDA_DIR")
    if explicite:
        if _dossier_complet(explicite):
            return explicite, "FABMESH_LUCIDA_DIR"
        for hub in (explicite, os.path.join(explicite, "hub")):
            trouve = essayer("FABMESH_LUCIDA_DIR", hub)
            if trouve:
                return trouve, "FABMESH_LUCIDA_DIR"
    for hub in _hubs_de_l_appli(env):
        trouve = essayer("cache de l'appli", hub)
        if trouve:
            return trouve, "cache de l'appli"
    trouve = essayer("cache utilisateur", os.path.join(home, ".cache", "huggingface", "hub"))
    if trouve:
        return trouve, "cache utilisateur"
    raise LucidaAbsent(
        "poids Lucida absents : cherches dans " + " ; ".join(cherches)
        + ". Aucun telechargement automatique (844 Mo) : copier le depot egeorcun/lucida dans l'un de ces dossiers, "
        "ou poser FABMESH_LUCIDA_TELECHARGER=1 (reseau requis).")


def _source_modele(env=None, home=None):
    """(source, local_seulement, origine) a donner a from_pretrained."""
    env = os.environ if env is None else env
    try:
        dossier, origine = trouver_poids(env, home)
        return dossier, True, origine
    except LucidaAbsent:
        # Le telechargement ne se fait que sur demande EXPLICITE, et jamais hors ligne (HF_HUB_OFFLINE=1 : meme regle
        # que scripts/hf_hors_ligne.py, local_files_only=True).
        if env.get("FABMESH_LUCIDA_TELECHARGER") == "1" and env.get("HF_HUB_OFFLINE") != "1":
            return DEPOT, False, "telechargement"
        raise


# ---------------------------------------------------------------------------
# Modele
# ---------------------------------------------------------------------------
def _charger():
    """Charge le modele une seule fois ; rend (modele, peripherique, demi_precision)."""
    global _MODELE
    if _MODELE is not None:
        return _MODELE
    source, local, origine = _source_modele()      # AVANT tout import lourd : sans poids, l'echec est immediat
    import torch
    if _CM is not None:
        _CM.plafonner_vram(torch)                  # VRAM : limite de l'utilisateur moins ce que les autres occupent
    import lucida_shims
    lucida_shims.installer(log=lambda m: print(f"LUCIDA: {m}", flush=True))
    from transformers import AutoModelForImageSegmentation
    m = AutoModelForImageSegmentation.from_pretrained(
        source, trust_remote_code=True, dtype=torch.float32, local_files_only=local)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    demi = dev == "cuda" and os.environ.get("FABMESH_LUCIDA_FP16") == "1"
    m.to(dev).eval()
    if demi:
        m.half()
    print(f"LUCIDA: model loaded on {dev} ({origine}{', fp16' if demi else ''})", flush=True)
    _MODELE = (m, dev, demi)
    return _MODELE


def _transformation():
    global _T
    if _T is None:
        from torchvision import transforms
        _T = transforms.Compose([
            transforms.Resize((1024, 1024)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
    return _T


def matte_image(img):
    """Alpha « L » (255 = sujet), a la taille de l'image PIL d'entree."""
    import torch
    from PIL import Image
    from torchvision import transforms
    m, dev, demi = _charger()
    rgb = img.convert("RGB")
    x = _transformation()(rgb).unsqueeze(0).to(dev)
    if demi:
        x = x.half()
    with torch.no_grad():
        preds = m(x)[-1].sigmoid().float().cpu()
    alpha = transforms.functional.resize(preds[0], rgb.size[::-1]).squeeze(0)
    return Image.fromarray((alpha.numpy() * 255).astype("uint8"))      # tableau 2D uint8 : mode « L » (le parametre mode est deprecie)


def matte(in_path, out_path):
    """Ecrit en `out_path` un PNG RGBA : les couleurs d'origine + l'alpha de Lucida."""
    from PIL import Image
    img = Image.open(in_path).convert("RGB")
    rgba = img.copy()
    rgba.putalpha(matte_image(img))
    rgba.save(out_path, "PNG")
    return out_path


def liberer():
    """Rend la memoire : supprime le modele, ramasse les miettes, vide le cache CUDA."""
    global _MODELE
    _MODELE = None
    gc.collect()
    torch = sys.modules.get("torch")
    if torch is not None:
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Ligne de commande
# ---------------------------------------------------------------------------
def _cloisonner():
    """Plafonds RAM / VRAM reels (scripts/cloisonnement_memoire.py), poses AVANT torch ; None si indisponible.
    Lance par le pipeline 3D en sous-processus, ce script doit respecter la limite de VRAM de l'utilisateur comme
    tout script GPU : sans elle, un depassement deborde dans la memoire partagee (donc la RAM)."""
    try:
        import cloisonnement_memoire as cm
        cm.appliquer("lucida_matte", cle=CLE_JOURNAL, log=lambda m: print(f"[lucida] {m}", flush=True))
        return cm
    except Exception as e:
        print(f"[lucida] cloisonnement memoire indisponible ({type(e).__name__}: {e})", flush=True)
        return None


def main():
    global _CM
    if len(sys.argv) < 2:
        print("Usage: python lucida_matte.py <image_path> [<output_png>]")
        sys.exit(1)
    in_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else \
        os.path.splitext(in_path)[0] + "_lucida.png"
    if not os.path.exists(in_path):
        print(f"LUCIDA_ERROR: image not found: {in_path}")
        sys.exit(1)
    _CM = _cloisonner()
    try:
        matte(in_path, out_path)
    except LucidaAbsent as e:
        print(f"LUCIDA_ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(2)
    if _CM is not None:
        _CM.mesurer("lucida")        # ligne FABMESH_MEM_ETAPE avec le pic de VRAM de PyTorch : le pipeline 3D la journalise
        _CM.terminer("ok")
    print(f"OK: {out_path}", flush=True)


if __name__ == "__main__":
    main()
