"""Preuve PAR MUTATION de la piste L (detourage Lucida + u2net) : chaque « mutant » change UNE chose dans une COPIE d'un fichier de la piste
(jamais dans le depot) ; les tests qui couvrent ce fichier doivent alors ECHOUER. Un mutant qui survit = un comportement sans test.

    <python de l'appli> build/bancs/noyaux/mutants_lucida.py [--sortie DOSSIER] [--garder] [groupe|tous] [identifiant ...]

groupes : shims (scripts/lucida_shims.py) | matte (scripts/lucida_matte.py) | pipeline (_prep_image et _detourer_sujet de
scripts/trellis2_native_full_pipeline.py) | fusion (scripts/fusion_masques.py) | detourage (modal_app/_detourage.py) | app (modal_app/app.py).
Tout se joue dans UN seul processus (torch et transformers ne sont importes qu'une fois) ; un temoin SANS mutation precede chaque filtre et doit etre
vert. Les groupes shims, matte, pipeline et detourage importent torch : les lancer par `bash /c/tmp/lourd.sh <python de l'appli> ...`. `fusion` et `app`
sont legers. Sortie : une ligne par mutant (TUE / SURVIT) puis le bilan ; code de sortie 1 si un mutant survit. Les copies mutantes sont ecrites dans
--sortie (dossier temporaire par defaut, supprime a la fin sauf --garder).

Un extrait doit apparaitre EXACTEMENT n fois dans le fichier d'origine, sinon le pilote s'arrete : apres une modification VOULUE d'un fichier de la piste,
mettre l'extrait a jour (ou retirer le mutant). Les extraits sont d'une ligne ou d'une partie de ligne : les fins de ligne n'ont pas d'importance.
"""
import argparse
import importlib.util
import io
import itertools
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

NOYAUX = os.path.dirname(os.path.abspath(__file__))
racine = os.path.abspath(os.path.join(NOYAUX, '..', '..', '..'))

CIBLES = {
    'shims': ('scripts/lucida_shims.py', 'test_lucida_shims.py', 'NOYAU_LUCIDA_SHIMS'),
    'matte': ('scripts/lucida_matte.py', 'test_lucida_shims.py', 'NOYAU_LUCIDA_MATTE'),
    'pipeline': ('scripts/trellis2_native_full_pipeline.py', 'test_lucida_shims.py', 'NOYAU_PIPELINE3D'),
    'fusion': ('scripts/fusion_masques.py', 'test_fusion_masques.py', 'NOYAU_FUSION_MASQUES'),
    'detourage': ('modal_app/_detourage.py', 'test_detourage_modal.py', 'NOYAU_DETOURAGE_MODAL'),
    'app': ('modal_app/app.py', 'test_lucida_image_modal.py', 'NOYAU_APP'),
}

# (identifiant, groupe, extrait d'origine, extrait mute, nombre d'occurrences, filtre -k de unittest (liste de sous-chaines) ou None = tout le fichier de test)
M = []


def mut(ident, groupe_, avant, apres, n=1, k=None):
    M.append((ident, groupe_, avant, apres, n, k))


# ---- shims ---------------------------------------------------------------------------------------------------------------
mut('S01_droppath_actif_en_eval', 'shims', "    if drop_prob == 0. or not training:", "    if drop_prob == 0.:", k=['TestTimmLayers'])
mut('S02_droppath_sans_echelle', 'shims', "        masque.div_(keep_prob)", "        pass", k=['TestTimmLayers'])
mut('S03_centre_du_noyau', 'shims', "    noyau[ky // 2, kx // 2] = 1 - noyau.sum()", "    noyau[ky // 2, kx // 2] = -noyau.sum()", k=['TestLaplacian'])
mut('S04_normalisation_signee', 'shims', "        noyau = noyau / noyau.abs().sum()", "        noyau = noyau / noyau.sum()", k=['TestLaplacian'])
mut('S05_marge_xy_inversee', 'shims', "(kx // 2, kx // 2, ky // 2, ky // 2), mode=bordure)", "(ky // 2, ky // 2, kx // 2, kx // 2), mode=bordure)", k=['TestLaplacian'])
mut('S06_to_2tuple_chaine', 'shims', "    if isinstance(x, collections.abc.Iterable) and not isinstance(x, str):", "    if isinstance(x, collections.abc.Iterable):", k=['TestTimmLayers'])
mut('S07_trunc_normal_rend_none', 'shims', "    return tensor", "    return None", k=['TestTimmLayers'])
mut('S08_le_vrai_paquet_ne_gagne_pas', 'shims', "        ok, raison = _vrai_paquet_utilisable(sous_module, noms)", "        ok, raison = False, 'mutant'", k=['TestInstaller'])
mut('S09_restes_non_purges', 'shims', "        _purger(paquet)", "        pass", k=['TestInstaller'])
mut('S10_sans_spec', 'shims', "    module.__spec__ = importlib.machinery.ModuleSpec(nom, None, is_package=paquet)", "    module.__spec__ = None", k=['TestInstaller'])
mut('S11_dll_bloquee_non_rattrapee', 'shims', "    except Exception as e:", "    except ImportError as e:", k=['TestInstaller'])
mut('S12_substitut_pas_reconnu', 'shims', "        if _est_substitut(paquet):", "        if False:", k=['TestInstaller'])
mut('S13_marque_absente', 'shims', "    setattr(module, MARQUE, True)", "    pass", k=['TestInstaller'])
mut('S14_attribut_manquant_accepte', 'shims', "            getattr(module, nom)", "            pass", k=['TestInstaller'])

# ---- matte ---------------------------------------------------------------------------------------------------------------
mut('L01_cache_appli_ignore', 'matte', "    for hub in _hubs_de_l_appli(env):", "    for hub in []:", k=['TestRechercheDesPoids'])
mut('L02_telechargement_sans_demande', 'matte', '        if env.get("FABMESH_LUCIDA_TELECHARGER") == "1" and env.get("HF_HUB_OFFLINE") != "1":',
    '        if env.get("HF_HUB_OFFLINE") != "1":', k=['TestRechercheDesPoids'])
mut('L03_telechargement_hors_ligne', 'matte', '        if env.get("FABMESH_LUCIDA_TELECHARGER") == "1" and env.get("HF_HUB_OFFLINE") != "1":',
    '        if env.get("FABMESH_LUCIDA_TELECHARGER") == "1":', k=['TestRechercheDesPoids'])
mut('L04_pas_de_sortie_rapide_sans_poids', 'matte', "        _source_modele()", "        pass", k=['TestContratLucidaMatte'])
mut('L05_pas_de_plafond_vram', 'matte', "_CM.plafonner_vram(torch)", "pass", k=['TestChargement'])
mut('L06_pas_de_substituts', 'matte', '    lucida_shims.installer(log=lambda m: print(f"LUCIDA: {m}", flush=True))', "    pass", k=['TestChargement', 'TestFauxLucidaDeBoutEnBout'])
mut('L07_taille_inversee', 'matte', "    alpha = transforms.functional.resize(preds[0], rgb.size[::-1]).squeeze(0)",
    "    alpha = transforms.functional.resize(preds[0], rgb.size).squeeze(0)", k=['TestContratLucidaMatte'])
mut('L08_code_retour_poids_absents', 'matte', "        sys.exit(2)", "        sys.exit(1)", n=2, k=['TestContratLucidaMatte'])
mut('L09_demi_precision_sans_carte', 'matte', '    demi = dev == "cuda" and os.environ.get("FABMESH_LUCIDA_FP16") == "1"',
    '    demi = os.environ.get("FABMESH_LUCIDA_FP16") == "1"', k=['TestChargement'])
mut('L10_revision_main_pas_preferee', 'matte', "    noms.sort(key=lambda n: (n != principal, n))", "    noms.sort()", k=['TestRechercheDesPoids'])
mut('L11_telechargement_toujours_autorise', 'matte', "        source, trust_remote_code=True, dtype=torch.float32, local_files_only=local)",
    "        source, trust_remote_code=True, dtype=torch.float32, local_files_only=False)", k=['TestChargement'])
mut('L12_poids_vides_acceptes', 'matte', "    return any(_taille(os.path.join(d, p)) > 0 for p in FICHIERS_POIDS)", "    return any(_taille(os.path.join(d, p)) > -1 for p in FICHIERS_POIDS)",
    k=['TestRechercheDesPoids'])
mut('L13_pas_de_chemin_du_script', 'matte', "    sys.path.insert(0, _ICI)", "    pass", k=['TestContratLucidaMatte'])
mut('L14_modele_charge_chaque_fois', 'matte', "    if _MODELE is not None:\n", "    if False:\n", k=['TestChargement'])

# ---- pipeline ------------------------------------------------------------------------------------------------------------
mut('P01_delai_du_sous_processus', 'pipeline', "timeout=240,", "timeout=24,", k=['TestPrepImage'])
mut('P02_code_retour_ignore', 'pipeline', "        if r.returncode != 0:", "        if False:", k=['TestPrepImage'])
mut('P03_pas_de_refus_lucida', 'pipeline', "        raison = fusion_masques.refus_lucida(alpha)", "        raison = None", k=['TestPrepImage'])
mut('P04_poignee_du_fichier_gardee', 'pipeline', "        ouverte.close()", "        pass", k=['TestPrepImage'])
mut('P05_union_remplacee_par_lucida', 'pipeline', "        union = fusion_masques.fusionner_alphas(alpha_u2, alpha_lucida)", "        union = alpha_lucida", k=['TestPrepImage'])
mut('P06_mode_u2net_appelle_lucida', 'pipeline', "    if mode != 'u2net':", "    if True:", k=['TestPrepImage'])
mut('P07_lucida_voit_l_image_non_orientee', 'pipeline', "alpha_lucida, raison, sortie = _masque_lucida_sous_processus(orientee)",
    "alpha_lucida, raison, sortie = _masque_lucida_sous_processus(source)", k=['TestPrepImage'])
mut('P08_console_visible', 'pipeline', "creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)", "creationflags=0", k=['TestPrepImage'])
mut('P09_dossier_temporaire_garde', 'pipeline', "        shutil.rmtree(dossier, ignore_errors=True)", "        pass", k=['TestPrepImage'])
mut('P10_delai_non_reconnu', 'pipeline', "        except subprocess.TimeoutExpired:", "        except KeyError:", k=['TestPrepImage'])
mut('P11_taille_non_verifiee', 'pipeline', "        if candidat.size != orientee.size:", "        if False:", k=['TestPrepImage'])
mut('P12_entree_heritee', 'pipeline', "stdin=subprocess.DEVNULL, ", "", k=['TestPrepImage'])
mut('P13_raison_du_repli_perdue', 'pipeline', "        log(f'detourage: u2net ({raison})')", "        log(f'detourage: ({raison})')", k=['TestPrepImage'])
mut('P14_union_qui_leve_remonte', 'pipeline', "        log(f'detourage: u2net (union impossible : {type(e).__name__}: {e})')", "        raise", k=['TestPrepImage'])
mut('P15_dossier_temporaire_qui_leve_remonte', 'pipeline', "        return None, f'dossier temporaire impossible ({type(e).__name__}: {e})', ''", "        raise", k=['TestPrepImage'])
mut('P16_variable_non_nettoyee', 'pipeline', "    brut = (os.environ.get('FABMESH_DETOURAGE') or '').strip().lower()", "    brut = (os.environ.get('FABMESH_DETOURAGE') or '').lower()", k=['TestPrepImage'])
mut('P17_alpha_lu_apres_union_seulement', 'pipeline', "        alpha = np.array(candidat.getchannel('A'), dtype=np.uint8)", "        alpha = np.array(candidat.convert('L'), dtype=np.uint8)", k=['TestPrepImage'])
mut('P18_pas_de_repli_fusion_absente', 'pipeline', "        return rembg.remove(image.convert('RGBA'), session=rembg.new_session('u2net'))", "        raise", k=['TestPrepImage'])
mut('P19_python_du_sous_processus_fige', 'pipeline', "os.environ.get('FABMESH_LUCIDA_PYTHON') or sys.executable", "sys.executable", k=['TestPrepImage'])

# ---- fusion --------------------------------------------------------------------------------------------------------------
mut('F01_seuil_u2net_strict', 'fusion', "    sur_u2 = np.where(a_u2 >= seuil, a_u2, np.uint8(0))", "    sur_u2 = np.where(a_u2 > seuil, a_u2, np.uint8(0))")
mut('F02_minimum_au_lieu_du_maximum', 'fusion', "    return np.maximum(a_lucida, sur_u2).astype(np.uint8, copy=False)", "    return np.minimum(a_lucida, sur_u2).astype(np.uint8, copy=False)")
mut('F03_part_max', 'fusion', "PART_MAX_LUCIDA = 0.95", "PART_MAX_LUCIDA = 0.99")
mut('F04_part_min', 'fusion', "PART_MIN_LUCIDA = 0.01", "PART_MIN_LUCIDA = 0.001")
mut('F05_composante_min', 'fusion', "COMPOSANTE_MIN_LUCIDA = 0.005", "COMPOSANTE_MIN_LUCIDA = 0.0005")
mut('F06_lucida_defaillant_large', 'fusion', '"lucida_defaillant": 2 * n_lu < n_u2,', '"lucida_defaillant": 2 * n_lu <= n_u2,')
mut('F07_u2net_defaillant_large', 'fusion', '"u2net_defaillant": 5 * n_u2 < 4 * n_lu,', '"u2net_defaillant": 5 * n_u2 <= 4 * n_lu,')
mut('F08_mode_par_defaut', 'fusion', '    return "union"', '    return "u2net"')
mut('F09_connexite_8', 'fusion', "        for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):",
    "        for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1), (y - 1, x - 1), (y + 1, x + 1), (y - 1, x + 1), (y + 1, x - 1)):")
mut('F10_case_pleine_au_dessus_de_la_moitie', 'fusion', "    grille = (2 * pleins >= totaux).reshape(cy, cx)", "    grille = (2 * pleins > totaux).reshape(cy, cx)")
mut('F11_borne_haute_exclue', 'fusion', "    if part > PART_MAX_LUCIDA:", "    if part >= PART_MAX_LUCIDA:")
mut('F12_borne_basse_exclue', 'fusion', "    if part < PART_MIN_LUCIDA:", "    if part <= PART_MIN_LUCIDA:")
mut('F13_composante_borne_exclue', 'fusion', "    if grande < COMPOSANTE_MIN_LUCIDA:", "    if grande <= COMPOSANTE_MIN_LUCIDA:")
mut('F14_entree_modifiee', 'fusion', "    sur_u2 = np.where(a_u2 >= seuil, a_u2, np.uint8(0))", "    a_u2[a_u2 < seuil] = 0\n    sur_u2 = a_u2")
mut('F15_seuil_du_diagnostic', 'fusion', "SEUIL_SUJET = 127", "SEUIL_SUJET = 128")

# ---- detourage Modal -----------------------------------------------------------------------------------------------------
mut('D01_echec_non_memorise', 'detourage', "        _LUCIDA_ESSAYE = True       # APRES _LUCIDA : un fil qui voit le drapeau voit aussi le modele", "        pass")
mut('D02_chargement_sans_verrou', 'detourage', "    with _VERROU_CHARGEMENT:", "    if True:", n=2)
mut('D03_inferences_non_serialisees', 'detourage', "        with _VERROU_INFERENCE:", "        if True:")
mut('D04_mode_u2net_appelle_lucida', 'detourage', '    if mode == "u2net":', "    if False:")
mut('D05_pas_de_refus_lucida', 'detourage', "        raison = refus_lucida(a_lucida)", "        raison = None")
mut('D06_charge_sans_carte', 'detourage', "    if not torch.cuda.is_available():", "    if False:")
mut('D07_telechargement_par_defaut', 'detourage', '    options["local_files_only"] = os.environ.get("FABMESH_LUCIDA_TELECHARGER") != "1"', '    options["local_files_only"] = False')
mut('D08_dossier_local_ignore', 'detourage', "    if dossier and os.path.isdir(dossier):", "    if False:")
mut('D09_cache_cuda_non_vide', 'detourage', "                    self.torch.cuda.empty_cache()", "                    pass")
mut('D10_exif_ignore', 'detourage', "    img = ImageOps.exif_transpose(img)", "    img = img")
mut('D11_mode_fige', 'detourage', '    mode = mode_detourage(os.environ.get("FABMESH_DETOURAGE"))   # relue A CHAQUE APPEL : on peut basculer sans redemarrer', '    mode = "union"')
mut('D12_union_remplacee_par_lucida', 'detourage', "        m_union = Image.fromarray(fusionner_alphas(a_u2, a_lucida))", "        m_union = Image.fromarray(a_lucida)")
mut('D13_poids_u2net_absents', 'detourage', "    if not os.path.exists(POIDS_U2NET):", "    if False:")
mut('D14_substituts_non_installes', 'detourage', '    lucida_shims.installer(log=lambda m: _journal("[detourage] substituts timm/kornia : %s" % m))', "    pass")
mut('D15_masque_non_verifie', 'detourage', "        if not isinstance(alpha, np.ndarray) or alpha.dtype != np.uint8 or alpha.shape != (hauteur, largeur):", "        if False:")
mut('D16_precharger_sans_effet_ignore', 'detourage', '        if mode_detourage(os.environ.get("FABMESH_DETOURAGE")) == "u2net":', "        if False:")
mut('D17_repli_signale_a_chaque_image', 'detourage', "        _REPLI_SIGNALE = True", "        pass")
mut('D18_revision_ignoree', 'detourage', '        options["revision"] = os.environ["FABMESH_LUCIDA_REVISION"]', "        pass")
mut('D19_modele_non_float32', 'detourage', "    modele.float()", "    pass")
mut('D20_modele_non_eval', 'detourage', "    modele.eval()", "    pass")
mut('D21_pas_de_code_distant', 'detourage', '    options = {"trust_remote_code": True}', "    options = {}")
mut('D22_absence_de_carte_memorisee', 'detourage', "            return None\n        except Exception as e:", "            _LUCIDA_ESSAYE = True\n            return None\n        except Exception as e:")

# ---- app.py (images Modal) -----------------------------------------------------------------------------------------------
mut('A01_revision_flottante', 'app', "revision='6cbedc9722652dc9a3df91dd871f0c4f3334e922'", "revision='main'", k=['TestDefinition'])
mut('A02_empreinte_fausse', 'app', "'274c3949a052b9da73885c8df33e6cf8605ea4280668e194e4a249cbcda06ec2'", "'174c3949a052b9da73885c8df33e6cf8605ea4280668e194e4a249cbcda06ec2'",
    k=['TestEmpreintesCorrespondentAuCache'])
mut('A03_backview_garde_son_image', 'app', "image=image_backview,", "image=image,", k=['TestImages'])
mut('A04_variable_du_dossier_absente_du_maillage', 'app', '    .env({"FABMESH_LUCIDA_DIR": _LUCIDA_DIR})\n', "", k=['TestImages'])
mut('A05_poids_hors_liste', 'app', "allow_patterns=['config.json', 'birefnet.py', 'BiRefNet_config.py', 'model.safetensors'])", "allow_patterns=['config.json', 'birefnet.py', 'BiRefNet_config.py'])",
    k=['TestDefinition'])
mut('A06_empreinte_des_poids_absente', 'app', "'2f1aa6913426537d4b93dd5f7138ae5c6664e99abda98c95f3d5b9101283e7d5' model.safetensors ", "", k=['TestDefinition'])
mut('A07_dossier_dans_le_cache', 'app', "local_dir='/opt/lucida', ", "", k=['TestDefinition'])
mut('A08_image_generale_avec_lucida', 'app', "image = _avec_sources(image)\n", "image = _avec_sources(image.run_commands(*_LUCIDA_DANS_L_IMAGE))\n", k=['TestImages'])

# ---- complements (apres la premiere passe) -------------------------------------------------------------------------------
mut('L15_variable_dossier_ignoree', 'matte', '    explicite = env.get("FABMESH_LUCIDA_DIR")\n    if explicite:', '    explicite = env.get("FABMESH_LUCIDA_DIR")\n    if False:',
    k=['TestRechercheDesPoids'])
mut('L16_code_distant_non_exige', 'matte', "    if not all(os.path.isfile(os.path.join(d, f)) for f in FICHIERS_CODE):", "    if False:", k=['TestRechercheDesPoids'])
mut('L17_cache_cuda_non_vide_par_liberer', 'matte', "                torch.cuda.empty_cache()", "                pass", k=['TestContratLucidaMatte'])
mut('L18_flux_intolerants', 'matte', '            flux.reconfigure(errors="replace")', "            pass", k=['TestContratLucidaMatte'])
mut('P20_modele_charge_non_journalise', 'pipeline', "                    log('detourage: ' + ligne[len('LUCIDA:'):].strip())", "                    pass", k=['TestPrepImage'])
mut('P21_pic_vram_non_journalise', 'pipeline', "                log(f'detourage: pic de VRAM PyTorch du sous-processus {pic.group(1)} Mo (hors contexte CUDA)')", "                pass", k=['TestPrepImage'])
mut('P22_entree_de_lucida_avec_perte', 'pipeline', "        orientee.convert('RGB').save(entree, 'PNG')", "        orientee.convert('RGB').save(entree, 'JPEG')", k=['TestPrepImage'])
mut('P23_mode_lucida_seul_ignore', 'pipeline', "            if mode == 'lucida':", "            if False:", k=['TestPrepImage'])
mut('P24_lucida_en_defaut_non_signale', 'pipeline', "        ligne += ' ; lucida en defaut'", "        pass", k=['TestPrepImage'])
mut('D23_mode_lucida_seul_ignore', 'detourage', '    if mode == "lucida":', "    if False:")
mut('D24_lucida_en_defaut_non_signale', 'detourage', '        ligne += " ; lucida en defaut"', "        pass")
mut('D25_u2net_en_defaut_non_signale', 'detourage', '        ligne += " ; u2net en defaut"', "        pass")


# ---------------------------------------------------------------------------------------------------------------------------
PREFIXES_A_OUBLIER = ('lucida', 'fusion_masques', 'detourage', 'remove_bg', 'transformers_modules', 'test_', 'mod_')
MARQUE_SUBSTITUT = '__fabmesh_substitut_pur_torch__'
_ABSENT = object()
_compteur = itertools.count()


def _a_nous(cle, obj):
    """Module introduit PAR LE TEST (code du depot, fichier de test, substituts pur torch de timm / kornia) : a oublier apres lui. Un module tiers
    (torch, transformers, numpy...) importe pour la premiere fois pendant un test reste en place : le retirer casserait ses extensions C."""
    if cle.split('.')[0].startswith(PREFIXES_A_OUBLIER):
        return True
    try:
        if getattr(obj, MARQUE_SUBSTITUT, False):
            return True
        fichier = getattr(obj, '__file__', None)
        return isinstance(fichier, str) and os.path.abspath(fichier).startswith(racine)
    except Exception:
        return False


def aplatir(suite):
    for t in suite:
        if isinstance(t, unittest.TestSuite):
            yield from aplatir(t)
        else:
            yield t


def executer(test, variable, chemin_mutant, k, torch_reel):
    """(nombre de tests, nombre d'echecs + erreurs, apercu) du fichier de test charge NEUF avec `variable` = chemin_mutant (ou retiree)."""
    avant_env = {v: os.environ.get(v) for v in (variable, 'DETOURAGE_TEST_TORCH')}
    if chemin_mutant is None:
        os.environ.pop(variable, None)
    else:
        os.environ[variable] = chemin_mutant
    if torch_reel:
        os.environ['DETOURAGE_TEST_TORCH'] = '1'
    modules_avant = dict(sys.modules)
    chemin_avant = list(sys.path)
    nom = 'test_mut_%d' % next(_compteur)
    spec = importlib.util.spec_from_file_location(nom, os.path.join(NOYAUX, test))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nom] = mod
    try:
        spec.loader.exec_module(mod)
        tests = list(aplatir(unittest.defaultTestLoader.loadTestsFromModule(mod)))
        if k:
            tests = [t for t in tests if any(p in t.id() for p in k)]
        res = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(unittest.TestSuite(tests))
        pb = [t.id().split('.', 1)[-1] for t, _ in (res.failures + res.errors)]
        return res.testsRun, len(pb), (pb[:3] if pb else [])
    except BaseException as e:      # le mutant peut casser l'IMPORT du test lui-meme : c'est une mort, pas un crash du pilote
        return 0, 1, ['IMPORT : %s: %s' % (type(e).__name__, str(e)[:100])]
    finally:
        for cle, val in avant_env.items():
            if val is None:
                os.environ.pop(cle, None)
            else:
                os.environ[cle] = val
        # l'etat du processus est remis comme avant le test : une entree REMPLACEE retrouve son ancien objet, une entree RETIREE revient, une entree
        # NOUVELLE disparait si elle est a nous. Sans cela, ce que le code teste enregistre lui-meme (les substituts de timm / kornia de
        # lucida_shims.installer) survivait au test suivant et le faisait echouer pour une raison etrangere au mutant.
        for cle, obj in list(sys.modules.items()):
            ancien = modules_avant.get(cle, _ABSENT)
            if ancien is obj:
                continue
            if ancien is _ABSENT:
                if _a_nous(cle, obj):
                    sys.modules.pop(cle, None)
            else:
                sys.modules[cle] = ancien
        for cle, ancien in modules_avant.items():
            if cle not in sys.modules:
                sys.modules[cle] = ancien
        sys.path[:] = chemin_avant
        sys.modules.pop(nom, None)


def main(argv=None):
    ap = argparse.ArgumentParser(description='Preuve par mutation de la piste L (Lucida + u2net).')
    ap.add_argument('groupe', nargs='?', default='tous', help='shims | matte | pipeline | fusion | detourage | app | tous (defaut)')
    ap.add_argument('identifiants', nargs='*', help='identifiants de mutants (defaut : tous ceux du groupe)')
    ap.add_argument('--sortie', default=None, help='dossier des copies mutantes (defaut : dossier temporaire)')
    ap.add_argument('--garder', action='store_true', help='ne pas supprimer le dossier des copies mutantes')
    a = ap.parse_args(argv)
    os.environ['MUTANTS_LUCIDA_EN_COURS'] = '1'         # les tests qui rejouent CE pilote se sautent (sinon recursion sans fin)
    voulus = set(a.identifiants)
    sel = [m for m in M if (a.groupe == 'tous' or m[1] == a.groupe) and (not voulus or m[0] in voulus)]
    if not sel:
        raise SystemExit('aucun mutant pour %r %r (groupes : %s)' % (a.groupe, sorted(voulus), sorted(CIBLES)))
    dossier = a.sortie or tempfile.mkdtemp(prefix='mutants_lucida_')
    os.makedirs(dossier, exist_ok=True)
    temoins, bilan = {}, []
    try:
        for ident, g, avant, apres, n, k in sel:
            rel, test, variable = CIBLES[g]
            torch_reel = (g == 'detourage')
            cle_temoin = (test, tuple(k or ()), torch_reel)
            # temoin JUSTE AVANT chaque mutant (meme etat du processus que lui) : si un test echoue sans mutation, la mort du mutant ne prouverait rien
            t0 = time.time()
            nb0, pb0, apercu0 = executer(test, variable, None, k, torch_reel)
            if pb0:
                raise SystemExit('le temoin sans mutation echoue avant %s (%s -k %s) : %s -- le pilote ne prouve rien dans cet etat'
                                 % (ident, test, list(k or []), apercu0))
            if cle_temoin not in temoins:
                temoins[cle_temoin] = nb0
                print('[temoin] %s -k %s : %d tests, 0 echec (%.1f s)' % (test, list(k or []), nb0, time.time() - t0), flush=True)
            with open(os.path.join(racine, rel), 'rb') as f:
                brut = f.read().decode('utf-8')
            nl = '\r\n' if '\r\n' in brut else '\n'
            avant_f, apres_f = avant.replace('\n', nl), apres.replace('\n', nl)
            trouve = brut.count(avant_f)
            if trouve != n:
                raise SystemExit('%s : extrait trouve %d fois (attendu %d) : %r' % (ident, trouve, n, avant))
            sortie_mutant = os.path.join(dossier, ident + os.path.splitext(rel)[1])
            with open(sortie_mutant, 'wb') as f:
                f.write(brut.replace(avant_f, apres_f).encode('utf-8'))
            t0 = time.time()
            nb, pb, apercu = executer(test, variable, sortie_mutant, k, torch_reel)
            tue = pb > 0
            bilan.append({'id': ident, 'groupe': g, 'tue': tue, 'tests': nb, 'echecs': pb, 'apercu': apercu, 'duree_s': round(time.time() - t0, 1)})
            print('%-48s %-7s %3d/%3d echec(s) %s (%.1f s)' % (ident, 'TUE' if tue else 'SURVIT', pb, nb, apercu[:2], time.time() - t0), flush=True)
    finally:
        if not a.garder and not a.sortie:
            shutil.rmtree(dossier, ignore_errors=True)
    survivants = [b['id'] for b in bilan if not b['tue']]
    print('\n%d mutant(s), %d tue(s), %d survivant(s) : %s' % (len(bilan), len(bilan) - len(survivants), len(survivants), survivants))
    if a.sortie:
        with open(os.path.join(dossier, 'bilan_%s.json' % a.groupe), 'w', encoding='utf-8') as f:
            json.dump(bilan, f, indent=1, ensure_ascii=False)
    return 1 if survivants else 0


if __name__ == '__main__':
    sys.exit(main())
