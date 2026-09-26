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
import struct
import sys

import numpy as np

# Prompt par type d'animation (menu de l'etape Animation). Le sujet depend de
# la famille : UniMate a appris « A person… », « An animal… », « An object… ».
_VERBES = {
    'idle': 'stands idle and breathes',
    'walk': 'walks forward',
    'run': 'runs forward',
    'attack': 'attacks forward',
    'jump': 'jumps up in place',
    'death': 'falls down and dies',
    'fly': 'flies flapping its wings',
    'hit': 'gets hit and staggers back',
    'dance': 'dances in place',
}


def famille_pour(asset_type):
    """La detection automatique de famille se trompe sur nos rigs (le
    chevalier sort « flying ») : le type d'asset choisi par l'utilisateur est
    plus sur. 'auto' = repli sur la detection."""
    t = (asset_type or '').lower()
    if t in ('character', 'other_living', 'humanoid'):
        return 'bipeds'
    if t == 'animal':
        return 'quadropeds'
    return 'auto'


_SUJETS = ('a ', 'an ', 'the ', 'he ', 'she ', 'it ', 'they ', 'someone', 'somebody', 'person', 'man ',
           'woman ', 'character', 'creature', 'animal')


def prompt_pour(anim_type, famille, prompt_utilisateur=''):
    """Legende au format appris par le modele : « A person walks forward ».
    Une description libre sans sujet (« digs the earth with a shovel ») en
    recoit un."""
    sujet = {'bipeds': 'A person', 'quadropeds': 'An animal', 'flying': 'A bird',
             'millipeds_snakes': 'A creature'}.get(famille, 'A creature')
    libre = (prompt_utilisateur or '').strip().rstrip('.')
    if libre:
        if libre.lower().startswith(_SUJETS):
            return libre[0].upper() + libre[1:]
        return f"{sujet} {libre[0].lower() + libre[1:]}"
    return f"{sujet} {_VERBES.get((anim_type or 'idle').lower(), 'moves naturally')}"


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


def noms_unimate(roles):
    """Roles FabMesh (hip, spine_01, arm_l_02, leg_r_03, wing_l_01, tail_02,
    neck_01, head, limb_04) -> vocabulaire anatomique d'UniMate."""
    longueurs = {}
    for r in roles.values():
        parts = r.split('_')
        if parts[0] in ('arm', 'leg', 'wing') and len(parts) >= 3:
            cle = parts[0] + '_' + parts[1]
            longueurs[cle] = max(longueurs.get(cle, 0), int(parts[2]))
    bras = {1: ['Upper Arm'], 2: ['Upper Arm', 'Hand'], 3: ['Upper Arm', 'Forearm', 'Hand']}
    jambe = {1: ['Thigh'], 2: ['Thigh', 'Foot'], 3: ['Thigh', 'Shin', 'Foot']}
    simples = {'hip': 'Hips', 'spine': 'Spine', 'neck': 'Neck', 'head': 'Head', 'tail': 'Tail'}
    out = {}
    for j, r in roles.items():
        parts = r.split('_')
        tete = parts[0]
        if tete in simples:
            out[j] = simples[tete]
        elif tete in ('arm', 'leg', 'wing') and len(parts) >= 3:
            cote = 'Left' if parts[1] == 'l' else 'Right'
            i, n = int(parts[2]), longueurs[tete + '_' + parts[1]]
            if tete == 'wing':
                base = 'Wing'
            elif tete == 'arm':
                seq = bras.get(n) or (['Shoulder', 'Upper Arm', 'Forearm', 'Hand'] + ['Finger'] * (n - 4))
                base = seq[min(i, len(seq)) - 1]
            else:
                seq = jambe.get(n) or (['Thigh', 'Shin', 'Foot', 'Toe'] + ['Toe'] * (n - 4))
                base = seq[min(i, len(seq)) - 1]
            out[j] = f'{cote} {base}'
        else:
            out[j] = 'End'
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
               nom_clip=None):
        """Rend (octets du GLB anime, infos). `famille` gouverne les noms des
        membres (bras/ailes) ; `stats` la normalisation (mixamo, truebones,
        objaverse)."""
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
        noms = noms_unimate({n: r.split('__j')[0] for n, r in roles.items()})
        if not stats or stats == 'auto':
            stats = ('mixamo' if famille in ('bipeds', 'biped')
                     else ('objaverse' if famille == 'all' else 'truebones'))

        idx_de = {n: k for k, n in enumerate(joints)}
        par_k = [idx_de[par_noeud[n]] if par_noeud[n] is not None else -1 for n in joints]
        ordre_k = ordre_bfs(par_k, np.array([pos_monde[n] for n in joints]))
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
        _, cond = mixture_batch_collate([lot])
        cond = {k: v.to(self.dev) if torch.is_tensor(v) else v for k, v in cond.items()}
        torch.manual_seed(int(graine))
        with torch.no_grad():
            ech = generate_samples(model=self.modele, cond=cond,
                                   motion_shape=(1, self.cfg.dataset.max_joints, 12, 60),
                                   diff_model='flow', diffusion=self.transport,
                                   gen_diffusion=Sampler(self.transport), device=self.dev,
                                   cfg_scale=cfg_scale)
        m = ech[0][:J].detach().cpu().permute(2, 0, 1).numpy() * std[None] + mean[None]

        # decodage : chaque os lit sa rotation dans le slot de son enfant
        # (feuilles : identite) ; trajectoire de la racine par integration
        M6 = rotation_6d_to_matrix_np(m[:, :, 3:9])
        R = np.tile(np.eye(3), (60, J, 1, 1))
        for j in range(1, J):
            R[:, parents[j]] = M6[:, j]
        rp = np.zeros((60, 3))
        rp[1:, [0, 2]] = m[:-1, 0, [9, 11]]
        rp = np.cumsum(np.einsum('tji,tj->ti', M6[:, 0], rp), axis=0)
        rp[:, 1] = m[:, 0, 1]

        glb = self._ecrire(js, bn, noeud_de, R, rp, X, s, W, parent_noeud, rot_monde, pos_monde,
                           nom_clip or prompt[:60])
        return glb, {'os': J, 'famille': famille, 'stats': stats, 'prompt': prompt,
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

        temps = ajouter(np.arange(60, dtype=np.float32) / 30.0, 'SCALAR', True)
        samplers, canaux = [], []
        for u, n in enumerate(noeud_de):
            pn = parent_noeud.get(n)
            Cp = orthonormer(W[pn][:3, :3]) if pn is not None else np.eye(3)
            L = np.einsum('ab,tbc,cd->tad', Cp.T, R[:, u], rot_monde[n])
            q = Rotation.from_matrix(L).as_quat()
            for t in range(1, 60):
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
