"""Test des outils purs du banc Pixal3D (modal_app/exp_pixal3d_outils.py, 2026-10-18). Aucun GPU, aucun reseau, ni torch ni modal.

Ces outils servent a MESURER (ou passe le temps de l'export GLB, combien de memoire GPU il faut reserver) : un defaut ne ferait pas planter le banc,
il fausserait silencieusement les chiffres rapportes. Chaque test cible donc un defaut qui donnerait un chiffre faux :

  - une enveloppe qui ne remet pas l'original apres une exception laisserait le code de l'auteur chronometre (et fausse) pour toutes les generations suivantes ;
  - sans synchronisation avant ET apres l'appel, le temps d'un noyau CUDA asynchrone serait compte dans l'etape suivante ;
  - une cible introuvable (le code de l'auteur a change) ne doit pas faire perdre la generation : elle est signalee ;
  - un pic de memoire qui oublie de se remettre a zero attribue a une etape le pic d'une etape precedente ;
  - une sonde dont la lecture leve (pilote occupe) ne doit ni tuer le fil ni inventer un pic.

Lancer :  <python de l'appli> build/bancs/noyaux/test_pixal3d_outils.py -v
Pour prouver l'echec sur une version fautive : NOYAU_OUTILS=<copie modifiee de exp_pixal3d_outils.py>.
"""
import importlib.util
import os
import sys
import threading
import time
import unittest

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..', '..'))
CHEMIN = os.environ.get('NOYAU_OUTILS') or os.path.join(RACINE, 'modal_app', 'exp_pixal3d_outils.py')


def charger():
    spec = importlib.util.spec_from_file_location('exp_pixal3d_outils_sous_test', CHEMIN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


O = charger()


class Horloge:
    """Horloge simulee : chaque appel avance du pas voulu (deterministe)."""

    def __init__(self, pas=1.0):
        self.t = 0.0
        self.pas = pas

    def __call__(self):
        self.t += self.pas
        return self.t


class Cible:
    def __init__(self):
        self.appels = 0

    def lent(self, x):
        self.appels += 1
        return x * 2

    def casse(self):
        raise ValueError('boom')


def fonction_module(a):
    return a + 1


class TestDecomposer(unittest.TestCase):
    def test_accumule_duree_et_appels(self):
        c = Cible()
        acc = O.Accumulateur()
        with O.decomposer([(c, 'lent', 'lent')], acc, horloge=Horloge(1.0)):
            self.assertEqual(c.lent(3), 6)
            self.assertEqual(c.lent(4), 8)
        self.assertEqual(acc.n['lent'], 2)
        self.assertAlmostEqual(acc.s['lent'], 2.0)            # deux appels, un pas d'horloge chacun
        self.assertEqual(acc.resume()['lent'], {'s': 2.0, 'appels': 2})

    def test_resume_trie_du_plus_long_au_plus_court(self):
        acc = O.Accumulateur()
        acc.ajouter('court', 1.0)
        acc.ajouter('long', 9.0)
        acc.ajouter('moyen', 4.0)
        self.assertEqual(list(acc.resume()), ['long', 'moyen', 'court'])
        self.assertAlmostEqual(acc.total(), 14.0)

    def test_restaure_l_original_apres_le_bloc(self):
        c = Cible()
        original = c.lent                                    # methode liee
        acc = O.Accumulateur()
        with O.decomposer([(c, 'lent', 'lent')], acc):
            self.assertIsNot(c.lent, original)
        self.assertEqual(c.lent(1), 2)                       # fonctionne comme avant
        self.assertNotIn('__pixal_original__', dir(c.lent))   # et n'est plus une enveloppe

    def test_restaure_apres_une_exception_dans_le_bloc(self):
        c = Cible()
        acc = O.Accumulateur()
        with self.assertRaises(RuntimeError):
            with O.decomposer([(c, 'lent', 'lent')], acc):
                raise RuntimeError('le code mesure a echoue')
        self.assertNotIn('__pixal_original__', dir(c.lent), 'enveloppe laissee en place apres une exception : toutes les generations suivantes seraient mesurees')

    def test_l_appel_qui_leve_est_quand_meme_compte_et_l_exception_remonte(self):
        c = Cible()
        acc = O.Accumulateur()
        with O.decomposer([(c, 'casse', 'casse')], acc, horloge=Horloge(1.0)):
            with self.assertRaises(ValueError):
                c.casse()
        self.assertEqual(acc.n['casse'], 1)
        self.assertGreater(acc.s['casse'], 0.0)

    def test_cible_absente_signalee_sans_faire_planter(self):
        c = Cible()
        acc = O.Accumulateur()
        with O.decomposer([(c, 'n_existe_pas', 'fantome'), (c, 'lent', 'lent')], acc):
            c.lent(1)
        self.assertEqual(acc.ignorees, ['fantome'])
        self.assertEqual(acc.n.get('lent'), 1)

    def test_attribut_non_modifiable_signale(self):
        acc = O.Accumulateur()
        with O.decomposer([(int, 'real', 'int.real')], acc):
            pass
        self.assertEqual(acc.ignorees, ['int.real'])

    def test_synchronisation_avant_et_apres_chaque_appel(self):
        c = Cible()
        journal = []
        acc = O.Accumulateur()
        with O.decomposer([(c, 'lent', 'lent')], acc, sync=lambda: journal.append('sync')):
            c.lent(1)
            c.lent(2)
        self.assertEqual(journal, ['sync'] * 4, 'sans sync avant ET apres, la duree d un noyau asynchrone glisse sur l etape suivante')

    def test_fonction_de_module_et_methode_de_classe(self):
        import types
        mod = types.ModuleType('faux_module')
        mod.f = fonction_module
        acc = O.Accumulateur()
        with O.decomposer([(mod, 'f', 'module.f'), (Cible, 'lent', 'Cible.lent')], acc, horloge=Horloge(0.5)):
            self.assertEqual(mod.f(1), 2)
            self.assertEqual(Cible().lent(5), 10)              # une instance creee DANS le bloc voit l'enveloppe de classe
        self.assertEqual(set(acc.n), {'module.f', 'Cible.lent'})
        self.assertIs(mod.f, fonction_module)
        self.assertNotIn('__pixal_original__', dir(Cible.lent))

    def test_blocs_successifs_ne_s_empilent_pas(self):
        c = Cible()
        acc1, acc2 = O.Accumulateur(), O.Accumulateur()
        for acc in (acc1, acc2):
            with O.decomposer([(c, 'lent', 'lent')], acc, horloge=Horloge(1.0)):
                c.lent(1)
        self.assertEqual(acc1.n['lent'], 1)
        self.assertEqual(acc2.n['lent'], 1, 'une enveloppe de la premiere generation comptait aussi dans la deuxieme')


class TestSondeMemoire(unittest.TestCase):
    def attendre(self, condition, delai=3.0):
        fin = time.time() + delai
        while time.time() < fin:
            if condition():
                return True
            time.sleep(0.005)
        return False

    def test_garde_le_pic_et_pas_la_derniere_valeur(self):
        valeur = {'v': 5.0}
        s = O.SondeMemoire(lambda: valeur['v'], pas=0.005).demarrer()
        try:
            self.assertTrue(self.attendre(lambda: s.pic >= 5.0))
            valeur['v'] = 21.5
            self.assertTrue(self.attendre(lambda: s.pic >= 21.5))
            valeur['v'] = 3.0
            time.sleep(0.05)
            self.assertAlmostEqual(s.pic, 21.5, msg='le pic doit rester a 21,5 quand la valeur courante redescend a 3')
        finally:
            s.arreter()

    def test_reinitialiser_remet_le_pic_a_la_valeur_courante(self):
        valeur = {'v': 30.0}
        s = O.SondeMemoire(lambda: valeur['v'], pas=0.005).demarrer()
        try:
            self.assertTrue(self.attendre(lambda: s.pic >= 30.0))
            valeur['v'] = 7.0
            s.reinitialiser()
            time.sleep(0.05)
            self.assertAlmostEqual(s.lire_pic(), 7.0, msg='le pic de l etape precedente (30) ne doit pas etre attribue a l etape suivante')
        finally:
            s.arreter()

    def test_lecture_qui_leve_ne_tue_pas_le_fil_et_n_invente_rien(self):
        etat = {'n': 0}

        def lire():
            etat['n'] += 1
            if etat['n'] <= 3:
                raise RuntimeError('pilote occupe')
            return 12.0

        s = O.SondeMemoire(lire, pas=0.005).demarrer()
        try:
            self.assertTrue(self.attendre(lambda: s.pic >= 12.0))
            self.assertAlmostEqual(s.pic, 12.0)
            self.assertGreaterEqual(s.echantillons, 1)
        finally:
            s.arreter()

    def test_arret_termine_le_fil(self):
        s = O.SondeMemoire(lambda: 1.0, pas=0.005).demarrer()
        self.assertTrue(any(t.name == 'sonde-memoire' for t in threading.enumerate()))
        s.arreter()
        self.assertFalse(any(t.name == 'sonde-memoire' for t in threading.enumerate()), 'le fil de la sonde tourne encore apres arreter()')

    def test_deux_demarrages_ne_font_qu_un_fil(self):
        s = O.SondeMemoire(lambda: 1.0, pas=0.005)
        s.demarrer()
        s.demarrer()
        try:
            self.assertEqual(sum(1 for t in threading.enumerate() if t.name == 'sonde-memoire'), 1)
        finally:
            s.arreter()


class TestNoms(unittest.TestCase):
    """Les noms d'etapes et de fichiers decident de ce que lit le comparateur et de ce que montrent les tableaux de durees : une erreur ne plante rien,
    elle range un chiffre sous la mauvaise etiquette ou ecrase le fichier d'une autre passe."""

    def test_descriptions_de_l_auteur(self):
        # descriptions reelles de pixal3d_image_to_3d.py (f7cf384), relevees dans le journal Modal du 18/10/2026
        self.assertEqual(O.nom_etape_sampler('Sampling sparse structure (proj)'), 'echantillonnage structure creuse (SS)')
        self.assertEqual(O.nom_etape_sampler('Sampling shape SLat (proj)'), 'echantillonnage forme LR 512')
        self.assertEqual(O.nom_etape_sampler('Sampling HR shape SLat (proj, 1536)'), 'echantillonnage forme HR 1536')
        self.assertEqual(O.nom_etape_sampler('Sampling HR shape SLat (proj, 1408)'), 'echantillonnage forme HR 1408')
        self.assertEqual(O.nom_etape_sampler('Sampling texture SLat (proj)'), 'echantillonnage texture 1024')

    def test_hr_shape_n_est_pas_pris_pour_la_forme_basse_resolution(self):
        self.assertNotEqual(O.nom_etape_sampler('Sampling HR shape SLat (proj, 1536)'), O.nom_etape_sampler('Sampling shape SLat (proj)'))

    def test_description_inconnue_ou_vide_garde_son_texte(self):
        self.assertEqual(O.nom_etape_sampler('Autre chose'), 'echantillonnage : Autre chose')
        self.assertEqual(O.nom_etape_sampler(''), 'echantillonnage : ')
        self.assertEqual(O.nom_etape_sampler(None), 'echantillonnage : ')

    def test_nom_local_de_la_derniere_passe_est_celui_du_comparateur(self):
        self.assertEqual(O.nom_glb_local('orc', '', 2, True, ''), 'pixal3d_orc.glb')
        self.assertEqual(O.nom_glb_local('orc', '', 2, True, '_1m'), 'pixal3d_orc_1m.glb')
        self.assertEqual(O.nom_glb_local('photo', '', 2, True, ''), 'pixal3d_photo.glb')

    def test_nom_local_des_passes_precedentes_garde_le_numero(self):
        self.assertEqual(O.nom_glb_local('orc', '', 1, False, ''), 'pixal3d_orc_passe1.glb')
        self.assertEqual(O.nom_glb_local('photo', '', 1, False, ''), 'pixal3d_photo_passe1.glb')

    def test_etiquette_dans_les_deux_noms(self):
        self.assertEqual(O.nom_glb_local('orc', '_froid2', 1, True, ''), 'pixal3d_orc_froid2.glb')
        self.assertEqual(O.nom_glb_local('orc', '_froid2', 1, False, '_1m'), 'pixal3d_orc_froid2_passe1_1m.glb')
        self.assertEqual(O.chemin_glb_volume('orc', '_froid2', 1, ''), '/cache/out/pixal3d_orc_froid2_p1.glb')

    def test_aucun_ecrasement_entre_passes_entrees_suffixes_et_etiquettes(self):
        locaux, volume = {}, {}
        for nom in ('orc', 'photo'):
            for etiquette in ('', '_froid2'):
                for passe, derniere in ((1, False), (2, True)):
                    for suffixe in ('', '_1m'):
                        loc = O.nom_glb_local(nom, etiquette, passe, derniere, suffixe)
                        vol = O.chemin_glb_volume(nom, etiquette, passe, suffixe)
                        cle = (nom, etiquette, passe, suffixe)
                        self.assertNotIn(loc, locaux, 'fichier local ecrase : %s et %s' % (cle, locaux.get(loc)))
                        self.assertNotIn(vol, volume, 'fichier du volume ecrase : %s et %s' % (cle, volume.get(vol)))
                        locaux[loc], volume[vol] = cle, cle
        self.assertEqual(len(locaux), 16)
        self.assertEqual(len(volume), 16)

    def test_le_chemin_du_volume_est_sous_cache_out(self):
        # main() retire /cache du chemin pour lire / effacer le fichier sur le volume : le prefixe est un contrat
        self.assertTrue(O.chemin_glb_volume('orc', '', 1, '').startswith('/cache/out/'))


if __name__ == '__main__':
    unittest.main()
