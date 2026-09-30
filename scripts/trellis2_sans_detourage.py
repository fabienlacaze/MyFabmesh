"""Empeche TRELLIS-2 de charger son propre modele de detourage (2026-09-30).

`Trellis2ImageTo3DPipeline.from_pretrained` construit `rembg.BiRefNet(...)` d'apres pipeline.json, alors que FabMesh detoure EN AMONT (u2net,
`scripts/rembg`) et remet ensuite `pipeline.rembg_model = None`. Sur une installation neuve ce chargement inutile :
  * telecharge ~1 Go (ZhengPeng7/BiRefNet), absent de la liste de l'assistant ;
  * execute du code distant qui exige `timm` ET `kornia`, dont la DLL `kornia_rs` est bloquee par Smart App Control
    (« ImportError: This modeling file requires the following packages that were not found in your environment: kornia, timm », essai du 2026-09-30) ;
  * consomme de la memoire pour rien.
On remplace donc la classe par une coquille vide AVANT `from_pretrained`. A appeler une fois, apres l'ajout de external/TRELLIS2_win/src au chemin.
"""


class _SansDetourage:
    """Meme interface que BiRefNet, ne charge rien. Le detourage est deja fait ; renvoie l'image telle quelle."""

    def __init__(self, *args, **kwargs):
        pass

    def to(self, *args, **kwargs):
        return self

    def cuda(self, *args, **kwargs):
        return self

    def cpu(self, *args, **kwargs):
        return self

    def __call__(self, image):
        return image


def appliquer():
    from trellis2.pipelines import rembg as _rembg
    _rembg.BiRefNet = _SansDetourage
