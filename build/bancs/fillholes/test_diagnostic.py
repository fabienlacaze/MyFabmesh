# -*- coding: utf-8 -*-
"""Tests du banc de diagnostic de matiere sur des maillages SYNTHETIQUES dont la verite est connue (20/10/2026).

Lancer avec l'interpreteur de l'appli :   python build/bancs/fillholes/test_diagnostic.py
Chaque cas fabrique un GLB (sans texture), l'analyse a petite resolution et verifie la categorie attendue ; un detecteur
qui se tromperait de categorie (par exemple compter une couture d'UV comme un trou, ou ne pas voir une peau retournee)
fait echouer le cas correspondant.
"""
import os
import sys
import tempfile
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import trimesh  # noqa: E402
from diagnostic_matiere import analyser, decompresser_ids  # noqa: E402
from glb_lecture import Glb, ecrire_glb, fusionner  # noqa: E402
from rasteur import Camera, rasteriser_triangles  # noqa: E402
from structures import Rayons  # noqa: E402

S = 256


def sphere(sub=4, r=1.0):
    m = trimesh.creation.icosphere(subdivisions=sub, radius=r)
    return np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)


def centres(V, F):
    return V[F].mean(1)


def analyser_synth(V, F, nom, structures=False, vues='cube26'):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, nom + '.glb')
        ecrire_glb(p, V, F)
        res, zones = analyser(p, nom, S=S, vues=vues, structures=structures, texture=False, journal=lambda *a: None)
    return res, zones


def plaque_mince_trouee(n=40, epaisseur=0.01, trou=0.33):
    """Plaque carree [-1, 1]^2 FERMEE et mince : deux nappes (z = +e et z = -e) qui se rejoignent, par des sommets partages, sur
    le pourtour exterieur ET sur le pourtour d'un trou carre traversant. Aucune arete de bord : le trou a une levre fermee
    (pli a ~160-180 degres). Rend (V, F, aire_du_trou_en_fraction_de_la_plaque)."""
    xs = np.linspace(-1, 1, n + 1)
    idx = -np.ones((n + 1, n + 1), np.int64)
    k = 0
    pts = []
    for i in range(n + 1):
        for j in range(n + 1):
            if abs(xs[i]) < trou and abs(xs[j]) < trou:
                continue
            idx[i, j] = k
            pts.append((xs[i], xs[j]))
            k += 1
    tri = []
    for i in range(n):
        for j in range(n):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (xs[j] + xs[j + 1]) / 2
            if abs(cx) < trou and abs(cy) < trou:
                continue
            a, b, c, d = idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]
            tri += [(a, b, c), (a, c, d)]
    tri = np.array(tri)
    pts = np.array(pts)
    # sommets de pourtour (utilises par une arete de bord de la nappe)
    from collections import Counter
    cnt = Counter()
    for t in tri:
        for u, v in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            cnt[(min(u, v), max(u, v))] += 1
    bord = set()
    for (u, v), c_ in cnt.items():
        if c_ == 1:
            bord.update((u, v))
    nv = len(pts)
    haut = np.concatenate([pts, np.full((nv, 1), epaisseur)], 1)
    bas = np.concatenate([pts, np.full((nv, 1), -epaisseur)], 1)
    for v in bord:
        haut[v, 2] = 0.0
        bas[v, 2] = 0.0
    V = np.concatenate([haut, bas])
    ident = np.arange(2 * nv)
    for v in bord:
        ident[nv + v] = v                       # le sommet de pourtour du bas est celui du haut : levre fermee
    F_haut = tri
    F_bas = ident[tri[:, [0, 2, 1]] + nv]       # nappe du bas retournee (normale -z)
    F = np.concatenate([F_haut, F_bas])
    h_eff = float(min(abs(x) for x in xs if abs(x) >= trou))      # demi-largeur reelle du trou (la grille est discrete)
    return V, F, (2 * h_eff) ** 2 / 4.0


def cat_pct(res, nom):
    return res['carte_zones'][nom]['pct_des_arriere']


class TestDiagnostic(unittest.TestCase):
    def test_sphere_fermee_ne_montre_aucun_arriere(self):
        V, F = sphere()
        res, _ = analyser_synth(V, F, 'sphere_fermee')
        self.assertEqual(res['topologie']['boucles']['n'], 0)
        self.assertEqual(res['topologie']['aretes_bord_soudees'], 0)
        self.assertLess(res['visibilite']['arriere_pct_global'], 0.05)

    def test_calotte_enlevee_est_une_boucle_de_bord_visible(self):
        V, F = sphere()
        garde = (centres(V, F) @ np.array([0.0, 0.0, 1.0])) < 0.8
        res, zones = analyser_synth(V, F[garde], 'sphere_percee')
        self.assertEqual(res['topologie']['boucles']['n'], 1)
        self.assertGreater(res['visibilite']['arriere_pct_global'], 1.0)
        # la quasi-totalite de ce qu'on voit a l'envers s'explique par la boucle de bord : Fill holes la verrait
        self.assertGreater(cat_pct(res, 'bord'), 90.0)
        # a faces simples (visionneuse de l'appli) c'est un VRAI trou : on voit le vide ou le mur du fond
        self.assertGreater(res['visibilite']['trou_visuel_pct_global'], 1.0)
        self.assertEqual(len(zones['bord']), 1)
        self.assertGreater(zones['bord'][0]['pixels_arriere_expliques'], 0)

    def test_coutures_uv_ne_sont_pas_des_trous(self):
        V, F = sphere(3)
        c = centres(V, F)
        cote = c[:, 0] > 0
        # dedouble tous les sommets utilises par les faces du cote x > 0 : couture d'UV le long du plan x = 0
        usage = np.unique(F[cote])
        nouveau = {int(v): len(V) + i for i, v in enumerate(usage)}
        # les sommets dedoubles different d'un bruit de 1e-6 (soit 5e-7 de la diagonale) : deux sommets « confondus » d'un GLB
        # ne le sont presque jamais au bit pres, et une soudure par arrondi sur grille les couperait au hasard
        bruit = np.random.default_rng(3).normal(scale=1e-6, size=(len(usage), 3))
        V2 = np.concatenate([V, V[usage] + bruit])
        F2 = F.copy()
        F2[cote] = np.vectorize(lambda x: nouveau[int(x)])(F[cote])
        res, _ = analyser_synth(V2, F2, 'sphere_coutures')
        self.assertGreater(res['topologie']['aretes_bord_brutes'], 20)
        self.assertEqual(res['topologie']['aretes_bord_soudees'], 0)
        self.assertEqual(res['topologie']['boucles']['n'], 0)
        self.assertLess(res['visibilite']['arriere_pct_global'], 0.05)

    def test_patch_retourne_n_est_pas_un_trou_mais_se_voit_a_l_envers(self):
        V, F = sphere()
        F2 = F.copy()
        retour = (centres(V, F) @ np.array([0.0, 0.0, 1.0])) > 0.75
        F2[retour] = F2[retour][:, [0, 2, 1]]
        res, zones = analyser_synth(V, F2, 'sphere_patch_retourne')
        self.assertEqual(res['topologie']['aretes_bord_soudees'], 0)
        self.assertEqual(res['topologie']['boucles']['n'], 0)
        self.assertGreater(res['topologie']['orientation']['aretes_incoherentes_W'], 10)
        self.assertGreater(res['visibilite']['arriere_pct_global'], 1.0)
        self.assertEqual(cat_pct(res, 'bord'), 0.0)
        self.assertGreater(cat_pct(res, 'retourne'), 90.0)
        # un patch retourne isole sur une sphere : derriere lui, rien de vu par devant -> trou visuel franc
        self.assertGreater(res['visibilite']['trou_visuel_pct_global'], 0.5)
        self.assertGreater(len(zones['faces']), 0)
        ids = decompresser_ids(zones['faces'][0]['faces_b64'])
        self.assertTrue(retour[ids].mean() > 0.95)

    def test_peau_externe_retournee_collee_a_une_peau_interne(self):
        Vo, Fo = sphere(3, 1.0)
        Vi, Fi = sphere(3, 0.998)
        Fo = Fo[:, [0, 2, 1]]            # nappe externe a l'envers
        V = np.concatenate([Vo, Vi])
        F = np.concatenate([Fo, Fi + len(Vo)])
        res, _ = analyser_synth(V, F, 'double_peau_inversee')
        self.assertEqual(res['topologie']['boucles']['n'], 0)
        self.assertGreater(res['visibilite']['arriere_pct_global'], 90.0)
        # la cause primaire est une coque FERMEE a l'envers (volume signe negatif) ; la structure, c'est une double peau :
        # les deux se lisent (classement exclusif par priorite, indicateurs non exclusifs a cote)
        self.assertEqual(res['topologie']['orientation']['composantes_fermees_inversees'], 1)
        self.assertGreater(cat_pct(res, 'retourne'), 90.0)
        self.assertGreater(res['carte_zones']['non_exclusif']['pixels_sur_face_double_peau_pct'], 90.0)
        self.assertEqual(cat_pct(res, 'bord'), 0.0)
        # la nappe interne est vue par devant juste derriere : a faces simples, aucun trou visible
        self.assertLess(res['visibilite']['trou_visuel_pct_global'], 0.5)

    def test_nappe_externe_ouverte_retournee_sur_une_calotte_est_double_peau(self):
        # coque externe saine mais une calotte retournee, doublee d'une coque interne saine a 0,2 % : on voit la calotte a
        # l'envers (arriere) mais l'autre nappe juste derriere : double peau, pas un trou
        Vo, Fo = sphere(4, 1.0)
        Vi, Fi = sphere(4, 0.998)
        calotte = (centres(Vo, Fo) @ np.array([0.0, 0.0, 1.0])) > 0.7
        Fo2 = Fo.copy()
        Fo2[calotte] = Fo2[calotte][:, [0, 2, 1]]
        V = np.concatenate([Vo, Vi])
        F = np.concatenate([Fo2, Fi + len(Vo)])
        res, _ = analyser_synth(V, F, 'calotte_double')
        self.assertEqual(res['topologie']['boucles']['n'], 0)
        self.assertGreater(res['visibilite']['arriere_pct_global'], 1.0)
        self.assertLess(res['visibilite']['trou_visuel_pct_global'], 0.5)
        self.assertGreater(res['carte_zones']['non_exclusif']['pixels_sur_face_double_peau_pct'], 80.0)

    def test_texture_noire_visible_est_mesuree(self):
        import io as _io
        from PIL import Image
        V, F = sphere(3)
        UV = np.stack([(V[:, 0] + 1) / 2, (V[:, 1] + 1) / 2], 1)
        mesures = {}
        for nom, coul in (('noire', (0, 0, 0)), ('claire', (200, 180, 160))):
            b = _io.BytesIO()
            Image.new('RGB', (16, 16), coul).save(b, 'PNG')
            with tempfile.TemporaryDirectory() as d:
                p = os.path.join(d, nom + '.glb')
                ecrire_glb(p, V, F, UV, b.getvalue())
                res, _ = analyser(p, nom, S=S, vues='cube26', structures=False, texture=True, journal=lambda *a: None)
            mesures[nom] = res['visibilite']['texture_noire_visible_pct_global']
        self.assertGreater(mesures['noire'], 90.0)
        self.assertLess(mesures['claire'], 1.0)

    def _reference(self, zones, cle='reference_visuel'):
        import json
        from rappel import charger_reference
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'z.json')
            json.dump(zones, open(p, 'w'))
            return charger_reference(p, cle)

    def test_rappel_trou_de_bord_la_reference_est_le_pourtour_pas_le_mur_du_fond(self):
        from rappel import evaluer
        V, F = sphere()
        garde = (centres(V, F) @ np.array([0.0, 0.0, 1.0])) < 0.8
        F2 = F[garde]
        res, zones = analyser_synth(V, F2, 'rappel_bord')
        ref = self._reference(zones)
        self.assertGreater(len(ref['ids']), 3)
        self.assertIn('bord', ref['par_categorie'])
        c = centres(V, F2)[ref['par_categorie']['bord']]
        # les faces de reference sont celles qui bordent l'ouverture (z ~ 0.8), pas le mur du fond (z < 0)
        self.assertGreater(c[:, 2].min(), 0.6)
        # un detecteur de boucles de bord qui rend le pourtour a un rappel de 1
        r = evaluer(ref, ref['par_categorie']['bord'])
        self.assertAlmostEqual(r['rappel_faces'], 1.0)
        self.assertAlmostEqual(r['rappel_pixels'], 1.0, places=6)
        # un detecteur qui ne rend rien : 0
        self.assertEqual(evaluer(ref, [])['rappel_faces'], 0.0)
        # un detecteur qui rend tout : rappel 1 mais precision faible
        tout = evaluer(ref, np.arange(len(F2)))
        self.assertAlmostEqual(tout['rappel_faces'], 1.0)
        self.assertLess(tout['precision_faces'], 0.2)
        # un detecteur qui rend le MUR DU FOND (la face vue par derriere) rate la reference
        fond = np.nonzero(centres(V, F2)[:, 2] < -0.5)[0]
        self.assertLess(evaluer(ref, fond)['rappel_faces'], 0.05)

    def test_rappel_patch_retourne_la_reference_est_le_patch(self):
        from rappel import evaluer
        V, F = sphere()
        F2 = F.copy()
        retour = (centres(V, F) @ np.array([0.0, 0.0, 1.0])) > 0.75
        F2[retour] = F2[retour][:, [0, 2, 1]]
        res, zones = analyser_synth(V, F2, 'rappel_retourne')
        ref = self._reference(zones)
        self.assertIn('retourne', ref['par_categorie'])
        self.assertTrue(retour[ref['par_categorie']['retourne']].mean() > 0.95)
        self.assertGreater(evaluer(ref, np.nonzero(retour)[0])['rappel_pixels'], 0.95)
        # la detection des boucles de bord (aucune ici) ne voit rien
        self.assertEqual(evaluer(ref, [])['rappel_faces'], 0.0)

    def test_sensibilite_du_seuil_d_ecart(self):
        # deux nappes a 0,2 % l'une de l'autre, l'externe retournee : un trou visuel si le seuil est serre (0,1 %),
        # aucun si on tolere 2 %
        Vo, Fo = sphere(3, 1.0)
        Vi, Fi = sphere(3, 0.985)
        Fo = Fo[:, [0, 2, 1]]
        V = np.concatenate([Vo, Vi])
        F = np.concatenate([Fo, Fi + len(Vo)])
        res, _ = analyser_synth(V, F, 'ecart_seuils')
        t = res['visibilite']['trou_visuel_pct_par_seuil_ecart']
        self.assertGreater(t['0.002'], 50.0)
        self.assertLess(t['0.02'], 1.0)
        self.assertGreaterEqual(t['0.002'], t['0.005'])
        self.assertGreaterEqual(t['0.005'], t['0.01'])
        self.assertGreaterEqual(t['0.01'], t['0.02'])

    def test_faces_a_arete_non_manifold_sont_reperees(self):
        from diagnostic_matiere import mesurer_topologie
        # trois feuillets autour de l'arete (0, 1) + un triangle isole ailleurs
        V = np.array([[0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, -1, 0], [0.5, 0, 1],
                      [5, 5, 5], [6, 5, 5], [5.5, 6, 5]], float)
        F = np.array([[0, 1, 2], [1, 0, 3], [0, 1, 4], [5, 6, 7]])
        res, it = mesurer_topologie(V, F, 12.0, 4.0)
        self.assertEqual(res['aretes_non_manifold'], 1)
        self.assertEqual(it['nm_face'].tolist(), [True, True, True, False])

    def test_versions_liste_les_resultats_perimes(self):
        import json
        import subprocess
        from diagnostic_matiere import VERSION_OUTIL
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, 'resultats'))
            for nom, v in (('a', VERSION_OUTIL), ('b', VERSION_OUTIL - 1)):
                json.dump({'version_outil': v}, open(os.path.join(d, 'resultats', nom + '.json'), 'w'))
            corpus = os.path.join(d, 'c.json')
            json.dump({'maillages': [{'nom': 'a'}, {'nom': 'b'}, {'nom': 'c'}]}, open(corpus, 'w'))
            out = subprocess.run([sys.executable, '-I', os.path.join(ICI, 'versions.py'), d, corpus], capture_output=True, text=True).stdout.split()
        self.assertEqual(out, ['b', 'c'])

    def test_produit_fill_holes_est_lance_et_rapporte_son_verdict(self):
        import json
        import subprocess
        V, F = sphere(3)
        sans_face = F[1:]                 # un vrai trou de 3 aretes
        with tempfile.TemporaryDirectory() as d:
            ent = os.path.join(d, 'trou.glb')
            sor = os.path.join(d, 'apres.glb')
            ecrire_glb(ent, V, sans_face)
            r = subprocess.run([sys.executable, '-I', '-X', 'utf8', '-W', 'ignore', os.path.join(ICI, 'produit_fill_holes.py'), ent,
                                '--sortie', sor], capture_output=True, text=True, timeout=300)
            self.assertEqual(r.returncode, 0, r.stderr[-500:])
            out = json.loads(r.stdout.strip().splitlines()[-1])
            self.assertEqual(out['faces_avant'], len(sans_face))
            self.assertEqual(out['resultat'], 'ok')
            self.assertEqual(out['faces_ajoutees'], 1)          # le trou d'un triangle est bouche
            self.assertTrue(os.path.exists(sor))
            # un maillage ferme : le produit refuse (refus explique du noyau bouchage_trous, 21/10), c'est le message qu'on rapporte
            ferme = os.path.join(d, 'ferme.glb')
            ecrire_glb(ferme, V, F)
            r2 = subprocess.run([sys.executable, '-I', '-X', 'utf8', '-W', 'ignore', os.path.join(ICI, 'produit_fill_holes.py'), ferme],
                                capture_output=True, text=True, timeout=300)
            out2 = json.loads(r2.stdout.strip().splitlines()[-1])
            self.assertEqual(out2['resultat'], 'refus')
            self.assertIn('Nothing to fill', out2['message'])

    def test_trou_traversant_a_levre_fermee_est_une_fenetre_sans_bord(self):
        from rappel import evaluer
        V, F, part_trou = plaque_mince_trouee()
        res, zones = analyser_synth(V, F, 'plaque_trouee')
        # aucune arete de bord : Fill holes ne verrait RIEN
        self.assertEqual(res['topologie']['aretes_bord_soudees'], 0)
        self.assertEqual(res['topologie']['boucles']['n'], 0)
        # ... mais le pourtour est un pli a ~180 degres, en deux composantes (exterieur et trou)
        self.assertGreaterEqual(res['topologie']['plis_levres']['composantes'], 2)
        # et le fond se voit a travers : la fenetre vaut ~ la part du trou dans la silhouette, vue de face
        fen = res['fenetres']
        self.assertGreater(fen['pct_max_vue'], 0.6 * 100 * part_trou)
        self.assertGreater(fen['part_bordee_par_pli_pct'], 90.0)
        ref = self._reference(zones, 'reference_fenetres')
        self.assertGreater(len(ref['ids']), 20)
        # un detecteur qui rend les faces des plis a 180 degres retrouve la reference ; celui des boucles de bord (rien) : 0
        self.assertAlmostEqual(evaluer(ref, ref['ids'])['rappel_faces'], 1.0)
        self.assertEqual(evaluer(ref, [])['rappel_faces'], 0.0)

    def test_fenetre_d_un_cadre_epais_n_est_pas_bordee_par_un_pli(self):
        # quatre poutres fermees formant un cadre : le jour au milieu est une fenetre, mais son pourtour est fait d'angles a
        # 90 degres (poutres epaisses), pas de plis a 180 degres : fenetre SANS levre
        pieces = [((2.0, 0.4, 0.4), (0, 0.8, 0)), ((2.0, 0.4, 0.4), (0, -0.8, 0)),
                  ((0.4, 2.0, 0.4), (0.8, 0, 0)), ((0.4, 2.0, 0.4), (-0.8, 0, 0))]
        Vs, Fs, dec = [], [], 0
        for ext, pos in pieces:
            b_ = trimesh.creation.box(extents=ext)
            Vs.append(np.asarray(b_.vertices) + np.array(pos))
            Fs.append(np.asarray(b_.faces) + dec)
            dec += len(b_.vertices)
        res, zones = analyser_synth(np.concatenate(Vs), np.concatenate(Fs), 'cadre_epais')
        self.assertGreater(res['fenetres']['pct_max_vue'], 5.0)
        self.assertLess(res['fenetres']['part_bordee_par_pli_pct'], 10.0)
        # la reference de rappel porte quand meme les faces du POURTOUR de la fenetre, rangees « sans pli »
        ref = self._reference(zones, 'reference_fenetres')
        self.assertGreater(len(ref['ids']), 10)
        self.assertIn('sans_pli', ref['par_categorie'])
        self.assertNotIn('avec_pli', ref['par_categorie'])
        n_faces = sum(len(f) for f in Fs)
        self.assertLess(len(ref['ids']), n_faces)          # le pourtour, pas tout le maillage

    def test_fenetre_a_levre_demande_un_pli_sur_la_moitie_du_pourtour(self):
        from rasteur import Camera
        from visibilite import Contexte, _fenetres
        S_ = 200
        cam = Camera([0, 0, 0], 1.0, [0, 0, -1], S_, marge=1.0)
        couv = np.ones((S_, S_), bool)
        couv[70:130, 70:130] = False                         # fenetre carree de 60 px, cernee de maillage
        zfirst = np.zeros(S_ * S_)
        h = 0.3
        cotes = [((-h, -h, 0), (h, -h, 0)), ((h, -h, 0), (h, h, 0)), ((h, h, 0), (-h, h, 0)), ((-h, h, 0), (-h, -h, 0))]

        def stats(nb_cotes):
            A = np.array([c[0] for c in cotes[:nb_cotes]], float)
            B = np.array([c[1] for c in cotes[:nb_cotes]], float)
            ctx = Contexte(np.zeros((3, 3)), np.array([[0, 1, 2]]), np.zeros(3), 1.0, 1.0, None, None, None,
                           A, B, np.zeros(nb_cotes, np.int32))
            out, _ = _fenetres(ctx, cam, couv, zfirst, S_)
            return out
        self.assertEqual(stats(0)['fen_px_lip'], 0)         # pas de pli du tout
        self.assertEqual(stats(1)['fen_px_lip'], 0)         # un cote sur quatre : un pli passe pres de la fenetre, ce n'est pas sa levre
        self.assertGreater(stats(3)['fen_px_lip'], 0)       # trois cotes sur quatre : levre
        self.assertEqual(stats(4)['fen_px_lip'], stats(4)['fen_px'])

    def test_un_triangle_geant_ne_fait_pas_exploser_la_recherche_de_voisines(self):
        # un eventail de comblement produit des triangles aussi grands que l'objet : le rayon de recherche des faces jumelles
        # doit rester plafonne (5 % de la diagonale), sinon chaque face « voit » tout le maillage (ca a fait expirer une mesure)
        from scipy.spatial import cKDTree
        from diagnostic_matiere import evaluer_proximite_remap
        V, F = sphere(3)
        V = np.concatenate([V, [[5.0, 5.0, 5.0], [-5.0, 5.0, 5.0], [0.0, -5.0, 5.0]]])
        F = np.concatenate([F, [[len(V) - 3, len(V) - 2, len(V) - 1]]])
        C = V[F].mean(1)
        n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        aire = 0.5 * np.linalg.norm(n, axis=1)
        un = n / np.linalg.norm(n, axis=1)[:, None]
        diag = float(np.linalg.norm(V.max(0) - V.min(0)))

        class Arbre:
            def __init__(self, t):
                self.t, self.rmax = t, 0.0

            def query_ball_point(self, x, r):
                self.rmax = max(self.rmax, float(np.max(r)))
                return self.t.query_ball_point(x, r)
        arbre = Arbre(cKDTree(C))
        evaluer_proximite_remap(np.array([len(F) - 1, 0, 1]), C, un, aire, F, diag, arbre, np.arange(len(F)))
        self.assertLessEqual(arbre.rmax, 0.05 * diag + 1e-9)

    def test_sphere_fermee_n_a_pas_de_fenetre(self):
        V, F = sphere()
        res, zones = analyser_synth(V, F, 'sphere_sans_fenetre')
        self.assertLess(res['fenetres']['pct_global'], 0.01)
        self.assertEqual(zones['reference_fenetres']['n_faces'], 0)

    def test_feuille_ouverte_vue_de_dos_montre_son_bord(self):
        n = 64
        t = np.linspace(0, 2 * np.pi, n, endpoint=False)
        V = np.concatenate([[[0, 0, 0]], np.stack([np.cos(t), np.sin(t), 0 * t], 1)])
        F = np.array([[0, 1 + i, 1 + (i + 1) % n] for i in range(n)])
        # disque dans le plan z = 0, normale +z ; epaissi pour avoir un volume de vue non plat
        res, _ = analyser_synth(V, F, 'disque_ouvert')
        self.assertEqual(res['topologie']['boucles']['n'], 1)
        self.assertGreater(res['visibilite']['arriere_pct_global'], 20.0)
        self.assertGreater(cat_pct(res, 'bord'), 90.0)

    def test_rasteriseur_aire(self):
        V, F = sphere(4)
        cam = Camera([0, 0, 0], 1.0, [0, 0, -1], 512)
        px, py, z = cam.projeter(V)
        n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        av = (n @ cam.d) < 0
        zb, ib = rasteriser_triangles(px[F[av]], py[F[av]], z[F[av]], np.nonzero(av)[0].astype(np.int32), 512)
        attendu = np.pi * (512 / 2 / 1.04) ** 2
        self.assertLess(abs(np.isfinite(zb).sum() - attendu) / attendu, 0.01)

    def test_balayage_des_grands_triangles_donne_les_memes_pixels_que_la_voie_des_echantillons(self):
        import rasteur
        rng = np.random.default_rng(0)
        S_ = 128
        n = 400
        X = rng.uniform(-30, S_ + 30, (n, 3))
        Y = rng.uniform(-30, S_ + 30, (n, 3))
        Z = rng.uniform(0, 1, (n, 3))
        # + lamelles d'eventail : aussi longues que l'image, tres fines
        c = np.array([S_ / 2, S_ / 2])
        ang = np.linspace(0, 2 * np.pi, 120, endpoint=False)
        Xf = np.stack([np.full(120, c[0]), c[0] + 400 * np.cos(ang), c[0] + 400 * np.cos(ang + 0.03)], 1)
        Yf = np.stack([np.full(120, c[1]), c[1] + 400 * np.sin(ang), c[1] + 400 * np.sin(ang + 0.03)], 1)
        X, Y = np.concatenate([X, Xf]), np.concatenate([Y, Yf])
        Z = np.concatenate([Z, rng.uniform(0, 1, (120, 3))])
        ids = np.arange(len(X), dtype=np.int32)
        avant = rasteur.SEUIL_GRAND
        try:
            rasteur.SEUIL_GRAND = 10 ** 12
            z0, i0 = rasteur.rasteriser_triangles(X, Y, Z, ids, S_)
            rasteur.SEUIL_GRAND = 1
            z1, i1 = rasteur.rasteriser_triangles(X, Y, Z, ids, S_)
        finally:
            rasteur.SEUIL_GRAND = avant
        self.assertTrue(np.array_equal(np.isfinite(z0), np.isfinite(z1)))
        m = np.isfinite(z0)
        self.assertLess(float(np.abs(z0[m] - z1[m]).max()), 1e-5)
        self.assertTrue(np.array_equal(i0[m], i1[m]))

    def test_rayons_contre_force_brute(self):
        V, F = sphere(3)
        r = Rayons(V, F)
        rng = np.random.default_rng(1)
        for _ in range(20):
            o = rng.normal(size=3) * 3
            d = -o / np.linalg.norm(o) + rng.normal(size=3) * 0.1
            d /= np.linalg.norm(d)
            t, f = r.plus_proche(o, d)
            # force brute : Moller-Trumbore sur tous les triangles
            v0, e1, e2 = V[F[:, 0]], V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]
            p = np.cross(d, e2)
            det = (e1 * p).sum(1)
            ok = np.abs(det) > 1e-14
            idet = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
            tv = o - v0
            u = (tv * p).sum(1) * idet
            q = np.cross(tv, e1)
            v = (q * d).sum(1) * idet
            tt = (e2 * q).sum(1) * idet
            valide = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (tt > 1e-9)
            if valide.any():
                self.assertAlmostEqual(t, float(tt[valide].min()), places=6)
            else:
                self.assertTrue(np.isinf(t))

    def test_lecture_glb_aller_retour(self):
        V, F = sphere(2)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'x.glb')
            ecrire_glb(p, V, F)
            V2, F2, _, _, _ = fusionner(Glb(p).primitives())
        self.assertEqual(len(V2), len(V))
        self.assertTrue(np.array_equal(F2, F))
        self.assertLess(np.abs(V2 - V).max(), 1e-6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
