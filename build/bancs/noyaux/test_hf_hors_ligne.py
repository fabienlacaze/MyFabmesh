"""Test de scripts/hf_hors_ligne.py::manquants_trellis2 (constat E-2, 2026-10-03).

Le detoureur (rembg_model, BiRefNet) ne doit plus etre exige pour le chemin « sans detourage » : le
modele n'est jamais charge, l'exiger gardait le mode hors ligne eteint (reessais SSL a chaque
generation). Faux dossier de cache, aucun reseau.

Lancer :  <python de l'appli> build/bancs/noyaux/test_hf_hors_ligne.py -v
Autre copie du module : variable NOYAU_HF (preuve d'echec sur l'ancien code).
"""
import importlib.util
import json
import os
import tempfile
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHEMIN = os.environ.get('NOYAU_HF') or os.path.join(RACINE, 'scripts', 'hf_hors_ligne.py')


def charger():
    spec = importlib.util.spec_from_file_location('hf_hors_ligne_sous_test', CHEMIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def ecrire(chemin, contenu=b'x'):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, 'wb') as f:
        f.write(contenu)


def faux_cache(racine, avec_birefnet=False):
    """Cache minimal : pipeline TRELLIS.2 + extracteur d'image, detoureur ABSENT sauf demande."""
    hub = os.path.join(racine, 'hub')
    snap = os.path.join(hub, 'models--microsoft--TRELLIS.2-4B', 'snapshots', 'abc')
    config = {'args': {
        'models': {'sparse_structure_flow_model': 'ckpts/ss_flow'},
        'image_cond_model': {'name': 'DinoV3', 'args': {'model_name': 'org/dino'}},
        'rembg_model': {'name': 'BiRefNet', 'args': {'model_name': 'org/birefnet'}},
    }}
    ecrire(os.path.join(snap, 'pipeline.json'), json.dumps(config).encode())
    for ext in ('.json', '.safetensors'):
        ecrire(os.path.join(snap, 'ckpts', 'ss_flow' + ext))
    dino = os.path.join(hub, 'models--org--dino', 'snapshots', 'd1')
    ecrire(os.path.join(dino, 'config.json'), b'{}')
    ecrire(os.path.join(dino, 'model.safetensors'))
    if avec_birefnet:
        bir = os.path.join(hub, 'models--org--birefnet', 'snapshots', 'b1')
        ecrire(os.path.join(bir, 'config.json'), b'{}')
        ecrire(os.path.join(bir, 'model.safetensors'))
    return hub


class TestManquantsTrellis2(unittest.TestCase):
    def setUp(self):
        self.mod = charger()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ancien = {k: os.environ.get(k) for k in ('HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE', 'HF_HOME')}
        os.environ.pop('HUGGINGFACE_HUB_CACHE', None)
        os.environ.pop('HF_HOME', None)

        def restaurer():
            for k, v in self.ancien.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.addCleanup(restaurer)

    def test_detoureur_absent_nest_pas_exige_par_defaut(self):
        os.environ['HF_HUB_CACHE'] = faux_cache(self.tmp.name, avec_birefnet=False)
        self.assertEqual(self.mod.manquants_trellis2(), [])

    def test_detoureur_exige_si_demande(self):
        os.environ['HF_HUB_CACHE'] = faux_cache(self.tmp.name, avec_birefnet=False)
        manque = self.mod.manquants_trellis2(avec_detourage=True)
        self.assertEqual(manque, ['org/birefnet'])

    def test_detoureur_present_ne_manque_pas(self):
        os.environ['HF_HUB_CACHE'] = faux_cache(self.tmp.name, avec_birefnet=True)
        self.assertEqual(self.mod.manquants_trellis2(avec_detourage=True), [])
        self.assertEqual(self.mod.manquants_trellis2(), [])

    def test_extracteur_absent_reste_exige(self):
        hub = faux_cache(self.tmp.name)
        import shutil
        shutil.rmtree(os.path.join(hub, 'models--org--dino'))
        os.environ['HF_HUB_CACHE'] = hub
        self.assertEqual(self.mod.manquants_trellis2(), ['org/dino'])

    def test_poids_du_pipeline_absents_restent_exiges(self):
        hub = faux_cache(self.tmp.name)
        os.remove(os.path.join(hub, 'models--microsoft--TRELLIS.2-4B', 'snapshots', 'abc', 'ckpts', 'ss_flow.safetensors'))
        os.environ['HF_HUB_CACHE'] = hub
        self.assertEqual(self.mod.manquants_trellis2(), ['microsoft/TRELLIS.2-4B/ckpts/ss_flow.safetensors'])

    def test_hors_ligne_pose_quand_seul_le_detoureur_manque(self):
        os.environ['HF_HUB_CACHE'] = faux_cache(self.tmp.name)
        avant = {k: os.environ.get(k) for k in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE')}
        os.environ.pop('HF_HUB_OFFLINE', None)
        try:
            self.assertTrue(self.mod.hors_ligne_si_complet(self.mod.manquants_trellis2(), log=lambda *_: None))
            self.assertEqual(os.environ.get('HF_HUB_OFFLINE'), '1')
        finally:
            for k, v in avant.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == '__main__':
    unittest.main()
