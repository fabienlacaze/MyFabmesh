"""Correctif FabMesh pour SkinTokens (VAST-AI, MIT) : alignement EXACT du
transfert de rig (`demo.py --use_transfer`).

POURQUOI (mesure du 2026-09-26). Avec --use_transfer, SkinTokens replace le
squelette et la peau calcules sur SON maillage normalise vers le maillage
d'origine, celui qui porte UV et textures. Il estime pour cela une similitude
(`estimate_similarity_transform`). Quand les deux maillages n'ont pas le meme
nombre de sommets — le cas normal, les coutures UV dupliquent des sommets —
il passe par `_pca_similarity` : 4 096 points tires AU HASARD de chaque cote,
puis alignement des axes principaux SANS lever l'ambiguite de signe. Mesure
sur 200 tirages : retournement a 180 degres dans 42 % des cas pour un
chevalier TRELLIS-2, 43 % pour un elephant, 26 % pour un poisson. Un rig
retourne garde ses os dans le corps, mais inverse gauche et droite et laisse
les orientations des os fausses : les animations cassent.

Or la normalisation d'inference de SkinTokens (config `predict_transform` du
checkpoint : trim -> affine [-1, 1] -> normalize ; `AugmentAffine`) ne fait
AUCUNE rotation : recentrage de la boite englobante puis echelle uniforme. La
similitude exacte se lit donc sur les deux boites. Ce correctif l'essaie en
premier ; si les boites ne sont pas homothetiques (une version future qui
tournerait l'entree), l'ancien chemin reprend la main.

Le meme fichier sert au cloud (execute au BUILD de l'image Modal) et au bureau
(appele par skintokens_bridge.py avant chaque rig). Les deux copies doivent
rester identiques : build/check-noyaux-partages.mjs le verifie.

Usage : python patch_skintokens_transfert.py <racine SkinTokens>
"""
import os
import sys

MARQUEUR = "_fabmesh_similitude_boites"
CIBLE = os.path.join("src", "rig_package", "parser", "bpy.py")
ANCRE_FONCTION = "def estimate_similarity_transform("
ANCRE_APPEL = "    if src.shape[0] == tgt.shape[0]:"

FONCTION = '''def _fabmesh_similitude_boites(src, tgt, tolerance=0.02):
    """FabMesh : similitude EXACTE (echelle uniforme + translation, sans
    rotation), lue sur les boites englobantes. Explication complete dans
    patch_skintokens_transfert.py (depot FabMesh). None si les boites ne sont
    pas homothetiques : l'appelant reprend alors son ancien chemin."""
    import numpy as _np
    src = _np.asarray(src, dtype=_np.float64)
    tgt = _np.asarray(tgt, dtype=_np.float64)
    lo_s, hi_s = src.min(axis=0), src.max(axis=0)
    lo_t, hi_t = tgt.min(axis=0), tgt.max(axis=0)
    ext_s, ext_t = hi_s - lo_s, hi_t - lo_t
    if ext_s.max() <= 0 or ext_t.max() <= 0:
        return None
    echelle = ext_t.max() / ext_s.max()
    if _np.abs(ext_t - echelle * ext_s).max() > tolerance * ext_t.max():
        return None
    T = _np.eye(4)
    T[:3, :3] *= echelle
    T[:3, 3] = (lo_t + hi_t) / 2 - echelle * (lo_s + hi_s) / 2
    print("[fabmesh] transfert : similitude par boites englobantes "
          "(echelle %.5f)" % echelle, flush=True)
    return T


'''

APPEL = '''    _t_fabmesh = _fabmesh_similitude_boites(src, tgt)
    if _t_fabmesh is not None:
        return _t_fabmesh
'''


def _auto_test():
    """La fonction inseree retrouve une homothetie exacte malgre des sommets
    dupliques, et refuse une entree tournee. Leve AssertionError sinon."""
    import numpy as np
    espace = {}
    exec(FONCTION, espace)
    f = espace[MARQUEUR]
    rng = np.random.default_rng(0)
    src = rng.normal(size=(5000, 3)) * np.array([0.3, 1.0, 0.15])
    decal = np.array([0.1, -0.2, 0.05])
    tgt = src * 0.37 + decal
    tgt = np.concatenate([tgt, tgt[:77]])            # coutures UV : doublons
    T = f(src, tgt)
    assert T is not None, "homothetie non reconnue"
    assert np.allclose(T[:3, :3], np.eye(3) * 0.37), T
    assert np.allclose(T[:3, 3], decal), T
    c, s = np.cos(np.pi / 2), np.sin(np.pi / 2)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    assert f(src, src @ R.T) is None, "rotation acceptee a tort"


def appliquer(racine):
    """Applique le correctif (idempotent). Rend 'deja' ou 'applique' ; leve une
    exception si le fichier de SkinTokens ne ressemble plus a ce qu'on attend
    (l'appelant doit alors renoncer au transfert)."""
    chemin = os.path.join(racine, CIBLE)
    with open(chemin, encoding="utf-8", newline="") as fh:
        texte = fh.read()
    if MARQUEUR in texte:
        return "deja"
    fin = "\r\n" if "\r\n" in texte else "\n"
    i = texte.find(ANCRE_FONCTION)
    if i < 0 or texte.count(ANCRE_FONCTION) != 1:
        raise RuntimeError("ancre '%s' introuvable ou multiple dans %s" % (ANCRE_FONCTION, chemin))
    j = texte.find(ANCRE_APPEL.replace("\n", fin), i)
    if j < 0:
        raise RuntimeError("ancre '%s' introuvable apres %s" % (ANCRE_APPEL.strip(), ANCRE_FONCTION))
    # D'abord l'appel (plus loin dans le texte), puis la fonction : les
    # indices calcules restent valides.
    texte = texte[:j] + APPEL.replace("\n", fin) + texte[j:]
    texte = texte[:i] + FONCTION.replace("\n", fin) + texte[i:]
    with open(chemin, "w", encoding="utf-8", newline="") as fh:
        fh.write(texte)
    return "applique"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage : python patch_skintokens_transfert.py <racine SkinTokens>")
        sys.exit(2)
    _auto_test()
    etat = appliquer(sys.argv[1])
    with open(os.path.join(sys.argv[1], CIBLE), encoding="utf-8") as fh:
        assert MARQUEUR in fh.read(), "correctif absent apres application"
    print("correctif d'alignement SkinTokens : %s (auto-test OK)" % etat)
