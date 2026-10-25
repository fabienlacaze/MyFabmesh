"""Construction de CuMesh avec le BVH MIT de cubvh + correctif de fill_holes (2026-10-14).

POURQUOI (verifie a la source le 14/10/2026, voir AGENT_LOG du jour) :

1. LICENCE. CuMesh (JeffreyXiang/CuMesh, MIT) compile le sous-module third_party/cubvh dans son extension
   `cumesh._cubvh` (cumesh.cuBVH : lancer de rayons, point le plus proche). Nous l'appelons en production :
   o_voxel.postprocess.to_glb (remaillage + cuisson de la texture), modal_app/_mesh.py::densifier,
   scripts/trellis2_native_full_pipeline.py::densifier, external_patches/TRELLIS2_win/o_voxel_patch.py.
   Le sous-module epingle par CuMesh (JeffreyXiang/cubvh, branche trellis.2, ce92267) contient le BVH
   d'instant-ngp (classes TriangleBvhWithBranchingFactor et DistAndIdx de instant-ngp/src/triangle_bvh.cu),
   sous NVIDIA Source Code License : « research or evaluation purposes only » (fichier LICENSE_NVIDIA).
   ashawkey/cubvh l'a reecrit sous MIT (c7379c0, 26/08/2026), a retire LICENSE_NVIDIA (191b020), puis corrige
   les requetes de distance sans triangle valide (de1badf, 27/08/2026). On compile donc CuMesh avec
   ashawkey/cubvh epingle a de1badf. L'API Python de cuBVH est inchangee (create_cuBVH, ray_trace,
   unsigned_distance, signed_distance ; state_dict en plus).

2. FILL_HOLES (PR #41 de CuMesh, ouverte le 21/08/2026, non fusionnee au 14/10). fill_holes calcule chaque
   sommet de bouchage par cub::DeviceSegmentedReduce::Sum sur des Vec3f. CUB construit la valeur initiale de
   la reduction COTE HOTE (`OutputT()`, cub/device/device_segmented_reduce.cuh) ; le constructeur par defaut
   de Vec3f (src/dtypes.cuh) est declare __device__ seulement : cote hote il n'est pas execute et la valeur
   initiale est ce qui traine sur la pile. Chaque sommet de bouchage vaut alors (G + somme des milieux) / n.
   Symptome publie (Windows, CUDA 13.0) : premier appel d'un processus juste, suivants faux (aretes de
   4,76e9, « colonne » de triangles en aiguille). Le meme defaut a ete corrige INDEPENDAMMENT dans
   visualbruno/CuMesh (de49c4a, 21/02/2026, « Fixed "infinite lines" bug » : somme refaite par un noyau GPU),
   la base de la roue du bureau, qui n'est donc pas concernee. Correctif de la PR (6 lignes) : constructeurs
   de Vec3f en __host__ __device__ ; aucun changement cote GPU. Le fait que CUB initialise la reduction par
   `OutputT()` cote hote est lisible dans cub/device/device_segmented_reduce.cuh (CUDA 12.8, lignes 405 et 420 :
   « OutputT(), // zero-initialize ») ; non re-lu pour CUDA 12.4 (image Modal), meme structure.

CE FICHIER est copie dans l'image Modal du maillage (/opt/construction_cumesh.py, voir app.py::_CUMESH_MIT)
et sert a build/reconstruire_roue_cumesh.py (roue du bureau). Bibliotheque standard seulement, sauf l'essai
du BVH de la commande `installation` (numpy, torch et le cumesh installe).

    python construction_cumesh.py sources <racine CuMesh> [--sans-git]   garde des sources de cubvh, puis correctif de fill_holes
    python construction_cumesh.py installation [--source <dossier>]      garde du cumesh INSTALLE (binaire + BVH construit sur le CPU)
    python construction_cumesh.py roue <fichier .whl>                    garde d'une roue (bureau)
    python construction_cumesh.py site <dossier site-packages>           garde d'un environnement deja installe (sans rien importer)

Code de sortie 0 = conforme, 1 = refuse (message « CONSTRUCTION CUMESH : ... » sur la sortie d'erreur).
"""
import glob
import importlib.util
import json
import os
import subprocess
import sys
import zipfile

# ---------------------------------------------------------------------------------------------------------
# Sources epinglees (verifiees le 14/10/2026)
# ---------------------------------------------------------------------------------------------------------
CUMESH_DEPOT = 'https://github.com/JeffreyXiang/CuMesh.git'
CUMESH_COMMIT = '12289e1062f0603f2f0d0771b02e1395d247f26f'      # main du 09/05/2026 = base de la PR #41
CUBVH_DEPOT = 'https://github.com/ashawkey/cubvh.git'
CUBVH_COMMIT = 'de1badf89b54975d407c42a02a47d41fa149e486'       # 27/08/2026, sans LICENSE_NVIDIA
CUBVH_REECRITURE_MIT = 'c7379c00f4617394112a10829817df6ece355bb6'  # 26/08/2026 : BVH reecrit sous MIT
# Bureau : meme CuMesh que la roue livree (visualbruno/CuMesh « version 1.0 », 08/03/2026)
CUMESH_BUREAU_DEPOT = 'https://github.com/visualbruno/CuMesh.git'
CUMESH_BUREAU_COMMIT = 'd10e54c30ddd03d11472c1431693f985501c7966'

# ---------------------------------------------------------------------------------------------------------
# Signatures
# ---------------------------------------------------------------------------------------------------------
# Identifiants propres a instant-ngp/src/triangle_bvh.cu (en-tete « NVIDIA CORPORATION and its licensors
# retain all intellectual property »), presents dans toutes les versions de cubvh anterieures a c7379c0.
SIGNATURES_SOURCE_INSTANT_NGP = (b'TriangleBvhWithBranchingFactor', b'DistAndIdx')
TEXTE_LICENCE_NC = b'NVIDIA Source Code License'
# Dans un binaire compile (.so / .pyd) : nom RTTI / symboles de la classe, et nom mangle (Itanium) de l'ancien
# noyau `cubvh::signed_distance_watertight_kernel` (longueur 33). Mesure sur la roue du bureau (08/03/2026) :
# `.?AV?$TriangleBvhWithBranchingFactor@$03@cubvh@@` et `_ZN5cubvh33signed_distance_watertight_kernelE...`.
SIGNATURES_BINAIRE_INSTANT_NGP = (b'TriangleBvhWithBranchingFactor', b'33signed_distance_watertight_kernel')
# La reecriture MIT a renomme ses noyaux : `cubvh::bvh_signed_distance_watertight_kernel`.
MARQUEUR_BINAIRE_MIT = b'bvh_signed_distance_watertight_kernel'
FICHIERS_COMPILES = ('src/bvh.cu', 'src/api_gpu.cu', 'src/bindings.cpp')   # extension cumesh._cubvh de CuMesh

# PR #41 : constructeurs de Vec3f (src/dtypes.cuh) rendus appelables cote hote. Lignes EXACTES (sans fin de ligne).
VEC3F_AVANT_APRES = (
    ('    __device__ __forceinline__ Vec3f();',
     '    __host__ __device__ __forceinline__ Vec3f();'),
    ('    __device__ __forceinline__ Vec3f(float x, float y, float z);',
     '    __host__ __device__ __forceinline__ Vec3f(float x, float y, float z);'),
    ('    __device__ __forceinline__ Vec3f(float3 v);',
     '    __host__ __device__ __forceinline__ Vec3f(float3 v);'),
    ('__device__ __forceinline__ Vec3f::Vec3f() {',
     '__host__ __device__ __forceinline__ Vec3f::Vec3f() {'),
    ('__device__ __forceinline__ Vec3f::Vec3f(float x, float y, float z) {',
     '__host__ __device__ __forceinline__ Vec3f::Vec3f(float x, float y, float z) {'),
    ('__device__ __forceinline__ Vec3f::Vec3f(float3 v) {',
     '__host__ __device__ __forceinline__ Vec3f::Vec3f(float3 v) {'),
)


class RefusConstruction(Exception):
    """La construction doit s'arreter (message destine au journal de construction)."""


# ---------------------------------------------------------------------------------------------------------
# Correctif de fill_holes (PR #41)
# ---------------------------------------------------------------------------------------------------------
def corriger_vec3f(chemin):
    """Applique la PR #41 a src/dtypes.cuh. Rend 'applique' ou 'deja' ; leve RefusConstruction (fichier INTACT)
    si le texte n'est pas exactement celui attendu (CuMesh a change : revoir le correctif). Fins de ligne
    conservees a l'octet."""
    with open(chemin, 'rb') as f:
        brut = f.read()
    try:
        texte = brut.decode('utf-8')
    except UnicodeDecodeError as e:
        raise RefusConstruction(f'{chemin} : pas en UTF-8 ({e})')
    lignes = texte.splitlines(keepends=True)
    corps = [l.rstrip('\r\n') for l in lignes]
    avant = {a: corps.count(a) for a, _ in VEC3F_AVANT_APRES}
    apres = {b: corps.count(b) for _, b in VEC3F_AVANT_APRES}
    if all(n == 0 for n in avant.values()) and all(n == 1 for n in apres.values()):
        return 'deja'
    if any(n != 1 for n in avant.values()) or any(n != 0 for n in apres.values()):
        detail = ', '.join(f'[{a.strip()}] x{n}' for a, n in avant.items() if n != 1)
        detail += ''.join(f', [{b.strip()}] x{n}' for b, n in apres.items() if n != 0)
        raise RefusConstruction(
            f'correctif de fill_holes (PR #41) : texte inattendu dans {chemin} ({detail}) ; '
            '6 lignes attendues une fois chacune : CuMesh a change, revoir le correctif')
    remplacement = dict(VEC3F_AVANT_APRES)
    sortie = []
    for ligne, c in zip(lignes, corps):
        sortie.append(remplacement[c] + ligne[len(c):] if c in remplacement else ligne)
    with open(chemin, 'wb') as f:
        f.write(''.join(sortie).encode('utf-8'))
    return 'applique'


# ---------------------------------------------------------------------------------------------------------
# Garde des sources de cubvh
# ---------------------------------------------------------------------------------------------------------
def _git(racine, *args):
    return subprocess.run(['git', '-C', racine, *args], capture_output=True, text=True)


def verifier_git_cubvh(racine):
    """HEAD de cubvh = commit epingle ET descendant de la reecriture MIT. Rend le commit lu."""
    if not os.path.isdir(os.path.join(racine, '.git')) and not os.path.isfile(os.path.join(racine, '.git')):
        raise RefusConstruction(f'{racine} : pas un depot git (impossible de verifier le commit de cubvh)')
    tete = _git(racine, 'rev-parse', 'HEAD')
    if tete.returncode != 0:
        raise RefusConstruction(f'{racine} : git rev-parse HEAD a echoue ({tete.stderr.strip()})')
    commit = tete.stdout.strip()
    anc = _git(racine, 'merge-base', '--is-ancestor', CUBVH_REECRITURE_MIT, 'HEAD')
    if anc.returncode != 0:
        raise RefusConstruction(
            f'cubvh {commit[:10]} ne descend pas de {CUBVH_REECRITURE_MIT[:7]} (reecriture MIT du 26/08/2026) : '
            "son BVH est encore celui d'instant-ngp (NVIDIA Source Code License, non commercial)")
    if commit != CUBVH_COMMIT:
        raise RefusConstruction(f'cubvh {commit} au lieu du commit epingle {CUBVH_COMMIT}')
    return commit


def verifier_sources_cubvh(racine, exiger_git=True):
    """Refuse un arbre cubvh qui contient encore du code ou la licence NVIDIA d'instant-ngp.
    Parcourt tout l'arbre sauf .git et third_party/ (Eigen, MPL-2.0). Rend un resume (dict)."""
    if not os.path.isdir(racine):
        raise RefusConstruction(f'{racine} : dossier cubvh absent')
    commit = verifier_git_cubvh(racine) if exiger_git else None
    manquants = [r for r in FICHIERS_COMPILES if not os.path.isfile(os.path.join(racine, *r.split('/')))]
    if manquants:
        raise RefusConstruction(f'{racine} : fichiers compiles par CuMesh absents : {manquants}')
    licence = os.path.join(racine, 'LICENSE')
    try:
        with open(licence, 'rb') as f:
            texte_licence = f.read()
    except OSError:
        raise RefusConstruction(f'{licence} absent')
    if b'MIT License' not in texte_licence or b'Permission is hereby granted, free of charge' not in texte_licence:
        raise RefusConstruction(f'{licence} : licence MIT attendue')
    trouves, lus = [], 0
    for dossier, sous, fichiers in os.walk(racine):
        rel = os.path.relpath(dossier, racine).replace(os.sep, '/')
        sous[:] = [d for d in sous if d != '.git' and not (rel == '.' and d == 'third_party')]
        for nom in fichiers:
            chemin = os.path.join(dossier, nom)
            relatif = os.path.relpath(chemin, racine).replace(os.sep, '/')
            if nom == 'LICENSE_NVIDIA':
                trouves.append(f'{relatif} (licence NVIDIA non commerciale)')
                continue
            with open(chemin, 'rb') as f:
                donnees = f.read()
            lus += 1
            for sig in SIGNATURES_SOURCE_INSTANT_NGP + (TEXTE_LICENCE_NC,):
                if sig in donnees:
                    trouves.append(f'{relatif} ({sig.decode()})')
    if trouves:
        raise RefusConstruction(
            "code ou licence d'instant-ngp (NVIDIA Source Code License, non commercial) dans cubvh : "
            + ', '.join(trouves))
    return {'commit': commit, 'fichiers_lus': lus}


# ---------------------------------------------------------------------------------------------------------
# Garde des binaires
# ---------------------------------------------------------------------------------------------------------
def verifier_binaire_cubvh(donnees, nom):
    """Refuse un binaire `_cubvh` compile depuis l'ancien BVH (ou dont on ne reconnait pas la reecriture)."""
    anciens = [s.decode() for s in SIGNATURES_BINAIRE_INSTANT_NGP if s in donnees]
    if anciens:
        raise RefusConstruction(
            f"{nom} : BVH d'instant-ngp (NVIDIA Source Code License, non commercial) present ({', '.join(anciens)})")
    if MARQUEUR_BINAIRE_MIT not in donnees:
        raise RefusConstruction(
            f'{nom} : marqueur de la reecriture MIT ({MARQUEUR_BINAIRE_MIT.decode()}) absent : binaire inattendu')
    return True


def _binaires_cubvh(dossier_paquet):
    return sorted(glob.glob(os.path.join(dossier_paquet, '_cubvh*.so'))
                  + glob.glob(os.path.join(dossier_paquet, '_cubvh*.pyd')))


def verifier_dossier_paquet(dossier_paquet):
    """Garde d'un dossier `cumesh/` installe, SANS rien importer. Rend la liste des binaires verifies."""
    binaires = _binaires_cubvh(dossier_paquet)
    if not binaires:
        raise RefusConstruction(f'{dossier_paquet} : aucun binaire _cubvh (CuMesh incomplet)')
    for chemin in binaires:
        with open(chemin, 'rb') as f:
            verifier_binaire_cubvh(f.read(), chemin)
    return binaires


def verifier_roue(chemin_roue):
    """Garde d'une roue cumesh (bureau) : chaque membre `cumesh/_cubvh*` doit etre la reecriture MIT."""
    with zipfile.ZipFile(chemin_roue) as z:
        membres = [n for n in z.namelist() if n.startswith('cumesh/_cubvh') and n.endswith(('.pyd', '.so'))]
        if not membres:
            raise RefusConstruction(f'{chemin_roue} : aucun binaire cumesh/_cubvh dans la roue')
        for n in membres:
            verifier_binaire_cubvh(z.read(n), f'{os.path.basename(chemin_roue)}:{n}')
    return membres


def _dossier_cumesh_installe():
    spec = importlib.util.find_spec('cumesh')      # paquet de premier niveau : rien n'est execute
    if spec is None or not spec.submodule_search_locations:
        raise RefusConstruction('paquet cumesh introuvable')
    return list(spec.submodule_search_locations)[0]


def _verifier_origine(dossier_paquet, source):
    """direct_url.json (PEP 610) du cumesh installe = le dossier compile ici (pas l'ancienne copie)."""
    parent = os.path.dirname(dossier_paquet)
    infos = glob.glob(os.path.join(parent, 'cumesh-*.dist-info'))
    if len(infos) != 1:
        raise RefusConstruction(f'{len(infos)} dist-info cumesh dans {parent} (1 attendu)')
    try:
        with open(os.path.join(infos[0], 'direct_url.json'), encoding='utf-8') as f:
            url = json.load(f).get('url', '')
    except (OSError, ValueError) as e:
        raise RefusConstruction(f'{infos[0]} : direct_url.json illisible ({e})')
    attendu = 'file://' + os.path.abspath(source).replace(os.sep, '/')
    if url.rstrip('/') != attendu.rstrip('/'):
        raise RefusConstruction(f'cumesh installe depuis {url}, attendu {attendu}')
    return url


def icosaedre():
    """12 sommets, 20 faces (float32, uint32) : maillage d'essai du BVH (CuMesh exige plus de 8 triangles)."""
    import numpy as np
    p = (1.0 + 5 ** 0.5) / 2.0
    v = np.array([[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p],
                  [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]], dtype=np.float32)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
                  [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
                  [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]], dtype=np.uint32)
    return v * np.float32(0.25), f


def essayer_bvh():
    """Construit un BVH avec le cumesh INSTALLE, sur le CPU (initialisation paresseuse de cubvh >= 30/12/2025 :
    aucun GPU n'est touche) : la racine doit englober exactement le maillage. Rend le nombre de noeuds."""
    os.environ.setdefault('CUDA_VISIBLE_DEVICES', '')
    import numpy as np
    import torch  # noqa: F401  (charge libtorch avant l'extension)
    from cumesh import _cubvh
    v, f = icosaedre()
    bvh = _cubvh.create_cuBVH(v, f)
    if not hasattr(bvh, 'state_dict'):
        raise RefusConstruction('cumesh._cubvh sans state_dict : ce cubvh est anterieur a la version epinglee')
    etat = bvh.state_dict()
    noeuds = etat['nodes']
    if noeuds.dim() != 2 or noeuds.shape[1] != 9 or noeuds.shape[0] < 1:
        raise RefusConstruction(f'noeuds du BVH inattendus : {tuple(noeuds.shape)} (n x 9 attendu)')
    boite = noeuds[0, :6].contiguous().view(torch.float32).numpy()
    attendu = np.concatenate([v.min(axis=0), v.max(axis=0)])
    if not np.allclose(boite, attendu, atol=1e-6):
        raise RefusConstruction(f'boite racine du BVH {boite.tolist()} au lieu de {attendu.tolist()}')
    return int(noeuds.shape[0])


# ---------------------------------------------------------------------------------------------------------
# Ligne de commande
# ---------------------------------------------------------------------------------------------------------
def _commande(argv):
    if not argv:
        raise RefusConstruction('commande attendue : sources | installation | roue | site')
    cmd, reste = argv[0], argv[1:]
    if cmd == 'sources':
        exiger_git = '--sans-git' not in reste
        args = [a for a in reste if a != '--sans-git']
        if len(args) != 1:
            raise RefusConstruction('usage : sources <racine CuMesh> [--sans-git]')
        racine = args[0]
        resume = verifier_sources_cubvh(os.path.join(racine, 'third_party', 'cubvh'), exiger_git=exiger_git)
        etat = corriger_vec3f(os.path.join(racine, 'src', 'dtypes.cuh'))
        print(f"CONSTRUCTION CUMESH : sources conformes (cubvh {resume['commit'] or 'hors git'}, "
              f"{resume['fichiers_lus']} fichiers lus, aucun code d'instant-ngp) ; correctif de fill_holes : {etat}")
    elif cmd == 'installation':
        source = None
        if reste[:1] == ['--source'] and len(reste) == 2:
            source = reste[1]
        elif reste:
            raise RefusConstruction('usage : installation [--source <dossier compile>]')
        dossier = _dossier_cumesh_installe()
        binaires = verifier_dossier_paquet(dossier)
        url = _verifier_origine(dossier, source) if source else None
        n = essayer_bvh()
        print(f'CONSTRUCTION CUMESH : cumesh installe conforme ({dossier}, '
              f'{len(binaires)} binaire(s) _cubvh MIT, origine {url or "non verifiee"}, BVH CPU {n} noeuds)')
    elif cmd == 'roue':
        if len(reste) != 1:
            raise RefusConstruction('usage : roue <fichier .whl>')
        membres = verifier_roue(reste[0])
        print(f'CONSTRUCTION CUMESH : roue conforme ({reste[0]} : {", ".join(membres)})')
    elif cmd == 'site':
        if len(reste) != 1:
            raise RefusConstruction('usage : site <dossier site-packages>')
        binaires = verifier_dossier_paquet(os.path.join(reste[0], 'cumesh'))
        print(f'CONSTRUCTION CUMESH : environnement conforme ({", ".join(binaires)})')
    else:
        raise RefusConstruction(f'commande inconnue : {cmd}')


def main(argv=None):
    try:
        _commande(sys.argv[1:] if argv is None else argv)
    except RefusConstruction as e:
        print(f'CONSTRUCTION CUMESH : {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
