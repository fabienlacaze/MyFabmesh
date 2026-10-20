"""Reconstruit la roue Windows de CuMesh (bureau) avec le BVH MIT de cubvh (2026-10-15).

POURQUOI. La roue `cumesh-1.0-cp311-cp311-win_amd64.whl` livree avec l'appli (extraResources build/wheels, installee par
scripts/wizard_install_deps.py ; publiee aussi dans la pre-release `trellis2-wheels-v1` du depot PUBLIC) embarque
`cumesh/_cubvh.cp311-win_amd64.pyd`, compile avec le BVH d'instant-ngp (classe TriangleBvhWithBranchingFactor), sous
NVIDIA Source Code License = « research or evaluation purposes only ». Mesure du 15/10/2026 sur la roue publique
(sha256 d1ed72df...) ET sur le .pyd installe dans le Python de l'appli : la signature est presente. ashawkey/cubvh a
reecrit ce BVH sous MIT (c7379c0, 26/08/2026). Voir docs/cumesh_licence_et_fill_holes_2026-10-15.md.

COMMENT LA ROUE ACTUELLE A ETE FAITE (verifie le 15/10 : couche Python octet pour octet identique, fins de ligne
comprises, a visualbruno/CuMesh d10e54c « version 1.0 », 08/03/2026) : « distribution ComfyUI-Trellis2 (Torch280) »
(build/fetch_trellis2_wheels.py), c'est-a-dire le fork visualbruno/CuMesh, qui versionne cubvh DANS l'arbre
(third_party/cubvh, avec LICENSE_NVIDIA). Ce script refait la MEME roue en remplacant seulement third_party/cubvh par
ashawkey/cubvh epingle (de1badf, MIT). Le correctif de fill_holes de la PR #41 n'est PAS applique : visualbruno l'avait
deja corrige autrement (de49c4a, somme refaite par un noyau GPU).

CE SCRIPT NE COMPILE RIEN SANS --construire, et n'installe aucun paquet. La compilation exige une machine avec :
Python 3.11 COMPLET (avec Include/ ; l'interpreteur embarque de l'appli ne convient pas), torch 2.8.0+cu128,
setuptools, wheel, ninja, CUDA 12.8 (nvcc), Visual Studio 2022 Build Tools (invite « x64 Native Tools »), git.

    python build/reconstruire_roue_cumesh.py --verifier [roue.whl ...]   garde (code 1 si BVH d'instant-ngp) ; sans argument :
                                                                         build/wheels/cumesh-*.whl (absent = avertissement, code 0)
    python build/reconstruire_roue_cumesh.py --prerequis                 la machine peut-elle compiler ? (ne compile rien)
    python build/reconstruire_roue_cumesh.py --preparer <dossier>        clones GitHub + remplacement de cubvh + garde des sources
    python build/reconstruire_roue_cumesh.py --construire <dossier>      --preparer, compilation, garde de la roue, sha256
    options : --version 1.0.1  --archs "8.6;8.9;12.0+PTX"  --a-blanc (affiche le plan, ne clone ni ne compile)
              --sortie <dossier> (defaut build/wheels ; l'ancienne roue n'est JAMAIS ecrasee)

Apres la construction : voir « Marche a suivre » dans docs/cumesh_licence_et_fill_holes_2026-10-15.md (essai sur la
machine, publication d'une pre-release trellis2-wheels-v2, epingles de build/fetch_trellis2_wheels.py et de
scripts/wizard_install_deps.py, THIRD_PARTY_LICENSES section 40).
"""
import argparse
import glob
import hashlib
import importlib.util
import os
import shutil
import stat
import subprocess
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, 'modal_app'))
import construction_cumesh as cc  # noqa: E402  (garde partagee avec l'image Modal)

VERSION_ROUE = '1.0.1'                       # >= a la 1.0 livree : pip remplace l'ancienne roue (cumesh==1.0 se croit satisfait)
ARCHS_PAR_DEFAUT = '8.6;8.9;12.0+PTX'        # Ampere, Ada, Blackwell (RTX 50) en natif ; la roue d'origine ne porte que le motif sm_86
LIGNE_VERSION_AVANT = 'version = "1.0"'
SORTIE_PAR_DEFAUT = os.path.join(RACINE, 'build', 'wheels')


class Echec(Exception):
    pass


# ---------------------------------------------------------------------------------------------------------
# Garde d'une roue
# ---------------------------------------------------------------------------------------------------------
def verifier_roues(chemins):
    """Rend (nombre de roues refusees, messages). Aucune roue = avertissement, pas un refus (arbre de dev)."""
    if not chemins:
        return 0, ['aucune roue cumesh a verifier (build/wheels absent : normal en developpement)']
    refus, msgs = 0, []
    for c in chemins:
        try:
            membres = cc.verifier_roue(c)
            msgs.append(f'conforme : {os.path.basename(c)} ({", ".join(membres)})')
        except cc.RefusConstruction as e:
            refus += 1
            msgs.append(f'REFUSEE : {e}')
    return refus, msgs


# ---------------------------------------------------------------------------------------------------------
# Prerequis de la machine (fonction PURE : les sondes sont fournies, donc testable partout)
# ---------------------------------------------------------------------------------------------------------
def sonder():
    """Observe la machine courante. Importe torch SEULEMENT ici."""
    s = {'plateforme': sys.platform, 'python': sys.version_info[:2], 'git': shutil.which('git'),
         'nvcc': shutil.which('nvcc'), 'cl': shutil.which('cl'), 'python_h': None, 'torch': None, 'cuda_torch': None,
         'setuptools': importlib.util.find_spec('setuptools') is not None,
         'wheel': importlib.util.find_spec('wheel') is not None, 'nvcc_version': None}
    try:
        import sysconfig
        h = os.path.join(sysconfig.get_paths()['include'], 'Python.h')
        s['python_h'] = h if os.path.isfile(h) else None
    except Exception:
        pass
    if s['nvcc']:
        try:
            s['nvcc_version'] = subprocess.run([s['nvcc'], '--version'], capture_output=True, text=True, timeout=60).stdout
        except Exception:
            pass
    try:
        import torch
        s['torch'], s['cuda_torch'] = torch.__version__, torch.version.cuda
    except Exception:
        pass
    return s


def problemes_prerequis(s):
    p = []
    if s.get('plateforme') != 'win32':
        p.append('cette roue est une roue Windows (win_amd64) : a construire sous Windows')
    if tuple(s.get('python') or ()) != (3, 11):
        p.append(f"Python 3.11 exige (cp311), trouve {s.get('python')}")
    if not s.get('python_h'):
        p.append("Python.h introuvable : il faut un Python 3.11 COMPLET (avec Include/), pas l'interpreteur embarque de l'appli")
    if not s.get('git'):
        p.append('git introuvable dans le PATH')
    if not s.get('torch'):
        p.append('torch introuvable : torch 2.8.0+cu128 exige (la roue est liee a cette version)')
    elif not str(s['torch']).startswith('2.8.0') or s.get('cuda_torch') != '12.8':
        p.append(f"torch {s['torch']} (CUDA {s.get('cuda_torch')}) : torch 2.8.0 avec CUDA 12.8 exige")
    if not s.get('nvcc'):
        p.append('nvcc introuvable dans le PATH (CUDA Toolkit 12.8)')
    elif s.get('nvcc_version') and 'release 12.8' not in s['nvcc_version']:
        p.append('nvcc n\'est pas la version 12.8 (release 12.8 attendue)')
    if not s.get('cl'):
        p.append("cl.exe introuvable : lancer depuis l'invite « x64 Native Tools Command Prompt for VS 2022 »")
    for mod in ('setuptools', 'wheel'):
        if not s.get(mod):
            p.append(f'module Python {mod} absent (build sans isolation : rien ne sera telecharge par ce script)')
    return p


# ---------------------------------------------------------------------------------------------------------
# Preparation des sources
# ---------------------------------------------------------------------------------------------------------
def _git(*args, cwd=None):
    r = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise Echec(f"git {' '.join(args)} a echoue : {(r.stderr or r.stdout).strip()[-600:]}")
    return r.stdout.strip()


def _supprimer_arbre(chemin):
    """Supprime un dossier ordinaire (fichiers suivis par git, sans jonction ni lien)."""
    def corriger(fonction, p, _info):
        os.chmod(p, stat.S_IWRITE)
        fonction(p)
    est_jonction = getattr(os.path, 'isjunction', lambda p: False)      # Python >= 3.12
    for dossier, sous, fichiers in os.walk(chemin):
        for nom in sous + fichiers:
            p = os.path.join(dossier, nom)
            if os.path.islink(p) or est_jonction(p):
                raise Echec(f'{p} est un lien/une jonction : suppression refusee')
    if sys.version_info >= (3, 12):
        shutil.rmtree(chemin, onexc=corriger)
    else:
        shutil.rmtree(chemin, onerror=corriger)


def remplacer_version(chemin_pyproject, version):
    """version = "1.0" -> version = "<version>" : exactement une occurrence, fins de ligne conservees."""
    with open(chemin_pyproject, 'rb') as f:
        brut = f.read().decode('utf-8')
    if brut.count(LIGNE_VERSION_AVANT) != 1:
        raise Echec(f'{chemin_pyproject} : {brut.count(LIGNE_VERSION_AVANT)} occurrence(s) de [{LIGNE_VERSION_AVANT}] '
                    '(1 attendue) : le fork a change, revoir le script')
    with open(chemin_pyproject, 'wb') as f:
        f.write(brut.replace(LIGNE_VERSION_AVANT, f'version = "{version}"').encode('utf-8'))


def preparer(dossier, version=VERSION_ROUE, depot_cumesh=None, depot_cubvh=None, log=print):
    """Clone le fork epingle, remplace third_party/cubvh par ashawkey/cubvh epingle, garde les sources, fixe la version.
    Rend le dossier des sources (a donner a `pip wheel`)."""
    depot_cumesh = depot_cumesh or cc.CUMESH_BUREAU_DEPOT
    depot_cubvh = depot_cubvh or cc.CUBVH_DEPOT
    dossier = os.path.abspath(dossier)
    if os.path.exists(dossier) and os.listdir(dossier):
        raise Echec(f'{dossier} existe et n\'est pas vide (dossier de travail NEUF exige)')
    os.makedirs(dossier, exist_ok=True)
    src = os.path.join(dossier, 'CuMesh')
    log(f'[1/4] clone {depot_cumesh} @ {cc.CUMESH_BUREAU_COMMIT[:7]}')
    _git('clone', '--quiet', depot_cumesh, src)
    _git('checkout', '--quiet', cc.CUMESH_BUREAU_COMMIT, cwd=src)
    cub = os.path.join(src, 'third_party', 'cubvh')
    log('[2/4] remplacement de third_party/cubvh (BVH d\'instant-ngp, LICENSE_NVIDIA) par ashawkey/cubvh epingle')
    if os.path.isdir(cub):
        _supprimer_arbre(cub)
    _git('clone', '--quiet', depot_cubvh, cub)
    _git('checkout', '--quiet', cc.CUBVH_COMMIT, cwd=cub)
    _git('submodule', 'update', '--init', '--recursive', '--quiet', cwd=cub)
    log('[3/4] garde des sources de cubvh')
    resume = cc.verifier_sources_cubvh(cub, exiger_git=True)
    eigen = os.path.join(cub, 'third_party', 'eigen', 'Eigen', 'Dense')
    if not os.path.isfile(eigen):
        raise Echec(f'{eigen} absent : le sous-module Eigen de cubvh n\'a pas ete recupere (gitlab.com injoignable ?)')
    log(f"      conforme : cubvh {resume['commit'][:10]}, {resume['fichiers_lus']} fichiers lus")
    log(f'[4/4] version de la roue : {version}')
    remplacer_version(os.path.join(src, 'pyproject.toml'), version)
    return src


# ---------------------------------------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------------------------------------
def sha256_de(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest()


def commande_construction(src, sortie_tmp):
    return [sys.executable, '-m', 'pip', 'wheel', '--no-deps', '--no-build-isolation', '-w', sortie_tmp, src]


def construire(dossier, sortie, version=VERSION_ROUE, archs=ARCHS_PAR_DEFAUT, a_blanc=False, log=print):
    if a_blanc:
        src = os.path.join(os.path.abspath(dossier), 'CuMesh')
        tmp = os.path.join(os.path.abspath(dossier), 'roue')
        log('[a blanc] rien n\'est clone ni compile. Plan :')
        log(f'  1. git clone {cc.CUMESH_BUREAU_DEPOT} @ {cc.CUMESH_BUREAU_COMMIT}  ->  {src}')
        log(f'  2. third_party/cubvh remplace par {cc.CUBVH_DEPOT} @ {cc.CUBVH_COMMIT} (+ sous-module Eigen) ; garde des sources')
        log(f'  3. pyproject.toml : version = "{version}"')
        log(f'  4. TORCH_CUDA_ARCH_LIST={archs} ; {" ".join(commande_construction(src, tmp))}')
        log(f'  5. garde de la roue (BVH MIT), sha256, copie dans {sortie} sous un NOM NOUVEAU (l\'ancienne roue reste)')
        return None
    problemes = problemes_prerequis(sonder())
    if problemes:
        raise Echec('machine non prete :\n  - ' + '\n  - '.join(problemes))
    src = preparer(dossier, version=version, log=log)
    tmp = os.path.join(os.path.abspath(dossier), 'roue')
    os.makedirs(tmp, exist_ok=True)
    env = dict(os.environ, TORCH_CUDA_ARCH_LIST=archs, FORCE_CUDA='1', DISTUTILS_USE_SDK='1')
    log(f'[compilation] TORCH_CUDA_ARCH_LIST={archs} (plusieurs dizaines de minutes ; fenetre a ne pas fermer)')
    r = subprocess.run(commande_construction(src, tmp), env=env)
    if r.returncode != 0:
        raise Echec(f'pip wheel a echoue (code {r.returncode}) : lire la sortie ci-dessus')
    roues = glob.glob(os.path.join(tmp, f'cumesh-{version}-*.whl'))
    if len(roues) != 1:
        raise Echec(f'{len(roues)} roue(s) cumesh-{version}-*.whl dans {tmp} (1 attendue)')
    roue = roues[0]
    log('[garde] roue construite')
    cc.verifier_roue(roue)
    os.makedirs(sortie, exist_ok=True)
    cible = os.path.join(sortie, os.path.basename(roue))
    if os.path.exists(cible):
        raise Echec(f'{cible} existe deja : pas d\'ecrasement')
    shutil.copyfile(roue, cible)
    log(f'[ok] {cible}\n     sha256 {sha256_de(cible)}\n     {os.path.getsize(cible)} octets')
    return cible


# ---------------------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--verifier', nargs='*', metavar='ROUE', help='garde des roues (defaut : build/wheels/cumesh-*.whl)')
    g.add_argument('--prerequis', action='store_true')
    g.add_argument('--preparer', metavar='DOSSIER')
    g.add_argument('--construire', metavar='DOSSIER')
    ap.add_argument('--version', default=VERSION_ROUE)
    ap.add_argument('--archs', default=ARCHS_PAR_DEFAUT)
    ap.add_argument('--a-blanc', action='store_true')
    ap.add_argument('--sortie', default=SORTIE_PAR_DEFAUT)
    a = ap.parse_args(argv)
    try:
        if a.verifier is not None:
            chemins = a.verifier or sorted(glob.glob(os.path.join(SORTIE_PAR_DEFAUT, 'cumesh-*.whl')))
            refus, msgs = verifier_roues(chemins)
            for m in msgs:
                print(f'[roue cumesh] {m}')
            return 1 if refus else 0
        if a.prerequis:
            p = problemes_prerequis(sonder())
            for x in p:
                print(f'[prerequis] MANQUE : {x}')
            print('[prerequis] machine prete' if not p else f'[prerequis] {len(p)} probleme(s)')
            return 1 if p else 0
        if a.preparer:
            preparer(a.preparer, version=a.version)
            print('[preparer] sources pretes (rien compile)')
            return 0
        construire(a.construire, a.sortie, version=a.version, archs=a.archs, a_blanc=a.a_blanc)
        return 0
    except (Echec, cc.RefusConstruction) as e:
        print(f'[roue cumesh] ECHEC : {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
