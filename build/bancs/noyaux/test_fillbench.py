# -*- coding: utf-8 -*-
"""Tests du banc fillbench : les cas generes sont coherents avec leur verite (saute si les GLB sources ou les cas sont absents).

Lancer :  python build/bancs/noyaux/test_fillbench.py -v
Les cas se generent avec  python build/bancs/noyaux/fillbench_generer.py  (sortie C:/tmp/fillbench, hors depot).
"""
import json
import os
import sys
import unittest

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
if ICI not in sys.path:
    sys.path.insert(0, ICI)

import fillbench_score as S  # noqa: E402

RACINE = os.environ.get('FILLBENCH_SORTIE', 'C:/tmp/fillbench')
VERITE = os.path.join(RACINE, 'verite.json')
MOISSON = os.environ.get('FILLBENCH_MOISSON', 'C:/tmp/moissonneuse.glb')
PRET = os.path.exists(VERITE) and os.path.exists(MOISSON)


def boucles_de_bord(V, F):
    """Centres (et nombre) des pourtours d'aretes de bord, apres soudure par position."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    cle = np.sort(e, axis=1)
    u, inv, cnt = np.unique(cle[:, 0] * (int(F.max()) + 1) + cle[:, 1], return_inverse=True, return_counts=True)
    bord = cle[np.isin(inv, np.nonzero(cnt == 1)[0])]
    if len(bord) == 0:
        return [], int(np.sum(cnt > 2))
    vs, loc = np.unique(bord.ravel(), return_inverse=True)
    loc = loc.reshape(-1, 2)
    n = len(vs)
    g = coo_matrix((np.ones(len(bord), dtype=np.int8), (loc[:, 0], loc[:, 1])), shape=(n, n))
    k, lab = connected_components(g, directed=False)
    return [V[vs[lab == i]].mean(axis=0) for i in range(k)], int(np.sum(cnt > 2))


@unittest.skipUnless(PRET, 'cas fillbench absents (lancer fillbench_generer.py)')
class TestFillbench(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.v = json.load(open(VERITE, encoding='utf-8'))['cas']

    def _charge_ext(self, nom):
        import trimesh
        sc = trimesh.load(os.path.join(RACINE, self.v[nom]['fichier']), force='scene', process=False)
        return sc, sc.geometry['peau_ext']

    def test_verite_bien_formee(self):
        for nom, f in self.v.items():
            if f['famille'] == 'reels':
                continue
            self.assertTrue(os.path.exists(os.path.join(RACINE, f['fichier'])), nom)
            for t in f['trous']:
                self.assertLessEqual(t['diametre_rel'], 0.09, nom)
                self.assertGreater(t['rayon'], 0, nom)
            for o in f['ouvertures']:
                self.assertGreaterEqual(o['diametre_rel'], 0.14, nom)

    def test_sains_sans_trou(self):
        for nom in ('sains_moissonneuse', 'sains_double', 'sains_collee'):
            f = self.v[nom]
            self.assertEqual(f['trous'], [])
            self.assertEqual(f['ouvertures'], [])
            self.assertTrue(f['attendu_vide'])
        V, F, _ = S.charger_cas(os.path.join(RACINE, self.v['sains_moissonneuse']['fichier']), souder=True)
        self.assertEqual(len(boucles_de_bord(V, F)[0]), 0, 'la moissonneuse saine a des aretes de bord')

    def test_faces_retirees_et_pourtours(self):
        """Faces de la peau exterieure = faces d'origine - faces retirees ; chaque trou donne UN pourtour centre sur la verite (peau exterieure seule)."""
        for nom in ('peau_double_perce_2', 'peau_collee_perce_2', 'bord_ouvert_perce_2'):
            f = self.v[nom]
            _, ext = self._charge_ext(nom)
            nv = len(ext.vertices)
            Fe = np.asarray(ext.faces)
            self.assertEqual(len(Fe), f['faces_ext'])
            # soudure de l'exterieur seul
            Ve = np.asarray(ext.vertices)
            from scipy.sparse import coo_matrix
            from scipy.sparse.csgraph import connected_components
            from scipy.spatial import cKDTree
            diag = float(np.linalg.norm(Ve.max(0) - Ve.min(0)))
            p = cKDTree(Ve).query_pairs(1e-6 * diag, output_type='ndarray')
            _, lab = connected_components(coo_matrix((np.ones(len(p), dtype=np.int8), (p[:, 0], p[:, 1])), shape=(nv, nv)), directed=False)
            nw = int(lab.max()) + 1
            Pw = np.stack([np.bincount(lab, weights=Ve[:, k], minlength=nw) / np.bincount(lab, minlength=nw) for k in range(3)], axis=1)
            centres, _ = boucles_de_bord(Pw, lab[Fe])
            self.assertGreaterEqual(len(centres), len(f['trous']), nom)
            for t in f['trous']:
                d = min(np.linalg.norm(c - np.asarray(t['centre'])) for c in centres)
                self.assertLessEqual(d, max(1.5 * t['rayon'], 0.005 * f['diag']), '%s : pourtour introuvable pres du trou %s' % (nom, t['centre']))
            # faces retirees : le total correspond (base = 514114 faces non degenerees)
            retirees = sum(t['n_faces_retirees'] for t in f['trous'])
            self.assertEqual(f['faces_ext'] + retirees, 514114)

    def test_peau_collee_a_des_aretes_multiples(self):
        """Les peaux collees ont des aretes a 3-4 faces ; les doubles non collees n'en ont pas (hors defauts de la source)."""
        def non_manifold(nom):
            return self._nm(S.charger_cas(os.path.join(RACINE, self.v[nom]['fichier']), souder=True)[1])
        a, b = non_manifold('peau_collee_perce_2'), non_manifold('peau_double_perce_2')
        self.assertGreater(a, b + 100)

    @staticmethod
    def _nm(F):
        e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
        _, cnt = np.unique(e[:, 0] * (int(F.max()) + 1) + e[:, 1], return_counts=True)
        return int((cnt > 2).sum())

    def test_ouvertures_pas_dans_les_trous(self):
        for nom in ('ouvertures_voulues_1', 'ouvertures_voulues_2'):
            f = self.v[nom]
            self.assertGreaterEqual(len(f['ouvertures']), 2)
            self.assertGreaterEqual(len(f['trous']), 3)
            for o in f['ouvertures']:
                self.assertGreater(o['diametre_rel'], f['max_trou_relatif'])
            for t in f['trous']:
                self.assertLess(t['diametre_rel'], f['max_trou_relatif'])

    def test_notation_ligne_de_base(self):
        """Le scorer note sans erreur un detecteur parfait (rappel 1) et un detecteur vide (rappel 0)."""
        f = self.v['peau_double_perce_2']
        parfait = {'detections': [{'centre': t['centre'], 'rayon': t['rayon']} for t in f['trous']], 'duree_s': 0, 'pic_memoire_mo': 0}
        r = S.noter_cas('x', f, parfait, f['diag'])
        self.assertEqual(r['trouves'], len(f['trous']))
        self.assertEqual(r['faux_positifs'], 0)
        vide = S.noter_cas('x', f, {'detections': [], 'duree_s': 0, 'pic_memoire_mo': 0}, f['diag'])
        self.assertEqual(vide['rappel'], 0.0)
        ouv = self.v['ouvertures_voulues_1']
        sur_fenetre = {'detections': [{'centre': ouv['ouvertures'][0]['centre'], 'rayon': 0.1}], 'duree_s': 0, 'pic_memoire_mo': 0}
        r = S.noter_cas('x', ouv, sur_fenetre, ouv['diag'])
        self.assertEqual(r['ouvertures_bouchees'], 1)


if __name__ == '__main__':
    unittest.main()
