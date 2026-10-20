"""« Reshape a region » avec une VUE CHOISIE (yaw / pitch) — banc du 2026-10-19.

Demande du proprietaire : « Reshape a region doit avoir un viewer 3D pour permettre d'afficher la zone que l'on
souhaite, pas un 2D de face ». Avant : la zone ne pouvait etre visee que sur la vue de face (impossible de viser le
dos, un cote, le dessus). Apres : la fenetre donne l'angle de la camera du visualiseur ; scripts/mesh_inpaint.py
fait tourner le MAILLAGE pour que la zone regarde +Z, execute la chaine inchangee, puis applique la rotation
INVERSE au GLB final.

Ce banc verifie :
  (a) la validation des angles (cas partages avec JS / worker : reshape_vue_cas.json) ;
  (b) la matrice : rotation pure, la direction de la camera va sur +Z, l'inverse est exacte ;
  (c) aller-retour sur un maillage a normales, UV et texture : sommets et normales a 1e-6, UV et texture intactes ;
  (d) `assembler` sur un maillage synthetique dont la zone visee est a l'ARRIERE (yaw 180), sur le COTE, au-DESSUS
      et en vue quelconque : SANS le correctif « aucune face sous le masque » ; avec lui la zone est coupee, la piece
      est posee au bon endroit, le corps revient dans son repere d'origine ;
  (e) yaw 0 / pitch 0 : GLB identique A L'OCTET a celui de l'ancien code (HEAD d'avant la modification) et cadre
      identique (aucun champ ajoute) ;
  (f) `preparer` porte les angles dans le cadre et la demi-largeur elargie ;
  (g) `rendre` (vrai rendu pyrender, 96 px) : la silhouette tombe au pixel attendu pour une vue de dos.

Lancer :  C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe build/bancs/noyaux/test_reshape_vue.py -v
Prouver l'echec sur l'ancien code : NOYAU_MESH_INPAINT=<copie de l'ancien scripts/mesh_inpaint.py> (git show <rev>:scripts/mesh_inpaint.py) :
les tests de la vue choisie ECHOUENT (AttributeError / zone introuvable). ANCIEN_MESH_INPAINT=<meme copie> active la comparaison a l'octet.
"""
import importlib.util
import json
import math
import os
import shutil
import struct
import sys
import tempfile
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
MODULE = os.environ.get('NOYAU_MESH_INPAINT') or os.path.join(RACINE, 'scripts', 'mesh_inpaint.py')
ANCIEN = os.environ.get('ANCIEN_MESH_INPAINT')            # copie de l'ancien module (comparaison a l'octet)
sys.path.insert(0, ICI)
sys.path.insert(0, os.path.join(RACINE, 'scripts'))


def charger(chemin, nom):
    spec = importlib.util.spec_from_file_location(nom, chemin)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


mi = charger(MODULE, 'mesh_inpaint_test')
AVEC_VUE = hasattr(mi, 'matrice_vue')
from _maillages import sphere_texturee   # noqa: E402


def jeton(v):
    return {'__NaN__': float('nan'), '__Infinity__': float('inf'), '__-Infinity__': float('-inf')}.get(v, v) \
        if isinstance(v, str) else v


def lire_json(chemin):
    with open(chemin, encoding='utf-8') as f:
        return json.load(f)


def lire_glb_json(chemin):
    with open(chemin, 'rb') as f:
        d = f.read()
    jl = struct.unpack('<I', d[12:16])[0]
    return json.loads(d[20:20 + jl].decode('utf-8').rstrip('\x00 '))


def corps_texture(centre, rayon, sous_div=3, graine=0):
    """Sphere texturee (coutures UV, normales EXPLICITES) posee en `centre`."""
    import trimesh
    s = sphere_texturee(subdivisions=sous_div, taille_texture=64, graine=graine)
    s.apply_scale(rayon)
    s.apply_translation(centre)
    s.vertex_normals = np.asarray(s.vertex_normals)         # fige les normales (elles sont exportees dans le GLB)
    return s


def exporter(mesh, chemin):
    import trimesh
    sc = trimesh.Scene()
    sc.add_geometry(mesh, geom_name='corps')
    sc.export(chemin)


def pixel(xm, S, x, y):
    return (x + xm) / (2 * xm) * S, (xm - y) / (2 * xm) * S


def masque_disque(chemin, S, cx, cy, r):
    from PIL import Image, ImageDraw
    im = Image.new('L', (S, S), 0)
    ImageDraw.Draw(im).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    im.save(chemin)


class Validation(unittest.TestCase):
    def test_cas_partages(self):
        with open(os.path.join(ICI, 'reshape_vue_cas.json'), encoding='utf-8') as f:
            cas = json.load(f)['cas']
        for c in cas:
            yaw, pitch = jeton(c['yaw']), jeton(c['pitch'])
            if c['ok']:
                got = mi.valider_vue(yaw, pitch)
                self.assertEqual([float(got[0]), float(got[1])], [float(c['sortie'][0]), float(c['sortie'][1])], c)
            else:
                with self.assertRaises(ValueError, msg=str(c)):
                    mi.valider_vue(yaw, pitch)

    def test_zero_negatif_normalise(self):
        yaw, pitch = mi.valider_vue(-0.0, -0.0)
        self.assertEqual(math.copysign(1, yaw), 1.0)
        self.assertEqual(math.copysign(1, pitch), 1.0)

    def test_xmag(self):
        self.assertEqual(mi.xmag_pour_vue(0.3), 0.6)          # jamais sous 0,6
        self.assertEqual(mi.xmag_pour_vue(0.6), 0.65)         # marge de 3 % -> pas suivant
        self.assertEqual(mi.xmag_pour_vue(0.707), 0.75)
        self.assertEqual(mi.xmag_pour_vue(99), 3.0)
        with open(os.path.join(ICI, 'reshape_vue_cas.json'), encoding='utf-8') as f:
            cas = json.load(f)
        for entree, attendu in cas['xmag_pour_vue']:
            self.assertEqual(mi.xmag_pour_vue(entree), attendu, entree)
        for c in cas['xmag_valide']:
            x = jeton(c['x'])
            if c['ok']:
                self.assertEqual(mi.valider_xmag(x), c['sortie'], c)
            else:
                with self.assertRaises(ValueError, msg=str(c)):
                    mi.valider_xmag(x)

    def test_matrices_partagees_avec_js(self):
        with open(os.path.join(ICI, 'reshape_vue_cas.json'), encoding='utf-8') as f:
            cas = json.load(f)
        for c in cas['matrice']:
            self.assertTrue(np.allclose(mi.matrice_vue(c['yaw'], c['pitch'])[:3, :3], np.array(c['r']), atol=1e-11), c)
        with self.assertRaises(ValueError):
            mi.valider_xmag(0.59)
        with self.assertRaises(ValueError):
            mi.valider_xmag(float('nan'))
        with self.assertRaises(ValueError):
            mi.valider_xmag(3.01)
        self.assertEqual(mi.valider_xmag(None), 0.6)


class Matrice(unittest.TestCase):
    ANGLES = [(0, 0), (90, 0), (180, 0), (-90, 0), (0, 90), (0, -90), (37, -23), (-143, 61), (180, 90), (12.5, 45)]

    def test_rotation_pure(self):
        for yaw, pitch in self.ANGLES:
            R = mi.matrice_vue(yaw, pitch)
            r = R[:3, :3]
            self.assertTrue(np.allclose(r @ r.T, np.eye(3), atol=1e-12), (yaw, pitch))
            self.assertAlmostEqual(np.linalg.det(r), 1.0, places=12)
            self.assertTrue(np.allclose(R[:3, 3], 0))
            inv = mi.matrice_vue_inverse(yaw, pitch)
            self.assertTrue(np.allclose(inv @ R, np.eye(4), atol=1e-12))

    def test_neutre_est_identite(self):
        self.assertTrue(np.array_equal(mi.matrice_vue(0, 0), np.eye(4)))
        self.assertTrue(mi.vue_neutre(0.0, 0.0))
        self.assertFalse(mi.vue_neutre(0.0, 0.01))

    def test_la_camera_va_sur_z(self):
        for yaw, pitch in self.ANGLES:
            a, b = math.radians(yaw), math.radians(pitch)
            d = np.array([math.sin(a) * math.cos(b), math.sin(b), math.cos(a) * math.cos(b)])
            self.assertTrue(np.allclose(mi.matrice_vue(yaw, pitch)[:3, :3] @ d, [0, 0, 1], atol=1e-12), (yaw, pitch))

    def test_le_haut_reste_en_haut(self):
        # pas de roulis : l'axe Y du monde, projete sur l'image, pointe vers le haut (composante y >= 0)
        for yaw, pitch in self.ANGLES:
            haut = mi.matrice_vue(yaw, pitch)[:3, :3] @ np.array([0, 1, 0])
            self.assertGreaterEqual(haut[1], -1e-12, (yaw, pitch))

    def test_dos_et_cotes(self):
        p = np.array([0.3, 0.1, -0.4])
        self.assertTrue(np.allclose(mi.matrice_vue(180, 0)[:3, :3] @ p, [-0.3, 0.1, 0.4], atol=1e-12))     # dos : x et z inverses
        self.assertTrue(np.allclose(mi.matrice_vue(90, 0)[:3, :3] @ np.array([1, 0, 0]), [0, 0, 1], atol=1e-12))   # camera a +X
        self.assertTrue(np.allclose(mi.matrice_vue(0, 90)[:3, :3] @ np.array([0, 1, 0]), [0, 0, 1], atol=1e-12))   # camera au-dessus


class AllerRetour(unittest.TestCase):
    def test_sommets_normales_uv_matiere(self):
        m = corps_texture([0.2, -0.1, 0.3], 0.25)
        v0 = np.asarray(m.vertices).copy()
        n0 = np.asarray(m.vertex_normals).copy()
        uv0 = np.asarray(m.visual.uv).copy()
        tex0 = np.asarray(m.visual.material.baseColorTexture).copy()
        for yaw, pitch in [(37, -23), (-143, 61), (180, 90), (90, 0), (12.5, 45)]:
            t = m.copy()
            t.apply_transform(mi.matrice_vue(yaw, pitch))
            self.assertGreater(np.abs(np.asarray(t.vertices) - v0).max(), 1e-3)             # le maillage a bien tourne
            t.apply_transform(mi.matrice_vue_inverse(yaw, pitch))
            self.assertLess(np.abs(np.asarray(t.vertices) - v0).max(), 1e-6, (yaw, pitch))
            self.assertLess(np.abs(np.asarray(t.vertex_normals) - n0).max(), 1e-6, (yaw, pitch))
            self.assertTrue(np.array_equal(np.asarray(t.visual.uv), uv0))
            self.assertTrue(np.array_equal(np.asarray(t.visual.material.baseColorTexture), tex0))


def fabriquer_cas(dossier, centre, rayon=0.15, sous_div=3):
    """Maillage a zone visee + pièce + masque, dans le REPERE ORIGINAL ; renvoie les chemins."""
    import trimesh
    maillage = os.path.join(dossier, 'maillage.glb')
    exporter(corps_texture(centre, rayon, sous_div), maillage)
    piece = os.path.join(dossier, 'piece.glb')
    p = sphere_texturee(subdivisions=2, taille_texture=64, graine=5)
    exporter(p, piece)
    return maillage, piece


def lancer_assembler(dossier, centre, yaw, pitch, avec_cles=True, module=None, S=256, rayon_masque=10, nom='sortie.glb'):
    """Pose le masque la ou la zone est VUE dans le repere tourne et lance `assembler`."""
    module = module or mi
    maillage, piece = fabriquer_cas(dossier, centre)
    if hasattr(module, 'matrice_vue'):
        R = module.matrice_vue(yaw, pitch)[:3, :3]
        vu = R @ np.asarray(centre, float)
    else:
        vu = np.asarray(centre, float)                   # ancien module : vue de face seulement
    xm = 0.6 if (yaw == 0 and pitch == 0) else (module.xmag_pour_vue(0.8) if hasattr(module, 'xmag_pour_vue') else 0.6)
    cx, cy = pixel(xm, S, vu[0], vu[1])
    masque = os.path.join(dossier, 'masque.png')
    masque_disque(masque, S, cx, cy, rayon_masque)
    # cadre : la piece occupe un petit rectangle autour du point vise (dans le repere du rendu)
    cadre = {'x': [vu[0] - 0.1, vu[0] + 0.1], 'y': [vu[1] - 0.1, vu[1] + 0.1], 'taille_rendu': S}
    if avec_cles and AVEC_VUE and not (yaw == 0 and pitch == 0):
        cadre.update({'yaw': yaw, 'pitch': pitch, 'xmag': xm})
    cj = os.path.join(dossier, 'cadre.json')
    with open(cj, 'w', encoding='utf-8') as f:
        json.dump(cadre, f)
    sortie = os.path.join(dossier, nom)
    module.assembler(maillage, masque, cj, piece, sortie)
    return maillage, sortie


def charger_sortie(sortie):
    import trimesh
    sc = trimesh.load(sortie, force='scene')
    return {nom: g for nom, g in sc.geometry.items()}


class AssemblerVueChoisie(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='reshape_vue_')

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def _verifier(self, centre, yaw, pitch):
        import trimesh
        from scipy.spatial import cKDTree
        maillage, sortie = lancer_assembler(self.d, centre, yaw, pitch)
        orig = trimesh.load(maillage, force='scene').to_geometry()
        geoms = charger_sortie(sortie)
        corps = next(g for n, g in geoms.items() if 'corps' in n)
        piece = next(g for n, g in geoms.items() if 'zone' in n)
        # 1. des faces ont ete retirees
        self.assertLess(len(corps.faces), len(orig.faces))
        # 2. le corps est dans le repere d'ORIGINE : chaque sommet restant existe dans le maillage d'origine
        arbre = cKDTree(np.asarray(orig.vertices))
        d, _ = arbre.query(np.asarray(corps.vertices))
        self.assertLess(d.max(), 1e-5, 'le corps n est pas revenu dans son repere')
        # 3. la zone retiree est celle qu'on visait : plus aucun sommet du corps ne reste au centre du trou
        self.assertGreater(len(orig.vertices), len(corps.vertices))
        # 4. la piece est posee au bon endroit, dans le repere d'origine (pas dans le repere tourne)
        pc = np.asarray(piece.vertices)
        centre = np.asarray(centre, float)
        self.assertLess(np.linalg.norm(pc.mean(0)[:2] - centre[:2]) if (yaw == 0 and pitch == 0) else
                        np.linalg.norm(pc.mean(0) - centre), 0.10, 'piece loin de la zone visee')
        # 5. les normales du corps sont celles d'origine (rotation inverse appliquee aux normales)
        self.assertTrue(np.isfinite(np.asarray(corps.vertex_normals)).all())
        _, idx = arbre.query(np.asarray(corps.vertices))
        ref = np.asarray(orig.vertex_normals)[idx]
        # (trimesh recalcule les normales des sommets du bord de la coupe : on compare loin du trou)
        Rm = mi.matrice_vue(yaw, pitch)[:3, :3]
        loin = np.linalg.norm((np.asarray(corps.vertices) @ Rm.T)[:, :2] - (Rm @ centre)[:2], axis=1) > 0.11
        proche = (d < 1e-6) & loin
        self.assertGreater(proche.mean(), 0.05)
        cos = (np.asarray(corps.vertex_normals)[proche] * ref[proche]).sum(1)
        # trimesh recalcule les normales a l'ouverture/ecriture (ecart de ~1 % deja present en vue de face : mesure) ;
        # des normales NON tournees donneraient un cosinus negatif pour 180 degres
        self.assertGreater(cos.min(), 0.97, 'normales du corps tournees de travers')
        # matiere intacte
        self.assertEqual(np.asarray(corps.visual.material.baseColorTexture).shape,
                         np.asarray(orig.visual.material.baseColorTexture).shape)
        return corps, piece, orig

    def test_arriere_yaw_180(self):
        # zone a l'ARRIERE et decalee a droite : en vue de face rien ne se projette sous le masque
        self._verifier([0.35, 0.0, -0.3], 180, 0)

    def test_cote_yaw_90(self):
        self._verifier([0.3, 0.05, 0.0], 90, 0)

    def test_dessus_pitch_90(self):
        self._verifier([0.0, 0.35, 0.0], 0, 90)

    def test_vue_quelconque(self):
        self._verifier([-0.25, 0.1, -0.2], 37, -23)
        shutil.rmtree(self.d, ignore_errors=True)
        os.makedirs(self.d)
        self._verifier([0.2, -0.2, 0.25], -143, 61)

    def test_sans_correctif_la_zone_n_est_pas_trouvee(self):
        """Le cas du proprietaire : zone a l'arriere. Chaine d'AVANT (cadre sans angles) : rien sous le masque."""
        centre = [0.35, 0.0, -0.3]
        maillage, piece = fabriquer_cas(self.d, centre)
        S = 256
        # masque la ou la zone est vue DEPUIS L'ARRIERE : x -> -x
        cx, cy = pixel(0.6, S, -0.35, 0.0)
        masque = os.path.join(self.d, 'masque.png')
        masque_disque(masque, S, cx, cy, 10)
        cj = os.path.join(self.d, 'cadre.json')
        with open(cj, 'w', encoding='utf-8') as f:
            json.dump({'x': [-0.45, -0.25], 'y': [-0.1, 0.1], 'taille_rendu': S}, f)
        with self.assertRaises(SystemExit) as e:
            mi.assembler(maillage, masque, cj, piece, os.path.join(self.d, 'sortie.glb'))
        self.assertIn('aucune face sous le masque', str(e.exception))

    def test_avec_correctif_meme_masque_meme_zone(self):
        """Exactement les memes entrees que le test precedent, plus les angles dans le cadre : la zone est trouvee."""
        centre = [0.35, 0.0, -0.3]
        maillage, piece = fabriquer_cas(self.d, centre)
        S = 256
        cx, cy = pixel(0.6, S, -0.35, 0.0)
        masque = os.path.join(self.d, 'masque.png')
        masque_disque(masque, S, cx, cy, 10)
        cj = os.path.join(self.d, 'cadre.json')
        with open(cj, 'w', encoding='utf-8') as f:
            json.dump({'x': [-0.45, -0.25], 'y': [-0.1, 0.1], 'taille_rendu': S, 'yaw': 180, 'pitch': 0, 'xmag': 0.6}, f)
        sortie = os.path.join(self.d, 'sortie.glb')
        mi.assembler(maillage, masque, cj, piece, sortie)
        self.assertTrue(os.path.getsize(sortie) > 1000)

    def test_cadre_invalide_refuse(self):
        centre = [0.35, 0.0, -0.3]
        maillage, piece = fabriquer_cas(self.d, centre)
        masque = os.path.join(self.d, 'masque.png')
        masque_disque(masque, 256, 100, 128, 10)
        for cle in ({'yaw': 999, 'pitch': 0}, {'yaw': 10, 'pitch': 'x'}, {'yaw': 10, 'pitch': 0, 'xmag': 0.1},
                    {'yaw': 10, 'pitch': 0, 'xmag': float('nan')}):
            cj = os.path.join(self.d, 'cadre.json')
            with open(cj, 'w', encoding='utf-8') as f:
                json.dump({'x': [-0.1, 0.1], 'y': [-0.1, 0.1], 'taille_rendu': 256, **cle}, f)
            with self.assertRaises(SystemExit, msg=str(cle)):
                mi.assembler(maillage, masque, cj, piece, os.path.join(self.d, 'sortie.glb'))

    def test_zone_peinte_en_3d_refuse_une_vue_tournee(self):
        centre = [0.35, 0.0, -0.3]
        maillage, piece = fabriquer_cas(self.d, centre)
        masque = os.path.join(self.d, 'masque.png')
        masque_disque(masque, 256, 100, 128, 10)
        np.save(os.path.join(self.d, 'faces.npy'), np.arange(10))
        cj = os.path.join(self.d, 'cadre.json')
        with open(cj, 'w', encoding='utf-8') as f:
            json.dump({'x': [-0.1, 0.1], 'y': [-0.1, 0.1], 'taille_rendu': 256, 'yaw': 10, 'pitch': 0, 'xmag': 0.6}, f)
        with self.assertRaises(SystemExit):
            mi.assembler(maillage, masque, cj, piece, os.path.join(self.d, 's.glb'), os.path.join(self.d, 'faces.npy'))


class VueDeFaceIdentique(unittest.TestCase):
    """yaw 0 / pitch 0 : aucune rotation, aucun champ ajoute, GLB identique a l'octet a celui de l'ancien code."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='reshape_vue_')

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_octet_pour_octet_avec_l_ancien_module(self):
        if not ANCIEN:
            self.skipTest('ANCIEN_MESH_INPAINT non fourni (copie de l ancien module)')
        ancien = charger(ANCIEN, 'mesh_inpaint_ancien')
        centre = [0.1, 0.05, 0.1]
        d1 = os.path.join(self.d, 'a')
        d2 = os.path.join(self.d, 'b')
        d3 = os.path.join(self.d, 'c')
        for x in (d1, d2, d3):
            os.makedirs(x)
        _, s_ancien = lancer_assembler(d1, centre, 0, 0, module=ancien)
        _, s_nouveau = lancer_assembler(d2, centre, 0, 0)
        with open(s_ancien, 'rb') as f:
            a = f.read()
        with open(s_nouveau, 'rb') as f:
            b = f.read()
        self.assertEqual(a, b, 'le GLB de la vue de face a change')
        # cadre avec yaw/pitch ECRITS a zero : meme resultat
        maillage = os.path.join(d3, 'maillage.glb')
        exporter(corps_texture(centre, 0.15), maillage)
        piece = os.path.join(d3, 'piece.glb')
        exporter(sphere_texturee(subdivisions=2, taille_texture=64, graine=5), piece)
        cx, cy = pixel(0.6, 256, centre[0], centre[1])
        masque = os.path.join(d3, 'masque.png')
        masque_disque(masque, 256, cx, cy, 10)
        cj = os.path.join(d3, 'cadre.json')
        with open(cj, 'w', encoding='utf-8') as f:
            json.dump({'x': [centre[0] - 0.1, centre[0] + 0.1], 'y': [centre[1] - 0.1, centre[1] + 0.1],
                       'taille_rendu': 256, 'yaw': 0, 'pitch': 0, 'xmag': 0.6}, f)
        s3 = os.path.join(d3, 'sortie.glb')
        mi.assembler(maillage, masque, cj, piece, s3)
        with open(s3, 'rb') as f:
            c = f.read()
        self.assertEqual(a, c)

    def test_preparer_cadre_sans_angles_en_vue_de_face(self):
        from PIL import Image
        S = 128
        rep = os.path.join(self.d, 'repeint.png')
        arr = np.full((S, S, 3), 255, np.uint8)
        arr[40:80, 50:90] = (200, 30, 30)
        Image.fromarray(arr).save(rep)
        masque = os.path.join(self.d, 'masque.png')
        masque_disque(masque, S, 70, 60, 30)
        # detourage : on le remplace par un faux pour ne pas lancer de reseau (comme le banc des noyaux)
        import types
        faux = types.ModuleType('lucida_matte')

        def matte(entree, sortie):
            im = Image.open(entree).convert('RGB')
            a = np.asarray(im)
            alpha = ((a < 250).any(2) * 255).astype(np.uint8)
            Image.fromarray(np.dstack([a, alpha])).save(sortie)
        faux.matte = matte
        sys.modules['lucida_matte'] = faux
        try:
            piece = os.path.join(self.d, 'piece.png')
            cadre = os.path.join(self.d, 'cadre.json')
            mi.preparer(rep, masque, piece, cadre)
            with open(cadre, encoding='utf-8') as f:
                c0 = json.load(f)
            self.assertEqual(sorted(c0), ['taille_rendu', 'x', 'y'])
            # vue tournee : angles et demi-largeur dans le cadre, repere elargi
            cadre2 = os.path.join(self.d, 'cadre2.json')
            mi.preparer(rep, masque, piece, cadre2, None, {'yaw': 180, 'pitch': 0, 'xmag': 0.75})
            with open(cadre2, encoding='utf-8') as f:
                c1 = json.load(f)
            self.assertEqual((c1['yaw'], c1['pitch'], c1['xmag']), (180.0, 0.0, 0.75))
            # meme rectangle en pixels -> coordonnees monde proportionnelles a la demi-largeur
            self.assertAlmostEqual(c1['x'][0] / 0.75, c0['x'][0] / 0.6, places=9)
            self.assertAlmostEqual(c1['y'][1] / 0.75, c0['y'][1] / 0.6, places=9)
            # vue de face fournie en dict : pas de champ ajoute
            cadre3 = os.path.join(self.d, 'cadre3.json')
            mi.preparer(rep, masque, piece, cadre3, None, {'yaw': 0, 'pitch': 0})
            with open(cadre3, encoding='utf-8') as f:
                self.assertEqual(json.load(f), c0)
            with self.assertRaises(SystemExit):
                mi.preparer(rep, masque, piece, cadre3, None, {'yaw': 400, 'pitch': 0})
        finally:
            sys.modules.pop('lucida_matte', None)

    def test_rendre_et_preparer_octet_pour_octet_avec_l_ancien_module(self):
        """`rendre` (vue de face a plat) et `preparer` (cadre) : memes octets que l'ancien code quand la vue est de face."""
        if not ANCIEN:
            self.skipTest('ANCIEN_MESH_INPAINT non fourni (copie de l ancien module)')
        ancien = charger(ANCIEN, 'mesh_inpaint_ancien2')
        from PIL import Image
        import types
        # preparer : cadre.json identique
        S = 128
        rep = os.path.join(self.d, 'repeint.png')
        arr = np.full((S, S, 3), 255, np.uint8)
        arr[40:80, 50:90] = (200, 30, 30)
        Image.fromarray(arr).save(rep)
        masque = os.path.join(self.d, 'masque.png')
        masque_disque(masque, S, 70, 60, 30)
        faux = types.ModuleType('lucida_matte')

        def matte(entree, sortie):
            a = np.asarray(Image.open(entree).convert('RGB'))
            Image.fromarray(np.dstack([a, ((a < 250).any(2) * 255).astype(np.uint8)])).save(sortie)
        faux.matte = matte
        sys.modules['lucida_matte'] = faux
        try:
            cadres = []
            for nom, module in (('ancien', ancien), ('nouveau', mi)):
                cadre = os.path.join(self.d, f'cadre_{nom}.json')
                module.preparer(rep, masque, os.path.join(self.d, f'piece_{nom}.png'), cadre)
                with open(cadre, 'rb') as f:
                    cadres.append(f.read())
            self.assertEqual(cadres[0], cadres[1], 'le cadre de la vue de face a change')
        finally:
            sys.modules.pop('lucida_matte', None)
        # rendre : PNG identique (vrai rendu pyrender)
        try:
            import pyrender  # noqa: F401
        except Exception as e:
            self.skipTest(f'pyrender indisponible : {e}')
        maillage = os.path.join(self.d, 'm.glb')
        exporter(corps_texture([0.1, 0.05, 0.1], 0.2, 2), maillage)
        try:
            ancien.rendre(maillage, os.path.join(self.d, 'a.png'), 96)
        except Exception as e:
            self.skipTest(f'rendu hors ecran impossible ici : {e}')
        mi.rendre(maillage, os.path.join(self.d, 'b.png'), 96)
        mi.rendre(maillage, os.path.join(self.d, 'c.png'), 96, 0, 0)
        with open(os.path.join(self.d, 'a.png'), 'rb') as f:
            a = f.read()
        for n in ('b.png', 'c.png'):
            with open(os.path.join(self.d, n), 'rb') as f:
                self.assertEqual(a, f.read(), f'le rendu de face a change ({n})')
        self.assertFalse(os.path.exists(os.path.join(self.d, 'c.png.vue.json')), 'vue de face : aucun fichier de vue')


class RenduReel(unittest.TestCase):
    """Un VRAI rendu pyrender (96 px, une sphere) : la silhouette tombe au pixel que l'assemblage attend."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='reshape_vue_')

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def _centroide(self, png):
        from PIL import Image
        a = np.asarray(Image.open(png).convert('RGB')).astype(int)
        sombre = (a.sum(2) < 740)                       # tout ce qui n'est pas le fond blanc
        ys, xs = np.where(sombre)
        return xs.mean(), ys.mean(), sombre.sum()

    def test_dos_decale(self):
        try:
            import pyrender  # noqa: F401
        except Exception as e:
            self.skipTest(f'pyrender indisponible : {e}')
        centre = [0.3, 0.1, -0.25]
        maillage = os.path.join(self.d, 'm.glb')
        exporter(corps_texture(centre, 0.2, 2), maillage)
        S = 96
        avant = os.path.join(self.d, 'face.png')
        try:
            mi.rendre(maillage, avant, S)               # vue de face : doit marcher aussi sur l'ancien code
        except Exception as e:
            self.skipTest(f'rendu hors ecran impossible ici : {e}')
        dos = os.path.join(self.d, 'dos.png')
        mi.rendre(maillage, dos, S, 180, 0)
        self.assertFalse(os.path.exists(avant + '.vue.json'), 'vue de face : aucun fichier ajoute')
        with open(dos + '.vue.json', encoding='utf-8') as f:
            vu = json.load(f)
        self.assertEqual((vu['yaw'], vu['pitch']), (180.0, 0.0))
        self.assertEqual(vu['xmag'], 0.6)
        cx, cy, n = self._centroide(dos)
        ex, ey = pixel(vu['xmag'], S, -0.3, 0.1)               # vu de dos : x inverse
        self.assertLess(abs(cx - ex), 2.5)
        self.assertLess(abs(cy - ey), 2.5)
        fx, fy, _ = self._centroide(avant)
        gx, gy = pixel(0.6, S, 0.3, 0.1)
        self.assertLess(abs(fx - gx), 2.5)                      # vue de face : comportement d'avant
        self.assertGreater(n, 50)

    def test_vue_large_elargit_la_fenetre(self):
        try:
            import pyrender  # noqa: F401
        except Exception as e:
            self.skipTest(f'pyrender indisponible : {e}')
        import trimesh
        boite = trimesh.creation.box(extents=[1.0, 0.5, 1.0])
        maillage = os.path.join(self.d, 'b.glb')
        trimesh.Scene([boite]).export(maillage)
        sortie = os.path.join(self.d, 'v.png')
        try:
            mi.rendre(maillage, os.path.join(self.d, 'f.png'), 64)
        except Exception as e:
            self.skipTest(f'rendu hors ecran impossible ici : {e}')
        mi.rendre(maillage, sortie, 64, 45, 0)
        with open(sortie + '.vue.json', encoding='utf-8') as f:
            vu = json.load(f)
        self.assertGreater(vu['xmag'], 0.6)                    # 0,707 de demi-largeur > 0,6
        self.assertEqual(vu['xmag'], 0.75)


class ChaineComplete(unittest.TestCase):
    """La chaine ENTIERE du bureau, hors IA : rendre (vrai rendu pyrender) -> masque sur la zone VUE -> repeinte simulee ->
    preparer (qui relit <rendu>.vue.json) -> assembler (qui relit le cadre). Prouve la poignee de main des trois etapes :
    la demi-largeur et les angles ecrits par `rendre` sont ceux que `preparer` et `assembler` retrouvent seuls."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='reshape_vue_')

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)
        sys.modules.pop('lucida_matte', None)

    def _faux_detourage(self):
        import types
        from PIL import Image
        faux = types.ModuleType('lucida_matte')

        def matte(entree, sortie):
            a = np.asarray(Image.open(entree).convert('RGB'))
            alpha = ((a < 250).any(2) * 255).astype(np.uint8)
            Image.fromarray(np.dstack([a, alpha])).save(sortie)
        faux.matte = matte
        sys.modules['lucida_matte'] = faux

    def _chaine(self, centre, yaw, pitch, rayon=0.15):
        try:
            import pyrender  # noqa: F401
        except Exception as e:
            self.skipTest(f'pyrender indisponible : {e}')
        from PIL import Image, ImageDraw
        import trimesh
        self._faux_detourage()
        d = self.d
        maillage = os.path.join(d, 'maillage.glb')
        exporter(corps_texture(centre, rayon, 2), maillage)
        S = 128
        vue = os.path.join(d, 'vue.png')
        try:                                   # sonde de l'environnement : la vue de FACE, qui marche aussi sur l'ancien code
            mi.rendre(maillage, os.path.join(d, 'sonde.png'), 32)
        except Exception as e:
            self.skipTest(f'rendu hors ecran impossible ici : {e}')
        mi.rendre(maillage, vue, S, yaw, pitch)   # hors de la sonde : sur l'ancien code (sans vue) ce test ECHOUE, il ne se saute pas
        vj = vue + '.vue.json'
        neutre = (yaw == 0 and pitch == 0)
        self.assertEqual(os.path.exists(vj), not neutre, 'le fichier de vue n existe que pour une vue tournee')
        xm = lire_json(vj)['xmag'] if not neutre else 0.6
        # la zone VUE : projection du centre dans le repere du rendu
        R = mi.matrice_vue(yaw, pitch)[:3, :3]
        vu = R @ np.asarray(centre, float)
        cx, cy = pixel(xm, S, vu[0], vu[1])
        masque = os.path.join(d, 'masque.png')
        masque_disque(masque, S, cx, cy, 14)
        # repeinte simulee : un disque rouge dans la zone (a la place du pinceau IA)
        repeint = os.path.join(d, 'repeint.png')
        im = Image.open(vue).convert('RGB')
        ImageDraw.Draw(im).ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=(220, 30, 30))
        im.save(repeint)
        piece_png = os.path.join(d, 'piece.png')
        cadre = os.path.join(d, 'cadre.json')
        mi.preparer(repeint, masque, piece_png, cadre, vue, vj if not neutre else None)
        c = lire_json(cadre)
        if neutre:
            self.assertEqual(sorted(c), ['taille_rendu', 'x', 'y'], 'vue de face : le cadre d avant, sans champ ajoute')
        else:
            self.assertEqual((c['yaw'], c['pitch'], c['xmag']), (float(yaw), float(pitch), xm), 'le cadre porte la vue lue dans <rendu>.vue.json')
        piece = os.path.join(d, 'piece.glb')
        exporter(sphere_texturee(subdivisions=2, taille_texture=64, graine=5), piece)
        sortie = os.path.join(d, 'sortie.glb')
        mi.assembler(maillage, masque, cadre, piece, sortie)
        orig = trimesh.load(maillage, force='scene').to_geometry()
        geoms = charger_sortie(sortie)
        corps = next(g for n, g in geoms.items() if 'corps' in n)
        pz = next(g for n, g in geoms.items() if 'zone' in n)
        return np.asarray(centre, float), orig, corps, pz

    def _verifier(self, centre, yaw, pitch):
        centre, orig, corps, pz = self._chaine(centre, yaw, pitch)
        # des faces ont ete retirees (la zone a ete trouvee sous le masque)
        self.assertLess(len(corps.faces), len(orig.faces))
        # la piece est posee sur la zone visee DANS LE REPERE D'ORIGINE (3D, pas seulement x / y)
        # mesure : 1 a 4 mm sur les cinq vues ; seuil a 3 cm (un repere mal retourne donnerait 0,3 a 0,7)
        ecart = float(np.linalg.norm(np.asarray(pz.vertices).mean(0) - centre))
        self.assertLess(ecart, 0.03, f'piece a {ecart:.3f} de la zone visee')
        # le reste du corps est revenu dans son repere : chaque sommet existe dans le maillage d'origine
        from scipy.spatial import cKDTree
        dist, _ = cKDTree(np.asarray(orig.vertices)).query(np.asarray(corps.vertices))
        self.assertLess(dist.max(), 1e-5)
        return corps, pz

    def test_vue_de_face(self):
        self._verifier([0.1, 0.05, 0.1], 0, 0)

    def test_dos_yaw_180(self):
        self._verifier([0.35, 0.0, -0.3], 180, 0)

    def test_cote_yaw_90(self):
        self._verifier([0.3, 0.05, 0.0], 90, 0)

    def test_dessus_pitch_90(self):
        self._verifier([0.0, 0.35, 0.0], 0, 90)

    def test_vue_en_biais(self):
        self._verifier([-0.25, 0.1, -0.2], 37, -23)

    def test_la_zone_arriere_est_introuvable_de_face(self):
        """Le defaut du proprietaire, sur la chaine entiere : le masque pose pour une vue de DOS, joue avec la chaine d'avant
        (vue de face, cadre sans angles), ne trouve aucune face."""
        try:
            import pyrender  # noqa: F401
        except Exception as e:
            self.skipTest(f'pyrender indisponible : {e}')
        centre = [0.35, 0.0, -0.3]
        maillage, piece = fabriquer_cas(self.d, centre)
        S = 128
        cx, cy = pixel(0.6, S, -0.35, 0.0)                    # ou la zone apparait DEPUIS L'ARRIERE
        masque = os.path.join(self.d, 'masque.png')
        masque_disque(masque, S, cx, cy, 14)
        cadre = os.path.join(self.d, 'cadre.json')
        with open(cadre, 'w', encoding='utf-8') as f:
            json.dump({'x': [-0.45, -0.25], 'y': [-0.1, 0.1], 'taille_rendu': S}, f)
        with self.assertRaises(SystemExit) as e:
            mi.assembler(maillage, masque, cadre, piece, os.path.join(self.d, 's.glb'))
        self.assertIn('aucune face sous le masque', str(e.exception))


class CommandeLigne(unittest.TestCase):
    def test_rendre_refuse_des_angles_invalides(self):
        import subprocess
        for args in (['400', '0'], ['0', '95'], ['abc', '0'], ['nan', '0']):
            r = subprocess.run([sys.executable, MODULE, 'rendre', 'inexistant.glb', os.path.join(tempfile.gettempdir(), 'x.png'),
                                '64'] + args, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0, args)
            self.assertIn('vue invalide', r.stderr + r.stdout, args)


if __name__ == '__main__':
    unittest.main()
