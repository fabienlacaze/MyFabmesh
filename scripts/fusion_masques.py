"""Fusion des masques de detourage : UNION de deux detoureurs, u2net et Lucida (2026-10-03).

SOURCE : scripts/fusion_masques.py (bureau). COPIE IDENTIQUE : modal_app/fusion_masques.py (Modal, qui ne peut pas
importer scripts/). Le garde build/check-noyaux-partages.mjs refuse une construction si les deux fichiers different ;
resynchroniser avec `node build/check-noyaux-partages.mjs --sync`. Ne jamais editer la copie a la main.

POURQUOI (mesure du 2026-10-03 sur Modal, 36 images reelles, modal_app/test_lucida_vs_u2net.py) :
  - sur les personnages en T-pose a fond gris, u2net PERD en mediane 21,7 % de ce que Lucida garde : avant-bras, mains
    et ARMES (le maillage reproduit ensuite fidelement une image deja amputee) ;
  - mais Lucida echoue ailleurs : l'ane gris sur fond blanc (il ne garde que 5,9 % de l'image contre 31,7 % pour u2net,
    81 % du masque u2net manquant) et un mille-pattes (16,5 % du masque u2net manquant).
  Chaque modele se trompe par DEFAUT de sujet, jamais par exces : le bon masque est l'UNION. Sur les mesures, l'union
  vaut 1,03 x Lucida sur l'orc, 1,00 x u2net sur l'ane (5,4 x Lucida) et 1,00 x u2net sur le mille-pattes.

CONTRAT (le bureau, `_prep_image`, reutilise ce module tel quel) :
  - Python pur + numpy (1.26 comme 2.x) : aucun torch, aucun PIL, aucun reseau, aucun etat global ;
  - un masque est un tableau numpy uint8 a DEUX dimensions (hauteur, largeur) : 0 = fond, 255 = sujet ; les deux masques
    compares ont la MEME forme (c'est a l'appelant de redimensionner Lucida a la taille de l'image) ;
  - aucune fonction ne modifie ses entrees (un tableau en lecture seule, comme `np.asarray(image)`, est accepte) et le
    resultat ne partage pas sa memoire avec elles ;
  - fusionner_alphas et diagnostic_masques refusent toute autre entree par une ValueError au message clair ;
    mode_detourage ne leve JAMAIS (une valeur inconnue est l'union, le mode sur) ;
  - « sujet » = alpha >= SEUIL_SUJET (127) pour toutes les mesures du diagnostic.

Exemple :
    alpha = fusionner_alphas(np.asarray(masque_u2net), np.asarray(masque_lucida))   # uint8 (h, w)
    d = diagnostic_masques(np.asarray(masque_u2net), np.asarray(masque_lucida))
    if d["lucida_defaillant"]: ...    # journaliser « Lucida en defaut », l'union garde u2net
"""
import numpy as np

__all__ = ["SEUIL_SUJET", "SEUIL_U2_DEFAUT", "MODES", "fusionner_alphas", "diagnostic_masques", "mode_detourage"]

#: alpha a partir duquel un pixel compte comme « sujet » dans les mesures (comme le banc du 2026-10-03, a ceci pres que
#: la comparaison est >= et non >).
SEUIL_SUJET = 127
#: alpha u2net a partir duquel u2net est « sur » : en dessous, ses traces fantomes et ses bords tres doux sont ignores.
SEUIL_U2_DEFAUT = 127
#: modes de detourage connus (variable d'environnement FABMESH_DETOURAGE).
MODES = ("union", "u2net", "lucida")


def _verifier_masque(nom, a):
    """ValueError au message clair si `a` n'est pas un masque valide (ndarray uint8 a 2 dimensions)."""
    if not isinstance(a, np.ndarray):
        raise ValueError("%s : tableau numpy attendu, recu %s" % (nom, type(a).__name__))
    if a.dtype != np.uint8:
        raise ValueError("%s : dtype uint8 attendu, recu %s" % (nom, a.dtype))
    if a.ndim != 2:
        raise ValueError("%s : tableau a 2 dimensions (hauteur, largeur) attendu, recu %d dimension(s), forme %s"
                         % (nom, a.ndim, tuple(a.shape)))


def _verifier_paire(a_u2, a_lucida):
    _verifier_masque("a_u2", a_u2)
    _verifier_masque("a_lucida", a_lucida)
    if a_u2.shape != a_lucida.shape:
        raise ValueError("a_u2 et a_lucida doivent avoir la meme forme : a_u2 %s, a_lucida %s"
                         % (tuple(a_u2.shape), tuple(a_lucida.shape)))


def _verifier_seuil(seuil):
    if isinstance(seuil, bool) or not isinstance(seuil, (int, np.integer)):
        raise ValueError("seuil_u2 : entier entre 0 et 255 attendu, recu %r" % (seuil,))
    seuil = int(seuil)
    if not 0 <= seuil <= 255:
        raise ValueError("seuil_u2 : entier entre 0 et 255 attendu, recu %d" % seuil)
    return seuil


def fusionner_alphas(a_u2, a_lucida, seuil_u2=SEUIL_U2_DEFAUT):
    """Alpha final = UNION des deux masques, tableau uint8 neuf de meme forme.

    alpha = max(a_lucida, a_u2 la ou a_u2 >= seuil_u2, sinon 0) :
      - Lucida garde tout ce qu'il voit, avec son propre alpha (bords doux compris) ;
      - u2net n'apporte que les pixels ou il est SUR (>= seuil_u2, 127 par defaut = 0,5) ; ses valeurs plus faibles
        (traces fantomes, halo) sont ignorees, donc n'ajoutent jamais de brume.
    Quand Lucida echoue (l'ane : 5,9 % de l'image), le resultat est u2net seul (seuille) ; quand u2net perd les bras et
    les armes (l'orc), le resultat est Lucida plus ce que u2net a de sur. Jamais moins que l'un ou l'autre.

    `a_u2`, `a_lucida` : ndarray uint8 2D de meme forme (ValueError sinon). `seuil_u2` : entier de 0 a 255.
    Les entrees ne sont pas modifiees."""
    _verifier_paire(a_u2, a_lucida)
    seuil = _verifier_seuil(seuil_u2)
    sur_u2 = np.where(a_u2 >= seuil, a_u2, np.uint8(0))
    return np.maximum(a_lucida, sur_u2).astype(np.uint8, copy=False)


def diagnostic_masques(a_u2, a_lucida):
    """Mesures de l'accord entre les deux masques (dict, valeurs Python natives : float et bool).

      aire_u2, aire_lucida, aire_union : part de l'image couverte (de 0 a 1) a SEUIL_SUJET ; l'union est celle de
                                         fusionner_alphas au meme seuil ;
      u2net_manque  : part du masque Lucida absente du masque u2net (ce que u2net perd) ;
      lucida_manque : part du masque u2net absente du masque Lucida (ce que Lucida perd) ;
      lucida_defaillant : aire_lucida < 0,5 x aire_u2  (l'ane : 0,059 contre 0,317) ;
      u2net_defaillant  : aire_u2 < 0,8 x aire_lucida  (l'orc : 0,163 contre 0,244).
    Les comparaisons de surface se font sur les COMPTES de pixels (arithmetique entiere, exacte, inegalite stricte) :
    pile a la limite, un masque n'est pas defaillant. Image vide : tout vaut 0 et rien n'est defaillant.

    `a_u2`, `a_lucida` : ndarray uint8 2D de meme forme (ValueError sinon). Les entrees ne sont pas modifiees."""
    _verifier_paire(a_u2, a_lucida)
    b_u2 = a_u2 >= SEUIL_SUJET
    b_lu = a_lucida >= SEUIL_SUJET
    n_u2 = int(np.count_nonzero(b_u2))
    n_lu = int(np.count_nonzero(b_lu))
    n_union = int(np.count_nonzero(b_u2 | b_lu))
    n_lucida_seul = int(np.count_nonzero(b_lu & ~b_u2))     # sujet pour Lucida, fond pour u2net
    n_u2_seul = int(np.count_nonzero(b_u2 & ~b_lu))          # sujet pour u2net, fond pour Lucida
    taille = float(a_u2.size)

    def part(n):
        return n / taille if taille else 0.0

    return {
        "aire_u2": part(n_u2),
        "aire_lucida": part(n_lu),
        "aire_union": part(n_union),
        "u2net_manque": n_lucida_seul / float(max(n_lu, 1)),
        "lucida_manque": n_u2_seul / float(max(n_u2, 1)),
        "lucida_defaillant": 2 * n_lu < n_u2,        # n_lu < 0,5 x n_u2
        "u2net_defaillant": 5 * n_u2 < 4 * n_lu,     # n_u2 < 0,8 x n_lu
    }


def mode_detourage(valeur_env):
    """Mode de detourage lu dans FABMESH_DETOURAGE : "union", "u2net" ou "lucida". Ne leve jamais.

      None, vide, "auto", "union" -> "union" (le defaut : l'union des deux masques) ;
      "u2net"                     -> "u2net" (u2net seul, comme avant le 2026-10-03) ;
      "lucida"                    -> "lucida" (Lucida seul) ;
      toute autre valeur (faute de frappe, nombre, octets...) -> "union".
    Majuscules et espaces autour sont ignores (« U2Net » vaut « u2net »)."""
    try:
        if isinstance(valeur_env, str):
            v = valeur_env.strip().lower()
            if v in ("u2net", "lucida"):
                return v
    except Exception:
        pass
    return "union"
