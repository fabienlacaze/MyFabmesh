"""Marche procedurale sur un squelette QUELCONQUE (prototype, hors appli).

Usage : python locomotion.py <rig.glb> <sortie.glb> [allure=walk] [cycles=3]

Aucune IA, aucune donnee d'animation : des regles de locomotion (comme Spore).
1. Pattes : bouts de chaine proches du sol et hors de l'axe du corps (une queue
   ou une machoire est centrale), regroupes par pied (orteils voisins) ; la patte
   remonte jusqu'au dernier os qui ne porte aucun autre pied.
2. Allure selon le nombre de pattes : 2 = alternance, 4 = pas (arriere gauche,
   avant gauche, arriere droit, avant droit), 6 et plus = trepied / tetrapode
   alterne avec une legere onde d'avant en arriere.
3. Pas : le corps avance a vitesse constante ; un pied en appui reste FIXE au
   sol, un pied en vol decrit un arc vers l'avant.
4. Cinematique inverse (FABRIK) partant de la pose de repos, pour garder le
   sens de pliure des genoux ; rotations = rotation minimale de chaque os.
5. Queue : ondulation qui se propage vers le bout ; tete : leger hochement.
Repere glTF de nos rigs : Y en haut, face +Z, +X = gauche.
"""
import json
import os
import struct
import sys

import numpy as np
from scipy.spatial.transform import Rotation

sys.path.insert(0, r'C:\Users\Utilisateur\Desktop\FabWare\MeshyMyself\modal_app')
import _unimate_moteur as M  # noqa: E402  (lecture GLB, matrices monde)

ALLURES = {
    #          appui  periode 2-4 pattes / 6+   hauteur de pas  bob
    'walk': dict(beta=0.65, T=(1.1, 0.7), h=0.22, bob=0.025, foulee=1.0),
    'run': dict(beta=0.40, T=(0.62, 0.42), h=0.30, bob=0.05, foulee=1.6),
}


# ---------------------------------------------------------------- squelette
def charger(chemin):
    js, bn = M.lire_glb(open(chemin, 'rb').read())
    joints = list(js['skins'][0]['joints'])
    W, parent_noeud = M.matrices_monde(js)
    ens = set(joints)
    idx = {n: i for i, n in enumerate(joints)}
    par = []
    for n in joints:
        p = parent_noeud.get(n)
        while p is not None and p not in ens:
            p = parent_noeud.get(p)
        par.append(idx[p] if p is not None else -1)
    P0 = np.array([W[n][:3, 3] for n in joints])
    return js, bn, joints, np.array(par), P0, W, parent_noeud


def enfants_de(par):
    E = [[] for _ in par]
    for j, p in enumerate(par):
        if p >= 0:
            E[p].append(j)
    return E


def sous_arbre(E, j):
    pile, out = [j], []
    while pile:
        k = pile.pop()
        out.append(k)
        pile.extend(E[k])
    return out


def detecter_pattes(par, P0):
    E = enfants_de(par)
    racine = int(np.flatnonzero(par < 0)[0])
    sol, H = P0[:, 1].min(), np.ptp(P0[:, 1])
    ext = np.ptp(P0, axis=0).max()
    x0 = float(np.median(P0[:, 0]))                          # axe median du corps
    feuilles = [j for j in range(len(par)) if not E[j]]
    prof = np.zeros(len(par), int)
    for j in range(len(par)):
        k = j
        while par[k] >= 0:
            k = par[k]
            prof[j] += 1

    def chemin(j):
        c = []
        while j >= 0:
            c.append(j)
            j = par[j]
        return c[::-1]

    def ancetre(a, b):
        ca, cb = chemin(a), chemin(b)
        k = 0
        while k < min(len(ca), len(cb)) and ca[k] == cb[k]:
            k += 1
        return ca[k - 1]

    bas = [j for j in feuilles if P0[j, 1] - sol < 0.2 * H]
    # une queue posee au sol : bout central ET derriere la hanche -> pas une patte
    bas = [j for j in bas if not (abs(P0[j, 0] - x0) < 0.01 * ext and P0[j, 2] < P0[racine, 2] - 0.1 * ext)]
    # pieds : feuilles au sol dont l'ancetre commun est a 2 os au plus (orteils d'un meme pied)
    grappes = []
    for j in sorted(bas, key=lambda k: P0[k, 1]):
        for g in grappes:
            a = ancetre(j, g[0])
            if prof[j] - prof[a] <= 2 and prof[g[0]] - prof[a] <= 2:
                g.append(j)
                break
        else:
            grappes.append([j])
    feuille_grappe = {j: gi for gi, g in enumerate(grappes) for j in g}

    def grappes_sous(j):
        return {feuille_grappe[k] for k in sous_arbre(E, j) if k in feuille_grappe}

    pattes = []
    for gi, g in enumerate(grappes):
        bout = g[0]
        for f in g[1:]:
            bout = ancetre(bout, f)                          # la cheville si plusieurs orteils
        haut = bout
        while par[haut] >= 0 and par[haut] != racine and grappes_sous(par[haut]) == {gi}:
            haut = par[haut]
        chaine, k = [], bout
        while True:
            chaine.append(k)
            if k == haut:
                break
            k = par[k]
        chaine = chaine[::-1]
        if len(chaine) < 2:
            continue
        pattes.append(dict(chaine=chaine, bout=bout, dx=float(P0[bout, 0] + P0[chaine[0], 0]) / 2 - x0))
    # cote (+X = gauche) : moyenne pied/attache par rapport a l'axe ; pour une patte
    # presque centrale (lion etroit), l'oppose de sa voisine la plus proche en Z
    for p in pattes:
        p['cote'] = int(np.sign(p['dx'])) if abs(p['dx']) > 0.01 * ext else 0
    for p in pattes:
        if p['cote'] == 0:
            autres = [q for q in pattes if q is not p]
            if autres:
                v = min(autres, key=lambda q: abs(P0[q['bout'], 2] - P0[p['bout'], 2]))
                p['cote'] = -v['cote'] if v['cote'] else (1 if p['dx'] >= v['dx'] else -1)
            else:
                p['cote'] = 1
    # queue et tete : chaines centrales issues de la racine (ou du tronc)
    autres = []
    dans_pattes = {j for p in pattes for j in p['chaine']}
    for f in feuilles:
        if f in dans_pattes or any(f in sous_arbre(E, p['chaine'][0]) for p in pattes):
            continue
        c, k = [], f
        while k >= 0 and k not in dans_pattes and k != racine and len(E[par[k]]) == 1:
            c.append(k)
            k = par[k]
        if k >= 0 and k != racine and k not in dans_pattes:
            c.append(k)
        c = c[::-1]
        if len(c) >= 2:
            autres.append(c)
    queues = [c for c in autres if P0[c[-1], 2] < P0[racine, 2] and abs(P0[c[-1], 0] - x0) < 0.05 * ext]
    tetes = [c for c in autres if P0[c[-1], 2] > P0[racine, 2] and abs(P0[c[-1], 0] - x0) < 0.05 * ext]
    return racine, pattes, queues, tetes, sol


def phases(pattes, P0):
    """Decalage de phase de chaque patte (0..1)."""
    for cote in (1, -1):
        cc = sorted([p for p in pattes if p['cote'] == cote], key=lambda p: -P0[p['bout'], 2])
        for k, p in enumerate(cc):
            p['rang'] = k
            p['nb_cote'] = len(cc)
    n = len(pattes)
    for p in pattes:
        s = 0 if p['cote'] == 1 else 1
        if n <= 2:
            p['phase'] = 0.5 * s
        elif n <= 4 and p['nb_cote'] == 2:
            # pas lateral : AR gauche 0, AV gauche 0,25, AR droit 0,5, AV droit 0,75
            p['phase'] = 0.5 * s + (0.25 if p['rang'] == 0 else 0.0)
        else:
            # trepied / tetrapode alterne + onde metachronale (de l'arriere vers l'avant)
            p['phase'] = (0.5 * ((p['rang'] + s) % 2) + 0.06 * (p['nb_cote'] - 1 - p['rang'])) % 1.0


# ---------------------------------------------------------------- cinematique
def aligner(a, b):
    """Rotation minimale qui amene la direction a sur la direction b."""
    a = a / (np.linalg.norm(a) + 1e-12)
    b = b / (np.linalg.norm(b) + 1e-12)
    v, c = np.cross(a, b), float(np.dot(a, b))
    if c < -0.999999:
        axe = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        return Rotation.from_rotvec(np.pi * axe / np.linalg.norm(axe)).as_matrix()
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def fabrik(Q, cible, iterations=20):
    L = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    base = Q[0].copy()
    if np.linalg.norm(cible - base) >= L.sum():
        d = (cible - base) / np.linalg.norm(cible - base)
        return np.vstack([base, base + np.cumsum(L)[:, None] * d])
    Q = Q.copy()
    for _ in range(iterations):
        Q[-1] = cible
        for i in range(len(Q) - 2, -1, -1):
            d = Q[i] - Q[i + 1]
            Q[i] = Q[i + 1] + d / (np.linalg.norm(d) + 1e-12) * L[i]
        Q[0] = base
        for i in range(1, len(Q)):
            d = Q[i] - Q[i - 1]
            Q[i] = Q[i - 1] + d / (np.linalg.norm(d) + 1e-12) * L[i - 1]
        if np.linalg.norm(Q[-1] - cible) < 1e-5:
            break
    return Q


def animer(chemin, allure='walk', cycles=3, fps=30):
    js, bn, joints, par, P0, W, parent_noeud = charger(chemin)
    racine, pattes, queues, tetes, sol = detecter_pattes(par, P0)
    if not pattes:
        raise SystemExit('aucune patte detectee')
    phases(pattes, P0)
    A = ALLURES[allure]
    nombreux = len(pattes) >= 6
    T = A['T'][1 if nombreux else 0]
    beta = A['beta'] if not (nombreux and allure == 'walk') else 0.55
    portee = np.mean([np.linalg.norm(P0[p['bout']] - P0[p['chaine'][0]]) for p in pattes])
    hanche = np.mean([P0[p['chaine'][0], 1] - sol for p in pattes])
    S = A['foulee'] * (0.6 * portee + 0.8 * hanche)         # foulee par cycle
    h = A['h'] * (0.5 * portee + 0.5 * hanche)               # hauteur du pas
    v = S / T
    nT = int(round(cycles * T * fps))
    t = np.arange(nT) / fps
    J = len(joints)

    D = np.tile(np.eye(3), (nT, J, 1, 1))                    # rotation monde (delta sur le repos)
    corps = np.zeros((nT, 3))
    corps[:, 2] = v * t
    corps[:, 1] = -A['bob'] * hanche * np.cos(2 * np.pi * t / T * 2)
    # tangage leger, synchrone du bob
    tangage = 0.02 * np.sin(2 * np.pi * t / T * 2)
    Rb = np.array([Rotation.from_euler('x', a).as_matrix() for a in tangage])
    pivot = P0[racine]

    def monde(i, p):                                         # point de repos -> monde a l'image i
        return pivot + corps[i] + Rb[i] @ (p - pivot)

    fixes = {}                                               # os pilotes directement (rotation monde)
    for p in pattes:
        ch = p['chaine']
        for i in range(nT):
            phi = (t[i] / T + p['phase']) % 1.0
            if phi < beta:
                rel_z, y = beta * S / 2 - phi * S, 0.0
            else:
                u = (phi - beta) / (1 - beta)
                rel_z = -beta * S / 2 + beta * S * (1 - np.cos(np.pi * u)) / 2
                y = h * np.sin(np.pi * u)
            neutre = P0[p['bout']]
            cible = np.array([neutre[0], neutre[1] + y, neutre[2] + rel_z]) + np.array([0, 0, corps[i, 2]])
            Q = np.array([monde(i, P0[k]) for k in ch])
            Q = fabrik(Q, cible)
            for a in range(len(ch) - 1):
                repos = Rb[i] @ (P0[ch[a + 1]] - P0[ch[a]])
                D[i, ch[a]] = aligner(repos, Q[a + 1] - Q[a]) @ Rb[i]
        for k in ch[:-1]:
            fixes[k] = D[:, k].copy()
        fixes[ch[-1]] = Rb                                   # pied a plat, orteils solidaires
    # queue : ondulation laterale qui se propage vers le bout ; tete : hochement
    balance = {}
    for c in queues:
        for a, j in enumerate(c[:-1]):
            ang = 0.10 * (a + 1) / len(c) * np.sin(2 * np.pi * t / T - 0.7 * a)
            balance[j] = Rotation.from_euler('y', ang[:, None]).as_matrix()
    for c in tetes:
        for a, j in enumerate(c[:-1]):
            balance[j] = Rotation.from_euler('x', 0.03 * np.sin(2 * np.pi * t / T * 2 + 0.5 + 0.3 * a)[:, None]).as_matrix()
    # parcours parents d'abord : un os non pilote suit son parent (solidaire)
    ordre, file = [], [racine]
    E = enfants_de(par)
    while file:
        j = file.pop(0)
        ordre.append(j)
        file.extend(E[j])
    for j in ordre:
        if j == racine:
            D[:, j] = Rb
        elif j in fixes:
            D[:, j] = fixes[j]
        elif j in balance:
            D[:, j] = np.einsum('tab,tbc->tac', D[:, par[j]], balance[j])
        else:
            D[:, j] = D[:, par[j]]
    # rotations locales (convention repos aligne sur le monde) : R_j = D_parent^T D_j
    R = np.empty_like(D)
    for j in range(J):
        p = par[j]
        R[:, j] = D[:, j] if p < 0 else np.einsum('tba,tbc->tac', D[:, p], D[:, j])
    racine_monde = np.array([monde(i, P0[racine]) for i in range(nT)])
    infos = dict(pattes=len(pattes), queues=len(queues), tetes=len(tetes), periode=T, foulee=round(float(S), 3),
                 appui=beta, phases=[round(p['phase'], 2) for p in pattes],
                 os_par_patte=[len(p['chaine']) for p in pattes])
    return ecrire(js, bn, joints, R, racine_monde, W, parent_noeud, f'{allure} (procedural)', fps), infos


# ---------------------------------------------------------------- ecriture glTF
def ecrire(js, bn, joints, R, racine_monde, W, parent_noeud, nom, fps):
    js = json.loads(json.dumps(js))
    blob = bytearray(bn)

    def ajouter(arr, typ, minmax=False):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        js.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
        a = {'bufferView': len(js['bufferViews']) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = [float(arr.min())]
            a['max'] = [float(arr.max())]
        js.setdefault('accessors', []).append(a)
        return len(js['accessors']) - 1
    nT = R.shape[0]
    temps = ajouter(np.arange(nT, dtype=np.float32) / fps, 'SCALAR', True)
    samplers, canaux = [], []
    for u, n in enumerate(joints):
        pn = parent_noeud.get(n)
        Cp = M.orthonormer(W[pn][:3, :3]) if pn is not None else np.eye(3)
        C = M.orthonormer(W[n][:3, :3])
        L = np.einsum('ab,tbc,cd->tad', Cp.T, R[:, u], C)
        qq = Rotation.from_matrix(L).as_quat()
        for i in range(1, nT):
            if np.dot(qq[i], qq[i - 1]) < 0:
                qq[i] = -qq[i]
        samplers.append({'input': temps, 'output': ajouter(qq, 'VEC4'), 'interpolation': 'LINEAR'})
        canaux.append({'sampler': len(samplers) - 1, 'target': {'node': n, 'path': 'rotation'}})
    racine = next(n for n in joints if parent_noeud.get(n) not in set(joints))
    pn = parent_noeud.get(racine)
    inv = np.linalg.inv(W[pn]) if pn is not None else np.eye(4)
    loc = (inv[:3, :3] @ racine_monde.T).T + inv[:3, 3]
    samplers.append({'input': temps, 'output': ajouter(loc, 'VEC3'), 'interpolation': 'LINEAR'})
    canaux.append({'sampler': len(samplers) - 1, 'target': {'node': racine, 'path': 'translation'}})
    js['animations'] = [{'name': nom, 'samplers': samplers, 'channels': canaux}]
    while len(blob) % 4:
        blob.append(0)
    js['buffers'][0]['byteLength'] = len(blob)
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    return (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob))
            + struct.pack('<II', len(jb), 0x4E4F534A) + jb
            + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


if __name__ == '__main__':
    rig, sortie = sys.argv[1], sys.argv[2]
    allure = sys.argv[3] if len(sys.argv) > 3 else 'walk'
    cycles = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    glb, infos = animer(rig, allure, cycles)
    open(sortie, 'wb').write(glb)
    print(os.path.basename(sortie), infos)
