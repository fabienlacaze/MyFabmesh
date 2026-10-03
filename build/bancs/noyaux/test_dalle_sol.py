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
     (une seule passe par maillage, inerte hors contexte, etat remis a zero) ; avec de vrais tenseurs torch (CPU) quand
     FABMESH_TEST_TORCH=1 (importe torch : processus lourd).
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
GLB_ORC = os.path.join(RACINE, 'meshes', 'verif_t80_orc_trellis2_native_1791026496124.glb')


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


def personnage(y_pieds, ecart=0.07):
    """Bipede en T : pieds, jambes, bassin, torse, tete, bras horizontaux. Le bas des pieds est a y_pieds."""
    p = []
    for s in (-1, 1):
        p.append(('pied%d' % s, *ellipsoide((s * ecart, y_pieds + 0.025, 0.03), (0.04, 0.025, 0.07))))
        p.append(('jambe%d' % s, *ellipsoide((s * ecart, y_pieds + 0.21, 0.0), (0.035, 0.18, 0.035))))
        p.append(('bras%d' % s, *ellipsoide((s * 0.24, y_pieds + 0.58, 0.0), (0.16, 0.025, 0.025))))
    p.append(('bassin', *ellipsoide((0, y_pieds + 0.40, 0), (0.10, 0.06, 0.06))))
    p.append(('torse', *ellipsoide((0, y_pieds + 0.55, 0), (0.10, 0.15, 0.065))))
    p.append(('tete', *ellipsoide((0, y_pieds + 0.76, 0), (0.05, 0.065, 0.05))))
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


def scene_figure_sur_feuille(**kw):
    Vp, Fp, ip = personnage(PIEDS)
    Vf, Ff = feuille(Y_FEUILLE, **kw)
    V, F, idx = fusionner(('figure', Vp, Fp), ('feuille', Vf, Ff))
    return V, F, idx


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
        V, F, idx = scene_figure_sur_feuille()
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
        V, F, idx = scene_figure_sur_feuille()
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


class TestAdaptateurCuMesh(unittest.TestCase):
    def setUp(self):
        self.acc = charger_module()
        if not hasattr(self.acc, 'retirer_dalle_cumesh'):
            self.fail('retirer_dalle_cumesh absent : ancien code')

    def test_retire_et_reinitialise(self):
        V, F, idx = scene_figure_sur_feuille()
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
        V, F, idx = scene_figure_sur_feuille()
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
        V, F, idx = scene_figure_sur_feuille()

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
        # la figure est intacte : rien n'est retire au-dessus de la ligne des pieds
        ligne = rapport['ligne_pieds']['hauteur']
        cy = V[F][:, :, 1].mean(axis=1)
        self.assertEqual(int(((~garder) & (cy > ligne)).sum()), 0, 'des faces du corps ont ete retirees')
        self.assertEqual(int((garder & (cy < ligne)).sum()), 0)
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


if __name__ == '__main__':
    unittest.main()
