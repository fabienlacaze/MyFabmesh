"""Test du retrait de la dalle de sol et du socle d'un maillage de personnage (2026-10-03, audit de fidelite).

Lancer :  <python de l'appli> build/bancs/noyaux/test_dalle_sol.py -v     (le Python embarque de l'appli n'a pas le dossier courant
dans sys.path : lancer le FICHIER, pas « -m unittest build/... »)
Variable NOYAU_ACCEL : chemin d'une AUTRE copie de acceleration_glb.py (pour prouver que le test echoue sur
l'ancien code : git show HEAD:scripts/acceleration_glb.py > fichier_temporaire).

Aucun modele, aucun GPU, aucun reseau. Formes SYNTHETIQUES (ellipsoides, feuille mince, rocher bruite) construites
en numpy ; et, si le fichier existe, le GLB REEL de l'orc du proprietaire (un seul chargement, sans materiaux).

ATTENDUS (ecrits avant le code, reperes : y vers le haut, cube de TRELLIS [-0,5 ; 0,5]) :

  1. figure debout + feuille mince 1 x 1 (2 mm, bruit 0,2 mm) sous les pieds
       -> toute la feuille (dessus, dessous, tranche) part, aucune face de la figure ne part ;
          la ligne des pieds est entre le sommet de la feuille et la semelle ; critere « plan_mince ».
  2. idem + rocher irregulier traversant la feuille (une moitie sous, une moitie au-dessus)
       -> tout ce qui est SOUS la ligne des pieds part (feuille + rocher du dessous), rien au-dessus ;
          la figure est intacte ; critere « socle_epais » en plus ; plus de 55 % de l'aire part.
  3. figure sur une PETITE plate-forme voulue, sans feuille -> inchange (rapport vide, masque tout vrai) ;
     la meme plate-forme posee sur une feuille -> la feuille part, la plate-forme reste entiere.
  4. figure assise (sur un banc large, sans feuille) -> inchange : un siege n'est pas une dalle ;
     assise sur la feuille -> la feuille part, la figure reste.
  5. quadrupede : avec feuille elle part, sans feuille -> inchange.
  6. maillage sans feuille -> INCHANGE : meme masque tout vrai, rapport {}, et pour trimesh le MEME objet.
  7. sommets dupliques le long des coutures d'UV (maillage entierement « eclate ») -> meme resultat, face par face.
  8. axe Z (ou X) vers le haut : meme resultat avec axe_haut=2 (ou 0) ; mauvais axe -> inchange.
  9. maillage vide, minuscule, a sommets non finis -> inchange ; indices hors limites -> ValueError.
 10. conserver_socle=True : seules la feuille et sa tranche partent, le rocher reste, la figure aussi ;
     une feuille a UNE face (dessus d'un socle plein) est conservee.
 11. GLB reel de l'orc : plus de 55 % de l'aire part, la figure reste intacte (aucune face retiree au-dessus de
     la ligne des pieds, meme hauteur de corps), duree < 3 s.
 12. FAUX POSITIFS a ecarter : robe evasee dont l'ourlet est un disque horizontal large (rapport ~1) ; grand disque a 49 % de
     la hauteur ; petite feuille voulue (rapport 2,4 < 3) ; champ de 128 petites dalles (aucune n'est une feuille).
 13. socle PLEIN plus epais que la fenetre (dessus + dessous) : tout le socle part (le dessus donne la ligne), il n'est pas
     retire en mode conserver_socle ; feuille de TRELLIS sous un socle plein : les deux partent.
 14. trimesh : UV, couleurs, attributs et NORMALES de sommet explicites suivent les faces gardees (sans quoi trimesh les
     recalcule par sommet et durcit les coutures d'UV) ; le materiau est partage ; l'entree n'est jamais modifiee ; scene :
     une geometrie entierement retiree disparait.
 15. branchement : l'adaptateur cumesh (read / init, indices compacts, ne leve jamais), le crochet de CuMesh.uv_unwrap
     (une seule passe par maillage, inerte hors contexte, etat remis a zero, propre au fil) ; avec de vrais tenseurs torch (CPU)
     quand FABMESH_TEST_TORCH=1 (importe torch : processus lourd).
 16. (2026-10-15) FEUILLE PENCHEE : de 0,1 a 14 degres (en x comme en z) la figure reste entiere, la feuille part entiere, sa tranche
     n'est pas prise pour un socle ; a plat aucune pente retenue ; au-dela de 26 degres (|n_haut| < 0,9) rien ne part ; l'orc reel
     tourne de 0,25 a 12 degres garde son corps a 0,05 % des faces pres.
 17. (2026-10-15) SEUILS que la relecture du 03/10 n'avait pas pris (mutants survivants) : cos_horizontal (un sol dont 75 % des
     facettes penchent de plus de 26 degres n'est pas une feuille), bande_demi (le dessus d'un socle reste entier en mode
     conserver_socle), double_face (le dessous pese au moins 20 % du dessus).
 18. (2026-10-15) ILOTS DETACHES, OPTION `debris_hauteur=0.05` passee EXPLICITEMENT (eteinte par defaut : point 25) : les calottes de rocher
     que la coupe laisse en l'air partent ; une composante secondaire que la coupe n'a pas touchee, plus haute que 5 % de T, plus lourde
     que 5 % de l'aire gardee, ou dont la somme depasse 10 %, reste ; un corps en miettes (aucune composante dominante) ne declenche
     rien ; l'orc reel : 32 ilots, la composante principale intacte.
 19. idempotence (une seconde passe ne change rien), scene dont une geometrie est instanciee deux fois (rendue telle quelle).
 20. (2026-10-18) FILET DU CROCHET : `init` qui echoue en cours de route (le maillage d'origine est reinjecte) ; depliage qui echoue SANS
     la dalle (maillage d'origine restitue, depliage rejoue, rapport annule ; pas de rejeu quand la memoire est epuisee ; restitution
     impossible : l'erreur d'origine remonte) ; une ligne de journal dans tous les cas, y compris « aucune dalle » avec son motif ; l'orc REEL
     avec ses MATERIAUX (variante apres export : positions, UV, normales explicites et texture conservees, GLB WebP plus leger, seconde
     passe sans effet).
 21. (2026-10-18) `retirer_dalle_glb`, la variante APRES export qui ne leve jamais : une ligne de journal dans tous les cas (le motif d'un
     refus, y compris une scene non prise en charge), `actif=False` ne fait rien, un objet qui n'est pas une scene est rendu tel quel.
     Un journal qui leve (flux ferme) ne casse ni le retrait, ni le filet du depliage, ni l'installation du crochet.
 22. (2026-10-18) le banc de l'ATLAS (build/bancs/fidelite/dalle_sol_atlas.py, que le protocole GPU rejouera) : chiffres connus sur deux
     triangles, aller-retour d'un GLB texture, et la variante APRES export qui donne un gain de resolution du corps de x1,00 (les UV ne
     bougent pas) contre l'estimation 1 / racine(part d'aire du corps) pour un retrait AVANT le depliage ; le gain VISIBLE plafonne par la
     grille de voxels (la couleur n'a pas plus de detail que ses voxels : orc a 2048 sur une grille de 1024, x1,19 au plus).
 23. (2026-10-18) creatures PLATES au ras du sol (focus « ailes » de la relecture) : dragon couche aux ailes etalees, raie, papillon a plat ->
     aucun faux positif (leurs grandes surfaces horizontales font PARTIE de la silhouette, rapport < 3).
 24. (2026-10-18) fumee du banc de mesures sur GLB reels (build/bancs/fidelite/dalle_sol_mesures.py : balayage, echelle dans un processus neuf,
     inclinaison, decimation, composantes) sur un GLB synthetique : le banc ne pourrit pas, ses chiffres sont ceux du module.
 25. (2026-10-18, BLOQUANT B1 de la relecture independante de la piste G) les ILOTS DETACHES sont ETEINTS PAR DEFAUT (`debris_hauteur=0`) : la regle
     emportait les pieds qui sont des coques SEPAREES de la jambe (os d'un squelette, bottes sans raccord, patins) parce que la coupe tranche
     leur semelle (« touchee par la coupe ») : « rien au-dessus de la ligne des pieds » etait rompu par defaut sur TOUS les points d'entree. Test 37 :
     deux pieds en coques separees (soudees ou non a la dalle, de 3 a 4,8 % de T) + temoin (l'option les retire, donc la scene est un vrai piege) ;
     test 38 : des coques de formes variees posees sur la dalle ; test 39 : retirer_dalle_sol, retirer_dalle_glb, retirer_dalle_cumesh et le
     crochet du depliage gardent les pieds, et l'option se passe par `**reglages` ; l'orc reel (rien ne part au-dessus de la ligne, l'option retrouve les
     32 ilots) et le squelette REEL de la relecture (variable GLB_SQUELETTE : 11 ilots / 1 042 faces d'os de pied avec l'option, aucun par defaut) ;
     le magicien REEL (variable GLB_MAGICIEN : rapport 2,30 pour un seuil de 3,0, donc refuse ; la dalle la plus faible, le squelette, est a 4,41 :
     les deux GLB bornent la marge du seuil, 1,3 fois seulement cote refus).
"""
import importlib.util
import json
import os
import time
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
CHEMIN = os.environ.get('NOYAU_ACCEL') or os.path.join(RACINE, 'scripts', 'acceleration_glb.py')
GLB_ORC = os.environ.get('GLB_ORC') or os.path.join(RACINE, 'meshes', 'verif_t80_orc_trellis2_native_1791026496124.glb')
# Squelette a cape du corpus d'entrainement (473 044 faces, dalle reconnue) : le cas REEL que la suite synthetique avait manque (bloquant B1
# de la relecture du 18/10 : ses pieds sont des coques separees de la jambe). Hors depot ; absent = tests sautes.
GLB_SQUELETTE = os.environ.get('GLB_SQUELETTE') or 'C:/tmp/training_meshes/humanoid/humanoid_26_seed68.glb'
# Magicien a robe etalee au sol du meme corpus (484 344 faces) : le refus REEL le plus fort de la relecture (rapport 2,30 pour un seuil de 3,0).
GLB_MAGICIEN = os.environ.get('GLB_MAGICIEN') or 'C:/tmp/training_meshes/humanoid/humanoid_13_seed55.glb'


def charger_module(chemin=CHEMIN):
    spec = importlib.util.spec_from_file_location('acceleration_glb_dalle_sous_test', chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ------------------------------------------------------------------------------------------ formes synthetiques
def ellipsoide(centre, rayons, n_lat=16, n_lon=24):
    """Ellipsoide (y vers le haut), normales vers l'exterieur. Rend (V, F)."""
    th = np.linspace(0.0, np.pi, n_lat + 1)[1:-1]
    ph = np.linspace(0.0, 2 * np.pi, n_lon, endpoint=False)
    T, P = np.meshgrid(th, ph, indexing='ij')
    anneaux = np.stack([np.sin(T) * np.cos(P), np.cos(T), np.sin(T) * np.sin(P)], -1).reshape(-1, 3)
    V = np.vstack([[0.0, 1.0, 0.0], anneaux, [0.0, -1.0, 0.0]])
    F = []
    for j in range(n_lon):
        F.append([0, 1 + (j + 1) % n_lon, 1 + j])
    for i in range(n_lat - 2):
        a = 1 + i * n_lon
        b = a + n_lon
        for j in range(n_lon):
            j2 = (j + 1) % n_lon
            F.append([a + j, a + j2, b + j])
            F.append([a + j2, b + j2, b + j])
    bas = len(V) - 1
    d = 1 + (n_lat - 2) * n_lon
    for j in range(n_lon):
        F.append([bas, d + j, d + (j + 1) % n_lon])
    return V * np.asarray(rayons) + np.asarray(centre), np.asarray(F, np.int64)


def cylindre(centre_bas, rayon, hauteur, n=32):
    """Cylindre plein (axe y), dessus et dessous compris."""
    ph = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    bas = np.stack([rayon * np.cos(ph), np.zeros(n), rayon * np.sin(ph)], -1) + np.asarray(centre_bas)
    haut = bas + [0.0, hauteur, 0.0]
    V = np.vstack([bas, haut, np.asarray(centre_bas) + [0, 0, 0], np.asarray(centre_bas) + [0, hauteur, 0]])
    cb, ch = 2 * n, 2 * n + 1
    F = []
    for j in range(n):
        j2 = (j + 1) % n
        F.append([j, j2, n + j])
        F.append([j2, n + j2, n + j])
        F.append([cb, j2, j])
        F.append([ch, n + j, n + j2])
    return V, np.asarray(F, np.int64)


def boite(centre, demi):
    cx, cy, cz = centre
    dx, dy, dz = demi
    V = np.array([[cx + sx * dx, cy + sy * dy, cz + sz * dz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)], float)
    F = np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
                  [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]], np.int64)
    return V, F


def feuille(y, demi=0.5, epaisseur=0.002, n=60, bruit=0.0002, graine=0, double_face=True):
    """Feuille mince carree (dessus normales +y, dessous -y, tranche) : la dalle de sol de TRELLIS. Surface bruitee."""
    rng = np.random.default_rng(graine)
    xs = np.linspace(-demi, demi, n + 1)
    X, Z = np.meshgrid(xs, xs, indexing='ij')
    nb = (n + 1) ** 2
    haut = np.stack([X, y + epaisseur / 2 + bruit * rng.standard_normal(X.shape), Z], -1).reshape(-1, 3)
    bas = np.stack([X, y - epaisseur / 2 + bruit * rng.standard_normal(X.shape), Z], -1).reshape(-1, 3)
    idx = np.arange(nb).reshape(n + 1, n + 1)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
    F_haut = np.vstack([np.stack([a, b, c], 1), np.stack([d, c, b], 1)])
    parts_V = [haut]
    parts_F = [F_haut]
    if double_face:
        parts_V.append(bas)
        parts_F.append(F_haut[:, ::-1] + nb)
        bord = np.concatenate([idx[0, :-1], idx[:-1, -1], idx[-1, :0:-1], idx[:0:-1, 0]])
        suivant = np.roll(bord, -1)
        F_bord = np.vstack([np.stack([bord, suivant, bord + nb], 1), np.stack([suivant, suivant + nb, bord + nb], 1)])
        parts_F.append(F_bord)
    return np.vstack(parts_V), np.vstack(parts_F)


def rocher(centre, rayons, bruit=0.012, graine=3, n_lat=20, n_lon=28):
    """Rocher irregulier : ellipsoide a rayon module par des sinus (deterministe)."""
    V, F = ellipsoide((0, 0, 0), (1, 1, 1), n_lat, n_lon)
    rng = np.random.default_rng(graine)
    k = rng.uniform(2, 7, (6, 3))
    ph = rng.uniform(0, 6.28, 6)
    amp = (np.sin(V @ k.T * 3.0 + ph).sum(1)) / 6.0
    V = V * (1.0 + bruit / max(min(rayons), 1e-9) * amp)[:, None]
    return V * np.asarray(rayons) + np.asarray(centre), F


def fusionner(*parts):
    """Assemble (nom, V, F) en un maillage ; rend V, F et le dict nom -> indices de faces."""
    Vs, Fs, deca, debut, index = [], [], 0, 0, {}
    for nom, V, F in parts:
        Vs.append(V)
        Fs.append(F + deca)
        index[nom] = np.arange(debut, debut + len(F))
        deca += len(V)
        debut += len(F)
    return np.vstack(Vs), np.vstack(Fs), index


def personnage(y_pieds, ecart=0.07, finesse=(16, 24)):
    """Bipede en T : pieds, jambes, bassin, torse, tete, bras horizontaux. Le bas des pieds est a y_pieds.
    `finesse` = (anneaux, meridiens) de chaque ellipsoide (6 484 faces par defaut ; (6, 8) : 720 faces)."""
    nl, nm = finesse
    p = []
    for s in (-1, 1):
        p.append(('pied%d' % s, *ellipsoide((s * ecart, y_pieds + 0.025, 0.03), (0.04, 0.025, 0.07), nl, nm)))
        p.append(('jambe%d' % s, *ellipsoide((s * ecart, y_pieds + 0.21, 0.0), (0.035, 0.18, 0.035), nl, nm)))
        p.append(('bras%d' % s, *ellipsoide((s * 0.24, y_pieds + 0.58, 0.0), (0.16, 0.025, 0.025), nl, nm)))
    p.append(('bassin', *ellipsoide((0, y_pieds + 0.40, 0), (0.10, 0.06, 0.06), nl, nm)))
    p.append(('torse', *ellipsoide((0, y_pieds + 0.55, 0), (0.10, 0.15, 0.065), nl, nm)))
    p.append(('tete', *ellipsoide((0, y_pieds + 0.76, 0), (0.05, 0.065, 0.05), nl, nm)))
    return fusionner(*p)


def quadrupede(y_pieds):
    p = [('corps', *ellipsoide((0, y_pieds + 0.30, 0), (0.30, 0.11, 0.10))),
         ('tete', *ellipsoide((0.36, y_pieds + 0.38, 0), (0.08, 0.07, 0.06))),
         ('queue', *ellipsoide((-0.38, y_pieds + 0.32, 0), (0.09, 0.02, 0.02)))]
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.append(('patte%d%d' % (sx, sz), *ellipsoide((sx * 0.20, y_pieds + 0.14, sz * 0.07), (0.03, 0.14, 0.03))))
    return fusionner(*p)


def assise(y_pieds, siege=0.30):
    """Figure assise (assise a `siege` au-dessus des pieds) : torse droit, cuisses horizontales, mollets verticaux."""
    h = siege
    p = [('torse', *ellipsoide((0, y_pieds + h + 0.26, 0), (0.10, 0.16, 0.065))),
         ('tete', *ellipsoide((0, y_pieds + h + 0.52, 0), (0.05, 0.065, 0.05))),
         ('bassin', *ellipsoide((0, y_pieds + h + 0.08, 0), (0.10, 0.06, 0.07)))]
    for s_ in (-1, 1):
        p.append(('cuisse%d' % s_, *ellipsoide((s_ * 0.06, y_pieds + h + 0.04, 0.14), (0.04, 0.04, 0.17))))
        p.append(('mollet%d' % s_, *ellipsoide((s_ * 0.06, y_pieds + h / 2 + 0.02, 0.30), (0.035, h / 2 + 0.02, 0.035))))
        p.append(('pied%d' % s_, *ellipsoide((s_ * 0.06, y_pieds + 0.025, 0.33), (0.04, 0.025, 0.07))))
    return fusionner(*p)


def tronc_cone(centre_bas, r_bas, r_haut, hauteur, n=48):
    """Jupe / robe evasee pleine : tronc de cone avec dessus et dessous (le dessous est un disque HORIZONTAL)."""
    ph = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    c, s_ = np.cos(ph), np.sin(ph)
    bas = np.stack([r_bas * c, np.zeros(n), r_bas * s_], -1) + np.asarray(centre_bas)
    haut = np.stack([r_haut * c, np.full(n, hauteur), r_haut * s_], -1) + np.asarray(centre_bas)
    V = np.vstack([bas, haut, np.asarray(centre_bas) + [0, 0, 0], np.asarray(centre_bas) + [0, hauteur, 0]])
    cb, ch = 2 * n, 2 * n + 1
    F = []
    for j in range(n):
        j2 = (j + 1) % n
        F.append([j, j2, n + j])
        F.append([j2, n + j2, n + j])
        F.append([cb, j2, j])
        F.append([ch, n + j, n + j2])
    return V, np.asarray(F, np.int64)


def eclater(V, F):
    """Tous les sommets dupliques (un jeu par face), ordre des faces conserve."""
    return V[F].reshape(-1, 3), np.arange(3 * len(F)).reshape(-1, 3)


def centres_y(V, F, axe=1):
    return V[F][:, :, axe].mean(axis=1)


Y_FEUILLE = -0.40          # hauteur de la feuille
PIEDS = Y_FEUILLE + 0.008  # le bas des pieds : juste au-dessus de la feuille (comme le sanglier)
ILOTS = {'debris_hauteur': 0.05}   # l'OPTION des ilots detaches, ETEINTE par defaut depuis le 18/10 (bloquant B1) : a passer EXPLICITEMENT


def scene_figure_sur_feuille(feuille_d_abord=False, **kw):
    """Figure + feuille. `feuille_d_abord=True` met les sommets de la FEUILLE en tete du tableau : les sommets gardes ne forment
    alors plus un prefixe, ce qui est la seule facon de voir une UV, une normale, une couleur ou un attribut mal reindexe
    (un mutant `uv[:n]` au lieu de `uv[utiles]` passait tous les tests tant que la figure venait en premier)."""
    Vp, Fp, ip = personnage(PIEDS)
    Vf, Ff = feuille(Y_FEUILLE, **kw)
    ordre = (('feuille', Vf, Ff), ('figure', Vp, Fp)) if feuille_d_abord else (('figure', Vp, Fp), ('feuille', Vf, Ff))
    V, F, idx = fusionner(*ordre)
    return V, F, idx


def scene_ilots(**fragments):
    """Corps CONNEXE (une seule composante, comme un vrai maillage : le corps de test des autres scenes est fait d'ellipsoides
    disjoints, aucune composante ne domine) sur une feuille, plus des fragments de rocher qui TRAVERSENT la feuille."""
    Vc, Fc = ellipsoide((0, PIEDS + 0.38, 0), (0.12, 0.38, 0.08), 60, 90)
    Vf, Ff = feuille(Y_FEUILLE, n=40)
    parts = [('corps', Vc, Fc), ('feuille', Vf, Ff)]
    for nom, (x, z, rx, ry, rz) in fragments.items():
        Vg, Fg = ellipsoide((x, Y_FEUILLE, z), (rx, ry, rz), 12, 16)
        parts.append((nom, Vg, Fg))
    return fusionner(*parts)


H_FIGURE = 0.76 + 0.065    # hauteur de la figure en T de `personnage` (du bas des pieds au sommet de la tete) ; la dalle ajoute 0,002


def _sans_parties(Vp, Fp, ip, prefixe):
    """Sous-maillages (nom, V, F) des parties de `personnage` dont le nom ne commence PAS par `prefixe`."""
    sortie = []
    for nom, faces in ip.items():
        if nom.startswith(prefixe):
            continue
        utiles, inv = np.unique(Fp[faces].reshape(-1), return_inverse=True)
        sortie.append((nom, Vp[utiles], inv.reshape(-1, 3)))
    return sortie


def _cape(y_dessus):
    """Cape connexe (tronc de cone ferme) qui DOMINE en aire, comme celle du squelette reel : sans composante dominante la regle des
    ilots dort (test 33e), et c'est ce que la suite synthetique d'ellipsoides disjoints ne voyait pas."""
    return ('cape', *tronc_cone((0.0, y_dessus + 0.03, 0.0), 0.30, 0.12, 0.62, n=48))


def scene_pieds_en_coques(hauteur_pied, soude=True, finesse=(16, 24), demi_longueur=0.07):
    """Dalle + figure en T dont les deux PIEDS sont des coques SEPAREES des jambes (os d'un squelette, bottes sans raccord, patins de
    robot) posees sur la dalle, + une cape connexe dominante. `soude=True` : le pole bas de chaque pied est recopie sur un noeud de la
    dalle (sommet commun apres soudure, ce que TRELLIS livre quand un pied touche le sol) ; sinon la coque ne partage aucun sommet avec
    la dalle (la coupe de la semelle suffit a la rendre « touchee »). Rend V, F, idx ('pied-1' et 'pied1' y sont), y du dessus de la dalle."""
    Vf, Ff = feuille(Y_FEUILLE, n=100, bruit=0.0, double_face=True)
    y_dessus = float(Vf[:, 1].max())
    Vp, Fp, ip = personnage(y_dessus, finesse=finesse)
    nl, nm = finesse
    pieds = []
    for s in (-1, 1):
        cx, cz = s * 0.07, 0.03
        k = int(np.argmin(np.abs(Vf[:, 0] - cx) + np.abs(Vf[:, 2] - cz) + 100 * (Vf[:, 1] < y_dessus - 1e-9)))
        noeud = Vf[k]
        Vpied, Fpied = ellipsoide((noeud[0], y_dessus + hauteur_pied / 2, noeud[2]), (0.04, hauteur_pied / 2, demi_longueur), nl, nm)
        if soude:
            Vpied = Vpied.copy()
            Vpied[-1] = noeud            # pole bas recopie sur le noeud de la dalle : meme position a l'octet, donc sommet commun apres soudure
        pieds.append(('pied%d' % s, Vpied, Fpied))
    V, F, idx = fusionner(('feuille', Vf, Ff), *_sans_parties(Vp, Fp, ip, 'pied'), *pieds, _cape(y_dessus))
    return V, F, idx, y_dessus


def scene_coques_posees(graine, nombre=6):
    """Dalle + figure SANS pieds + cape dominante + `nombre` coques SEPAREES de formes variees (ellipsoide, boite, cylindre, rocher bruite)
    posees sur la dalle, le bas de chacune au niveau du dessus de la dalle (donc tranche par la ligne), hautes de 1 a 4,5 % de T, a des
    positions pseudo-aleatoires mais deterministes : pied, botte, patin, sabre couche, baton, caillou. La dalle fait 1,5 x 1,5 (et non
    1 x 1) pour que son rapport avec la silhouette reste franc malgre l'aire que les coques ajoutent. Rend V, F, idx, y du dessus."""
    rng = np.random.default_rng(graine)
    Vf, Ff = feuille(Y_FEUILLE, demi=0.75, n=60, bruit=0.0, double_face=True)
    y_dessus = float(Vf[:, 1].max())
    Vp, Fp, ip = personnage(y_dessus, finesse=(10, 14))
    parts = [('feuille', Vf, Ff), *_sans_parties(Vp, Fp, ip, 'pied'), _cape(y_dessus)]
    for k in range(nombre):
        h = float(rng.uniform(0.01, 0.045)) * H_FIGURE
        x, z = (float(a) for a in rng.uniform(-0.42, 0.42, 2))
        forme = k % 4
        if forme == 0:
            Vc, Fc = ellipsoide((x, y_dessus + h / 2, z), (float(rng.uniform(0.02, 0.045)), h / 2, float(rng.uniform(0.03, 0.07))), 10, 14)
        elif forme == 1:
            Vc, Fc = boite((x, y_dessus + h / 2, z), (float(rng.uniform(0.02, 0.05)), h / 2, float(rng.uniform(0.02, 0.05))))
        elif forme == 2:
            Vc, Fc = cylindre((x, y_dessus, z), float(rng.uniform(0.015, 0.03)), h, n=16)
        else:
            rayons = (float(rng.uniform(0.02, 0.04)), h / 2, float(rng.uniform(0.02, 0.04)))
            Vc, Fc = rocher((x, y_dessus + h / 2, z), rayons, bruit=0.15 * min(rayons), graine=int(rng.integers(1, 99)), n_lat=10, n_lon=14)
        parts.append(('coque%d' % k, Vc, Fc))
    V, F, idx = fusionner(*parts)
    return V, F, idx, y_dessus


def charger_glb_nu(chemin):
    """(sommets, faces) d'un GLB reel, sans materiaux, transformations des noeuds appliquees (repere monde)."""
    import trimesh
    sc = trimesh.load(chemin, force='scene', skip_materials=True, process=False)
    Vs, Fs, deca = [], [], 0
    for nom in sc.graph.nodes_geometry:
        T, g = sc.graph[nom]
        G = sc.geometry[g]
        if not hasattr(G, 'faces') or len(G.faces) == 0:
            continue
        Vs.append(np.asarray(G.vertices, np.float64) @ np.asarray(T)[:3, :3].T + np.asarray(T)[:3, 3])
        Fs.append(np.asarray(G.faces, np.int64) + deca)
        deca += len(G.vertices)
    return np.concatenate(Vs), np.concatenate(Fs)


# ------------------------------------------------------------------------------------------------- les tests
class TestFormesSynthetiques(unittest.TestCase):
    def setUp(self):
        self.acc = charger_module()
        for nom in ('masque_dalle_sol', 'retirer_dalle_sol', 'TYPES_CONCERNES'):
            if not hasattr(self.acc, nom):
                self.fail('%s absent : ancien code (pas de retrait de la dalle de sol)' % nom)

    def test_1_figure_sur_feuille(self):
        V, F, idx = scene_figure_sur_feuille()
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport, 'la feuille n\'a pas ete reconnue')
        self.assertEqual(garder.shape, (len(F),))
        self.assertEqual(garder.dtype, bool)
        self.assertTrue((~garder[idx['feuille']]).all(), 'une face de la feuille (dessus, dessous ou tranche) reste')
        self.assertTrue(garder[idx['figure']].all(), 'une face de la FIGURE a ete retiree')
        self.assertIn('plan_mince', rapport['criteres'])
        self.assertNotIn('socle_epais', rapport['criteres'])
        sommet_feuille = Y_FEUILLE + 0.001 + 0.0008
        ligne = rapport['ligne_pieds']['hauteur']
        self.assertGreater(ligne, sommet_feuille - 0.002)
        self.assertLess(ligne, PIEDS + 0.001, 'la ligne des pieds passe sous les semelles ou presque')
        self.assertEqual(rapport['faces_retirees'], len(idx['feuille']))
        self.assertEqual(rapport['faces_total'], len(F))
        self.assertAlmostEqual(rapport['faces_retirees_pct'], 100.0 * len(idx['feuille']) / len(F), places=6)
        self.assertGreater(rapport['aire_retiree_pct'], 50.0)
        self.assertGreater(rapport['dalle']['ratio_empreinte'], 3.0)
        self.assertTrue(rapport['dalle']['double_face'])
        # l'empreinte du corps est celle de la figure (bras en croix : environ 0,6 de large)
        emp = rapport['empreinte_corps']
        self.assertEqual(emp['axes'], [0, 2])
        self.assertLess(max(emp['etendue']), 0.85)
        self.assertGreater(max(emp['etendue']), 0.5)

    def test_2_figure_feuille_et_rocher(self):
        V0, F0, idx0 = personnage(Y_FEUILLE + 0.045)                  # les pieds reposent sur le rocher
        Vf, Ff = feuille(Y_FEUILLE)
        Vr, Fr = rocher((0, Y_FEUILLE - 0.004, 0), (0.17, 0.05, 0.15))   # une moitie sous la feuille, une au-dessus
        V, F, idx = fusionner(('figure', V0, F0), ('feuille', Vf, Ff), ('rocher', Vr, Fr))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertEqual(rapport['mode'], 'socle_retire')
        self.assertIn('socle_epais', rapport['criteres'])
        ligne = rapport['ligne_pieds']['hauteur']
        cy = centres_y(V, F)
        # rien d'au-dessus de la ligne n'est retire ; rien en dessous n'est garde
        self.assertTrue(garder[cy > ligne].all(), 'une face AU-DESSUS de la ligne des pieds a ete retiree')
        self.assertFalse(garder[cy < ligne].any(), 'une face SOUS la ligne des pieds est restee')
        self.assertTrue(garder[idx['figure']].all(), 'la figure est amputee')
        self.assertTrue((~garder[idx['feuille']]).all())
        # le rocher du dessous part, celui du dessus (au-dessus de la feuille) reste : residu documente
        sous = idx['rocher'][cy[idx['rocher']] < ligne]
        dessus = idx['rocher'][cy[idx['rocher']] >= ligne]
        self.assertGreater(len(sous), 100)
        self.assertGreater(len(dessus), 100)
        self.assertGreater(rapport['aire_retiree_pct'], 55.0)
        self.assertGreater(rapport['socle']['faces'], 100)

    def test_3_petite_plate_forme_voulue(self):
        Vp, Fp, _ = personnage(0.10)
        Vc, Fc = cylindre((0, 0.07, 0), 0.13, 0.03)               # plate-forme sous les pieds, ~25 % de la largeur du corps
        V, F, idx = fusionner(('figure', Vp, Fp), ('plateforme', Vc, Fc))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        # la meme plate-forme POSEE sur une feuille : la feuille part, la plate-forme reste entiere
        Vf, Ff = feuille(Y_FEUILLE)
        Vc2, Fc2 = cylindre((0, Y_FEUILLE + 0.010, 0), 0.13, 0.03)
        Vp2, Fp2, _ = personnage(Y_FEUILLE + 0.010 + 0.03 + 0.004)
        V, F, idx = fusionner(('figure', Vp2, Fp2), ('plateforme', Vc2, Fc2), ('feuille', Vf, Ff))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertTrue(garder[idx['plateforme']].all(), 'la plate-forme voulue a ete entamee')
        self.assertTrue(garder[idx['figure']].all())
        self.assertTrue((~garder[idx['feuille']]).all())

    def test_4_figure_assise(self):
        Va, Fa, ia = assise(0.0, 0.30)
        # assise sur un banc LARGE (0,5 x 0,3), sans feuille : un siege n'est pas une dalle (il est a 32 % de la hauteur :
        # c'est le rapport avec la silhouette, pas la hauteur, qui le refuse)
        Vb, Fb = boite((0, 0.288, 0.12), (0.25, 0.012, 0.15))
        V, F, idx = fusionner(('figure', Va, Fa), ('banc', Vb, Fb))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertEqual(rapport, {}, 'un banc a ete pris pour une dalle de sol')
        self.assertTrue(garder.all())
        diag = {}
        self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        c = diag['candidats'][0]             # le dessus et le dessous du banc sont bien examines, puis refuses par le rapport
        self.assertFalse(c['accepte'])
        self.assertLess(c['ratio_empreinte'], 3.0)
        self.assertGreater(c['ratio_empreinte'], 0.5, 'le banc est large : le rapport doit etre proche de 1, pas nul')
        # assise sur le sol, avec la feuille : seule la feuille part
        Vp, Fp, ip = assise(Y_FEUILLE + 0.008)
        Vf, Ff = feuille(Y_FEUILLE)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertTrue(garder[idx['figure']].all())
        self.assertTrue((~garder[idx['feuille']]).all())

    def test_5_quadrupede(self):
        Vq, Fq, _ = quadrupede(Y_FEUILLE + 0.008)
        Vf, Ff = feuille(Y_FEUILLE)
        V, F, idx = fusionner(('animal', Vq, Fq), ('feuille', Vf, Ff))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertTrue(garder[idx['animal']].all(), 'le quadrupede est entame')
        self.assertTrue((~garder[idx['feuille']]).all())
        garder, rapport = self.acc.masque_dalle_sol(Vq, Fq, 1)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())

    def test_6_sans_feuille_inchange(self):
        Vp, Fp, _ = personnage(-0.30)
        copie_v, copie_f = Vp.copy(), Fp.copy()
        garder, rapport = self.acc.masque_dalle_sol(Vp, Fp, 1)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        self.assertTrue(np.array_equal(Vp, copie_v) and np.array_equal(Fp, copie_f), 'les entrees ont ete modifiees')
        diag = {}
        self.acc.masque_dalle_sol(Vp, Fp, 1, diagnostic=diag)
        self.assertEqual(diag['decision'], 'inchange')
        self.assertIn('bande horizontale', diag['raison'], "refus pour une autre raison que l'absence de bande horizontale")

    def test_6b_trimesh_meme_objet(self):
        import trimesh
        Vp, Fp, _ = personnage(-0.30)
        m = trimesh.Trimesh(Vp, Fp, process=False)
        sortie, rapport = self.acc.retirer_dalle_sol(m, 1)
        self.assertIs(sortie, m)
        self.assertEqual(rapport, {})

    def test_7_coutures_uv(self):
        V, F, idx = scene_figure_sur_feuille()
        ref, rap_ref = self.acc.masque_dalle_sol(V, F, 1)
        # (a) tout eclate : un jeu de sommets par face
        Ve, Fe = eclater(V, F)
        garder, rapport = self.acc.masque_dalle_sol(Ve, Fe, 1)
        self.assertTrue(np.array_equal(garder, ref), 'le maillage eclate ne donne pas le meme masque')
        self.assertEqual(rapport['faces_retirees'], rap_ref['faces_retirees'])
        # (b) coutures partielles : la moitie des faces (au hasard) recoivent leurs propres sommets
        rng = np.random.default_rng(5)
        dup = rng.random(len(F)) < 0.5
        Vd = np.vstack([V, V[F[dup]].reshape(-1, 3)])
        Fd = F.copy()
        Fd[dup] = len(V) + np.arange(3 * int(dup.sum())).reshape(-1, 3)
        garder, rapport = self.acc.masque_dalle_sol(Vd, Fd, 1)
        self.assertTrue(np.array_equal(garder, ref))
        # (c) les composantes sont comptees sur les sommets SOUDES : la feuille eclatee reste UNE feuille par face
        self.assertEqual(rapport['dalle']['composantes'], rap_ref['dalle']['composantes'])

    def test_8_axes(self):
        V, F, idx = scene_figure_sur_feuille()
        ref, rap_ref = self.acc.masque_dalle_sol(V, F, 1)
        for axe, perm in ((2, [0, 2, 1]), (0, [1, 0, 2])):
            Vp = V[:, perm]
            garder, rapport = self.acc.masque_dalle_sol(Vp, F, axe)
            self.assertTrue(np.array_equal(garder, ref), 'axe_haut=%d : masque different' % axe)
            self.assertEqual(rapport['axe_haut'], axe)
            self.assertAlmostEqual(rapport['ligne_pieds']['fraction'], rap_ref['ligne_pieds']['fraction'], places=9)
            self.assertEqual(rapport['empreinte_corps']['axes'], [i for i in range(3) if i != axe])
        # mauvais axe : la feuille est alors un mur vertical, pas une dalle
        garder, rapport = self.acc.masque_dalle_sol(V[:, [0, 2, 1]], F, 1)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())

    def test_9_cas_limites(self):
        acc = self.acc
        garder, rapport = acc.masque_dalle_sol(np.zeros((0, 3)), np.zeros((0, 3), np.int64), 1)
        self.assertEqual((garder.shape, rapport), ((0,), {}))
        garder, rapport = acc.masque_dalle_sol([], [], 1)
        self.assertEqual((garder.shape, rapport), ((0,), {}))
        V, F = boite((0, 0, 0), (0.5, 0.01, 0.5))
        garder, rapport = acc.masque_dalle_sol(V, F, 1)       # 12 faces
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        V, F = ellipsoide((0, 0, 0), (0.2, 0.3, 0.2), 8, 10)    # ~80 faces
        self.assertEqual(acc.masque_dalle_sol(V, F, 1)[1], {})
        V, F, _ = scene_figure_sur_feuille()
        V = V.copy()
        V[10, 1] = np.nan
        diag = {}
        garder, rapport = acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        self.assertIn('non finis', diag['raison'])
        V, F, _ = scene_figure_sur_feuille()
        with self.assertRaises(ValueError):
            acc.masque_dalle_sol(V, F + len(V), 1)
        with self.assertRaises(ValueError):
            acc.masque_dalle_sol(V, F, 3)
        with self.assertRaises(ValueError):
            acc.masque_dalle_sol(V[:, :2], F, 1)
        with self.assertRaises(TypeError):
            acc.masque_dalle_sol(V, F, 1, reglage_inexistant=1)
        # maillage plat (une seule feuille, rien au-dessus) : rien a faire
        Vf, Ff = feuille(0.0)
        garder, rapport = acc.masque_dalle_sol(Vf, Ff, 1)
        self.assertEqual(rapport, {})

    def test_10_conserver_socle(self):
        V0, F0, _ = personnage(Y_FEUILLE + 0.045)
        Vf, Ff = feuille(Y_FEUILLE)
        Vr, Fr = rocher((0, Y_FEUILLE - 0.004, 0), (0.17, 0.05, 0.15))
        V, F, idx = fusionner(('figure', V0, F0), ('feuille', Vf, Ff), ('rocher', Vr, Fr))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True)
        self.assertTrue(rapport)
        self.assertEqual(rapport['mode'], 'dalle_seule')
        self.assertIn('socle_conserve', rapport['criteres'])
        self.assertTrue(garder[idx['figure']].all())
        self.assertTrue(garder[idx['rocher']].all(), 'le socle devait etre CONSERVE')
        self.assertTrue((~garder[idx['feuille']]).all(), 'la feuille et sa tranche doivent partir')
        # une feuille a UNE seule face (dessus d'un socle plein) n'est pas touchee en mode conservation
        Vs, Fs = feuille(Y_FEUILLE, double_face=False)
        Vp, Fp, _ = personnage(Y_FEUILLE + 0.008)
        V, F, idx = fusionner(('figure', Vp, Fp), ('dessus', Vs, Fs))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        # ... mais elle est reconnue et retiree par defaut (avec tout ce qui est dessous)
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertFalse(rapport['dalle']['double_face'])
        self.assertTrue((~garder[idx['dessus']]).all())

    def test_11_feuille_trop_haute_pas_de_socle(self):
        """Feuille a 20 % de la hauteur : ce qui est dessous pourrait etre le corps, seule la feuille part."""
        Vp, Fp, _ = personnage(-0.30)
        Vf, Ff = feuille(-0.30 + 0.17)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport, 'une feuille a 20 % de la hauteur est une dalle (elle deborde 6 fois le corps)')
        self.assertEqual(rapport['mode'], 'dalle_seule')
        self.assertIn('socle_trop_profond', rapport['criteres'])
        self.assertTrue(garder[idx['figure']].all(), 'le corps sous la feuille a ete retire')
        self.assertTrue((~garder[idx['feuille']]).all())
        # a une seule face, la meme feuille trop haute n'est pas touchee : retirer son seul dessus ouvrirait un volume
        Vs, Fs = feuille(-0.30 + 0.17, double_face=False)
        V, F, idx = fusionner(('figure', Vp, Fp), ('dessus', Vs, Fs))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())

    def test_12_reglages_et_determinisme(self):
        V, F, idx = scene_figure_sur_feuille()
        g1, r1 = self.acc.masque_dalle_sol(V, F, 1)
        g2, r2 = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(np.array_equal(g1, g2))
        r1.pop('duree_s'), r2.pop('duree_s')
        self.assertEqual(r1, r2)
        # un rapport d'empreinte exige trop haut -> plus rien n'est retire (le reglage est bien lu)
        g3, r3 = self.acc.masque_dalle_sol(V, F, 1, ratio_min=1e6)
        self.assertEqual(r3, {})
        self.assertTrue(g3.all())
        # le rapport est JSON-isable (pas de types numpy)
        json.dumps(r1)
        diag = {}
        self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        json.dumps(diag)

    def test_13_types_concernes(self):
        acc = self.acc
        self.assertEqual(tuple(acc.TYPES_CONCERNES), ('character', 'creature', 'animal'))
        for t in ('character', 'Creature', ' ANIMAL '):
            self.assertTrue(acc.type_concerne(t), t)
        for t in ('building', 'vehicle', 'weapon', 'prop', 'avion', 'environment', '', None, 'insect'):
            self.assertFalse(acc.type_concerne(t), repr(t))

    def test_17_robe_evasee_sans_dalle(self):
        """Robe ou jupe evasee dont l'ourlet pose au sol est un disque horizontal large : ce n'est pas une dalle (le disque ne
        deborde pas la robe qu'il porte, rapport ~1), donc rien ne part."""
        Vp, Fp, _ = personnage(0.0)
        Vr, Fr = tronc_cone((0, 0.0, 0), 0.26, 0.07, 0.42)
        V, F, idx = fusionner(('figure', Vp, Fp), ('robe', Vr, Fr))
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        self.assertEqual(rapport, {}, 'une robe evasee a ete amputee')
        self.assertTrue(garder.all())
        self.assertTrue(diag['candidats'], "le disque de l'ourlet devait etre examine")
        self.assertLess(diag['candidats'][0]['ratio_empreinte'], 3.0)

    def test_18_socle_plein_epais(self):
        """Socle plein (cylindre de 5 % de la hauteur : plus epais que la fenetre) : la feuille du dessous seule ne suffit pas
        (le socle serait un creux ouvert), c'est le DESSUS qui donne la ligne des pieds ; tout le socle part. Il ne se
        conserve pas en mode conserver_socle (dessus a une seule face)."""
        Vc, Fc = cylindre((0, Y_FEUILLE, 0), 0.45, 0.05, n=64)
        Vp, Fp, _ = personnage(Y_FEUILLE + 0.05 + 0.004)
        V, F, idx = fusionner(('figure', Vp, Fp), ('socle', Vc, Fc))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport, "le socle plein n'a pas ete reconnu")
        self.assertTrue((~garder[idx['socle']]).all(), 'une partie du socle (flanc, dessus ou dessous) est restee')
        self.assertTrue(garder[idx['figure']].all())
        self.assertEqual(rapport['mode'], 'socle_retire')
        self.assertIn('socle_epais', rapport['criteres'])
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())

    def test_19_feuille_et_socle_plein_sous_la_figure(self):
        """Feuille de TRELLIS sous un socle plein : la coupe monte jusqu'au dessus du socle (la feuille, seule, ne deborde pas
        assez le socle qu'elle porte pour etre acceptee, c'est le dessus du socle qui l'est)."""
        Vf, Ff = feuille(Y_FEUILLE)
        Vc, Fc = cylindre((0, Y_FEUILLE + 0.010, 0), 0.45, 0.05, n=64)
        Vp, Fp, _ = personnage(Y_FEUILLE + 0.010 + 0.05 + 0.004)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff), ('socle', Vc, Fc))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertTrue((~garder[idx['feuille']]).all())
        self.assertTrue((~garder[idx['socle']]).all())
        self.assertTrue(garder[idx['figure']].all())

    def test_20_grand_disque_en_hauteur(self):
        """Grand disque horizontal a 49 % de la hauteur (plateau, parasol, soucoupe) : hors du tiers inferieur, ce n'est pas une
        dalle de sol, meme s'il deborde 6 fois le corps qui le surmonte (torse, bras, tete : plus de 10 % des faces)."""
        Vp, Fp, _ = personnage(PIEDS)
        Vd, Fd = feuille(PIEDS + 0.40, demi=0.45)
        V, F, idx = fusionner(('figure', Vp, Fp), ('disque', Vd, Fd))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())

    def test_21_petite_feuille_voulue(self):
        """Une feuille PETITE (0,36 de cote, soit ~2,4 fois la silhouette du corps : sous le seuil de 3) est une base voulue : elle
        reste ; la meme feuille a 0,70 de cote (rapport ~9) est une dalle."""
        Vp, Fp, _ = personnage(PIEDS)
        Vf, Ff = feuille(Y_FEUILLE, demi=0.18, n=30)
        V, F, idx = fusionner(('figure', Vp, Fp), ('base', Vf, Ff))
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        self.assertTrue(0.5 < diag['candidats'][0]['ratio_empreinte'] < 3.0, diag['candidats'][0]['ratio_empreinte'])
        Vf, Ff = feuille(Y_FEUILLE, demi=0.35, n=30)
        V, F, idx = fusionner(('figure', Vp, Fp), ('base', Vf, Ff))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertTrue((~garder[idx['base']]).all())

    def test_22_champ_de_pas_japonais(self):
        """128 petites dalles plates (pas japonais, galets plats) autour des pieds : ensemble, plus de 3 fois la silhouette du corps,
        mais aucune n'est une feuille : chacune pese 0,2 % de l'aire. Rien ne part."""
        parts = []
        k = 0
        for i in range(12):
            for j in range(12):
                x, z = (i - 5.5) * 0.07, (j - 5.5) * 0.07
                if abs(x) < 0.14 and abs(z) < 0.14:
                    continue
                Vc, Fc = cylindre((x, Y_FEUILLE, z), 0.04, 0.012, n=16)
                parts.append(('pierre%d' % k, Vc, Fc))
                k += 1
        Vp, Fp, _ = personnage(Y_FEUILLE + 0.012 + 0.004)
        V, F, idx = fusionner(('figure', Vp, Fp), *parts)
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        self.assertEqual(rapport, {}, 'un champ de petites dalles a ete pris pour une dalle de sol')
        self.assertTrue(garder.all())
        self.assertIn('composante', diag['candidats'][0]['raison'])

    def test_23_garde_fous_du_retrait_excessif(self):
        """Figure TRES peu maillee (720 faces) sur une feuille tres maillee. A 4,6 % des faces au-dessus de la coupe, le critere « au
        moins 10 % des faces au-dessus » refuse (il n'y a presque pas de corps). Sans lui, a 2,7 % le garde-fou « jamais moins de 3 %
        des faces gardees » refuse a son tour. Sans les deux, le retrait a lieu : les deux reglages sont bien lus."""
        Vp, Fp, _ = personnage(PIEDS, finesse=(6, 8))
        self.assertEqual(len(Fp), 720)
        Vf, Ff = feuille(Y_FEUILLE, n=60)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff))
        self.assertAlmostEqual(len(idx['figure']) / len(F), 0.046, places=3)
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        self.assertIn('presque rien au-dessus', diag['raison'])
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, dessus_min=0.0)
        self.assertTrue(rapport, 'dessus_min=0 devait laisser passer une figure a 4,6 % des faces')
        self.assertTrue((~garder[idx['feuille']]).all())
        self.assertTrue(garder[idx['figure']].all())
        Vf, Ff = feuille(Y_FEUILLE, n=80)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff))
        self.assertAlmostEqual(len(idx['figure']) / len(F), 0.027, places=3)
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, dessus_min=0.0, diagnostic=diag)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())
        self.assertIn('retrait excessif', diag['raison'])
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, dessus_min=0.0, conserve_min=0.0)
        self.assertTrue(rapport, 'conserve_min=0 devait laisser passer le retrait de 97 % des faces')
        self.assertAlmostEqual(rapport['faces_retirees_pct'], 100.0 * len(idx['feuille']) / len(F), places=6)

    def test_24_deux_dalles_acceptees_la_plus_haute_donne_la_ligne(self):
        """Feuille de TRELLIS (+/- 0,5) ET grand socle cylindrique (rayon 0,30, environ 4 fois la figure) pose dessus : les DEUX
        debordent assez la figure (rapports 4,3 et 4,7). La ligne des pieds est celle du DESSUS du socle, la plus haute dans la
        limite des 15 % : feuille et socle partent, la figure reste. En mode conserver_socle seule la feuille part, le socle reste."""
        Vf, Ff = feuille(Y_FEUILLE)
        Vc, Fc = cylindre((0, Y_FEUILLE + 0.0012, 0), 0.30, 0.03, n=64)
        Vp, Fp, _ = personnage(Y_FEUILLE + 0.0012 + 0.03 + 0.004)
        V, F, idx = fusionner(('feuille', Vf, Ff), ('socle', Vc, Fc), ('figure', Vp, Fp))
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        self.assertEqual(sum(1 for c in diag['candidats'] if c['accepte']), 2, diag['candidats'])
        self.assertTrue(rapport)
        self.assertEqual(rapport['mode'], 'socle_retire')
        self.assertTrue((~garder[idx['feuille']]).all())
        self.assertTrue((~garder[idx['socle']]).all(), 'le socle sur lequel la figure se tient devait partir avec la feuille')
        self.assertTrue(garder[idx['figure']].all())
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True)
        self.assertEqual(rapport['mode'], 'dalle_seule')
        self.assertTrue((~garder[idx['feuille']]).all())
        self.assertGreaterEqual(int(garder[idx['socle']].sum()), 3 * len(idx['socle']) // 4, 'le flanc et le dessus du socle devaient rester')
        self.assertTrue(garder[idx['figure']].all())

    def test_25_composante_horizontale_parasite_pas_dans_la_dalle(self):
        """Un disque plat flottant dans la bande de la feuille (6 mm au-dessus d'elle) pese 2,8 % de l'aire : plus de 1 %, donc
        « grand » en absolu, mais moins de 20 % de la plus grosse composante (la feuille). Il n'est PAS la dalle : il ne compte pas
        dans ses faces et, en mode conserver_socle, il n'est pas retire avec elle (un dessus de rocher a ce niveau serait perdu)."""
        Vf, Ff = feuille(Y_FEUILLE)
        Vd, Fd = feuille(Y_FEUILLE + 0.006, demi=0.14, n=20, double_face=False)
        Vp, Fp, _ = personnage(PIEDS + 0.02)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff), ('disque', Vd, Fd))
        P = V[F]
        cr = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        horiz = np.abs(cr[:, 1]) / np.linalg.norm(cr, axis=1) >= 0.9
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True, diagnostic=diag)
        self.assertTrue(rapport)
        self.assertEqual(diag['candidats'][0]['faces'], int(horiz[idx['feuille']].sum()), 'le disque parasite est compte dans la dalle')
        self.assertTrue(garder[idx['disque']].all(), 'le disque parasite a ete retire avec la feuille')
        self.assertTrue((~garder[idx['feuille']]).all())
        self.assertTrue(garder[idx['figure']].all())

    def test_26_dtypes_de_fichier(self):
        """Les tableaux d'un GLB (positions float32, indices uint32) ou de CuMesh (float32, int32) donnent le meme masque et le meme
        rapport que float64 / int64."""
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)
        ref, rap = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rap)
        for dv, df in ((np.float32, np.uint32), (np.float32, np.int32), (np.float64, np.uint32), (np.float32, np.int64)):
            garder, rapport = self.acc.masque_dalle_sol(V.astype(dv), F.astype(df), 1)
            self.assertTrue(np.array_equal(garder, ref), '%s / %s : masque different' % (dv.__name__, df.__name__))
            self.assertEqual(rapport['faces_retirees'], rap['faces_retirees'])
            self.assertAlmostEqual(rapport['aire_retiree_pct'], rap['aire_retiree_pct'], places=3)

    def test_27_soupes_aleatoires_sans_exception(self):
        """Soupes de triangles aleatoires (indices repetes, faces degenerees, sommets coplanaires, echelles de 1e-6 a 1e6, les trois
        axes) : jamais d'exception, masque booleen de la bonne taille, rapport JSON-isable. (Une soupe peut contenir un plan par
        hasard : on ne dit rien de la decision, seulement qu'elle est propre.)"""
        rng = np.random.default_rng(123)
        for k in range(36):
            nv, nf = int(rng.integers(4, 3000)), int(rng.integers(1, 6000))
            echelle = 10.0 ** int(rng.integers(-6, 7))
            V = rng.standard_normal((nv, 3)) * echelle + rng.standard_normal(3) * 5 * echelle
            if k % 3 == 0:
                V[:, 1] = np.round(V[:, 1], 1 if echelle >= 1 else 6)
            F = rng.integers(0, nv, (nf, 3))
            if k % 4 == 0:
                F[:, 1] = F[:, 0]
            axe = k % 3
            garder, rapport = self.acc.masque_dalle_sol(V, F, axe)
            self.assertEqual((garder.dtype, garder.shape), (np.dtype(bool), (nf,)), 'soupe %d' % k)
            json.dumps(rapport)
            if rapport:
                self.assertEqual(int((~garder).sum()), rapport['faces_retirees'], 'soupe %d' % k)
        # tous les sommets au meme point, une seule face repetee : rien a faire
        V = np.zeros((3, 3))
        garder, rapport = self.acc.masque_dalle_sol(V, np.tile([0, 1, 2], (500, 1)), 1)
        self.assertEqual((rapport, bool(garder.all())), ({}, True))

    def test_14_performance_500k(self):
        """Plus de 500 000 faces : moins de 3 s (mesure a ~0,4 s)."""
        V, F, idx = scene_figure_sur_feuille(n=300)       # feuille de 2 x 300 x 300 x 2 faces + rebord
        # on ajoute de petits ellipsoides pour atteindre 500 K faces au total
        while len(F) < 500_000:
            Vg, Fg = ellipsoide((0.3, 0.0, 0.3), (0.02, 0.02, 0.02), 40, 60)
            V, F = np.vstack([V, Vg]), np.vstack([F, Fg + len(V)])
        t0 = time.time()
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        dt = time.time() - t0
        print('\n   %d faces : %.2f s' % (len(F), dt))
        self.assertTrue(rapport)
        self.assertLess(dt, 3.0)

    def test_15_numpy_pur_sans_scipy(self):
        """Le repli numpy des composantes connexes donne les memes composantes que scipy."""
        acc = self.acc
        try:
            from scipy.sparse import coo_matrix
            from scipy.sparse.csgraph import connected_components
        except ImportError:
            self.skipTest('scipy absent')
        rng = np.random.default_rng(2)
        n = 400
        a = rng.integers(0, n, 300)
        b = rng.integers(0, n, 300)
        lab = acc._etiquettes_numpy(a, b, n)
        _, ref = connected_components(coo_matrix((np.ones(len(a), np.int8), (a, b)), shape=(n, n)), directed=False)
        # memes partitions : deux noeuds sont ensemble pour l'un ssi ils le sont pour l'autre
        paires_np = lab[:, None] == lab[None, :]
        paires_sp = ref[:, None] == ref[None, :]
        self.assertTrue(np.array_equal(paires_np, paires_sp))
        # chaine longue : pire cas de la propagation
        chaine = np.arange(5000)
        lab = acc._etiquettes_numpy(chaine[:-1], chaine[1:], 5000)
        self.assertEqual(len(np.unique(lab)), 1)

    def test_16_silhouette(self):
        """L'aire de silhouette est celle de la forme REMPLIE (un anneau creux compte plein) : sinon le rapport est faux."""
        acc = self.acc
        rng = np.random.default_rng(0)
        r = 0.1 * np.sqrt(rng.random(100000))
        t = 2 * np.pi * rng.random(100000)
        disque = acc._aire_silhouette(r * np.cos(t), r * np.sin(t))
        self.assertAlmostEqual(disque / (np.pi * 0.01), 1.0, delta=0.08)
        r = 0.1 + 0.001 * rng.random(100000)
        anneau = acc._aire_silhouette(r * np.cos(t), r * np.sin(t))
        self.assertAlmostEqual(anneau / (np.pi * 0.01), 1.0, delta=0.12)
        rect = acc._aire_silhouette(rng.random(200000) * 0.5, rng.random(200000) * 0.13)
        self.assertAlmostEqual(rect / 0.065, 1.0, delta=0.08)
        self.assertEqual(acc._aire_silhouette(np.zeros(0), np.zeros(0)), 0.0)

    def test_16b_silhouette_numpy_pur_identique_a_cv2(self):
        """Sans cv2 (repli numpy) la silhouette est la meme, au carre de case pres : formes pleines, creuses, deux composantes, bruit."""
        acc = self.acc
        try:
            import cv2  # noqa: F401
        except ImportError:
            self.skipTest('cv2 absent')
        rng = np.random.default_rng(11)
        r = 0.1 * np.sqrt(rng.random(60000))
        t = 2 * np.pi * rng.random(60000)
        formes = [
            (r * np.cos(t), r * np.sin(t)),                                               # disque plein
            ((0.1 + 0.002 * rng.random(60000)) * np.cos(t), (0.1 + 0.002 * rng.random(60000)) * np.sin(t)),   # anneau creux
            (rng.random(40000) * 0.5, rng.random(40000) * 0.13),                          # rectangle
            (np.concatenate([rng.random(20000) * 0.2, 0.8 + rng.random(20000) * 0.2]), rng.random(40000) * 0.2),  # deux blocs
            (rng.random(3000), rng.random(3000)),                                         # nuage clairseme
            (np.concatenate([r * np.cos(t), 0.5 + 0.05 * rng.random(100)]), np.concatenate([r * np.sin(t), 0.5 + 0.05 * rng.random(100)])),
        ]
        for i, (x, y) in enumerate(formes):
            a = acc._aire_silhouette(x, y, 'cv2')
            b = acc._aire_silhouette(x, y, 'numpy')
            self.assertEqual(a, b, 'forme %d : cv2 %.6f, numpy %.6f' % (i, a, b))

    def test_16c_chaine_complete_sans_scipy_ni_cv2(self):
        """Le retrait complet (composantes connexes + silhouette) donne le MEME masque quand scipy et cv2 sont indisponibles."""
        import builtins
        V, F, idx = scene_figure_sur_feuille()
        ref, rap_ref = self.acc.masque_dalle_sol(V, F, 1)
        reel = builtins.__import__

        def sans(nom, *a, **k):
            if nom.split('.')[0] in ('scipy', 'cv2'):
                raise ImportError('absent pour le test : ' + nom)
            return reel(nom, *a, **k)
        builtins.__import__ = sans
        try:
            garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        finally:
            builtins.__import__ = reel
        self.assertTrue(np.array_equal(garder, ref))
        self.assertEqual(rapport['faces_retirees'], rap_ref['faces_retirees'])
        self.assertAlmostEqual(rapport['dalle']['ratio_empreinte'], rap_ref['dalle']['ratio_empreinte'], places=9)

    # ------------------------------------------------------------------------------------ 2026-10-15 : inclinaison
    def test_28_feuille_inclinee(self):
        """Constat de la relecture du 03/10 : l'orc tourne de 1 degre perdait 3 % de son corps (la coupe horizontale passait au-dessus
        du bord HAUT de la feuille, donc dans les semelles), et a 3 degres rien n'etait plus retire. La coupe suit maintenant le PLAN
        de la feuille : la figure reste entiere et la feuille part entiere, de 0,1 a 14 degres, penchee en x comme en z."""
        V, F, idx = scene_figure_sur_feuille()
        for axe in ((0, 1), (2, 1)):                       # rotation autour de Z (penche en x), puis autour de X (penche en z)
            for deg in (0.1, 0.5, 1.0, 3.0, 6.0, 10.0, 14.0):
                Vr = V @ _rotation(axe, deg).T
                garder, rapport = self.acc.masque_dalle_sol(Vr, F, 1)
                etiquette = 'axe %s, %.1f degres' % (axe, deg)
                self.assertTrue(rapport, 'feuille inclinee non reconnue : ' + etiquette)
                self.assertTrue(garder[idx['figure']].all(), 'la figure est entamee : ' + etiquette)
                self.assertTrue((~garder[idx['feuille']]).all(), 'une partie de la feuille reste : ' + etiquette)
                # la tranche de la feuille penchee est reconnue comme rebord (sinon elle passerait pour un socle epais)
                self.assertNotIn('socle_epais', rapport['criteres'], 'la tranche de la feuille penchee prise pour un socle : ' + etiquette)
                self.assertAlmostEqual(rapport['dalle']['inclinaison_deg'], deg, delta=0.02 * deg + 0.01, msg=etiquette)

    def test_28b_feuille_a_plat_pas_de_plan(self):
        """Une feuille a plat (bruit de surface compris) garde la coupe horizontale d'avant, a l'octet : aucune pente retenue."""
        V, F, idx = scene_figure_sur_feuille()
        diag = {}
        self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag)
        c = diag['candidats'][0]
        self.assertEqual(c['pente'], [0.0, 0.0])
        self.assertEqual(c['inclinaison_deg'], 0.0)
        # au-dela de 26 degrees (|n_haut| < 0,9) ce n'est plus une feuille horizontale : rien ne part
        garder, rapport = self.acc.masque_dalle_sol(V @ _rotation((0, 1), 30.0).T, F, 1)
        self.assertEqual(rapport, {})
        self.assertTrue(garder.all())

    # -------------------------------------------------------------------------------- seuils que la relecture n'avait pas pris
    def test_29_facettes_penchees_ne_sont_pas_horizontales(self):
        """cos_horizontal = 0,9 (26 degres) : un sol dont les facettes penchent presque toutes de plus de 26 degres (bruit de 8 mm sur
        une maille de 17 mm) n'est PAS reconnu (conservateur : le sol de TRELLIS est lisse) ; un sol a 0,4 % de bruit l'est. Relecture
        du 03/10 : le mutant cos_horizontal 0,9 -> 0,5 survivait a tous les tests."""
        Vp, Fp, _ = personnage(PIEDS)
        Vf, Ff = feuille(Y_FEUILLE, n=60, bruit=0.008, graine=1)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff))
        P = V[F]
        cr = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        part = float((np.abs(cr[:, 1]) / np.linalg.norm(cr, axis=1) >= 0.9)[idx['feuille']].mean())
        self.assertLess(part, 0.35, 'le banc de test est mal regle : trop de facettes encore horizontales')
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertEqual(rapport, {}, 'un sol dont les facettes sont penchees a ete pris pour une feuille horizontale')
        self.assertTrue(garder.all())
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, cos_horizontal=0.5)      # le reglage est lu
        self.assertTrue(rapport)
        Vf, Ff = feuille(Y_FEUILLE, n=60, bruit=0.004, graine=1)
        V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport, 'un sol legerement bruite (64 % de facettes horizontales) n\'est plus reconnu')
        self.assertTrue(garder[idx['figure']].all())
        self.assertLess(float(garder[idx['feuille']].mean()), 0.005)     # quelques pointes de bruit au-dessus du 99e centile restent

    def test_30_largeur_de_la_bande_de_la_dalle(self):
        """bande_demi = 1 % de T : le DESSUS d'un socle pose sur la feuille (3,4 % de T plus haut) n'est pas dans la dalle ; en mode
        conserver_socle il reste ENTIER (dessus compris). Relecture du 03/10 : le mutant bande_demi 1 % -> 4 % survivait, car le test 24
        n'exigeait que 3/4 des faces du socle (le dessus pese justement 1/4)."""
        Vf, Ff = feuille(Y_FEUILLE)
        Vc, Fc = cylindre((0, Y_FEUILLE + 0.0012, 0), 0.30, 0.03, n=64)
        Vp, Fp, _ = personnage(Y_FEUILLE + 0.0012 + 0.03 + 0.004)
        V, F, idx = fusionner(('feuille', Vf, Ff), ('socle', Vc, Fc), ('figure', Vp, Fp))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True)
        self.assertEqual(rapport['mode'], 'dalle_seule')
        socle = idx['socle']
        haut = (V[F[socle]][:, :, 1] > Y_FEUILLE + 0.02).all(axis=1)           # les faces du dessus du socle
        self.assertEqual(int(haut.sum()), 64)
        self.assertTrue(garder[socle[haut]].all(), 'le dessus du socle a ete retire avec la feuille')
        flanc = (V[F[socle]][:, :, 1].max(axis=1) > Y_FEUILLE + 0.02) & ~haut
        self.assertTrue(garder[socle[flanc]].all(), 'le flanc du socle a ete retire avec la feuille')
        # un reglage plus large l'attraperait : le reglage est lu
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True, bande_demi=0.04)
        self.assertFalse(garder[socle[haut]].all())

    def test_31_dalle_a_deux_faces_et_proportion(self):
        """double_face : le dessous pese au moins 20 % du dessus. Un dessous de 49 % du dessus (feuille dont le dessous est a moitie
        mange) est une dalle a deux faces (conserver_socle la retire) ; un dessous de 4 % ne l'est pas (c'est le dessus d'un socle,
        conserver_socle n'y touche pas). Relecture du 03/10 : le mutant 20 % -> 90 % survivait."""
        Vp, Fp, _ = personnage(PIEDS)
        Vh, Fh = feuille(Y_FEUILLE + 0.001, double_face=False)
        for demi, attendu in ((0.35, True), (0.10, False)):
            Vb, Fb = feuille(Y_FEUILLE - 0.001, demi=demi, n=max(6, int(60 * demi / 0.5)), double_face=False, bruit=0.0)
            Fb = Fb[:, ::-1]                                                   # le dessous regarde vers le bas
            V, F, idx = fusionner(('figure', Vp, Fp), ('dessus', Vh, Fh), ('dessous', Vb, Fb))
            diag = {}
            garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True, diagnostic=diag)
            self.assertEqual(bool(rapport), attendu, 'dessous de %.0f %% du dessus' % (100 * (2 * demi) ** 2))
            if attendu:
                self.assertTrue(rapport['dalle']['double_face'])
                self.assertTrue((~garder[idx['dessus']]).all())
                self.assertTrue((~garder[idx['dessous']]).all())
            self.assertTrue(garder[idx['figure']].all())

    # ---------------------------------------------------------------------------------------------- ilots detaches
    def _scene_ilots(self, **fragments):
        return scene_ilots(**fragments)

    def test_32_ilots_de_rocher_retires(self):
        """OPTION `debris_hauteur=0.05` (ETEINTE par defaut, bloquant B1 du 18/10) : morceaux de rocher qui traversaient la feuille, dont
        la coupe laisse la calotte, disjointe du corps, EN L'AIR au bord de la coupe (l'orc : 32 plaques, 1,9 % de l'aire). Avec l'option
        elles partent avec le socle ; le corps reste entier. PAR DEFAUT (option eteinte) la calotte reste."""
        frag = {'f%d' % k: (x, z, 0.03, 0.015, 0.03) for k, (x, z) in enumerate(((0.3, 0.3), (-0.3, 0.25), (0.35, -0.3), (-0.25, -0.35), (0.0, 0.4)))}
        V, F, idx = self._scene_ilots(**frag)
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, diagnostic=diag, **ILOTS)
        self.assertTrue(rapport)
        self.assertIn('ilots_detaches', rapport['criteres'])
        self.assertTrue(garder[idx['corps']].all(), 'le corps est entame')
        self.assertTrue((~garder[idx['feuille']]).all())
        for nom in frag:
            self.assertFalse(garder[idx[nom]].any(), 'la calotte de %s flotte encore au-dessus du sol retire' % nom)
        self.assertEqual(rapport['ilots']['faces'], int(sum((V[F[idx[nom]]][:, :, 1].mean(axis=1) > rapport['ligne_pieds']['hauteur']).sum() for nom in frag)))
        self.assertGreater(rapport['ilots']['faces'], 100)
        self.assertLess(rapport['ilots']['aire_pct'], 5.0)
        json.dumps(rapport)
        # conserver_socle : le rocher reste PAR CHOIX, ses calottes aussi, meme avec l'option (les ilots ne sont retires qu'avec le socle)
        gcs, rcs = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True, **ILOTS)
        self.assertEqual(rcs['mode'], 'dalle_seule')
        self.assertNotIn('ilots_detaches', rcs['criteres'])
        self.assertNotIn('ilots', rcs)
        for nom in frag:
            self.assertGreater(int(gcs[idx[nom]].sum()), 0.9 * len(idx[nom]), 'le rocher a ete retire en mode conserver_socle')
        # PAR DEFAUT (option eteinte) : la calotte au-dessus de la ligne reste
        garder0, rapport0 = self.acc.masque_dalle_sol(V, F, 1)
        self.assertNotIn('ilots_detaches', rapport0['criteres'])
        self.assertNotIn('ilots', rapport0)
        cy = centres_y(V, F)
        calottes = np.concatenate([idx[nom][cy[idx[nom]] > rapport0['ligne_pieds']['hauteur']] for nom in frag])
        self.assertGreater(len(calottes), 100)
        self.assertTrue(garder0[calottes].all())

    def test_33_ce_qui_n_est_pas_un_ilot_reste(self):
        """Une composante secondaire reste si (a) la coupe ne l'a pas touchee (un objet voulu qui flotte, un bijou), (b) elle monte
        a plus de 5 % de T au-dessus de la ligne (un pieu, une lance plantee), (c) elle pese plus de 5 % de l'aire gardee (un gros
        rocher), (d) leur somme depasse 10 % de l'aire gardee, ou (e) le corps est en miettes (aucune composante ne domine)."""
        # (a) un ellipsoide qui flotte a 1 % de T au-dessus de la feuille (son sommet reste sous les 5 % de T d'un ilot), sans la toucher
        Vc, Fc = ellipsoide((0, PIEDS + 0.38, 0), (0.12, 0.38, 0.08), 60, 90)
        Vf, Ff = feuille(Y_FEUILLE, n=40)
        Vb, Fb = ellipsoide((0.3, Y_FEUILLE + 0.015, 0.3), (0.03, 0.008, 0.03), 12, 16)
        V, F, idx = fusionner(('corps', Vc, Fc), ('feuille', Vf, Ff), ('bijou', Vb, Fb))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertTrue(rapport)
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        self.assertTrue(garder[idx['bijou']].all(), 'un objet que la coupe n\'a pas touche a ete retire')
        # (b) un pieu de 0,20 (24 % de T) planté dans le sol : sa partie haute monte bien au-dela de 5 % de T
        Vp, Fp = cylindre((0.3, Y_FEUILLE - 0.05, 0.3), 0.012, 0.25, n=24)       # 3 % de l'aire gardee : seule la hauteur le garde
        V, F, idx = fusionner(('corps', Vc, Fc), ('feuille', Vf, Ff), ('pieu', Vp, Fp))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertTrue(rapport)
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        cy = centres_y(V, F)
        haut_pieu = idx['pieu'][cy[idx['pieu']] > rapport['ligne_pieds']['hauteur']]
        self.assertGreater(len(haut_pieu), 20)
        self.assertTrue(garder[haut_pieu].all(), 'un pieu plus haut que 5 % de T a ete retire')
        # (c) un gros rocher bas (rayon 0,08) : sa calotte pese 6,4 % de l'aire gardee, plus que les 5 % d'un ilot, moins que les
        # 10 % de la somme : SEUL le plafond par composante le garde
        Vr, Fr = ellipsoide((0.32, Y_FEUILLE, 0.32), (0.08, 0.03, 0.08), 20, 28)
        V, F, idx = fusionner(('corps', Vc, Fc), ('feuille', Vf, Ff), ('rocher', Vr, Fr))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertTrue(rapport)
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        cy = centres_y(V, F)
        calotte = idx['rocher'][cy[idx['rocher']] > rapport['ligne_pieds']['hauteur']]
        self.assertGreater(len(calotte), 100)
        self.assertTrue(garder[calotte].all(), 'un gros rocher a ete retire comme un debris')
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, debris_aire_max=0.10, **ILOTS)                     # reglage lu : 10 % le laisse passer
        self.assertIn('ilots_detaches', rapport['criteres'])
        # (d) quatre calottes de 1,4 % chacune (somme 5,4 %) : chacune passe, leur somme aussi ; a 1 % de somme maximale tout reste
        pos = ((0.3, 0.3), (-0.3, 0.25), (0.35, -0.3), (-0.25, -0.35))
        V, F, idx = self._scene_ilots(**{'f%d' % k: (x, z, 0.04, 0.015, 0.04) for k, (x, z) in enumerate(pos)})
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertIn('ilots_detaches', rapport['criteres'], rapport.get('ilots'))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, debris_total_max=0.01, **ILOTS)
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        cy = centres_y(V, F)
        self.assertTrue(garder[cy > rapport['ligne_pieds']['hauteur']].all())
        # (d') quatre calottes de 2,7 % chacune (somme 10,8 %) : chacune passe, mais leur somme depasse 10 % de l'aire gardee : rien ne part
        V, F, idx = self._scene_ilots(**{'f%d' % k: (x, z, 0.06, 0.015, 0.06) for k, (x, z) in enumerate(pos)})
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertTrue(rapport)
        self.assertNotIn('ilots_detaches', rapport['criteres'], 'la somme des ilots depasse 10 % de l\'aire gardee : rien ne devait partir')
        cy = centres_y(V, F)
        self.assertTrue(garder[cy > rapport['ligne_pieds']['hauteur']].all())
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, debris_total_max=0.15, **ILOTS)                    # reglage lu
        self.assertIn('ilots_detaches', rapport['criteres'])
        # (f) la composante PRINCIPALE (la plus lourde en aire) n'est jamais prise pour un ilot, meme avec des plafonds permissifs.
        # Appel direct de l'aide : un grand rocher bas a cheval sur la ligne, plus lourd que le corps mince qui s'eleve a cote, touche
        # la coupe et reste sous 5 % de T ; sans la garde il partirait comme un ilot (dans une scene complete, un tel rocher serait
        # lui-meme pris pour un socle, d'ou l'appel direct).
        acc = self.acc
        Vt, Ft = ellipsoide((-0.3, PIEDS + 0.38, -0.3), (0.05, 0.38, 0.04), 24, 36)
        Vr2, Fr2 = ellipsoide((0.1, Y_FEUILLE, 0.1), (0.25, 0.03, 0.25), 40, 60)
        V, F, idx = fusionner(('corps', Vt, Ft), ('rocher', Vr2, Fr2))
        centres, _, aires = acc._geometrie_faces(V, F, 1)
        T = float(V[:, 1].max() - V[:, 1].min())
        h = centres[:, 1] - float(V[:, 1].min())
        coupe = (Y_FEUILLE + 0.004) - float(V[:, 1].min())
        retire = h < coupe
        etendue = float((V.max(axis=0) - V.min(axis=0)).max())
        permissif = dict(acc.REGLAGES_DALLE, debris_aire_max=1.0, debris_total_max=1.0, **ILOTS)
        self.assertGreater(float(aires[idx['rocher']][~retire[idx['rocher']]].sum()), float(aires[idx['corps']].sum()), 'le rocher doit etre le plus lourd')
        self.assertIsNone(acc._ilots_detaches(V, F, retire, h, coupe, T, aires, etendue, permissif), 'la composante principale a ete prise pour un ilot')
        # et la meme scene avec un rocher PLUS LEGER que le corps : c'est lui l'ilot
        Vr3, Fr3 = ellipsoide((0.1, Y_FEUILLE, 0.1), (0.05, 0.03, 0.05), 20, 28)
        V, F, idx = fusionner(('corps', Vt, Ft), ('rocher', Vr3, Fr3))
        centres, _, aires = acc._geometrie_faces(V, F, 1)
        h = centres[:, 1] - float(V[:, 1].min())
        retire = h < coupe
        masque = acc._ilots_detaches(V, F, retire, h, coupe, T, aires, etendue, permissif)
        self.assertIsNotNone(masque)
        self.assertTrue(masque[idx['rocher']][~retire[idx['rocher']]].all())
        self.assertFalse(masque[idx['corps']].any())
        # (e) le corps de test des autres scenes est fait d'ellipsoides disjoints (aucune composante ne domine) : rien n'est decide
        V, F, idx = scene_figure_sur_feuille()
        Vg, Fg = ellipsoide((0.3, Y_FEUILLE, 0.3), (0.03, 0.015, 0.03), 12, 16)
        V, F = np.vstack([V, Vg]), np.vstack([F, Fg + len(V)])
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertTrue(rapport)
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        self.assertTrue(garder[len(F) - len(Fg):][centres_y(V, F)[len(F) - len(Fg):] > rapport['ligne_pieds']['hauteur']].all())

    def test_33b_colonne_soudee_a_la_feuille(self):
        """Une colonne SOUDEE a la feuille (ses sommets du bas sont ceux de la feuille, comme un rocher venu d'un seul tenant avec
        le sol dans une vraie surface) : apres la coupe elle flotte, c'est un ilot et elle part avec le socle ; en mode conserver_socle
        (le socle reste PAR CHOIX) elle reste entiere. Les scenes de rochers separes ne touchent jamais la feuille : seule la soudure
        met le retrait des ilots du mode « socle conserve » a l'epreuve."""
        Vc, Fc = ellipsoide((0, PIEDS + 0.38, 0), (0.12, 0.38, 0.08), 60, 90)
        Vf, Ff = feuille(Y_FEUILLE, n=40, bruit=0.0)          # noeuds de la grille tous les 0,025 ; dessus a Y_FEUILLE + 0,001
        Vk, Fk = boite((0.325, Y_FEUILLE + 0.001 + 0.01, 0.325), (0.025, 0.01, 0.025))     # bas de la boite = noeuds de la grille
        V, F, idx = fusionner(('corps', Vc, Fc), ('feuille', Vf, Ff), ('colonne', Vk, Fk))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertTrue(rapport)
        self.assertIn('ilots_detaches', rapport['criteres'])
        self.assertFalse(garder[idx['colonne']].any(), 'la colonne soudee flotte encore au-dessus du sol retire')
        self.assertTrue(garder[idx['corps']].all())
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True, **ILOTS)
        self.assertEqual(rapport['mode'], 'dalle_seule')
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        cy = centres_y(V, F)
        cotes = idx['colonne'][cy[idx['colonne']] > Y_FEUILLE + 0.004]                      # les faces au-dessus de la feuille
        self.assertGreater(len(cotes), 6)
        self.assertTrue(garder[cotes].all(), 'la colonne a ete retiree en mode conserver_socle')

    def test_35_figure_allongee_et_ailes(self):
        """Du FOCUS de la relecture : une figure ALLONGEE (couchee, ventre sur le sol) n'est pas prise pour une dalle (son ventre est
        un grand plan horizontal, mais il ne deborde pas du corps qu'il porte) ; avec la feuille sous elle, seule la feuille part.
        Des AILES ouvertes a mi-hauteur (plus du tiers de la hauteur : hors du tiers inferieur) ne sont pas une dalle non plus."""
        y0 = Y_FEUILLE + 0.008
        parts = [('torse', *ellipsoide((0, y0 + 0.07, 0), (0.35, 0.07, 0.10), 40, 60)),
                 ('tete', *ellipsoide((0.42, y0 + 0.08, 0), (0.07, 0.06, 0.06), 20, 30)),
                 ('jambes', *ellipsoide((-0.40, y0 + 0.04, 0), (0.12, 0.04, 0.05), 20, 30)),
                 ('bras', *ellipsoide((0.20, y0 + 0.03, 0.12), (0.10, 0.03, 0.03), 20, 30))]
        V, F, idx = fusionner(*parts)
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertEqual(rapport, {}, 'une figure allongee a ete prise pour une dalle')
        self.assertTrue(garder.all())
        Vf, Ff = feuille(Y_FEUILLE, n=40)
        V, F, idx = fusionner(*parts, ('feuille', Vf, Ff))
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport)
        self.assertTrue((~garder[idx['feuille']]).all())
        for nom in ('torse', 'tete', 'jambes', 'bras'):
            self.assertTrue(garder[idx[nom]].all(), 'la figure allongee est entamee : ' + nom)
        # ailes ouvertes a 45 % de la hauteur (deux plaques de 0,5 x 0,2), sans feuille
        Vp, Fp, ip = personnage(PIEDS)
        T_fig = 0.76 + 0.065
        ailes = [('aile%d' % s_, *ellipsoide((s_ * 0.5, PIEDS + 0.45 * T_fig, 0.0), (0.5, 0.01, 0.2), 30, 40)) for s_ in (-1, 1)]
        V, F, idx = fusionner(('figure', Vp, Fp), *ailes)
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertEqual(rapport, {}, 'des ailes ouvertes a mi-hauteur ont ete prises pour une dalle')
        self.assertTrue(garder.all())

    def test_36_creatures_plates_au_ras_du_sol(self):
        """Du FOCUS « ailes » : des grandes surfaces horizontales AU RAS DU SOL qui sont le corps lui-meme (ailes etalees d'un dragon couche,
        raie, papillon a plat) ne sont pas une dalle : leur aire d'une face ne deborde pas la silhouette qu'elles portent. Le garde est
        le rapport avec la silhouette (0,47 pour le dragon, 0,15 pour la raie), pas la hauteur."""
        y0 = Y_FEUILLE

        def aile(cote, long_x, demi_z, y, ep=0.01):
            return ellipsoide((cote * long_x / 2.0, y, 0.0), (long_x / 2.0, ep, demi_z), 40, 80)
        cas = {
            'dragon couche': [('torse', *ellipsoide((0, y0 + 0.07, 0), (0.18, 0.07, 0.10), 30, 40)),
                              ('tete', *ellipsoide((0.26, y0 + 0.10, 0), (0.07, 0.05, 0.05), 20, 30)),
                              ('queue', *ellipsoide((-0.30, y0 + 0.03, 0), (0.15, 0.03, 0.03), 20, 30)),
                              ('aile_g', *aile(+1, 0.5, 0.22, y0 + 0.04)), ('aile_d', *aile(-1, 0.5, 0.22, y0 + 0.04))],
            'raie': [('disque', *ellipsoide((0, y0 + 0.03, 0), (0.5, 0.03, 0.40), 40, 80)),
                     ('bosse', *ellipsoide((0, y0 + 0.06, 0), (0.12, 0.05, 0.10), 20, 30))],
            'papillon a plat': [('thorax', *ellipsoide((0, y0 + 0.05, 0), (0.04, 0.04, 0.15), 20, 30)),
                                ('aile_g', *aile(+1, 0.48, 0.30, y0 + 0.05, ep=0.004)), ('aile_d', *aile(-1, 0.48, 0.30, y0 + 0.05, ep=0.004))],
        }
        for nom, parts in cas.items():
            V, F, idx = fusionner(*parts)
            garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
            self.assertEqual(rapport, {}, '%s : une partie du corps a ete prise pour une dalle' % nom)
            self.assertTrue(garder.all(), nom)

    def test_34_idempotent(self):
        """Une seconde passe sur le maillage deja nettoye ne change rien : la feuille (et, avec l'option des ilots, les ilots) sont
        partis, la figure garde sa base. Vrai par defaut ET avec l'option."""
        import trimesh
        frag = {'f%d' % k: (x, z, 0.03, 0.015, 0.03) for k, (x, z) in enumerate(((0.3, 0.3), (-0.3, 0.25), (0.35, -0.3)))}
        V, F, idx = self._scene_ilots(**frag)
        m = trimesh.Trimesh(V, F, process=False)
        sortie, rapport = self.acc.retirer_dalle_sol(m, 1, **ILOTS)
        self.assertTrue(rapport)
        self.assertIn('ilots_detaches', rapport['criteres'])
        sortie2, rapport2 = self.acc.retirer_dalle_sol(sortie, 1, **ILOTS)
        self.assertEqual(rapport2, {})
        self.assertIs(sortie2, sortie)
        # par defaut (option eteinte) : la calotte reste, mais la seconde passe ne change toujours rien
        sortie3, rapport3 = self.acc.retirer_dalle_sol(m, 1)
        self.assertTrue(rapport3)
        self.assertNotIn('ilots_detaches', rapport3['criteres'])
        self.assertGreater(len(sortie3.faces), len(sortie.faces))
        sortie4, rapport4 = self.acc.retirer_dalle_sol(sortie3, 1)
        self.assertEqual(rapport4, {})
        self.assertIs(sortie4, sortie3)


def _rotation(plan, deg):
    """Rotation de `deg` degres dans le plan des axes `plan` (i, j)."""
    a = np.radians(deg)
    R = np.eye(3)
    i, j = plan
    R[i, i] = R[j, j] = np.cos(a)
    R[i, j], R[j, i] = -np.sin(a), np.sin(a)
    return R


class TestTrimesh(unittest.TestCase):
    """retirer_dalle_sol sur de vrais objets trimesh : texture, normales, scene, entree non modifiee."""

    def setUp(self):
        self.acc = charger_module()
        if not hasattr(self.acc, 'retirer_dalle_sol'):
            self.fail('retirer_dalle_sol absent : ancien code')
        import trimesh
        self.trimesh = trimesh

    def _maillage_texture(self):
        from PIL import Image
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)
        uv = np.stack([(V[:, 0] + 0.5) / 1.0, (V[:, 2] + 0.5) / 1.0], 1)
        img = Image.fromarray((np.random.default_rng(1).random((64, 64, 3)) * 255).astype(np.uint8))
        mat = self.trimesh.visual.material.PBRMaterial(baseColorTexture=img)
        rng = np.random.default_rng(7)
        normales = rng.standard_normal((len(V), 3))
        normales /= np.linalg.norm(normales, axis=1, keepdims=True)         # normales EXPLICITES, une par sommet, toutes differentes
        m = self.trimesh.Trimesh(V, F, process=False, visual=self.trimesh.visual.TextureVisuals(uv=uv, material=mat),
                                 vertex_normals=normales)
        return m, idx, mat

    def test_texture_normales_et_entree_intacte(self):
        m, idx, mat = self._maillage_texture()
        v0, f0 = np.array(m.vertices), np.array(m.faces)
        sortie, rapport = self.acc.retirer_dalle_sol(m, 1)
        self.assertTrue(rapport)
        self.assertIsNot(sortie, m)
        self.assertTrue(np.array_equal(m.vertices, v0) and np.array_equal(m.faces, f0), 'l\'entree a ete modifiee')
        nf = len(idx['figure'])
        self.assertEqual(len(sortie.faces), nf)
        self.assertLess(len(sortie.vertices), len(v0))
        self.assertEqual(len(sortie.vertices), len(np.unique(sortie.faces)), 'sommets inutiles conserves')
        self.assertEqual(sortie.visual.uv.shape, (len(sortie.vertices), 2))
        self.assertEqual(np.asarray(sortie.vertex_normals).shape, (len(sortie.vertices), 3))
        self.assertIsNotNone(sortie.visual.material.baseColorTexture)
        self.assertIs(sortie.visual.material, mat, 'le materiau devait etre PARTAGE (pas de copie des textures)')
        # chaque face gardee est geometriquement la meme que dans l'original (ordre conserve)
        ref = v0[f0[idx['figure']]]
        got = np.asarray(sortie.vertices)[np.asarray(sortie.faces)]
        self.assertTrue(np.allclose(ref, got))
        # l'UV d'un sommet garde est celle du sommet d'origine
        uv0 = np.asarray(m.visual.uv)[f0[idx['figure']]]
        uv1 = np.asarray(sortie.visual.uv)[np.asarray(sortie.faces)]
        self.assertTrue(np.allclose(uv0, uv1))
        # les NORMALES de sommet explicites sont conservees telles quelles (trimesh les recalculerait par sommet : coutures d'UV
        # durcies, mesure sur l'orc : ecart moyen 0,69 entre deux doubles de couture au lieu de 0)
        n0 = np.asarray(m.vertex_normals)[f0[idx['figure']]]
        n1 = np.asarray(sortie.vertex_normals)[np.asarray(sortie.faces)]
        self.assertTrue(np.allclose(n0, n1), 'les normales de sommet ont ete recalculees')

    def test_couleurs_de_sommet_et_attributs(self):
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)
        tm = self.trimesh
        couleurs = (np.random.default_rng(3).random((len(V), 4)) * 255).astype(np.uint8)
        m = tm.Trimesh(V, F, process=False, visual=tm.visual.ColorVisuals(vertex_colors=couleurs))
        m.metadata['nom'] = 'figure'
        m.vertex_attributes['poids'] = np.arange(len(V), dtype=np.float64)
        m.face_attributes['groupe'] = np.arange(len(F))
        sortie, rapport = self.acc.retirer_dalle_sol(m, 1)
        self.assertTrue(rapport)
        self.assertEqual(len(sortie.faces), len(idx['figure']))
        c0 = couleurs[F[idx['figure']]]
        c1 = np.asarray(sortie.visual.vertex_colors)[np.asarray(sortie.faces)]
        self.assertTrue(np.array_equal(c0, c1), 'les couleurs de sommet ne suivent pas')
        p0 = np.arange(len(V), dtype=np.float64)[F[idx['figure']]]
        p1 = np.asarray(sortie.vertex_attributes['poids'])[np.asarray(sortie.faces)]
        self.assertTrue(np.array_equal(p0, p1), 'les attributs de sommet ne suivent pas')
        self.assertTrue(np.array_equal(np.asarray(sortie.face_attributes['groupe']), idx['figure']))
        self.assertEqual(sortie.metadata.get('nom'), 'figure')
        # couleurs par face
        fc = (np.random.default_rng(4).random((len(F), 4)) * 255).astype(np.uint8)
        m2 = tm.Trimesh(V, F, process=False, visual=tm.visual.ColorVisuals(face_colors=fc))
        sortie2, _ = self.acc.retirer_dalle_sol(m2, 1)
        self.assertTrue(np.array_equal(np.asarray(sortie2.visual.face_colors), fc[idx['figure']]))

    def test_scene_deux_geometries(self):
        Vp, Fp, _ = personnage(PIEDS)
        Vf, Ff = feuille(Y_FEUILLE)
        tm = self.trimesh
        scene = tm.Scene()
        T = np.eye(4)
        T[:3, 3] = [0.3, 0.1, -0.2]                               # le decalage du noeud ne change rien
        scene.add_geometry(tm.Trimesh(Vp - T[:3, 3], Fp, process=False), node_name='figure', geom_name='figure', transform=T)
        scene.add_geometry(tm.Trimesh(Vf - T[:3, 3], Ff, process=False), node_name='feuille', geom_name='feuille', transform=T)
        sortie, rapport = self.acc.retirer_dalle_sol(scene, 1)
        self.assertTrue(rapport)
        self.assertIn('figure', sortie.geometry)
        self.assertNotIn('feuille', sortie.geometry, 'la geometrie entierement retiree devait disparaitre')
        self.assertEqual(len(sortie.geometry['figure'].faces), len(Fp))
        self.assertIn('feuille', scene.geometry, 'la scene d\'entree a ete modifiee')
        # une scene sans feuille : la MEME scene
        s2 = tm.Scene()
        s2.add_geometry(tm.Trimesh(Vp, Fp, process=False), geom_name='figure')
        self.assertIs(self.acc.retirer_dalle_sol(s2, 1)[0], s2)

    def test_scene_une_geometrie_figure_et_feuille(self):
        V, F, idx = scene_figure_sur_feuille()
        tm = self.trimesh
        scene = tm.Scene(tm.Trimesh(V, F, process=False))
        sortie, rapport = self.acc.retirer_dalle_sol(scene, 1)
        self.assertTrue(rapport)
        (g,) = sortie.geometry.values()
        self.assertEqual(len(g.faces), len(idx['figure']))

    @staticmethod
    def _normales_aleatoires(n, graine):
        a = np.random.default_rng(graine).standard_normal((n, 3))
        return a / np.linalg.norm(a, axis=1, keepdims=True)

    def test_scene_garde_les_normales_explicites(self):
        """Une SCENE (ce que trimesh.load rend pour un GLB) : Scene.copy() copie les geometries SANS leur cache, donc SANS les
        normales de sommet explicites du fichier (trimesh les recalcule alors sommet par sommet, coutures d'UV durcies : ecart
        max 2,0 mesure sur le GLB de l'orc). Elles doivent survivre pour la geometrie coupee ET pour celle que rien ne touche."""
        tm = self.trimesh
        # (a) une seule geometrie : figure + feuille, normales explicites toutes differentes
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)
        n_all = self._normales_aleatoires(len(V), 9)
        scene = tm.Scene(tm.Trimesh(V, F, process=False, vertex_normals=n_all))
        sortie, rapport = self.acc.retirer_dalle_sol(scene, 1)
        self.assertTrue(rapport)
        (g,) = sortie.geometry.values()
        self.assertEqual(len(g.faces), len(idx['figure']))
        self.assertTrue(np.allclose(n_all[F[idx['figure']]], np.asarray(g.vertex_normals)[np.asarray(g.faces)]),
                        'les normales explicites de la geometrie coupee ont ete recalculees')
        # (b) deux geometries : la figure (que rien ne touche) et la feuille (entierement retiree)
        Vp, Fp, _ = personnage(PIEDS)
        Vf, Ff = feuille(Y_FEUILLE)
        n_fig = self._normales_aleatoires(len(Vp), 10)
        scene = tm.Scene()
        scene.add_geometry(tm.Trimesh(Vp, Fp, process=False, vertex_normals=n_fig), node_name='figure', geom_name='figure')
        scene.add_geometry(tm.Trimesh(Vf, Ff, process=False), node_name='feuille', geom_name='feuille')
        sortie, rapport = self.acc.retirer_dalle_sol(scene, 1)
        self.assertTrue(rapport)
        self.assertEqual(list(sortie.geometry), ['figure'])
        gf = sortie.geometry['figure']
        self.assertTrue(np.allclose(np.asarray(gf.vertex_normals), n_fig),
                        'les normales explicites de la geometrie que rien ne touche ont ete recalculees')
        self.assertIsNot(gf, scene.geometry['figure'], 'la geometrie intacte doit etre une COPIE (la sortie est un nouvel objet)')
        self.assertTrue(np.allclose(np.asarray(scene.geometry['figure'].vertex_normals), n_fig), "l'entree a ete modifiee")

    def test_scene_geometrie_instanciee_deux_fois(self):
        """Une geometrie rattachee a deux noeuds de la scene (instance) : couper l'une couperait l'autre, la scene est rendue telle quelle."""
        V, F, idx = scene_figure_sur_feuille()
        tm = self.trimesh
        scene = tm.Scene()
        scene.add_geometry(tm.Trimesh(V, F, process=False), node_name='a', geom_name='g')
        T = np.eye(4)
        T[0, 3] = 2.0
        scene.graph.update(frame_to='b', frame_from=scene.graph.base_frame, matrix=T, geometry='g')
        self.assertEqual(sorted(scene.graph.nodes_geometry), ['a', 'b'])
        sortie, rapport = self.acc.retirer_dalle_sol(scene, 1)
        self.assertEqual(rapport, {})
        self.assertIs(sortie, scene)

    def test_scene_partage_le_materiau_de_la_geometrie_coupee(self):
        m, idx, mat = self._maillage_texture()
        sortie, rapport = self.acc.retirer_dalle_sol(self.trimesh.Scene(m), 1)
        self.assertTrue(rapport)
        (g,) = sortie.geometry.values()
        self.assertIs(g.visual.material, mat, 'le materiau devait etre PARTAGE avec l\'entree (textures non copiees)')
        n0 = np.asarray(m.vertex_normals)[np.asarray(m.faces)[idx['figure']]]
        self.assertTrue(np.allclose(n0, np.asarray(g.vertex_normals)[np.asarray(g.faces)]))


class TestRetirerDalleGlb(unittest.TestCase):
    """La variante APRES export : `glb, _ = retirer_dalle_glb(glb, type_concerne(type_actif), log=log)` juste avant `export`."""

    def setUp(self):
        self.acc = charger_module()
        if not hasattr(self.acc, 'retirer_dalle_glb'):
            self.fail('retirer_dalle_glb absent : ancien code')
        import trimesh
        self.trimesh = trimesh

    def test_scene_avec_dalle(self):
        V, F, idx = scene_figure_sur_feuille()
        scene = self.trimesh.Scene(self.trimesh.Trimesh(V, F, process=False))
        journal = []
        sortie, rapport = self.acc.retirer_dalle_glb(scene, True, log=journal.append)
        self.assertTrue(rapport)
        self.assertIsNot(sortie, scene)
        (g,) = sortie.geometry.values()
        self.assertEqual(len(g.faces), len(idx['figure']))
        self.assertEqual(len(journal), 1, journal)
        self.assertIn('apres export', journal[0])
        self.assertIn('dalle de sol retiree', journal[0])
        # les reglages passent au detecteur (un rapport d'empreinte exige trop haut : plus rien ne part)
        sortie, rapport = self.acc.retirer_dalle_glb(scene, True, log=lambda *_: None, ratio_min=1e6)
        self.assertEqual(rapport, {})
        self.assertIs(sortie, scene)

    def test_sans_dalle_meme_objet_et_motif_au_journal(self):
        Vp, Fp, _ = personnage(-0.30)
        scene = self.trimesh.Scene(self.trimesh.Trimesh(Vp, Fp, process=False))
        journal = []
        sortie, rapport = self.acc.retirer_dalle_glb(scene, True, log=journal.append)
        self.assertEqual(rapport, {})
        self.assertIs(sortie, scene)
        self.assertEqual(len(journal), 1, journal)
        self.assertIn('aucune', journal[0])
        self.assertIn('bande horizontale', journal[0], 'le motif du refus doit figurer au journal')

    def test_scene_non_prise_en_charge_dit_pourquoi(self):
        V, F, _ = scene_figure_sur_feuille()
        scene = self.trimesh.Scene()
        scene.add_geometry(self.trimesh.Trimesh(V, F, process=False), node_name='a', geom_name='g')
        T = np.eye(4)
        T[0, 3] = 2.0
        scene.graph.update(frame_to='b', frame_from=scene.graph.base_frame, matrix=T, geometry='g')
        journal = []
        sortie, rapport = self.acc.retirer_dalle_glb(scene, True, log=journal.append)
        self.assertEqual(rapport, {})
        self.assertIs(sortie, scene)
        self.assertIn('instanciee', journal[0], journal)
        vide = self.trimesh.Scene()
        journal = []
        self.assertIs(self.acc.retirer_dalle_glb(vide, True, log=journal.append)[0], vide)
        self.assertIn('sans maillage', journal[0], journal)

    def test_inactif_ne_fait_rien(self):
        V, F, _ = scene_figure_sur_feuille()
        scene = self.trimesh.Scene(self.trimesh.Trimesh(V, F, process=False))
        journal = []
        sortie, rapport = self.acc.retirer_dalle_glb(scene, False, log=journal.append)
        self.assertIs(sortie, scene)
        self.assertEqual(rapport, {})
        self.assertEqual(journal, [], 'rien ne doit etre journalise quand le type n\'est pas concerne')

    def test_ne_leve_jamais(self):
        objet = object()                                   # pas une scene, pas un maillage
        journal = []
        sortie, rapport = self.acc.retirer_dalle_glb(objet, True, log=journal.append)
        self.assertIs(sortie, objet)
        self.assertEqual(rapport, {})
        self.assertEqual(len(journal), 1, journal)
        self.assertIn('ignore', journal[0])
        # un journal qui leve ne casse rien non plus : ni sur le chemin d'exception, ni sur le chemin normal
        def journal_casse(_):
            raise OSError('flux ferme')
        sortie, rapport = self.acc.retirer_dalle_glb(objet, True, log=journal_casse)
        self.assertIs(sortie, objet)
        self.assertEqual(rapport, {})
        V, F, _ = scene_figure_sur_feuille()
        scene = self.trimesh.Scene(self.trimesh.Trimesh(V, F, process=False))
        sortie, rapport = self.acc.retirer_dalle_glb(scene, True, log=journal_casse)
        self.assertTrue(rapport)


class FauxCuMesh:
    """Imite l'interface de cumesh.CuMesh utilisee par le retrait (read / init), en numpy."""

    def __init__(self, V, F):
        self.v, self.f = np.asarray(V, np.float32), np.asarray(F, np.int32)
        self.nb_init = 0
        self.nb_lecture = 0
        self.uv_unwrap_appeles = 0

    def read(self):
        self.nb_lecture += 1
        return self.v, self.f

    def init(self, v, f):
        self.v, self.f = v, f
        self.nb_init += 1

    def uv_unwrap(self, *a, **k):
        self.uv_unwrap_appeles += 1
        return 'depliage'


class Casse2(FauxCuMesh):
    """Un maillage dont read() leve (le retrait doit se replier sur « retrait ignore » sans lever, meme avec un journal casse)."""

    def read(self):
        raise RuntimeError('boum')


class TestAdaptateurCuMesh(unittest.TestCase):
    def setUp(self):
        self.acc = charger_module()
        if not hasattr(self.acc, 'retirer_dalle_cumesh'):
            self.fail('retirer_dalle_cumesh absent : ancien code')

    def test_retire_et_reinitialise(self):
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)       # sommets gardes : pas un prefixe
        # repere de cumesh : Z vers le haut
        mesh = FauxCuMesh(V[:, [0, 2, 1]], F)
        journal = []
        rapport = self.acc.retirer_dalle_cumesh(mesh, 2, log=journal.append)
        self.assertTrue(rapport)
        self.assertEqual(mesh.nb_init, 1)
        self.assertEqual(len(mesh.f), len(idx['figure']))
        self.assertEqual(mesh.f.dtype, np.int32)
        self.assertEqual(mesh.v.dtype, np.float32)
        self.assertTrue(mesh.f.min() >= 0 and mesh.f.max() < len(mesh.v))
        self.assertEqual(len(mesh.v), len(np.unique(mesh.f)), 'sommets inutiles conserves')
        ref = np.asarray(V[:, [0, 2, 1]], np.float32)[F[idx['figure']]]
        self.assertTrue(np.allclose(ref, mesh.v[mesh.f]))
        self.assertTrue(any('dalle de sol retiree' in ligne for ligne in journal), journal)

    def test_rien_a_retirer_ne_touche_a_rien(self):
        Vp, Fp, _ = personnage(-0.30)
        mesh = FauxCuMesh(Vp[:, [0, 2, 1]], Fp)
        v0, f0 = mesh.v, mesh.f
        self.assertEqual(self.acc.retirer_dalle_cumesh(mesh, 2), {})
        self.assertEqual(mesh.nb_init, 0)
        self.assertIs(mesh.v, v0)
        self.assertIs(mesh.f, f0)

    def test_ne_leve_jamais(self):
        class Casse(FauxCuMesh):
            def read(self):
                raise RuntimeError('boum')
        journal = []
        self.assertEqual(self.acc.retirer_dalle_cumesh(Casse(np.zeros((3, 3)), [[0, 1, 2]]), 2, log=journal.append), {})
        self.assertTrue(any('ignore' in ligne for ligne in journal), journal)

        class InitCasse(FauxCuMesh):
            def init(self, v, f):
                raise RuntimeError('init refuse')
        V, F, _ = scene_figure_sur_feuille()
        journal = []
        self.assertEqual(self.acc.retirer_dalle_cumesh(InitCasse(V[:, [0, 2, 1]], F), 2, log=journal.append), {})
        self.assertTrue(any('init refuse' in ligne for ligne in journal), journal)

    def test_crochet_uv_unwrap(self):
        import types
        acc = self.acc
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)
        faux_module = types.SimpleNamespace(CuMesh=type('CuMesh', (FauxCuMesh,), {}))
        original = faux_module.CuMesh.uv_unwrap
        # hors contexte rien n'est installe
        m = faux_module.CuMesh(V[:, [0, 2, 1]], F)
        self.assertEqual(m.uv_unwrap(), 'depliage')
        self.assertEqual(m.nb_init, 0)
        journal = []
        with acc.retrait_dalle_actif(True, log=journal.append, cumesh_module=faux_module) as rapports:
            m = faux_module.CuMesh(V[:, [0, 2, 1]], F)
            self.assertEqual(m.uv_unwrap(), 'depliage')                  # le depliage d'origine est bien appele
            self.assertEqual(m.uv_unwrap_appeles, 1)
            self.assertEqual(m.nb_init, 1, 'la dalle n\'a pas ete retiree avant le depliage')
            self.assertEqual(len(m.f), len(idx['figure']))
            m.uv_unwrap()                                                # deuxieme depliage du MEME maillage : pas de seconde passe
            self.assertEqual(m.nb_init, 1)
            self.assertEqual(m.nb_lecture, 1, 'le maillage a ete relu et reanalyse')
            self.assertEqual(len(rapports), 1)
        # apres le contexte le crochet reste en place mais ne fait plus rien
        m2 = faux_module.CuMesh(V[:, [0, 2, 1]], F)
        m2.uv_unwrap()
        self.assertEqual(m2.nb_init, 0)
        # installation idempotente : une seule enveloppe
        acc.installer_retrait_dalle(faux_module)
        acc.installer_retrait_dalle(faux_module)
        self.assertIs(faux_module.CuMesh.uv_unwrap.__wrapped__, original)
        # actif=False : aucun effet
        with acc.retrait_dalle_actif(False, cumesh_module=faux_module) as rapports:
            m3 = faux_module.CuMesh(V[:, [0, 2, 1]], F)
            m3.uv_unwrap()
            self.assertEqual(m3.nb_init, 0)
        # exception dans le contexte : l'etat est remis a zero
        with self.assertRaises(KeyError):
            with acc.retrait_dalle_actif(True, cumesh_module=faux_module):
                raise KeyError('x')
        m4 = faux_module.CuMesh(V[:, [0, 2, 1]], F)
        m4.uv_unwrap()
        self.assertEqual(m4.nb_init, 0)

    def test_etat_propre_au_fil(self):
        """L'etat du retrait est propre au fil : un depliage lance dans un AUTRE fil pendant qu'un contexte est ouvert ne retire rien
        (deux generations en parallele dans le meme processus ne s'influencent pas)."""
        import threading
        import types
        acc = self.acc
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)
        faux_module = types.SimpleNamespace(CuMesh=type('CuMesh', (FauxCuMesh,), {}))
        autre = []

        def depliage_dans_un_autre_fil():
            m = faux_module.CuMesh(V[:, [0, 2, 1]], F)
            m.uv_unwrap()
            autre.append((m.nb_init, m.uv_unwrap_appeles))
        with acc.retrait_dalle_actif(True, cumesh_module=faux_module):
            fil = threading.Thread(target=depliage_dans_un_autre_fil)
            fil.start()
            fil.join()
            m = faux_module.CuMesh(V[:, [0, 2, 1]], F)
            m.uv_unwrap()
            self.assertEqual(m.nb_init, 1)
        self.assertEqual(autre, [(0, 1)], 'le depliage d\'un autre fil a ete modifie')

    def test_init_qui_echoue_remet_le_maillage(self):
        """`init` peut vider le maillage avant d'echouer : les sommets et faces d'ORIGINE (copies de `read()`) sont reinjectes, pas de
        maillage a moitie construit pour le depliage. Sans cette restitution le maillage reste dans l'etat laisse par l'echec."""
        class InitUneFoisCasse(FauxCuMesh):
            def init(self, v, f):
                self.nb_init += 1
                if self.nb_init == 1:
                    self.v, self.f = None, None            # etat inconnu laisse par l'echec
                    raise RuntimeError('init refuse')
                self.v, self.f = v, f
        V, F, _ = scene_figure_sur_feuille()
        mesh = InitUneFoisCasse(V[:, [0, 2, 1]], F)
        v0, f0 = mesh.v, mesh.f
        journal = []
        self.assertEqual(self.acc.retirer_dalle_cumesh(mesh, 2, log=journal.append), {})
        self.assertEqual(mesh.nb_init, 2, "le maillage d'origine n'a pas ete reinjecte")
        self.assertIs(mesh.v, v0)
        self.assertIs(mesh.f, f0)
        self.assertTrue(any('init refuse' in ligne for ligne in journal), journal)
        # restitution impossible elle aussi : rien ne leve, la raison est dite
        class InitToujoursCasse(FauxCuMesh):
            def init(self, v, f):
                raise RuntimeError('init refuse toujours')
        journal = []
        self.assertEqual(self.acc.retirer_dalle_cumesh(InitToujoursCasse(V[:, [0, 2, 1]], F), 2, log=journal.append), {})
        self.assertTrue(any('NON restitue' in ligne for ligne in journal), journal)

    def test_journal_dans_tous_les_cas(self):
        """UNE ligne de journal par maillage traite : la dalle retiree, ou « aucune » avec le motif du refus. Sur Modal c'est la seule
        trace de ce que le detecteur a decide (sans elle, un detecteur qui ne declenche jamais est invisible)."""
        Vp, Fp, _ = personnage(-0.30)
        journal = []
        self.assertEqual(self.acc.retirer_dalle_cumesh(FauxCuMesh(Vp[:, [0, 2, 1]], Fp), 2, log=journal.append), {})
        self.assertEqual(len(journal), 1, journal)
        self.assertIn('dalle de sol : aucune', journal[0])
        self.assertIn('bande horizontale', journal[0], 'le motif du refus doit figurer au journal')
        V, F, _ = scene_figure_sur_feuille()
        journal = []
        self.assertTrue(self.acc.retirer_dalle_cumesh(FauxCuMesh(V[:, [0, 2, 1]], F), 2, log=journal.append))
        self.assertEqual(len(journal), 1, journal)
        self.assertIn('dalle de sol retiree', journal[0])
        self.assertIn('analyse', journal[0])

    def _module_avec(self, classe):
        import types
        return types.SimpleNamespace(CuMesh=classe)

    def test_un_journal_qui_leve_ne_casse_rien(self):
        """Flux de journal ferme (print dans un flux ferme, rappel qui leve) : ni le retrait, ni son refus, ni le filet du depliage, ni
        l'installation du crochet ne doivent en souffrir. Une generation ne se perd pas pour une ligne de journal."""
        def casse(_):
            raise OSError('flux ferme')
        V, F, idx = scene_figure_sur_feuille()
        mesh = FauxCuMesh(V[:, [0, 2, 1]], F)
        self.assertTrue(self.acc.retirer_dalle_cumesh(mesh, 2, log=casse))
        self.assertEqual(len(mesh.f), len(idx['figure']))
        Vp, Fp, _ = personnage(-0.30)
        self.assertEqual(self.acc.retirer_dalle_cumesh(FauxCuMesh(Vp[:, [0, 2, 1]], Fp), 2, log=casse), {})
        self.assertEqual(self.acc.retirer_dalle_cumesh(Casse2(np.zeros((3, 3)), [[0, 1, 2]]), 2, log=casse), {})

        class Capricieux(FauxCuMesh):
            def __init__(self, V, F):
                super().__init__(V, F)
                self.n0 = len(self.f)

            def uv_unwrap(self, *a, **k):
                self.uv_unwrap_appeles += 1
                if len(self.f) != self.n0:
                    raise RuntimeError('depliage impossible')
                return 'depliage'
        module = self._module_avec(Capricieux)
        with self.acc.retrait_dalle_actif(True, log=casse, cumesh_module=module):
            m = module.CuMesh(V[:, [0, 2, 1]], F)
            self.assertEqual(m.uv_unwrap(), 'depliage')
            self.assertEqual(m.uv_unwrap_appeles, 2)
        # cumesh absent ET journal casse : l'installation rend False sans lever
        self.assertFalse(self.acc.installer_retrait_dalle(object(), log=casse))

    def test_depliage_qui_echoue_sans_la_dalle_est_rejoue_sur_l_original(self):
        """FILET du crochet : le depliage n'a JAMAIS ete essaye sur un maillage a bord ouvert sous les pieds (GPU, non mesure). S'il echoue
        apres le retrait, le maillage d'origine est remis et le depliage rejoue : la generation sort comme avant, sans le retrait, et le
        rapport du retrait annule n'est plus rendu."""
        class Capricieux(FauxCuMesh):
            def __init__(self, V, F):
                super().__init__(V, F)
                self.n0 = len(self.f)

            def uv_unwrap(self, *a, **k):
                self.uv_unwrap_appeles += 1
                if len(self.f) != self.n0:
                    raise RuntimeError('depliage impossible sur un bord ouvert')
                return 'depliage'
        V, F, _ = scene_figure_sur_feuille(feuille_d_abord=True)
        module = self._module_avec(Capricieux)
        journal = []
        with self.acc.retrait_dalle_actif(True, log=journal.append, cumesh_module=module) as rapports:
            m = module.CuMesh(V[:, [0, 2, 1]], F)
            v0, f0 = m.v, m.f
            self.assertEqual(m.uv_unwrap(), 'depliage')
            self.assertEqual(m.uv_unwrap_appeles, 2, 'le depliage devait etre rejoue une fois sur le maillage d\'origine')
            self.assertEqual(m.nb_init, 2)
            self.assertIs(m.v, v0)
            self.assertIs(m.f, f0)
            self.assertEqual(rapports, [], 'le rapport du retrait annule est encore la')
            m.uv_unwrap()                                            # un depliage ulterieur du meme maillage ne retente rien
            self.assertEqual(m.nb_init, 2)
        self.assertTrue(any('restitue' in ligne for ligne in journal), journal)
        # le meme depliage qui REUSSIT sur le maillage coupe : le rapport est rendu, aucun rejeu
        module_sain = self._module_avec(type('CuMesh', (FauxCuMesh,), {}))
        with self.acc.retrait_dalle_actif(True, cumesh_module=module_sain) as rapports:
            m = module_sain.CuMesh(V[:, [0, 2, 1]], F)
            m.uv_unwrap()
            self.assertEqual((m.nb_init, m.uv_unwrap_appeles, len(rapports)), (1, 1, 1))

    def test_depliage_qui_echoue_toujours_leve_comme_avant(self):
        """Si le depliage echoue AUSSI sur le maillage d'origine, l'erreur remonte comme sans le crochet (le maillage est celui d'origine)."""
        class Toujours(FauxCuMesh):
            def uv_unwrap(self, *a, **k):
                self.uv_unwrap_appeles += 1
                raise RuntimeError('depliage KO')
        V, F, _ = scene_figure_sur_feuille()
        module = self._module_avec(Toujours)
        with self.acc.retrait_dalle_actif(True, log=lambda *_: None, cumesh_module=module) as rapports:
            m = module.CuMesh(V[:, [0, 2, 1]], F)
            f0 = m.f
            with self.assertRaises(RuntimeError) as ctx:
                m.uv_unwrap()
            self.assertIn('depliage KO', str(ctx.exception))
            self.assertEqual(m.uv_unwrap_appeles, 2, 'un essai sur le maillage coupe, un sur l\'original')
            self.assertIs(m.f, f0)
            self.assertEqual(rapports, [])

    def test_memoire_epuisee_pas_de_rejeu(self):
        """Carte ou RAM epuisee : rejouer sur le maillage COMPLET (plus gros) ne peut pas reussir ; l'erreur remonte tout de suite (le
        traitement de memoire de l'appelant, par exemple le repli de mode, la voit telle quelle) et le maillage reste coupe."""
        class OutOfMemoryError(RuntimeError):
            pass

        class Memoire(FauxCuMesh):
            def uv_unwrap(self, *a, **k):
                self.uv_unwrap_appeles += 1
                raise OutOfMemoryError('CUDA out of memory')
        V, F, idx = scene_figure_sur_feuille()
        module = self._module_avec(Memoire)
        with self.acc.retrait_dalle_actif(True, log=lambda *_: None, cumesh_module=module):
            m = module.CuMesh(V[:, [0, 2, 1]], F)
            with self.assertRaises(OutOfMemoryError):
                m.uv_unwrap()
            self.assertEqual(m.uv_unwrap_appeles, 1, 'un depliage hors memoire a ete rejoue')
            self.assertEqual(m.nb_init, 1)
            self.assertEqual(len(m.f), len(idx['figure']))
        self.assertTrue(self.acc._memoire_epuisee(MemoryError()))
        self.assertFalse(self.acc._memoire_epuisee(RuntimeError('autre chose')))

    def test_restitution_impossible_l_erreur_du_depliage_remonte(self):
        """Le depliage echoue ET la restitution du maillage d'origine echoue : c'est l'erreur du DEPLIAGE qui remonte (pas celle de
        `init`), et le journal dit que le maillage n'a pas pu etre remis."""
        class Impossible(FauxCuMesh):
            def init(self, v, f):
                self.nb_init += 1
                if self.nb_init >= 2:
                    raise RuntimeError('init refuse a la restitution')
                self.v, self.f = v, f

            def uv_unwrap(self, *a, **k):
                self.uv_unwrap_appeles += 1
                raise RuntimeError('depliage KO')
        V, F, _ = scene_figure_sur_feuille()
        module = self._module_avec(Impossible)
        journal = []
        with self.acc.retrait_dalle_actif(True, log=journal.append, cumesh_module=module):
            m = module.CuMesh(V[:, [0, 2, 1]], F)
            with self.assertRaises(RuntimeError) as ctx:
                m.uv_unwrap()
            self.assertIn('depliage KO', str(ctx.exception))
            self.assertEqual(m.uv_unwrap_appeles, 1)
        self.assertTrue(any('NON restitue' in ligne for ligne in journal), journal)

    def test_cumesh_absent(self):
        journal = []
        faux_module = object()                       # pas de CuMesh
        with self.acc.retrait_dalle_actif(True, log=journal.append, cumesh_module=faux_module) as rapports:
            pass
        self.assertEqual(rapports, [])
        self.assertTrue(any('impossible' in ligne for ligne in journal), journal)


@unittest.skipUnless(os.environ.get('FABMESH_TEST_TORCH') == '1',
                     "FABMESH_TEST_TORCH=1 pour le test avec de vrais tenseurs torch (importe torch : processus lourd, CPU seulement)")
class TestAdaptateurTorch(unittest.TestCase):
    """Le chemin torch de retirer_dalle_cumesh (celui de la production : read() rend des tenseurs, init() les veut contigus, meme
    peripherique, memes types). Tenseurs CPU : aucun GPU. Lancer avec CUDA_VISIBLE_DEVICES= pour etre sur de ne pas en toucher."""

    def test_tenseurs_torch(self):
        import torch
        acc = charger_module()
        V, F, idx = scene_figure_sur_feuille(feuille_d_abord=True)

        class MeshTorch(FauxCuMesh):
            def __init__(self, V, F):
                self.v = torch.from_numpy(np.ascontiguousarray(V, np.float32))
                self.f = torch.from_numpy(np.ascontiguousarray(F, np.int32))
                self.nb_init = 0

            def read(self):
                return self.v, self.f

            def init(self, v, f):
                assert v.ndim == 2 and v.shape[1] == 3 and f.ndim == 2 and f.shape[1] == 3
                assert v.is_contiguous() and f.is_contiguous() and v.device == f.device
                self.v, self.f = v, f
                self.nb_init += 1

        mesh = MeshTorch(V[:, [0, 2, 1]], F)
        rapport = acc.retirer_dalle_cumesh(mesh, 2, log=lambda *_: None)
        self.assertTrue(rapport)
        self.assertEqual(mesh.nb_init, 1)
        self.assertEqual(mesh.v.dtype, torch.float32)
        self.assertEqual(mesh.f.dtype, torch.int32)
        self.assertEqual(mesh.f.shape[0], len(idx['figure']))
        self.assertEqual(int(mesh.f.max()) + 1, mesh.v.shape[0])
        ref = np.asarray(V[:, [0, 2, 1]], np.float32)[F[idx['figure']]]
        self.assertTrue(np.allclose(ref, mesh.v.numpy()[mesh.f.numpy()]))
        # rien a retirer : read() seul, aucun init
        Vp, Fp, _ = personnage(-0.30)
        m2 = MeshTorch(Vp[:, [0, 2, 1]], Fp)
        self.assertEqual(acc.retirer_dalle_cumesh(m2, 2, log=lambda *_: None), {})
        self.assertEqual(m2.nb_init, 0)


def charger_banc_atlas():
    chemin = os.path.join(RACINE, 'build', 'bancs', 'fidelite', 'dalle_sol_atlas.py')
    spec = importlib.util.spec_from_file_location('dalle_sol_atlas_sous_test', chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class TestAtlas(unittest.TestCase):
    """Le banc de mesure de l'atlas : les chiffres que le protocole GPU compare entre un GLB d'avant et un GLB d'apres."""

    def test_part_atlas_chiffres_connus(self):
        banc = charger_banc_atlas()
        # corps : aire 3D 0,5 (y de 0 a 1), aire UV 0,3 ; dalle : aire 3D 1,5 (a y = -1), aire UV 0,1
        V = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0], [3, -1, 0], [0, -1, 1]], float)
        F = np.array([[0, 1, 2], [3, 4, 5]])
        UV = np.array([[0, 0], [0.6, 0], [0, 1.0], [0.5, 0.5], [0.9, 0.5], [0.5, 1.0]], float)
        r = banc.part_atlas(V, F, UV, np.array([True, False]), taille=1000)
        self.assertAlmostEqual(r['aire_3d_retiree_pct'], 75.0, places=9)
        self.assertAlmostEqual(r['atlas_retire_pct'], 25.0, places=9)
        self.assertAlmostEqual(r['atlas_corps_pct'], 75.0, places=9)
        self.assertAlmostEqual(r['occupation_pct'], 40.0, places=9)
        self.assertAlmostEqual(r['densite_corps'], np.sqrt(0.3 / 0.5), places=9)
        self.assertAlmostEqual(r['hauteur_corps'], 1.0, places=9)
        self.assertAlmostEqual(r['texels_par_unite'], 1000 * np.sqrt(0.6), places=6)
        self.assertAlmostEqual(r['texels_sur_la_hauteur'], 1000 * np.sqrt(0.6), places=6)
        json.dumps(r)
        # tout est corps : rien ne part, la densite est celle de l'ensemble
        r = banc.part_atlas(V, F, UV, np.array([True, True]))
        self.assertEqual((r['aire_3d_retiree_pct'], r['atlas_retire_pct']), (0.0, 0.0))
        self.assertNotIn('texels_par_unite', r)

    def test_gain_visible_plafonne_par_la_grille(self):
        """L'orc a 2048 : 857 texels par unite contre une grille de 1024 voxels -> au mieux x1,19 de detail visible, pas x1,68 ; la meme
        texture sur une grille de 1536 voxels profite du plein x1,68 ; une texture deja plus fine que la grille (4096) ne gagne rien."""
        banc = charger_banc_atlas()
        self.assertAlmostEqual(banc.gain_utile_estime(1.68, 857.0, 1024), 1024 / 857.0, places=9)
        self.assertAlmostEqual(banc.gain_utile_estime(1.68, 857.0, 1536), 1.68, places=9)
        self.assertEqual(banc.gain_utile_estime(1.68, 1714.0, 1024), 1.0)
        self.assertEqual(banc.gain_utile_estime(1.68, None, 1024), 1.68)           # inconnu : le gain tel quel
        self.assertEqual(banc.gain_utile_estime(1.68, 857.0, None), 1.68)
        self.assertEqual(banc.gain_utile_estime(1.05, 857.0, 1024), 1.05)           # jamais plus que le gain lui-meme

    def test_glb_texture_et_gain_de_resolution(self):
        """Un GLB texture (UV = projection a plat, figure + feuille) : la dalle prend l'essentiel de l'atlas AVANT ; la variante APRES export
        (UV inchanges) ne gagne rien (x1,00 mesure), alors que l'estimation pour un retrait AVANT le depliage est x1 / racine(part du corps)."""
        import contextlib
        import io
        import tempfile
        import trimesh
        from PIL import Image
        banc = charger_banc_atlas()
        acc = charger_module()
        V, F, idx = scene_figure_sur_feuille()
        uv = np.stack([V[:, 0] + 0.5, V[:, 2] + 0.5], 1) * 0.9 + 0.05          # projection a plat sur le dessus
        img = Image.fromarray(np.zeros((128, 128, 3), np.uint8))
        mat = trimesh.visual.material.PBRMaterial(baseColorTexture=img)
        m = trimesh.Trimesh(V, F, process=False, visual=trimesh.visual.TextureVisuals(uv=uv, material=mat))
        with tempfile.TemporaryDirectory() as dossier:
            avant, apres, sortie_json = (os.path.join(dossier, n) for n in ('avant.glb', 'apres.glb', 'sortie.json'))
            trimesh.Scene(m).export(avant)
            V2, F2, UV2, taille = banc.charger_glb_uv(avant)
            self.assertEqual((len(F2), taille), (len(F), 128))
            self.assertEqual(UV2.shape, (len(V2), 2))
            self.assertAlmostEqual(float(banc.aires_uv(UV2, F2).sum()), float(banc.aires_uv(uv, F).sum()), places=6)
            coupe, rapport = acc.retirer_dalle_sol(trimesh.load(avant, force='scene', process=False), 1)
            self.assertTrue(rapport)
            coupe.export(apres)
            sortie = io.StringIO()
            with contextlib.redirect_stdout(sortie):
                self.assertEqual(banc.main([avant, apres, '--json', sortie_json]), 0)
            with open(sortie_json, encoding='utf-8') as f:
                res = json.load(f)
        a = res['avant']
        self.assertEqual(a['detecteur'], 'retire')
        self.assertGreater(a['aire_3d_retiree_pct'], 50.0)
        self.assertGreater(a['atlas_retire_pct'], 50.0, "la dalle devrait prendre l'essentiel de l'atlas")
        self.assertEqual(res['apres']['detecteur'], 'inchange')
        self.assertAlmostEqual(res['gain_lineaire_mesure'], 1.0, delta=1e-6)           # variante APRES export : les UV n'ont pas bouge
        part_corps = 1.0 - a['aire_3d_retiree_pct'] / 100.0
        self.assertAlmostEqual(res['gain_lineaire_estime'], 1.0 / np.sqrt(part_corps), places=9)
        self.assertGreater(res['gain_lineaire_estime'], 1.5)
        self.assertIn('GAIN LINEAIRE MESURE', sortie.getvalue())


def charger_banc_mesures():
    chemin = os.path.join(RACINE, 'build', 'bancs', 'fidelite', 'dalle_sol_mesures.py')
    spec = importlib.util.spec_from_file_location('dalle_sol_mesures_sous_test', chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class TestBancMesures(unittest.TestCase):
    """Fumee du banc de mesures sur GLB reels : chaque sous-commande tourne sur un GLB synthetique (figure + feuille) et rend les chiffres du module."""

    def setUp(self):
        import tempfile
        import trimesh
        self.banc = charger_banc_mesures()
        self.dossier = tempfile.TemporaryDirectory()
        V, F, self.idx = scene_figure_sur_feuille()
        self.avec = os.path.join(self.dossier.name, 'avec_dalle.glb')
        trimesh.Scene(trimesh.Trimesh(V, F, process=False)).export(self.avec)
        Vp, Fp, _ = personnage(-0.30)
        self.sans = os.path.join(self.dossier.name, 'sans_dalle.glb')
        trimesh.Scene(trimesh.Trimesh(Vp, Fp, process=False)).export(self.sans)

    def tearDown(self):
        self.dossier.cleanup()

    @staticmethod
    def _args(**kw):
        import argparse
        return argparse.Namespace(module=None, **kw)

    def test_balayage(self):
        sortie = os.path.join(self.dossier.name, 'balayage.json')
        res = self.banc.cmd_balayage(self._args(cibles=[self.dossier.name], max_mo=300.0, sortie=sortie))
        par_nom = {r['nom']: r for r in res}
        self.assertEqual(par_nom['avec_dalle.glb']['decision'], 'retire')
        self.assertEqual(par_nom['sans_dalle.glb']['decision'], 'inchange')
        self.assertIn('bande horizontale', par_nom['sans_dalle.glb']['raison'])
        self.assertAlmostEqual(par_nom['avec_dalle.glb']['faces_pct'], 100.0 * len(self.idx['feuille']) / (len(self.idx['feuille']) + len(self.idx['figure'])), places=1)
        with open(sortie, encoding='utf-8') as f:
            self.assertEqual(len(json.load(f)), 2)
        ignore = self.banc.cmd_balayage(self._args(cibles=[self.avec], max_mo=1e-6, sortie=None))
        self.assertEqual(ignore[0]['decision'], 'ignore')

    def test_inclinaison(self):
        res = self.banc.cmd_inclinaison(self._args(glb=self.avec, angles=[0.5, 5.0]))
        self.assertEqual(len(res), 4)                                          # deux angles autour de Z et de X
        for r in res:
            self.assertEqual(r['decision'], 'retire', r)
            self.assertEqual((r['corps_perdu'], r['dalle_laissee'], r['rocher_entame']), (0, 0, 0), r)
            self.assertAlmostEqual(r['inclinaison_mesuree'], r['degres'], delta=0.03 * r['degres'] + 0.01)
        self.assertEqual(self.banc.cmd_inclinaison(self._args(glb=self.sans, angles=[1])), [])       # rien a plat : rien a comparer

    def test_composantes(self):
        res = self.banc.cmd_composantes(self._args(glb=self.avec))
        self.assertEqual(sorted(res), ['avec', 'sans'])
        for r in res.values():
            self.assertGreaterEqual(r['composantes'], 1)
            self.assertEqual(r['composantes'], r['secondaires'] + 1)
        self.assertEqual(self.banc.cmd_composantes(self._args(glb=self.sans)), {})

    def test_composantes_option_des_ilots(self):
        """La sous-commande `composantes` passe l'OPTION des ilots EXPLICITEMENT (elle est eteinte par defaut depuis le 18/10) : sur un maillage
        qui porte des calottes de rocher en l'air, « avec » les retire (aucune composante secondaire basse) et « sans » les compte."""
        import trimesh
        frag = {'f%d' % k: (x, z, 0.03, 0.015, 0.03) for k, (x, z) in enumerate(((0.3, 0.3), (-0.3, 0.25), (0.35, -0.3), (-0.25, -0.35), (0.0, 0.4)))}
        V, F, _ = scene_ilots(**frag)
        chemin = os.path.join(self.dossier.name, 'ilots.glb')
        trimesh.Scene(trimesh.Trimesh(V, F, process=False)).export(chemin)
        res = self.banc.cmd_composantes(self._args(glb=chemin))
        self.assertEqual(res['sans']['en_l_air'], len(frag))
        self.assertEqual(res['avec']['en_l_air'], 0)
        self.assertEqual(res['sans']['composantes'] - res['avec']['composantes'], len(frag))

    def test_decimation(self):
        try:
            import fast_simplification  # noqa: F401
        except ImportError:
            self.skipTest('fast_simplification absent')
        res = self.banc.cmd_decimation(self._args(glb=self.avec, cibles=[10000, 4000]))
        self.assertTrue(res and all(r['decision'] in ('retire', 'inchange') for r in res))
        self.assertEqual(self.banc.cmd_decimation(self._args(glb=self.sans, cibles=[1000])), [])

    def test_echelle_dans_un_processus_neuf(self):
        res = self.banc.cmd_echelle(self._args(glb=self.avec, k=0, axe=1))
        self.assertEqual(res['decision'], 'retire')
        self.assertEqual(res['faces'], len(self.idx['feuille']) + len(self.idx['figure']))
        self.assertGreater(res['duree_s'], 0.0)


class TestPiedsEnCoquesSeparees(unittest.TestCase):
    """BLOQUANT B1 de la relecture independante du 18/10 : la regle des ILOTS DETACHES (depuis une option eteinte) retirait des pieces du CORPS
    AU-DESSUS de la ligne des pieds. Un pied qui est une coque separee de la jambe (os d'un squelette, botte sans raccord, patin) a sa semelle
    tranchee par la ligne, donc « touchee par la coupe » : petit, bas, non dominant, il partait comme un caillou. La suite synthetique ne le voyait
    pas : son corps est fait d'ellipsoides disjoints (aucune composante ne domine : la regle dormait, test 33e) et ses ilots ne sont que des rochers."""

    POURCENTS = (3.0, 4.0, 4.8)               # hauteur du pied en % de T (l'option des ilots prend tout ce qui reste sous 5 %)

    def setUp(self):
        self.acc = charger_module()
        for nom in ('masque_dalle_sol', 'retirer_dalle_sol', 'retirer_dalle_glb', 'retirer_dalle_cumesh', 'retrait_dalle_actif', 'REGLAGES_DALLE'):
            if not hasattr(self.acc, nom):
                self.fail('%s absent : ancien code' % nom)

    def _scene(self, pct, soude=True):
        return scene_pieds_en_coques(pct / 100.0 * H_FIGURE, soude=soude)

    @staticmethod
    def _etiquette(pct, soude):
        return 'pieds de %.1f %% de T, %s' % (pct, 'coques soudees a la dalle' if soude else 'coques sans sommet commun avec la dalle')

    def test_37_pieds_en_coques_separees_restent(self):
        """PAR DEFAUT rien ne part au-dessus de la ligne des pieds : les deux pieds (coques separees de la jambe, de 3 a 4,8 % de T, soudees
        ou non a la dalle) restent entiers, ainsi que tout le corps ; ce qui part est EXACTEMENT ce qui est sous la ligne."""
        self.assertEqual(self.acc.REGLAGES_DALLE['debris_hauteur'], 0, "l'option des ilots detaches doit etre ETEINTE par defaut")
        for soude in (True, False):
            for pct in self.POURCENTS:
                et = self._etiquette(pct, soude)
                V, F, idx, _ = self._scene(pct, soude)
                garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
                self.assertTrue(rapport, 'la dalle doit etre reconnue : ' + et)
                self.assertNotIn('ilots_detaches', rapport['criteres'], et)
                self.assertNotIn('ilots', rapport, et)
                ligne = rapport['ligne_pieds']['hauteur']
                cy = centres_y(V, F, 1)
                self.assertTrue(garder[cy > ligne].all(), 'des faces ont ete retirees AU-DESSUS de la ligne des pieds : ' + et)
                self.assertFalse(garder[cy < ligne].any(), 'des faces SOUS la ligne sont restees : ' + et)
                self.assertEqual(rapport['faces_retirees'], int((cy < ligne).sum()), et)
                for nom in ('pied-1', 'pied1'):
                    v = idx[nom]
                    self.assertGreater(int((cy[v] > ligne).sum()), 100, 'le pied doit avoir une partie au-dessus de la ligne : ' + et)
                    self.assertTrue(garder[v[cy[v] > ligne]].all(), 'le %s a ete entame : %s' % (nom, et))

    def test_37b_temoin_l_option_retire_les_pieds(self):
        """TEMOIN : avec l'option `debris_hauteur=0.05` les MEMES pieds partent (limite connue de la regle, la raison pour laquelle elle est
        eteinte). Sans lui le test 37 pourrait passer dans le vide : il prouve que la scene est un vrai piege (dalle reconnue, pieds pris pour
        des ilots, SEULS les pieds partent). Au-dela de 5 % de T l'option ne les prend pas : son seuil de hauteur fonctionne."""
        for soude in (True, False):
            for pct in self.POURCENTS:
                et = self._etiquette(pct, soude)
                V, F, idx, _ = self._scene(pct, soude)
                garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
                self.assertIn('ilots_detaches', rapport['criteres'], et)
                ligne = rapport['ligne_pieds']['hauteur']
                retirees = (~garder) & (centres_y(V, F, 1) > ligne)
                pieds = np.concatenate([idx['pied-1'], idx['pied1']])
                self.assertGreater(int(retirees.sum()), 100, et)
                self.assertEqual(int(retirees[pieds].sum()), int(retirees.sum()), 'autre chose que les pieds est parti : ' + et)
            et = self._etiquette(6.5, soude)                      # nettement plus haut que 5 % de T : l'option ne le prend pas pour un ilot
            V, F, idx, _ = self._scene(6.5, soude)
            garder, rapport = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
            self.assertTrue(rapport, et)
            self.assertNotIn('ilots_detaches', rapport['criteres'], 'un pied plus haut que 5 %% de T est pris pour un ilot : %s' % et)
            self.assertTrue(garder[centres_y(V, F, 1) > rapport['ligne_pieds']['hauteur']].all(), et)

    def test_38_coques_variees_posees_sur_la_dalle(self):
        """Le contrat « rien au-dessus de la ligne des pieds » tient pour des coques separees de formes variees (pied, botte, patin, sabre
        couche, baton, caillou), hautes de 1 a 4,5 % de T et posees sur la dalle a des positions pseudo-aleatoires (deux tirages) ; avec
        l'option des ilots certaines partent, et seulement elles (temoin)."""
        for graine in (1, 2):
            V, F, idx, _ = scene_coques_posees(graine)
            garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
            self.assertTrue(rapport, 'tirage %d : la dalle doit etre reconnue' % graine)
            self.assertNotIn('ilots_detaches', rapport['criteres'])
            ligne = rapport['ligne_pieds']['hauteur']
            cy = centres_y(V, F, 1)
            self.assertTrue(garder[cy > ligne].all(), 'tirage %d : des faces ont ete retirees AU-DESSUS de la ligne des pieds' % graine)
            self.assertEqual(rapport['faces_retirees'], int((cy < ligne).sum()), 'tirage %d' % graine)
            go, ro = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
            retirees = np.flatnonzero((~go) & (cy > ligne))
            coques = np.concatenate([idx[n] for n in idx if n.startswith('coque')])
            self.assertGreater(len(retirees), 0, 'tirage %d : le temoin (l\'option) ne retire rien, la scene ne prouve rien' % graine)
            self.assertTrue(np.isin(retirees, coques).all(), 'tirage %d : l\'option a retire autre chose que des coques' % graine)

    def test_39_tous_les_points_d_entree_gardent_les_pieds(self):
        """Le defaut touchait TOUS les points d'entree, pas seulement masque_dalle_sol : retirer_dalle_sol, la variante apres export
        (retirer_dalle_glb), l'adaptateur cumesh et le crochet du depliage. Chacun garde les pieds par defaut et rend l'option disponible
        par `**reglages` (temoin)."""
        import trimesh
        import types
        V, F, idx, _ = self._scene(4.8, True)
        cy = centres_y(V, F, 1)
        # (a) retirer_dalle_sol (trimesh)
        sortie, rapport = self.acc.retirer_dalle_sol(trimesh.Trimesh(V, F, process=False), 1)
        n_sous = int((cy < rapport['ligne_pieds']['hauteur']).sum())
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        self.assertEqual(rapport['faces_retirees'], n_sous)
        self.assertEqual(len(sortie.faces), len(F) - n_sous, 'retirer_dalle_sol a retire des faces AU-DESSUS de la ligne')
        # (b) la variante apres export
        journal = []
        scene = trimesh.Scene(trimesh.Trimesh(V, F, process=False))
        sortie, rapport = self.acc.retirer_dalle_glb(scene, True, log=journal.append)
        (g,) = sortie.geometry.values()
        self.assertEqual(len(g.faces), len(F) - n_sous, 'retirer_dalle_glb a retire des faces AU-DESSUS de la ligne')
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        self.assertNotIn('ilots', journal[0], journal)
        sortie, rapport = self.acc.retirer_dalle_glb(scene, True, log=journal.append, debris_hauteur=0.05)         # temoin : l'option passe
        (g,) = sortie.geometry.values()
        self.assertIn('ilots_detaches', rapport['criteres'])
        self.assertLess(len(g.faces), len(F) - n_sous - 100)
        self.assertIn('ilots', journal[-1])
        # (c) l'adaptateur cumesh (repere Z vers le haut, sommets float32 : la ligne se lit dans ce repere)
        Vz = np.asarray(V[:, [0, 2, 1]], np.float32)
        cz = Vz[F].astype(np.float64).mean(axis=1)[:, 2]
        mesh = FauxCuMesh(Vz, F)
        rapport = self.acc.retirer_dalle_cumesh(mesh, 2, log=journal.append)
        n_sous_z = int((cz < rapport['ligne_pieds']['hauteur']).sum())
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        self.assertEqual(len(mesh.f), len(F) - n_sous_z, 'retirer_dalle_cumesh a retire des faces AU-DESSUS de la ligne')
        mesh = FauxCuMesh(Vz, F)
        rapport = self.acc.retirer_dalle_cumesh(mesh, 2, log=journal.append, debris_hauteur=0.05)                   # temoin
        self.assertIn('ilots_detaches', rapport['criteres'])
        self.assertLess(len(mesh.f), len(F) - n_sous_z - 100)
        # (d) le crochet de CuMesh.uv_unwrap
        faux_module = types.SimpleNamespace(CuMesh=type('CuMesh', (FauxCuMesh,), {}))
        with self.acc.retrait_dalle_actif(True, log=journal.append, cumesh_module=faux_module) as rapports:
            m = faux_module.CuMesh(Vz, F)
            m.uv_unwrap()
        self.assertEqual(len(rapports), 1)
        self.assertNotIn('ilots_detaches', rapports[0]['criteres'])
        self.assertEqual(len(m.f), len(F) - n_sous_z, 'le crochet du depliage a retire des faces AU-DESSUS de la ligne')
        faux_module = types.SimpleNamespace(CuMesh=type('CuMesh', (FauxCuMesh,), {}))
        with self.acc.retrait_dalle_actif(True, log=journal.append, cumesh_module=faux_module, debris_hauteur=0.05) as rapports:   # temoin
            m = faux_module.CuMesh(Vz, F)
            m.uv_unwrap()
        self.assertIn('ilots_detaches', rapports[0]['criteres'])
        self.assertLess(len(m.f), len(F) - n_sous_z - 100)


@unittest.skipUnless(os.path.exists(GLB_SQUELETTE), "GLB du squelette a cape de la relecture absent (hors depot : variable GLB_SQUELETTE)")
class TestSqueletteReel(unittest.TestCase):
    """Le cas REEL du bloquant B1 (humanoid_26_seed68 du corpus d'entrainement : 473 044 faces, squelette a cape sur une dalle de rapport 4,41,
    pieds en coques separees) : la relecture independante y mesurait 11 ilots, 1 042 faces retirees au-dessus de la ligne, dont un os de
    777 faces, de couleur os et non rocher. Par defaut rien ne part au-dessus de la ligne ; l'option retrouve les 11 ilots (temoin)."""

    @classmethod
    def setUpClass(cls):
        cls.acc = charger_module()
        cls.V, cls.F = charger_glb_nu(GLB_SQUELETTE)

    def test_squelette_rien_au_dessus_de_la_ligne(self):
        V, F = self.V, self.F
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        self.assertTrue(rapport, 'la dalle du squelette n\'a pas ete reconnue')
        self.assertGreater(rapport['dalle']['ratio_empreinte'], 4.0)
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        self.assertNotIn('ilots', rapport)
        ligne = rapport['ligne_pieds']['hauteur']
        cy = V[F][:, :, 1].mean(axis=1)
        self.assertTrue(garder[cy > ligne].all(), '%d faces retirees AU-DESSUS de la ligne des pieds' % int(((~garder) & (cy > ligne)).sum()))
        self.assertEqual(rapport['faces_retirees'], int((cy < ligne).sum()), 'ce qui part est exactement ce qui est sous la ligne')
        # TEMOIN : l'option retrouve les ilots de la relecture (des os de pied)
        go, ro = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        retirees = (~go) & (cy > ligne)
        self.assertIn('ilots_detaches', ro['criteres'])
        self.assertGreater(int(retirees.sum()), 500, 'le temoin ne retrouve plus les ilots de la relecture (1 042 faces)')
        self.assertEqual(int(retirees.sum()), ro['ilots']['faces'])


@unittest.skipUnless(os.path.exists(GLB_MAGICIEN), "GLB du magicien de la relecture absent (hors depot : variable GLB_MAGICIEN)")
class TestMagicienReel(unittest.TestCase):
    """Le refus REEL le plus fort de la relecture independante du 18/10 : humanoid_13_seed55, un magicien a robe etalee au sol (484 344 faces),
    rapport 2,30 pour un seuil de 3,0. Il borne la MARGE du seuil cote refus (1,3 fois : le seuil n'a ete calibre que sur 2 dalles) ; la dalle
    la plus faible, le squelette de TestSqueletteReel, est a 4,41. Si un changement de seuil ou d'algorithme rapproche ce rapport de 3, ou le
    fait passer sous la garde, ce test le dit."""

    @classmethod
    def setUpClass(cls):
        cls.acc = charger_module()
        cls.V, cls.F = charger_glb_nu(GLB_MAGICIEN)

    def test_magicien_refuse_avec_une_marge_mince(self):
        diag = {}
        garder, rapport = self.acc.masque_dalle_sol(self.V, self.F, 1, diagnostic=diag)
        self.assertEqual(rapport, {}, 'le magicien a robe etalee a ete pris pour une dalle')
        self.assertTrue(garder.all())
        ratio = diag['candidats'][0]['ratio_empreinte']
        self.assertTrue(2.0 < ratio < 3.0, 'rapport %.2f : la marge de refus a change (2,30 mesure le 18/10, seuil 3,0)' % ratio)
        # ce que l'exigence du rapport lui evite : sans elle plus de 15 % de l'aire partirait
        garder0, rapport0 = self.acc.masque_dalle_sol(self.V, self.F, 1, ratio_min=0.0)
        self.assertTrue(rapport0)
        self.assertGreater(rapport0['aire_retiree_pct'], 15.0)


@unittest.skipUnless(os.path.exists(GLB_ORC), "GLB reel de l'orc absent (meshes/ n'est pas suivi par git)")
class TestOrcReel(unittest.TestCase):
    """Le GLB de l'orc (512 301 faces) : une feuille double face de 82 K faces a 8 % de la hauteur et un rocher dessous."""

    @classmethod
    def setUpClass(cls):
        import trimesh
        cls.acc = charger_module()
        sc = trimesh.load(GLB_ORC, force='scene', skip_materials=True, process=False)
        Vs, Fs, deca = [], [], 0
        for nom in sc.graph.nodes_geometry:
            T, g = sc.graph[nom]
            G = sc.geometry[g]
            Vs.append(np.asarray(G.vertices, np.float64) @ np.asarray(T)[:3, :3].T + np.asarray(T)[:3, 3])
            Fs.append(np.asarray(G.faces, np.int64) + deca)
            deca += len(G.vertices)
        cls.V, cls.F = np.concatenate(Vs), np.concatenate(Fs)

    def test_orc(self):
        if not hasattr(self.acc, 'masque_dalle_sol'):
            self.fail('masque_dalle_sol absent : ancien code')
        V, F = self.V, self.F
        t0 = time.time()
        garder, rapport = self.acc.masque_dalle_sol(V, F, 1)
        dt = time.time() - t0
        print('\n   orc : %d faces, %.2f s, %.1f %% des faces et %.1f %% de l\'aire retirees, ligne des pieds a %.1f %% de la hauteur'
              % (len(F), dt, rapport.get('faces_retirees_pct', 0), rapport.get('aire_retiree_pct', 0),
                 100 * rapport.get('ligne_pieds', {}).get('fraction', 0)))
        self.assertTrue(rapport, 'la dalle de l\'orc n\'a pas ete reconnue')
        self.assertLess(dt, 3.0)
        self.assertGreater(rapport['aire_retiree_pct'], 55.0)
        self.assertGreater(rapport['faces_retirees'], 150_000)
        self.assertIn('plan_mince', rapport['criteres'])
        self.assertIn('socle_epais', rapport['criteres'])
        self.assertGreater(rapport['dalle']['ratio_empreinte'], 5.0)
        # la figure est intacte : RIEN n'est retire au-dessus de la ligne des pieds (les ilots detaches sont une option eteinte, plus bas)
        ligne = rapport['ligne_pieds']['hauteur']
        cy = V[F][:, :, 1].mean(axis=1)
        T = float(V[:, 1].max() - V[:, 1].min())
        au_dessus = (~garder) & (cy > ligne)
        self.assertEqual(int(au_dessus.sum()), 0, 'des faces ont ete retirees AU-DESSUS de la ligne des pieds')
        self.assertNotIn('ilots_detaches', rapport['criteres'])
        self.assertNotIn('ilots', rapport)
        self.assertEqual(int((garder & (cy < ligne)).sum()), 0)
        self.assertEqual(rapport['faces_retirees'], int((cy < ligne).sum()), 'ce qui part est exactement ce qui est sous la ligne')
        # la composante PRINCIPALE du maillage garde est intacte, face par face
        Fk = np.flatnonzero(garder)
        _, comp = np.unique(self.acc._etiquettes_soudees(self.acc._souder(V, F[Fk], 1.0)), return_inverse=True)
        principale = Fk[comp == int(np.argmax(np.bincount(comp)))]
        self.assertGreater(len(principale), 250_000)
        self.assertTrue(garder[principale].all(), 'la composante principale du corps a ete entamee')
        # OPTION des ilots detaches (eteinte par defaut) : les plaques de rocher que la coupe a laissees en l'air (32 composantes,
        # 9 067 faces, 1,9 % de l'aire gardee, de 0 a 3,5 % de T au-dessus de la ligne) partent aussi, la composante principale reste
        go, ro = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        au_dessus_o = (~go) & (cy > ligne)
        self.assertEqual(int(au_dessus_o.sum()), ro['ilots']['faces'], 'des faces retirees au-dessus de la ligne ne sont pas des ilots')
        self.assertGreater(ro['ilots']['faces'], 5_000)
        self.assertLess(ro['ilots']['aire_pct'], 3.0)
        self.assertLess(float((cy[au_dessus_o].max() - ligne) / T), 0.05, 'un ilot retire monte a plus de 5 % de T au-dessus de la ligne')
        self.assertIn('ilots_detaches', ro['criteres'])
        self.assertTrue(go[principale].all(), 'la composante principale du corps a ete entamee par l\'option des ilots')
        # plus aucun ilot apres retrait : les composantes secondaires restantes ne touchent plus la coupe
        self.assertEqual(int(rapport['faces_retirees'] + ro['ilots']['faces']), ro['faces_retirees'])
        # meme hauteur de corps : le sommet de la tete n'a pas bouge
        haut_avant = V[np.unique(F)][:, 1].max()
        haut_apres = V[np.unique(F[garder])][:, 1].max()
        self.assertEqual(haut_avant, haut_apres)
        # le maillage garde reste dans une boite de figure (plus de cube de 1 x 1 : le sol etirait les boites englobantes)
        Vk = V[np.unique(F[garder])]
        etendue_xz = np.ptp(Vk[:, [0, 2]], axis=0)
        self.assertLess(float(etendue_xz.max()), 0.6)
        # plus de 50 000 faces de rocher/feuille retirees ne comptent pas comme corps : la part gardee est la figure
        self.assertGreater(int(garder.sum()), 300_000)
        # conserver_socle : seule la feuille part (un peu plus de la moitie de l'aire)
        g2, r2 = self.acc.masque_dalle_sol(V, F, 1, conserver_socle=True)
        self.assertEqual(r2['mode'], 'dalle_seule')
        self.assertTrue(54.0 < r2['aire_retiree_pct'] < 60.0, r2['aire_retiree_pct'])
        self.assertTrue(g2[(~garder)].sum() > 50_000, 'le rocher du dessous devait rester en mode conservation')

    def test_orc_incline(self):
        """L'orc tourne de 0,25 a 12 degres (constat de la relecture : 1,0 % du corps perdu a 0,25 degre, 11 % a 4 degres, plus rien
        de retire a 3 degres) : le corps garde est celui du maillage a plat, a moins de 0,05 % des faces pres, la dalle part entiere.
        Le CORPS de reference est le plat SANS ses plaques de rocher (celles que l'option des ilots reconnait : 9 067 faces de la couleur du
        rocher, mesure du 18/10) : le defaut les garde, mais une coupe penchee en entame le bas (185 faces a 14 degres), ce qui n'est pas une
        perte de corps."""
        V, F = self.V, self.F
        plat, rap_plat = self.acc.masque_dalle_sol(V, F, 1)
        corps, _ = self.acc.masque_dalle_sol(V, F, 1, **ILOTS)
        self.assertGreater(int((plat & ~corps).sum()), 5_000, 'les plaques de rocher du plat (32 ilots, 9 067 faces le 18/10) ont disparu de la reference')
        for plan, deg in (((0, 1), 0.25), ((2, 1), 0.25), ((0, 1), 3.0), ((2, 1), 3.0), ((0, 1), 5.0), ((2, 1), 8.0), ((0, 1), 12.0)):
            garder, rapport = self.acc.masque_dalle_sol(V @ _rotation(plan, deg).T, F, 1)
            etiquette = 'plan %s, %.2f degres' % (plan, deg)
            self.assertTrue(rapport, 'feuille inclinee non reconnue : ' + etiquette)
            perdu = int((corps & ~garder).sum())
            laisse = int((~plat & garder).sum())
            self.assertLess(perdu, 0.0005 * int(corps.sum()), '%s : %d faces du corps perdues' % (etiquette, perdu))
            self.assertLess(laisse, 0.001 * int((~plat).sum()), '%s : %d faces de dalle laissees' % (etiquette, laisse))
            self.assertAlmostEqual(rapport['dalle']['inclinaison_deg'], deg, delta=0.03 * deg)
        # ZONE DE TRANSITION (mesure fine du 18/10, pas de 0,5 degre) : jusqu'a 13 degres le retrait est entier ; de 13,5 a 14,5 (Z) ou 15 (X) la
        # fenetre de 2 % de la hauteur n'attrape plus toute la feuille et le retrait est PARTIEL (45 % de la dalle part, 55 % reste) ; au-dela
        # rien n'est retire. Le CORPS, lui, ne souffre jamais : moins de 0,05 % de ses faces, que le retrait soit entier, partiel ou nul.
        for plan, deg in (((0, 1), 13.0), ((0, 1), 14.0), ((2, 1), 14.0), ((2, 1), 15.0), ((0, 1), 16.0), ((2, 1), 18.0), ((0, 1), 25.0)):
            garder, rapport = self.acc.masque_dalle_sol(V @ _rotation(plan, deg).T, F, 1)
            perdu = int((corps & ~garder).sum())
            self.assertLess(perdu, 0.0005 * int(corps.sum()), 'plan %s, %.1f degres : %d faces du corps perdues' % (plan, deg, perdu))
            if deg >= 18.0:
                self.assertEqual(rapport, {}, 'plan %s, %.1f degres : au-dela de la plage de calibrage rien ne doit etre retire (conservateur)' % (plan, deg))

    def test_orc_scene_avec_materiaux(self):
        """VARIANTE APRES EXPORT sur le GLB REEL avec ses MATERIAUX (la scene que charge trimesh, 21 Mo) : positions, UV et normales de
        sommet EXPLICITES du fichier suivent les faces gardees (Scene.copy() perdrait ces normales : coutures d'UV durcies, ecart 2,0
        mesure ici), la texture est celle de l'entree, le GLB reexporte (WebP, comme la production) est nettement plus leger et une
        seconde passe ne change rien."""
        import io
        import trimesh
        acc = self.acc
        sc = trimesh.load(GLB_ORC, force='scene', process=False)
        if len(sc.geometry) != 1 or not np.allclose(np.asarray(sc.graph[sc.graph.nodes_geometry[0]][0]), np.eye(4)):
            self.skipTest("le GLB de l'orc n'a plus une geometrie unique sous une transformation neutre")
        g = list(sc.geometry.values())[0]
        v0, f0 = np.array(g.vertices), np.array(g.faces)
        n0, uv0 = np.array(g.vertex_normals), np.array(g.visual.uv)
        garder, _ = acc.masque_dalle_sol(v0, f0, 1)
        sortie, rapport = acc.retirer_dalle_sol(sc, 1)
        self.assertTrue(rapport)
        self.assertIsNot(sortie, sc)
        (gk,) = sortie.geometry.values()
        fk, vk = np.asarray(gk.faces), np.asarray(gk.vertices)
        self.assertEqual(len(fk), int(garder.sum()))
        self.assertTrue(np.array_equal(vk[fk], v0[f0[garder]]), 'les positions des faces gardees ont change')
        self.assertTrue(np.array_equal(np.asarray(gk.visual.uv)[fk], uv0[f0[garder]]), 'les UV des faces gardees ont change')
        ecart = float(np.abs(np.asarray(gk.vertex_normals)[fk] - n0[f0[garder]]).max())
        self.assertLess(ecart, 1e-6, 'les normales de sommet du fichier ont ete recalculees (ecart max %.2f)' % ecart)
        self.assertIs(gk.visual.material, g.visual.material, 'le materiau (donc la texture) devait etre PARTAGE')
        self.assertEqual(len(g.faces), len(f0), "l'entree a ete modifiee")
        # export comme la production (WebP) : nettement plus leger que l'orc entier, et la relecture redonne les memes faces
        acc.webp_rapide(sc)
        acc.webp_rapide(sortie)
        entier = len(sc.export(file_type='glb', extension_webp=True))
        coupe = sortie.export(file_type='glb', extension_webp=True)
        self.assertLess(len(coupe), 0.8 * entier, 'GLB coupe %d octets contre %d pour l\'orc entier' % (len(coupe), entier))
        relu = trimesh.load(io.BytesIO(coupe), file_type='glb', force='scene', process=False)
        self.assertEqual(sum(len(x.faces) for x in relu.geometry.values()), int(garder.sum()))
        # seconde passe : plus rien a retirer, le MEME objet
        sortie2, rapport2 = acc.retirer_dalle_sol(sortie, 1)
        self.assertEqual(rapport2, {})
        self.assertIs(sortie2, sortie)


if __name__ == '__main__':
    unittest.main()
