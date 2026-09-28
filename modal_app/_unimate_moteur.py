"""Moteur d'animation UniMate : anime un rig GLB a partir d'un texte.

POURQUOI UN PILOTE AUTONOME (2026-09-26)
Le `sample.py` d'UniMate n'accepte que les squelettes de son propre jeu de
donnees, et sa chaine de preparation exige bpy 4.0 et la bibliotheque
`Motion` (inbar-2344/Motion, SANS licence). Or tout ce que le modele lit se
calcule a partir de la hierarchie des os et de leurs positions de repos :
ce module le fait en numpy, sans bpy ni Motion, puis ecrit l'animation
directement sur les os du rig (pas de reciblage, contrairement a AnyTop).

Chaine : GLB -> hierarchie + repos -> noms anatomiques (le modele encode le
NOM de chaque os ; nos rigs n'ont que `bone_N`) -> ordre BFS d'UniMate ->
canonisation (XZ au centre, « diametre » 2, sol a 0, face +Z) -> T-pose
(J,12) normalisee + graphe + spectre + noms T5 + legende T5 -> modele (flow
matching, CFG) -> (60, J, 12) -> rotations par os + trajectoire de la
racine -> animation glTF ajoutee au GLB.

Valide le 2026-09-26 sur le rig du chevalier (34 os) : la cinematique
directe coincide avec les positions que sort le modele (ecart moyen 0,04
pour un squelette de taille 2 ; les autres conventions : 0,19 a 0,30).

POIDS : le checkpoint public est un entrainement INDEPENDANT (tarn59) sur
des donnees Mixamo / Objaverse sous licences restrictives — evaluation
seulement tant que l'exploitant n'a pas tranche. Le moteur est donc reserve
aux comptes autorises (cote worker).
"""
import ast
import json
import os
import re
import struct
import sys

import numpy as np

# Prompt par type d'animation (menu de l'etape Animation), au style des
# legendes d'entrainement (`data_process/vlm_caption/prompts.py` @9f3076e) :
# une phrase au present, < 12 mots, une action ou « X and then Y », action
# secondaire par « while », « forward » seulement s'il y a deplacement, sinon
# « in place » ; ni adverbe, ni espece, ni accessoire. Le sujet est ajoute
# par `prompt_pour` (A person / An animal / An object).
_VERBES = {
    'idle': 'stands in place while shifting its weight',
    'walk': 'walks forward',
    'run': 'runs forward',
    'attack': 'lunges forward and strikes',
    'jump': 'crouches and then jumps up',
    'death': 'staggers and then collapses to the ground',
    'fly': 'flaps its wings and flies forward',
    'hit': 'flinches and steps backward',
    'dance': 'dances in place',
}

# Types cycliques : le clip est rendu bouclable (voir MoteurUniMate.animer).
CYCLIQUES = ('idle', 'walk', 'run', 'fly')


def famille_pour(asset_type):
    """La detection automatique de famille se trompe sur nos rigs (le
    chevalier sort « flying ») : le type d'asset choisi par l'utilisateur est
    plus sur. 'auto' = repli sur la detection."""
    t = (asset_type or '').lower()
    if t in ('character', 'other_living', 'humanoid'):
        return 'bipeds'
    # Insectes / araignees : leurs pattes sont des chaines LATERALES, que la
    # detection prend pour des ailes (>= 4 laterales -> « flying ») — une
    # araignee aurait eu huit « Left Wing ». Famille a pattes non ailee ;
    # statistiques Truebones (qui contient araignees, scorpions, fourmis).
    if t in ('animal', 'insect'):
        return 'quadropeds'
    return 'auto'


# Sujets des legendes d'entrainement des poids en production (tarn59 v2,
# entraines vers le 19/09/2026) : « A person » (Mixamo), « An animal »
# (Truebones, qui contient insectes, araignees, oiseaux, dragons), « An object »
# (Objaverse) — `patch_annotations.SUBJECT` a la revision 9f3076e ; la fiche des
# poids en donne des exemples. « An insect » / « A creature » n'ont JAMAIS ete
# vus. NB : depuis le 27/09 le depot force « An object » partout (legendes
# publiees : 3 414 sur 3 414) — a reprendre si l'on passe aux poids officiels.
_SUJET_PAR_TYPE = {'character': 'A person', 'other_living': 'A person', 'humanoid': 'A person',
                   'animal': 'An animal', 'insect': 'An animal', 'creature': 'An animal',
                   'vehicle': 'An object', 'object': 'An object', 'prop': 'An object'}


# Sujet d'une description libre (« A dragon breathes fire », « the knight
# walks », « he jumps ») : remplace par le sujet canonique, comme le fait le
# depot (`patch_annotations.py` : ^(?:An?|The) [A-Za-z-]+).
_SUJET_LIBRE = re.compile(r"^(?:(?:an?|the)\s+[a-z-]+|he|she|it|they|someone|somebody)\s+", re.I)

# Statistiques de normalisation : celles du jeu dont le sujet est tire
# (`conditioning.py` normalise chaque clip avec les stats de SON jeu).
STATS_PAR_SUJET = {'A person': 'mixamo', 'An animal': 'truebones', 'An object': 'objaverse'}


def sujet_pour(famille, asset_type=''):
    return _SUJET_PAR_TYPE.get((asset_type or '').lower()) or {
        'bipeds': 'A person', 'quadropeds': 'An animal', 'flying': 'An animal',
        'millipeds_snakes': 'An animal'}.get(famille, 'An object')


def prompt_pour(anim_type, famille, prompt_utilisateur='', asset_type=''):
    """Legende au format appris par le modele : « A person walks forward. ».
    Le sujet suit le type d'asset quand il est connu, sinon la famille ; le
    sujet d'une description libre est remplace par le sujet canonique."""
    sujet = sujet_pour(famille, asset_type)
    libre = (prompt_utilisateur or '').strip().rstrip('.').strip()
    if libre:
        libre = _SUJET_LIBRE.sub('', libre, count=1) or libre
        return f"{sujet} {libre[0].lower() + libre[1:]}."
    # point final : toutes les legendes d'entrainement en ont un
    return f"{sujet} {_VERBES.get((anim_type or 'idle').lower(), 'moves in place')}."


# ============================================================ GLB
_TYPES = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
_NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def lire_glb(octets):
    b = bytes(octets)
    if b[:4] != b'glTF':
        raise ValueError('pas un GLB')
    off, js, bn = 12, None, b''
    while off < len(b):
        n, t = struct.unpack_from('<II', b, off)
        c = b[off + 8: off + 8 + n]
        if t == 0x4E4F534A:
            js = json.loads(c)
        elif t == 0x004E4942:
            bn = bytes(c)
        off += 8 + n
    return js, bn


def matrice_locale(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    from scipy.spatial.transform import Rotation
    M = np.eye(4)
    M[:3, :3] = Rotation.from_quat(n.get('rotation', [0, 0, 0, 1])).as_matrix() * np.array(n.get('scale', [1, 1, 1]))
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def matrices_monde(js):
    noeuds = js['nodes']
    parent = {}
    for i, n in enumerate(noeuds):
        for c in n.get('children', []):
            parent[c] = i
    W = {}

    def w(i):
        if i not in W:
            M = matrice_locale(noeuds[i])
            W[i] = w(parent[i]) @ M if i in parent else M
        return W[i]
    for i in range(len(noeuds)):
        w(i)
    return W, parent


def orthonormer(M):
    U, _, Vt = np.linalg.svd(M)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        U[:, -1] *= -1
        R = U @ Vt
    return R


def charger_stats(chemin):
    """`dataset_stats.npy` est un PICKLE (tableau objet) venu d'un depot
    TIERS : `np.load(allow_pickle=True)` executerait n'importe quel code
    qu'il contiendrait. Liste blanche des seules classes numpy qu'il utilise
    (inventaire fait avec pickletools le 2026-09-26, sans l'executer)."""
    import pickle

    class _Restreint(pickle.Unpickler):
        _OK = {('numpy._core.multiarray', '_reconstruct'), ('numpy.core.multiarray', '_reconstruct'),
               ('numpy', 'ndarray'), ('numpy', 'dtype')}

        def find_class(self, module, nom):
            if (module, nom) in self._OK:
                return super().find_class(module, nom)
            raise pickle.UnpicklingError(f'classe refusee dans les stats : {module}.{nom}')

    with open(chemin, 'rb') as f:
        version = np.lib.format.read_magic(f)
        if version == (1, 0):
            np.lib.format.read_array_header_1_0(f)
        else:
            np.lib.format.read_array_header_2_0(f)
        return _Restreint(f).load().item()


# ============================================ noms anatomiques des os
def charger_classifieur():
    """`_detect_topology_family` et `_anatomical_names`, extraits de
    `_anytop_anim.py` (meme dossier) sans l'importer : ce module declare une
    app Modal et son image au niveau haut."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_anytop_anim.py')
    arbre = ast.parse(open(chemin, encoding='utf-8').read())
    garder = [n for n in arbre.body if isinstance(n, ast.FunctionDef)
              and n.name in ('_detect_topology_family', '_count_target_roles', '_anatomical_names')]
    espace = {'np': np, 'numpy': np}
    exec(compile(ast.Module(body=garder, type_ignores=[]), '_anytop_anim_extrait', 'exec'), espace)
    return espace


def _seq_jambe(n):
    """Segments d'une patte, comme les pattes d'arthropodes de Truebones
    (`patch_annotations.CHAIN_RIGS` : Thigh, Shin, Foot, Toe…). Quatre os =
    la jambe du noyau Mixamo (Thigh, Shin, Foot, Toe) ; au-dela, le bout est un
    « Toe End », comme dans Truebones (un os feuille n'a pas de rotation propre
    dans UniMate : c'est un point, exactement comme leurs os « End »)."""
    if n <= 4:
        return [['Thigh'], ['Thigh', 'Foot'], ['Thigh', 'Shin', 'Foot'],
                ['Thigh', 'Shin', 'Foot', 'Toe']][max(n, 1) - 1]
    return ['Thigh', 'Shin', 'Foot'] + ['Toe'] * (n - 4) + ['Toe End']


def _seq_bras(n):
    """Segments d'un bras : noyau Mixamo (Shoulder, Upper Arm, Forearm,
    Hand), qui est aussi le nommage des pattes avant des quadrupedes
    Truebones ; doigts au-dela."""
    if n <= 3:
        return [['Upper Arm'], ['Upper Arm', 'Hand'], ['Upper Arm', 'Forearm', 'Hand']][max(n, 1) - 1]
    return ['Shoulder', 'Upper Arm', 'Forearm', 'Hand'] + ['Finger'] * (n - 4)


def _role(r):
    """'leg_l_03' -> ('leg', 'l', 3) ; 'spine_02' -> ('spine', None, 0)."""
    p = r.split('__j')[0].split('_')
    if p[0] in ('arm', 'leg', 'wing') and len(p) >= 3:
        return p[0], p[1], int(p[2])
    return p[0], None, 0


def noms_unimate(roles, parents=None, positions=None):
    """Roles FabMesh (hip, spine_01, arm_l_02, leg_r_03, wing_l_01, tail_02,
    neck_01, head, limb_04) -> vocabulaire anatomique d'UniMate.

    Le modele encode le NOM de chaque os (T5), appris sur `clean_joint_names`
    d'UniML3D, au format « [Left |Right ]<partie>[ End] », avec « Bone » pour
    un os sans anatomie reconnue (`data_process/joint_annotation/vocab.py`).
    Mesure du 2026-09-28 sur les noms publies : « End » seul n'y apparait
    JAMAIS (0 sur 300 000), alors que l'ancien code le donnait a toute chaine
    hors des deux bras et deux jambes retenus par le classifieur — 27 os sur
    42 pour l'araignee, dont ses six autres pattes.

    Avec `parents` ({os: parent ou None}) et `positions` ({os: xyz, face +Z,
    Y en haut}), chaque chaine `limb_NN` est nommee d'apres sa geometrie :
    patte si elle touche le sol, orteil / doigt si elle part d'un membre,
    appendice si elle part de la tete ; cote par le signe de X (+X = gauche,
    convention d'UniML3D : `patch_annotations.side_from_x`)."""
    base = {j: _role(r) for j, r in roles.items()}
    longueurs = {}
    for t, c, i in base.values():
        if c:
            longueurs[(t, c)] = max(longueurs.get((t, c), 0), i)
    simples = {'hip': 'Hips', 'spine': 'Spine', 'neck': 'Neck', 'head': 'Head', 'tail': 'Tail'}
    out = {}
    for j, (t, c, i) in base.items():
        if t in simples:
            out[j] = simples[t]
        elif c:
            n = longueurs[(t, c)]
            seq = ['Wing'] * n if t == 'wing' else (_seq_bras(n) if t == 'arm' else _seq_jambe(n))
            out[j] = ('Left ' if c == 'l' else 'Right ') + seq[min(i, len(seq)) - 1]
        else:
            out[j] = 'Bone'
    if parents is None or positions is None:
        return out

    # ---- chaines restees « limb_NN » : nommage d'apres la geometrie
    P = {j: np.asarray(positions[j], dtype=np.float64) for j in base}
    tout = np.array(list(P.values()))
    sol, H = float(tout[:, 1].min()), max(float(np.ptp(tout[:, 1])), 1e-6)
    ext = max(float(np.ptp(tout, axis=0).max()), 1e-6)
    racine = next(j for j in base if parents.get(j) is None)
    x0 = float(P[racine][0])
    enfants = {j: [] for j in base}
    for j in base:
        if parents.get(j) is not None:
            enfants[parents[j]].append(j)
    taille = {}

    def sous_arbre(j):
        if j not in taille:
            taille[j] = 1 + sum(sous_arbre(k) for k in enfants[j])
        return taille[j]

    def au_sol(j):
        return float(P[j][1]) - sol < 0.25 * H

    def patte(ch):
        # touche le sol, ou redescend nettement sous son attache (patte avant
        # d'araignee levee au repos : 0,07 au-dessus du sol pour H = 0,16)
        pere = parents.get(ch[0])
        haut = float(P[pere][1]) if pere is not None else float(P[ch[0]][1])
        return au_sol(ch[-1]) or float(P[ch[-1]][1]) < haut - 0.3 * H

    def cote(os_):
        dx = max((float(P[k][0]) - x0 for k in os_), key=abs)
        return '' if abs(dx) < 0.03 * ext else ('Left ' if dx > 0 else 'Right ')

    # chaines : un os libre dont le parent n'est pas dans une chaine deja
    # construite en ouvre une, puis on suit l'enfant libre au plus grand
    # sous-arbre ; les branches laterales ouvrent leur propre chaine
    libres = {j for j, (t, _, _) in base.items() if t == 'limb'}
    pris, chaines = set(), []
    for j in sorted(libres, key=lambda k: -sous_arbre(k)):
        if j in pris:
            continue
        ch = [j]
        while True:
            suite = [k for k in enfants[ch[-1]] if k in libres and k not in pris]
            if not suite:
                break
            ch.append(max(suite, key=sous_arbre))
        pris.update(ch)
        chaines.append(ch)

    # Plus de deux pattes au sol d'un meme cote = arthropode : Truebones
    # nomme alors TOUTES ses pattes Thigh/Shin/Foot/Toe (araignee, crabe,
    # scorpion), y compris la paire que le classifieur appelle « bras ».
    pattes = {'Left ': 0, 'Right ': 0}
    for ch in chaines:
        if patte(ch) and cote(ch):
            pattes[cote(ch)] += 1
    membres = {}
    for j, (t, c, i) in base.items():
        if t in ('arm', 'leg'):
            membres.setdefault((t, c), []).append((i, j))
    for (t, c), os_ in membres.items():
        if au_sol(max(os_)[1]):
            pattes['Left ' if c == 'l' else 'Right '] += 1
    if max(pattes.values()) >= 3:
        for (t, c), os_ in membres.items():
            if t == 'arm' and au_sol(max(os_)[1]):
                for (_, k), nom in zip(sorted(os_), _seq_jambe(len(os_))):
                    out[k] = ('Left ' if c == 'l' else 'Right ') + nom

    def famille(j):
        # famille d'un os d'apres son NOM deja calcule (les chaines sont
        # traitees parents d'abord) ; le role du classifieur ne sert que de
        # repli : sur un humanoide du 2026-09-28, ses « queue » portaient les
        # jambes et son « cou » etait l'epaule gauche
        nom = out.get(j, '').split(' ', 1)[-1] if out.get(j, '').startswith(('Left ', 'Right ')) else out.get(j, '')
        for f, mots in (('leg', ('Thigh', 'Shin', 'Foot', 'Toe')), ('arm', ('Shoulder', 'Arm', 'Forearm', 'Hand', 'Finger')),
                        ('wing', ('Wing',)), ('tail', ('Tail',)), ('head', ('Head', 'Neck', 'Jaw', 'Antenna', 'Mandible'))):
            if nom.startswith(mots):
                return f
        return base[j][0]

    for ch in chaines:
        s = cote(ch)
        pere = parents.get(ch[0])
        t_pere = famille(pere) if pere is not None else ''
        n = len(ch)
        debut = P[pere] if pere is not None else P[ch[0]]
        v = P[ch[-1]] - debut
        if t_pere == 'leg':
            noms = ['Toe'] * n
        elif t_pere == 'arm':
            noms = ['Finger'] * n
        elif t_pere == 'wing':
            noms = ['Wing'] * n
        elif s and patte(ch):
            noms = _seq_jambe(n)
        elif t_pere == 'tail':
            noms = ['Tail'] * n
        elif not s and float(v[1]) > 0.5 * float(np.linalg.norm(v)) and 'Head' not in out.values() and n >= 1:
            # chaine centrale qui MONTE au-dessus de son attache : cou + tete
            noms = ['Neck'] * (n - 1) + ['Head']
        elif t_pere in ('head', 'neck'):
            if not s:
                noms = ['Jaw'] * n
            else:
                noms = ['Antenna' if float(P[ch[-1]][1]) > float(P[ch[0]][1]) else 'Mandible'] * n
        elif s:
            # un os feuille isole est un point du tronc, pas un bras
            noms = ['Bone'] if (n == 1 and not enfants[ch[0]]) else _seq_bras(n)
        else:
            # os central : vers l'arriere = queue, vers l'avant = machoire
            # (cheliceres de l'araignee), os de longueur nulle = « Bone »
            if float(np.linalg.norm(v)) < 0.02 * ext or (n == 1 and not enfants[ch[0]]):
                # un os feuille isole est un point du tronc, pas un appendice
                noms = ['Bone'] * n
            else:
                noms = ['Jaw' if float(v[2]) > 0 else 'Tail'] * n
        for k, nom in zip(ch, noms):
            out[k] = nom if nom in ('Tail', 'Jaw') else s + nom

    # « Queue » du classifieur qui pointe vers l'AVANT (face +Z) : ce sont les
    # cheliceres ou la machoire (araignee du 2026-09-28 : pointe a z = +0,14,
    # hanche a z = -0,03). Nommee « Tail », elle serait agitee comme une queue.
    queue = [j for j, (t, _, _) in base.items() if t == 'tail']
    # « queue » qui porte des pattes = moyeu du bassin, pas une queue
    for j in list(queue):
        pile, porte = list(enfants[j]), False
        while pile and not porte:
            k = pile.pop()
            porte = out.get(k, '').endswith(('Thigh', 'Shin', 'Foot'))
            pile.extend(enfants[k])
        if porte:
            out[j] = 'Bone'
            queue.remove(j)
    if queue:
        bout = max(queue, key=lambda k: base[k][2] if base[k][2] else int(roles[k].split('__j')[0].split('_')[1]))
        if float(P[bout][2]) > float(P[racine][2]) + 0.05 * ext:
            for k in queue:
                out[k] = 'Jaw'
    return out


# ================================================ squelette et canonisation
def ordre_bfs(parents_orig, positions):
    """Ordre UniMate : racine en 0, largeur d'abord, enfants tries par
    sous-arbre le plus grand puis os le plus court."""
    J = len(parents_orig)
    enfants = {i: [] for i in range(J)}
    racine = None
    for i, p in enumerate(parents_orig):
        if p < 0:
            racine = i
        else:
            enfants[p].append(i)
    taille = {}

    def t(i):
        if i not in taille:
            taille[i] = 1 + sum(t(c) for c in enfants[i])
        return taille[i]
    t(racine)
    ordre, file = [], [racine]
    while file:
        i = file.pop(0)
        ordre.append(i)
        file.extend(sorted(enfants[i], key=lambda c: (-taille[c], float(np.linalg.norm(positions[c] - positions[i])))))
    return ordre


def diametre(parents, pos):
    J = len(parents)
    adj = {i: [] for i in range(J)}
    for i, p in enumerate(parents):
        if p >= 0:
            L = float(np.linalg.norm(pos[i] - pos[p]))
            adj[p].append((i, L))
            adj[i].append((p, L))

    def plus_loin(src):
        dist = {src: 0.0}
        pile = [src]
        while pile:
            u = pile.pop()
            for v, L in adj[u]:
                if v not in dist:
                    dist[v] = dist[u] + L
                    pile.append(v)
        k = max(dist, key=dist.get)
        return k, dist[k]
    u, _ = plus_loin(0)
    return plus_loin(u)[1]


def score_mouvement(m, parents):
    """Note un clip (60, J, 12) denormalise, pour garder le meilleur de
    plusieurs tirages. Mesure du 2026-09-28 (course de l'araignee, 5 graines) :
    d'un tirage a l'autre, 2 a 9 pattes sur 10 bougent — l'ecart entre
    graines pese bien plus que tout reglage. Les scripts officiels tirent
    d'ailleurs 3 echantillons par defaut (`REPLICATE=3`).

    Score = part des bouts de chaine (feuilles a profondeur >= 2) dont la
    position RELATIVE AU CORPS (canaux RIFKE 0:3, echelle diametre 2) parcourt
    plus de 5 % de la taille (0,1), moins une penalite d'a-coups (derivee
    seconde moyenne de ces positions).

    Les positions RIFKE ne retirent que le XZ de la racine et le cap : un
    candidat qui sautille ou bascule en bloc y parait « tres actif » (mesure :
    le score 0,998 d'un tirage a 6 pattes battait le 0,774 d'un tirage a 9).
    On les ramene donc dans le repere du CORPS : relatif a la racine, puis
    rotation de la racine retiree (lue, comme au decodage, dans le slot d'un
    enfant de la racine ; le slot 0 porte le cap)."""
    from unimate.utils.rotation_conversions import rotation_6d_to_matrix_np
    J = m.shape[1]
    enfants = np.zeros(J, dtype=int)
    prof = np.zeros(J, dtype=int)
    for j in range(1, J):
        enfants[parents[j]] += 1
        prof[j] = prof[parents[j]] + 1
    bouts = [j for j in range(1, J) if enfants[j] == 0 and prof[j] >= 2]
    fils = [j for j in range(1, J) if parents[j] == 0]
    if not bouts or not fils:
        return 0.0
    M6 = rotation_6d_to_matrix_np(m[:, :, 3:9])
    F, R0 = M6[:, 0], M6[:, fils[-1]]
    rel = m[:, bouts, :3] - m[:, :1, :3]
    corps = np.einsum('tab,tca,tjc->tjb', R0, F, rel)       # R0^T . F^T . rel
    course = np.linalg.norm(corps.max(0) - corps.min(0), axis=-1)
    acoups = float(np.abs(np.diff(corps, n=2, axis=0)).mean())
    return float(np.mean(course > 0.1)) - 2.0 * acoups


def os_ponderes(js, bn, skin=0, seuil=1e-3):
    """Noeuds des os qui portent un poids de peau (None si illisible). Le
    depot elague a l'export les os sans poids (`blender_export.py`) : le
    modele n'a jamais vu d'os de controle ni de bout vide."""
    try:
        joints = js['skins'][skin]['joints']
        acc, vues = js['accessors'], js.get('bufferViews', [])

        def lire(i):
            a = acc[i]
            v = vues[a['bufferView']]
            dt, n = np.dtype(_TYPES[a['componentType']]), _NCOMP[a['type']]
            off, pas = v.get('byteOffset', 0) + a.get('byteOffset', 0), v.get('byteStride') or dt.itemsize * n
            brut = np.frombuffer(bn, np.uint8, count=pas * (a['count'] - 1) + dt.itemsize * n, offset=off)
            idx = (np.arange(a['count'])[:, None] * pas + np.arange(dt.itemsize * n)[None]).ravel()
            x = brut[idx].view(dt).reshape(a['count'], n)
            if a.get('normalized') and dt.kind == 'u':
                x = x.astype(np.float32) / np.iinfo(dt).max
            return x
        utiles = set()
        for nd in js['nodes']:
            if nd.get('skin') != skin or 'mesh' not in nd:
                continue
            for prim in js['meshes'][nd['mesh']]['primitives']:
                at = prim['attributes']
                for k in (0, 1):
                    if f'JOINTS_{k}' in at and f'WEIGHTS_{k}' in at:
                        jj = lire(at[f'JOINTS_{k}']).astype(np.int64)
                        utiles.update(np.unique(jj[lire(at[f'WEIGHTS_{k}']) > seuil]).tolist())
        return {joints[u] for u in utiles if u < len(joints)} or None
    except Exception:
        return None


def noyau_mixamo(noms, parents):
    """Os du noyau Mixamo de 22 os, seul squelette vu pour « A person »
    (`metadata.py`, `--mixamo_core_joints` actif par defaut) : Hips, 3 Spine,
    Neck, Head et, par cote, Shoulder / Upper Arm / Forearm / Hand et Thigh /
    Shin / Foot / Toe. Ni doigts, ni accessoires. Choisi d'apres les NOMS
    (`noms_unimate`, geometriques), plus fiables que les roles du
    classifieur. None s'il manque bras ou jambes d'un cote."""
    prof = {}

    def profondeur(j):
        if j not in prof:
            prof[j] = 0 if parents.get(j) is None else 1 + profondeur(parents[j])
        return prof[j]
    par_nom = {}
    for j in sorted(noms, key=profondeur):
        par_nom.setdefault(noms[j], []).append(j)
    garde = {j for j in noms if parents.get(j) is None}
    colonne = par_nom.get('Spine', [])
    if len(colonne) > 3:
        colonne = [colonne[i] for i in np.linspace(0, len(colonne) - 1, 3).round().astype(int)]
    garde.update(colonne)
    tete = par_nom.get('Head', [])[:1]
    garde.update(tete)
    if tete:
        k = parents.get(tete[0])
        while k is not None and noms.get(k) != 'Neck':
            k = parents.get(k)
        if k is not None:
            garde.add(k)
    for cote in ('Left ', 'Right '):
        for membre, obligatoires in ((('Shoulder', 'Upper Arm', 'Forearm', 'Hand'), ('Upper Arm', 'Hand')),
                                     (('Thigh', 'Shin', 'Foot', 'Toe'), ('Thigh', 'Foot'))):
            if not all(par_nom.get(cote + o) for o in obligatoires):
                return None
            garde.update(par_nom[cote + m][0] for m in membre if par_nom.get(cote + m))
    return garde


# ======================================================================= moteur
class MoteurUniMate:
    """Charge le modele et l'encodeur UNE fois (conteneur Modal), puis anime
    autant de rigs que demande."""

    def __init__(self, dossier_unimate, dossier_poids, appareil='cuda'):
        if dossier_unimate not in sys.path:
            sys.path.insert(0, dossier_unimate)
        import torch
        from safetensors.torch import load_model
        from unimate.configs.schema import MainConfig
        from unimate.models.factory import create_model, create_transport
        from unimate.models.text_encoder.factory import create_text_encoder
        self.torch = torch
        self.poids = dossier_poids
        self.dev = torch.device(appareil)
        self.cfg = MainConfig.from_json(os.path.join(dossier_poids, 'config.json'))
        self.stats = charger_stats(os.path.join(dossier_poids, 'dataset_stats.npy'))
        self.modele = create_model(self.cfg.dataset, self.cfg.model)
        load_model(self.modele, os.path.join(dossier_poids, 'model_ema.safetensors'), strict=True)
        self.modele = self.modele.to(self.dev).eval()
        self.transport = create_transport(training_config=self.cfg.training)
        self.enc = create_text_encoder(encoder_type=self.cfg.model.text_encoder_type,
                                       encoder_version=self.cfg.model.text_encoder_version,
                                       device=str(self.dev), pool=False)
        self.classifieur = charger_classifieur()
        self._noms = {}

    def traduire(self, texte):
        """Description libre -> anglais (le modele n'a appris que l'anglais).
        Opus-MT fr-en (Apache-2.0) : mesure du 2026-09-26, 9 phrases de
        mouvement sur 12 correctes, et l'anglais ressort INTACT (3/3) — donc
        pas de detection de langue. flan-t5 (deja charge) a ete essaye et
        ecarte : « marche en boitant » -> « a sand castle »."""
        texte = (texte or '').strip()
        if not texte:
            return texte
        if getattr(self, '_trad', None) is None:
            from transformers import MarianMTModel, MarianTokenizer
            self._trad = (MarianTokenizer.from_pretrained('Helsinki-NLP/opus-mt-fr-en'),
                          MarianMTModel.from_pretrained('Helsinki-NLP/opus-mt-fr-en').to(self.dev).eval())
        tok, mod = self._trad
        with self.torch.no_grad():
            ids = tok([texte[:300]], return_tensors='pt').to(self.dev)
            sortie = mod.generate(**ids, max_new_tokens=80)
        return tok.decode(sortie[0], skip_special_tokens=True).strip() or texte

    def _texte(self, texte):
        from unimate.utils.text_emb_cache import sequences_from_hidden, pool
        with self.torch.no_grad():
            inp = self.enc.tokenize(texte)
            h = self.enc(inp)
        tok = sequences_from_hidden(h.detach().cpu(), inp['attention_mask'].cpu())[0]
        return pool(tok), tok

    @staticmethod
    def _parents_joints(joints, parent_noeud):
        ens = set(joints)
        out = {}
        for n in joints:
            p = parent_noeud.get(n)
            while p is not None and p not in ens:
                p = parent_noeud.get(p)
            out[n] = p
        return out

    def animer(self, rig_octets, prompt, famille='bipeds', stats=None, graine=0, cfg_scale=3.0,
               nom_clip=None, tirages=3, boucle=False, raccord=8):
        """Rend (octets du GLB anime, infos). `famille` gouverne les noms des
        membres (bras/ailes) ; `stats` la normalisation (par defaut celle du
        jeu dont vient le sujet de la legende) ; `tirages` candidats generes en
        UN lot, le meilleur selon `score_mouvement` est garde ; `boucle` rend
        le clip bouclable (`raccord` images figees de part et d'autre)."""
        torch = self.torch
        from scipy.spatial.transform import Rotation
        from unimate.models.flow.transport import Sampler
        from unimate.inference.generate import generate_samples
        from unimate.dataset.mixture.collate import mixture_batch_collate
        from unimate.utils.topology_utils import (compute_edge_indexs, compute_joint_depths,
                                                  compute_laplacian_eigenvectors,
                                                  compute_edge_relations_and_distances)
        from unimate.utils.rotation_conversions import rotation_6d_to_matrix_np

        js, bn = lire_glb(rig_octets)
        joints = list(js['skins'][0]['joints'])
        W, parent_noeud = matrices_monde(js)
        par_noeud = self._parents_joints(joints, parent_noeud)
        racines = [n for n in joints if par_noeud[n] is None]
        if len(racines) != 1:
            raise ValueError(f'squelette a {len(racines)} racines : non gere')
        pos_monde = {n: W[n][:3, 3].copy() for n in joints}
        rot_monde = {n: orthonormer(W[n][:3, :3]) for n in joints}

        par_idx = {n: (par_noeud[n] if par_noeud[n] is not None else -1) for n in joints}
        if not famille or famille == 'auto':
            # peu fiable (le chevalier sort « flying ») : l'appelant devrait
            # la deduire du type d'asset ; ce n'est qu'un repli
            famille = self.classifieur['_detect_topology_family'](joints, par_idx, pos_monde)
        roles = self.classifieur['_anatomical_names'](joints, par_idx, pos_monde, famille)
        noms = noms_unimate(roles, parents=par_noeud, positions=pos_monde)
        # statistiques = celles du jeu dont vient le sujet (A person -> mixamo,
        # An animal -> truebones, An object -> objaverse) : l'entrainement
        # normalise chaque clip avec les stats de SON jeu
        sujet = next((x for x in STATS_PAR_SUJET if prompt.startswith(x + ' ')), None)
        if not stats or stats == 'auto':
            stats = STATS_PAR_SUJET.get(sujet) or (
                'mixamo' if famille in ('bipeds', 'biped') else ('objaverse' if famille == 'all' else 'truebones'))

        # Os pilotes par le modele ; les autres suivent leur parent dans leur
        # pose de repos (le decodage le gere : Cp est la rotation de repos du
        # parent DIRECT du noeud, pilote ou non).
        os_total = len(joints)
        actifs = set(joints)
        ponderes = os_ponderes(js, bn)
        elagues = 0
        if ponderes:
            # bouts sans poids de peau (os de controle, extremites vides)
            while True:
                nb = {n: 0 for n in actifs}
                for n in actifs:
                    if par_noeud[n] in nb:
                        nb[par_noeud[n]] += 1
                vides = {n for n in actifs if not nb[n] and n not in ponderes and par_noeud[n] is not None}
                if not vides:
                    break
                actifs -= vides
                elagues += len(vides)
        noyau = noyau_mixamo(noms, par_noeud) if sujet == 'A person' else None
        if noyau:
            actifs &= noyau
        joints_m = [n for n in joints if n in actifs]
        par_m = self._parents_joints(joints_m, parent_noeud)

        idx_de = {n: k for k, n in enumerate(joints_m)}
        par_k = [idx_de[par_m[n]] if par_m[n] is not None else -1 for n in joints_m]
        ordre_k = ordre_bfs(par_k, np.array([pos_monde[n] for n in joints_m]))
        # Au-dela de la capacite du modele, on anime les os les PLUS PROCHES DU
        # TRONC. L'ordre BFS range chaque parent avant ses enfants : le prefixe
        # est donc un sous-arbre connexe ; les extremites ecartees suivent leur
        # parent. Capacite = 60 os REELS : `max_joints` (61) compte l'os que
        # l'augmentation d'ajout insere a l'entrainement (`dataset.py`).
        limite = self.cfg.dataset.max_joints - (1 if getattr(self.cfg.dataset, 'use_addition_aug', False) else 0)
        ordre_k = ordre_k[:getattr(self, 'max_os', None) or limite]
        joints = joints_m
        noeud_de = [joints[k] for k in ordre_k]
        u_de_k = {k: u for u, k in enumerate(ordre_k)}
        parents = np.array([u_de_k[par_k[k]] if par_k[k] >= 0 else -1 for k in ordre_k], dtype=np.int64)
        J = len(parents)
        if not 5 <= J <= self.cfg.dataset.max_joints:
            raise ValueError(f'{J} os : hors des bornes du modele (5-{self.cfg.dataset.max_joints})')
        if not all(parents[j] < j for j in range(1, J)):
            raise ValueError('ordre des os invalide (parent apres enfant)')

        # canonisation : XZ au centre, diametre 2, sol a 0 (face +Z supposee :
        # c'est l'orientation de tous les assets generes par FabMesh)
        X = np.array([pos_monde[n] for n in noeud_de], dtype=np.float64)
        X = X - np.array([X[0, 0], 0.0, X[0, 2]])
        s = 2.0 / diametre(parents, X)
        X = X * s
        X[:, 1] -= X[:, 1].min()
        offsets = X.copy()
        offsets[1:] = X[1:] - X[parents[1:]]

        st = self.stats[stats]
        mean = np.zeros((J, 12)); std = np.zeros((J, 12))
        mean[0], std[0] = st['mean_root'], st['std_root']
        mean[1:], std[1:] = st['mean_local'], st['std_local']
        tpos = np.zeros((J, 12))
        tpos[:, :3] = X
        tpos[:, 3:9] = [1, 0, 0, 0, 1, 0]
        tpos_n = np.nan_to_num((tpos - mean) / std)
        tpos_par = tpos_n.copy()
        for j in range(1, J):
            tpos_par[j] = tpos_n[parents[j]]
        relations, dists = compute_edge_relations_and_distances(parents, max_path_len=5)
        spectral, _ = compute_laplacian_eigenvectors(parents, max_freqs=8)

        noms_u = [noms[n] for n in noeud_de]
        for nm in set(noms_u):
            if nm not in self._noms:
                self._noms[nm] = self._texte(nm)[0]
        cap_emb, cap_tok = self._texte(prompt)
        lot = {
            'motion': np.zeros((60, J, 12)), 'max_motion_length': 60, 'motion_length': 60,
            'max_joints': self.cfg.dataset.max_joints, 'parents': parents,
            'edge_indexs': compute_edge_indexs(parents),
            'tpos_first_frame': tpos_n, 'tpos_first_frame_parents': tpos_par,
            'offsets': offsets, 'joint_graph_dist': dists, 'joint_relations': relations,
            'joint_depths': compute_joint_depths(parents), 'spectral_feats': spectral,
            'joint_names_emb': np.stack([self._noms[nm] for nm in noms_u]),
            'object_type': 'fabmesh', 'start_idx': 0, 'mean': mean, 'std': std,
            'split_tag': 'eval', 'caption': prompt, 'caption_emb': cap_emb, 'caption_tokens': cap_tok,
        }
        B = max(1, int(tirages))
        _, cond = mixture_batch_collate([lot] * B)
        cond = {k: v.to(self.dev) if torch.is_tensor(v) else v for k, v in cond.items()}
        torch.manual_seed(int(graine))
        with torch.no_grad():
            ech = generate_samples(model=self.modele, cond=cond,
                                   motion_shape=(B, self.cfg.dataset.max_joints, 12, 60),
                                   diff_model='flow', diffusion=self.transport,
                                   gen_diffusion=Sampler(self.transport), device=self.dev,
                                   cfg_scale=cfg_scale)
        candidats = [ech[b][:J].detach().cpu().permute(2, 0, 1).numpy() * std[None] + mean[None]
                     for b in range(B)]
        scores = [score_mouvement(c, parents) for c in candidats]
        meilleur = int(np.argmax(scores))
        m = candidats[meilleur]

        T = 60
        k = int(raccord) if boucle else 0
        if boucle and 0 < k < 30:
            # BOUCLE (recette du depot, `motion_inbetweening.py` : Euler 50 pas
            # avec images figees) : seconde passe ou les k premieres images
            # sont gardees et les k DERNIERES figees sur ces memes k premieres.
            # Le cycle dure 60 - k images ; on ecrit l'image 60 - k (egale a
            # l'image 0) pour que le lecteur reboucle sans saut.
            A = ech[meilleur:meilleur + 1].detach().clone()
            x1 = A.clone()
            x1[..., 60 - k:] = A[..., :k]
            fige = torch.zeros((1, 1, 1, 60), dtype=torch.bool, device=self.dev)
            fige[..., :k] = True
            fige[..., 60 - k:] = True
            _, cond1 = mixture_batch_collate([lot])
            cond1 = {c: v.to(self.dev) if torch.is_tensor(v) else v for c, v in cond1.items()}
            with torch.no_grad():
                ech2 = generate_samples(model=self.modele, cond=cond1,
                                        motion_shape=(1, self.cfg.dataset.max_joints, 12, 60),
                                        diff_model='flow', diffusion=self.transport,
                                        gen_diffusion=Sampler(self.transport), device=self.dev,
                                        cfg_scale=cfg_scale, x1_known=x1, keep_mask=fige)
            T = 60 - k + 1
            m = (ech2[0][:J].detach().cpu().permute(2, 0, 1).numpy() * std[None] + mean[None])[:T]

        # decodage : chaque os lit sa rotation dans le slot de son enfant
        # (feuilles : identite) ; trajectoire de la racine par integration
        M6 = rotation_6d_to_matrix_np(m[:, :, 3:9])
        R = np.tile(np.eye(3), (T, J, 1, 1))
        for j in range(1, J):
            R[:, parents[j]] = M6[:, j]
        rp = np.zeros((T, 3))
        rp[1:, [0, 2]] = m[:-1, 0, [9, 11]]
        rp = np.cumsum(np.einsum('tji,tj->ti', M6[:, 0], rp), axis=0)
        rp[:, 1] = m[:, 0, 1]

        glb = self._ecrire(js, bn, noeud_de, R, rp, X, s, W, parent_noeud, rot_monde, pos_monde,
                           nom_clip or prompt[:60])
        return glb, {'os': J, 'os_total': os_total, 'famille': famille, 'stats': stats, 'prompt': prompt,
                     'tirages': B, 'scores': [round(x, 3) for x in scores], 'boucle': k, 'images': T,
                     'os_elagues': elagues, 'noyau_mixamo': bool(noyau),
                     'deplacement_racine': float(np.linalg.norm((rp[-1] - rp[0])[[0, 2]]) / s)}

    @staticmethod
    def _ecrire(js, bn, noeud_de, R, rp, X, s, W, parent_noeud, rot_monde, pos_monde, nom):
        """Ajoute le clip au GLB : L_j = Cp^-1 . R_j . C_j (C : rotations monde
        de repos) ; translation de la racine ramenee dans l'espace de son parent."""
        from scipy.spatial.transform import Rotation
        js = json.loads(json.dumps(js))
        blob = bytearray(bn)

        def ajouter(arr, typ, minmax=False):
            arr = np.ascontiguousarray(arr, dtype=np.float32)
            while len(blob) % 4:
                blob.append(0)
            off = len(blob)
            blob.extend(arr.tobytes())
            js.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
            a = {'bufferView': len(js['bufferViews']) - 1, 'componentType': 5126,
                 'count': int(arr.shape[0]), 'type': typ}
            if minmax:
                a['min'] = [float(arr.min())]
                a['max'] = [float(arr.max())]
            js.setdefault('accessors', []).append(a)
            return len(js['accessors']) - 1

        T = R.shape[0]
        temps = ajouter(np.arange(T, dtype=np.float32) / 30.0, 'SCALAR', True)
        samplers, canaux = [], []
        for u, n in enumerate(noeud_de):
            pn = parent_noeud.get(n)
            Cp = orthonormer(W[pn][:3, :3]) if pn is not None else np.eye(3)
            L = np.einsum('ab,tbc,cd->tad', Cp.T, R[:, u], rot_monde[n])
            q = Rotation.from_matrix(L).as_quat()
            for t in range(1, T):
                if np.dot(q[t], q[t - 1]) < 0:
                    q[t] = -q[t]
            samplers.append({'input': temps, 'output': ajouter(q, 'VEC4'), 'interpolation': 'LINEAR'})
            canaux.append({'sampler': len(samplers) - 1, 'target': {'node': n, 'path': 'rotation'}})
        racine = noeud_de[0]
        monde = pos_monde[racine][None] + (rp - X[0][None]) / s
        pn = parent_noeud.get(racine)
        inv = np.linalg.inv(W[pn]) if pn is not None else np.eye(4)
        loc = (inv[:3, :3] @ monde.T).T + inv[:3, 3]
        samplers.append({'input': temps, 'output': ajouter(loc, 'VEC3'), 'interpolation': 'LINEAR'})
        canaux.append({'sampler': len(samplers) - 1, 'target': {'node': racine, 'path': 'translation'}})
        js.setdefault('animations', []).append({'name': nom, 'samplers': samplers, 'channels': canaux})
        while len(blob) % 4:
            blob.append(0)
        js['buffers'][0]['byteLength'] = len(blob)
        jb = json.dumps(js, separators=(',', ':')).encode()
        jb += b' ' * ((4 - len(jb) % 4) % 4)
        return (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob))
                + struct.pack('<II', len(jb), 0x4E4F534A) + jb
                + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))
