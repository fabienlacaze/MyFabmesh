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
import ik_forme  # noqa: E402  (cinematique inverse a forme gardee)

ALLURES = {
    # appui : part du cycle au sol ; T : periode (<= 4 pattes, 6 et plus) ; h : hauteur de pas ;
    # bob : balancement vertical ; foulee : longueur relative ; lacet : rad/s (+ = vers la gauche)
    'walk': dict(beta=0.65, T=(1.1, 0.7), h=0.22, bob=0.035, foulee=1.0, lacet=0.0, tendu=0.965, talon=0.5, pas=True),
    'run': dict(beta=0.38, T=(0.62, 0.42), h=0.22, bob=0.035, foulee=1.8, lacet=0.0, tendu=0.87, talon=0.7, pas=True),
    'turn_left': dict(beta=0.65, T=(1.1, 0.7), h=0.2, bob=0.02, foulee=0.55, lacet=0.55, tendu=0.92, talon=0.35, pas=True),
    'turn_right': dict(beta=0.65, T=(1.1, 0.7), h=0.2, bob=0.02, foulee=0.55, lacet=-0.55, tendu=0.92, talon=0.35, pas=True),
    'idle': dict(beta=1.0, T=(4.0, 4.0), h=0.0, bob=0.008, foulee=0.0, lacet=0.0, tendu=0.95, talon=0.0, pas=False),
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
    # patte LEVEE au repos (pattes arriere de l'araignee a 26-28 % de la hauteur) : bout
    # lateral dans le bas du corps ; validee plus loin si sa chaine redescend au bout
    levees = {j for j in feuilles if 0.2 * H <= P0[j, 1] - sol < 0.45 * H and abs(P0[j, 0] - x0) > 0.1 * ext}
    bas += sorted(levees)
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
        if all(f in levees for f in g) and (len(chaine) < 3 or P0[bout, 1] >= P0[chaine[1], 1]):
            continue
        p_levee = all(f in levees for f in g)
        pattes.append(dict(chaine=chaine, bout=bout, levee=p_levee, dx=float(P0[bout, 0] + P0[chaine[0], 0]) / 2 - x0))
    longueur = lambda q: float(np.linalg.norm(np.diff(P0[q['chaine']], axis=0), axis=1).sum())
    ref = [longueur(q) for q in pattes if not q['levee']]
    if ref:
        pattes = [q for q in pattes if not q['levee'] or longueur(q) >= 0.6 * float(np.median(ref))]
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


def phases(pattes, P0, allure='walk'):
    """Decalage de phase de chaque patte (0..1). Marche a 4 pattes : pas lateral ;
    course a 4 pattes : trot (diagonales ensemble) ; 6 et plus : tetrapode / trepied
    alterne, avec une onde de l'arriere vers l'avant a la marche."""
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
        elif n <= 4 and p['nb_cote'] == 2 and allure != 'run':
            # pas lateral : AR gauche 0, AV gauche 0,25, AR droit 0,5, AV droit 0,75
            p['phase'] = 0.5 * s + (0.25 if p['rang'] == 0 else 0.0)
        else:
            onde = 0.06 if allure != 'run' else 0.0
            p['phase'] = (0.5 * ((p['rang'] + s) % 2) + onde * (p['nb_cote'] - 1 - p['rang'])) % 1.0


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


def fabrik(Q, cible, iterations=20, n=None, sol_min=None, pole=None):
    L = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    base = Q[0].copy()
    Q = Q.copy()
    # chaine presque ALIGNEE : FABRIK ne sait pas de quel cote plier et la garde droite (la
    # jambe de l'humain au repos, 99 % de sa longueur, poussait le pied sous le sol) -> on la
    # pre-plie dans son sens naturel
    if pole is not None and len(Q) > 2:
        u0 = (cible - base) / (np.linalg.norm(cible - base) + 1e-12)
        ecart = max(np.linalg.norm((Q[k] - base) - np.dot(Q[k] - base, u0) * u0) for k in range(1, len(Q) - 1))
        if ecart < 0.03 * L.sum():
            Q[1:-1] += 0.08 * L.sum() * pole

    def plan(Q_):
        if n is None:
            return Q_
        return Q_ - np.outer((Q_ - base) @ n, n)
    Q = plan(Q)
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
        Q = plan(Q)
        if sol_min is not None:                              # aucune articulation sous le sol
            Q[1:-1, 1] = np.maximum(Q[1:-1, 1], sol_min)
        for i in range(1, len(Q)):                           # longueurs exactes apres projection
            d = Q[i] - Q[i - 1]
            Q[i] = Q[i - 1] + d / (np.linalg.norm(d) + 1e-12) * L[i - 1]
        if np.linalg.norm(Q[-1] - cible) < 1e-5:
            break
    return Q


def Ry(a):
    return Rotation.from_euler('y', np.atleast_1d(a)[:, None]).as_matrix()


def animer(chemin, allure='walk', cycles=3, fps=30, brut=False):
    js, bn, joints, par, P0, W, parent_noeud = charger(chemin)
    racine, pattes, queues, tetes, sol = detecter_pattes(par, P0)
    if not pattes:
        raise SystemExit('aucune patte detectee')
    palpes = []
    if len(pattes) >= 6:
        lg = [float(np.linalg.norm(np.diff(P0[q['chaine']], axis=0), axis=1).sum()) for q in pattes]
        med = float(np.median(lg))
        palpes = [q for q, l_ in zip(pattes, lg) if l_ < 0.65 * med]
        pattes = [q for q, l_ in zip(pattes, lg) if l_ >= 0.65 * med]
    phases(pattes, P0, allure)
    A = ALLURES[allure]
    nombreux = len(pattes) >= 6
    bipede = len(pattes) <= 2
    T = A['T'][1 if nombreux else 0]
    beta = 0.55 if (nombreux and allure != 'run' and A['pas']) else A['beta']
    if bipede and A['pas'] and allure != 'run':
        beta = 0.6
    H = float(np.ptp(P0[:, 1]))
    # --- geometrie de chaque patte : chaine de cinematique inverse, pied rigide, point neutre
    for p in pattes:
        ch = p['chaine']
        # Patte de 3 os ou plus : son dernier os (la patte proprement dite, court) reste RIGIDE,
        # oriente comme au repos, et la cinematique inverse s'arrete a la cheville. Sinon FABRIK
        # retourne ce petit os en plein vol (a-coups de 90 a 150 deg sur les pattes avant du lion).
        seg = np.linalg.norm(np.diff(P0[ch], axis=0), axis=1)
        p['ik'] = ch[:-1] if len(ch) >= 4 and seg[-1] < 0.5 * seg[:-1].mean() else ch
        p['pied_off'] = P0[p['bout']] - P0[p['ik'][-1]]
        Eb = enfants_de(par)
        sous = [k for k in sous_arbre(Eb, p['bout']) if not Eb[k] and k != p['bout']]
        p['pivot_off'] = None
        if p['ik'] is not ch:
            p['pivot_off'] = np.zeros(3)                   # la patte pivote sur son bout
        elif sous:
            orteil = max(sous, key=lambda k: P0[k, 2])
            off = P0[orteil] - P0[p['bout']]
            if off[2] > 0.05 * float(np.linalg.norm(np.diff(P0[ch], axis=0), axis=1).sum()):
                p['pivot_off'] = off
        haut = P0[ch[0]]
        N = P0[p['bout']].copy()
        d = N - haut
        # Patte « debout » (plus haute que large) : cheville a l'aplomb de la hanche. Au repos, les
        # pattes arriere du lion sont en pleine foulee (pied 9 cm devant, l'autre 10 cm derriere).
        # Patte etalee (araignee) : direction de repos gardee.
        if abs(d[1]) > 1.5 * np.hypot(d[0], d[2]):
            N[2] = haut[2] + p['pied_off'][2]
        # pied pose au sol, y compris une patte levee au repos (pattes arriere de l'araignee)
        # le point le plus BAS du pied (orteil sous la cheville chez l'humain) touche le sol ;
        # abaisser la cheville elle-meme au sol enfoncait les orteils de 6 % de la hauteur
        Eb_ = enfants_de(par)
        contact = min(P0[k, 1] for k in sous_arbre(Eb_, p['bout']))
        if contact - sol > 0.02 * H:
            N[1] -= contact - sol
        p['neutre'] = N
        # sens de pliure : ecart des articulations a la droite hanche-cheville, au repos ;
        # patte « debout » : ramene dans le plan avant-arriere (genou vers l'avant par defaut)
        ik_ = p['ik']
        a_, b_ = P0[ik_[0]], P0[ik_[-1]]
        u_ = (b_ - a_) / (np.linalg.norm(b_ - a_) + 1e-12)
        pole = np.zeros(3)
        for k_ in ik_[1:-1]:
            o_ = P0[k_] - a_
            pole += o_ - np.dot(o_, u_) * u_
        debout = abs(d[1]) > 1.5 * np.hypot(d[0], d[2])
        if debout:
            pole[0] = 0.0
        if np.linalg.norm(pole) < 1e-4:
            pole = np.array([0.0, 0.0, 1.0]) if debout else np.array([0.0, 1.0, 0.0])
        p['pole'] = pole / np.linalg.norm(pole)
        p['forme'] = ik_forme.preparer(P0[ik_], p['pole'])
    portee = np.mean([np.linalg.norm(p['neutre'] - P0[p['chaine'][0]]) for p in pattes])
    hanche = np.mean([P0[p['chaine'][0], 1] - sol for p in pattes])
    S = A['foulee'] * (0.6 * portee + 0.8 * hanche)         # foulee par cycle
    h = A['h'] * (0.5 * portee + 0.5 * hanche)               # hauteur du pas
    # Patte trop tendue en fin de poussee = pied hors de portee : la patte se bloque droite
    # puis « claque » (a-coups vus sur le lion et l'humain le 28/09 ; jambes de l'humain a 99 %
    # de leur longueur au repos, pied demande a 110 % en fin d'appui).
    # (a) bassin abaisse : chaque patte, pied au neutre, a <= A['tendu'] de sa longueur ;
    # (b) demi-pas en appui limite pour rester a <= 98 % de la longueur aux extremites.
    TENDU_MAX = 0.98
    geo = []
    for p in pattes:
        ik = p['ik']
        Lc = float(np.linalg.norm(np.diff(P0[ik], axis=0), axis=1).sum())
        d = (p['neutre'] - p['pied_off']) - P0[ik[0]]
        geo.append((Lc, abs(d[0]), -d[1], abs(d[2])))
    abaisse = 0.0
    for Lc, dx, dy, dz in geo:
        r2 = (A['tendu'] * Lc) ** 2 - dx ** 2 - dz ** 2
        if r2 > 0:
            abaisse = max(abaisse, dy - np.sqrt(r2))
    # course : corps haut aux extremites de l'appui ; marche : corps BAS au double appui (gain de portee)
    marge_bob = A['bob'] * hanche * (2 if allure == 'run' else -1)
    if A['pas']:
        demis = [max(np.sqrt(max((TENDU_MAX * Lc) ** 2 - dx ** 2 - (dy - abaisse + marge_bob) ** 2, 0)) - dz, 0.03 * portee)
                 for Lc, dx, dy, dz in geo]
        S = min(S, float(np.median([2 * d_ / beta for d_ in demis])))
        for p, d_ in zip(pattes, demis):
            p['beta'] = float(np.clip(2 * d_ / S, 0.25, beta))
    else:
        for p in pattes:
            p['beta'] = beta
    v, w = S / T, A['lacet']
    nT = int(round(cycles * T * fps))
    t = np.arange(nT) / fps
    J = len(joints)
    pivot = P0[racine]

    # --- trajectoire du corps (sans balancement) : position au sol et cap, a tout instant
    def chemin_corps(tt):
        tt = np.atleast_1d(tt).astype(float)
        cap = w * tt
        if abs(w) < 1e-9:
            c = np.stack([0 * tt, 0 * tt, v * tt], -1)
        else:
            c = np.stack([(v / w) * (1 - np.cos(cap)), 0 * tt, (v / w) * np.sin(cap)], -1)
        return c, cap

    c, cap = chemin_corps(t)
    Rcap = Ry(cap)
    # --- balancement : haut au milieu de l'appui a la marche, bas a la course ; respiration a l'arret
    p0 = pattes[0]['phase']
    onde2 = np.cos(4 * np.pi * (t / T - (beta / 2 - p0)))
    if not A['pas']:
        bob = A['bob'] * hanche * np.sin(2 * np.pi * 2 * t / T)
        tangage = 0.01 * np.sin(2 * np.pi * t / T)
        roulis = 0.012 * np.sin(2 * np.pi * t / T + 1.0)
        lateral = 0.015 * hanche * np.sin(2 * np.pi * t / T + 1.0)
    else:
        bob = A['bob'] * hanche * (onde2 if allure != 'run' else -onde2)
        tangage = (0.05 if allure == 'run' and bipede else 0.0) + 0.02 * np.sin(4 * np.pi * t / T)
        roulis = (0.035 if bipede else 0.012) * np.sin(2 * np.pi * (t / T + p0 - beta / 2))
        lateral = (0.04 * hanche if bipede else 0.0) * np.sin(2 * np.pi * (t / T + p0 - beta / 2))
    # Bipede « coince » (retour du 28/09) : dans une vraie marche le bassin TOURNE (hanche de la
    # jambe avant en avant) et BASCULE (cote de la jambe en vol qui descend), les epaules
    # contre-tournent et les bras balancent a l'opposé des jambes.
    lacet_bassin = np.zeros_like(t)
    s_g = np.zeros_like(t)                                   # +1 quand le pied gauche se pose (jambe gauche devant)
    if bipede:
        gauche = next((q for q in pattes if q['cote'] == 1), pattes[0])
        s_g = np.cos(2 * np.pi * (t / T + gauche['phase']))
        if A['pas']:
            amp = {'run': (0.12, 0.05)}.get(allure, (0.08, 0.06))
            lacet_bassin = -amp[0] * s_g
            roulis = amp[1] * np.cos(2 * np.pi * (t / T + gauche['phase'] - beta / 2))
            lateral = 0.035 * hanche * np.cos(2 * np.pi * (t / T + gauche['phase'] - beta / 2))
    Rb = np.einsum('tab,tbc,tcd,tde->tae', Rcap, Ry(lacet_bassin), Rotation.from_euler('x', tangage[:, None]).as_matrix(),
                   Rotation.from_euler('z', roulis[:, None]).as_matrix())
    decal = c + np.stack([0 * t, bob - abaisse, 0 * t], -1) + np.einsum('tab,tb->ta', Rcap, np.stack([lateral, 0 * t, 0 * t], -1))

    def monde(i, p):                                         # point de repos -> monde a l'image i
        return pivot + decal[i] + Rb[i] @ (p - pivot)

    def appui(p_, k):
        """Point d'appui du cycle k : pied neutre sous le corps au MILIEU de l'appui."""
        tm = (k - p_['phase']) * T + p_['beta'] * T / 2
        cm, capm = chemin_corps(tm)
        N = p_['neutre']
        X = pivot + cm[0] + Ry(capm)[0] @ (N - pivot)
        X[1] = N[1]
        return X

    D = np.tile(np.eye(3), (nT, J, 1, 1))                    # rotation monde (delta sur le repos)
    fixes = {}
    for p in pattes:
        ch = p['ik']
        Qprec = None
        Fpied = np.tile(np.eye(3), (nT, 1, 1))
        u = 0.0
        nplan = None
        for i in range(nT):
            if not A['pas']:
                cible = p['neutre'].copy()
            else:
                x = t[i] / T + p['phase']
                k, phi = int(np.floor(x)), x % 1.0
                b_ = p['beta']
                if phi < b_:
                    cible = appui(p, k)
                else:
                    u = (phi - b_) / (1 - b_)
                    X0, X1 = appui(p, k), appui(p, k + 1)
                    cible = X0 + (X1 - X0) * (1 - np.cos(np.pi * u)) / 2
                    cible[1] += h * np.sin(np.pi * u) ** 2
            theta = 0.0
            if A['pas'] and p['pivot_off'] is not None:
                if phi < b_:
                    s_ = np.clip((phi / b_ - 0.55) / 0.45, 0, 1)
                else:
                    s_ = 1 - np.clip(u / 0.45, 0, 1)
                theta = A['talon'] * s_ * s_ * (3 - 2 * s_)
            F = Rcap[i] @ Rotation.from_euler('x', theta).as_matrix()
            Fpied[i] = F
            if p['pivot_off'] is not None and theta > 0:
                orteil_w = cible + Rcap[i] @ p['pivot_off']   # orteil (ou bout de patte) au sol (PAS « pivot » : centre du corps)
                cible = orteil_w - F @ p['pivot_off']
            Q = np.array([monde(i, P0[k_]) for k_ in ch])
            if Qprec is not None:                            # continuite : meme sens de pliure
                Q = Qprec + (Q[0] - Qprec[0])
            cib = cible - F @ p['pied_off']                    # cible de la cheville
            # portee bornee a 97 % : au-dela, le pied glisse un peu plutot que la patte se bloque
            # droite et se retourne (pedipalpes de l'araignee a la course : 160 deg d'un coup)
            Lik = float(np.linalg.norm(np.diff(P0[ch], axis=0), axis=1).sum())
            dd = cib - Q[0]
            if np.linalg.norm(dd) > 0.97 * Lik:
                cib = Q[0] + dd / np.linalg.norm(dd) * 0.97 * Lik
            axe = cib - Q[0]
            nrm = np.cross(axe, Rb[i] @ p['pole'])
            if np.linalg.norm(nrm) > 1e-6 * (np.linalg.norm(axe) + 1e-12):
                nplan = nrm / np.linalg.norm(nrm)
            Q = ik_forme.resoudre(p['forme'], Q[0], cib, Rb[i] @ p['pole'])
            Qprec = Q
            for a in range(len(ch) - 1):
                repos = Rb[i] @ (P0[ch[a + 1]] - P0[ch[a]])
                D[i, ch[a]] = aligner(repos, Q[a + 1] - Q[a]) @ Rb[i]
        for k_ in ch[:-1]:
            fixes[k_] = D[:, k_].copy()
        fixes[ch[-1]] = Fpied                                # pied rigide (cap + deroule), orteils solidaires
        fixes[p['bout']] = Fpied
    # --- queue : ondulation qui se propage vers le bout ; tete : stabilisee, hoche, regarde autour a l'arret
    balance = {}
    amp_q = {'run': 0.16, 'idle': 0.08}.get(allure, 0.10)
    for cq in queues:
        for a, j in enumerate(cq[:-1]):
            ang = amp_q * (a + 1) / len(cq) * np.sin(2 * np.pi * t / T * (1 if A['pas'] else 2) - 0.7 * a)
            balance[j] = Ry(ang)
    for q_, cp in enumerate(palpes):
        cc = cp['chaine']
        vit = 1 if A['pas'] else 0.5
        balance[cc[0]] = Rotation.from_euler('x', (-0.07 * (0.5 + 0.5 * np.sin(2 * np.pi * vit * t / T + 1.7 * q_)))[:, None]).as_matrix()  # leve seulement
        if len(cc) > 2:
            balance[cc[1]] = Rotation.from_euler('x', (-0.05 * np.sin(2 * np.pi * vit * t / T + 1.7 * q_ + 0.8))[:, None]).as_matrix()
    if bipede:
        E_ = enfants_de(par)
        x_mid = float(np.median(P0[:, 0]))
        ext_ = float(np.ptp(P0, axis=0).max())
        pris = {j for q in pattes for j in sous_arbre(E_, q['chaine'][0])} | {j for ct in tetes for j in ct}
        bras = []
        for f in range(len(par)):
            if E_[f] or f in pris or abs(P0[f, 0] - x_mid) < 0.1 * ext_:
                continue
            ch_, k_ = [f], f
            while par[k_] >= 0 and len(E_[par[k_]]) == 1:
                k_ = par[k_]
                ch_.append(k_)
            ch_ = ch_[::-1]
            if len(ch_) < 3 or par[ch_[0]] < 0:
                continue
            # epaule = premier os qui descend (apres la clavicule) ; coude = le suivant
            ep = next((a_ for a_ in range(len(ch_) - 1)
                       if (P0[ch_[a_ + 1], 1] - P0[ch_[a_], 1]) < -0.5 * np.linalg.norm(P0[ch_[a_ + 1]] - P0[ch_[a_]])), 0)
            bras.append(dict(chaine=ch_, epaule=ch_[ep], coude=ch_[min(ep + 1, len(ch_) - 2)],
                             cote=1 if P0[f, 0] > x_mid else -1, moyeu=int(par[ch_[0]])))
        # colonne : de la racine au moyeu des bras (poitrine), qui contre-tourne le bassin
        colonne = []
        if bras:
            k_ = bras[0]['moyeu']
            while k_ >= 0 and k_ != racine:
                colonne.append(k_)
                k_ = par[k_]
            colonne = colonne[::-1]
        infos_bras = (len(bras), len(colonne))
        n_c = max(len(colonne), 1)
        for j in colonne:
            balance[j] = np.einsum('tab,tbc->tac', Ry(-1.6 * lacet_bassin / n_c),
                                   Rotation.from_euler('z', (-roulis / n_c)[:, None]).as_matrix())
        amp_b, flex = {'run': (0.5, 1.1), 'idle': (0.03, 0.12)}.get(allure, (0.3, 0.15))
        for b in bras:
            d_ = P0[b['coude']] - P0[b['epaule']]
            axe = np.cross(d_ / (np.linalg.norm(d_) + 1e-12), [0.0, 0.0, 1.0])
            if np.linalg.norm(axe) < 1e-6:
                continue
            axe /= np.linalg.norm(axe)
            if A['pas']:
                avant = -b['cote'] * amp_b * s_g               # bras gauche devant quand la jambe gauche est derriere
            else:
                avant = amp_b * np.sin(2 * np.pi * t / T + (0 if b['cote'] == 1 else 1.3))
            balance[b['epaule']] = Rotation.from_rotvec(axe[None] * avant[:, None]).as_matrix()
            coude = flex + (0.15 if allure != 'run' else 0.2) * np.clip(avant / max(amp_b, 1e-6), 0, 1)
            balance[b['coude']] = Rotation.from_rotvec(axe[None] * coude[:, None]).as_matrix()
    for ct in tetes:
        for a, j in enumerate(ct[:-1]):
            hoche = (0.03 if A['pas'] else 0.04) * np.sin(2 * np.pi * t / T * 2 + 0.5 + 0.3 * a)
            m = Rotation.from_euler('x', (hoche - (tangage if a == 0 else 0))[:, None]).as_matrix()
            if not A['pas'] and a == 0:
                m = np.einsum('tab,tbc->tac', Ry(0.22 * np.sin(2 * np.pi * t / T)), m)
            if bipede and a == 0:
                m = np.einsum('tab,tbc->tac', Ry(0.6 * lacet_bassin), m)
            balance[j] = m
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
    # --- controles : positions monde reconstruites (FK), os sous le sol, glissement des pieds en appui
    Pw = np.zeros((nT, J, 3))
    for j in ordre:
        Pw[:, j] = racine_monde if j == racine else Pw[:, par[j]] + np.einsum('tab,b->ta', D[:, par[j]], P0[j] - P0[par[j]])
    H = np.ptp(P0[:, 1])
    pire = np.unravel_index(np.argmin(Pw[..., 1]), Pw.shape[:2])
    gl = []
    for p in pattes:
        if not A['pas']:
            continue
        ph = (t / T + p['phase']) % 1.0
        au_sol = ph[1:] < p['beta']
        au_sol &= ph[:-1] < ph[1:]
        dep = np.linalg.norm(np.diff(Pw[:, p['bout']], axis=0), axis=1)[au_sol]
        gl.append(float(dep.mean()) if len(dep) else 0.0)
    ext_max = 0.0
    acc = []
    for p in pattes:
        ch = p['chaine']
        Lc = float(np.linalg.norm(np.diff(P0[ch], axis=0), axis=1).sum())
        ext_max = max(ext_max, float((np.linalg.norm(Pw[:, p['bout']] - Pw[:, ch[0]], axis=1) / Lc).max()))
        for j in ch[:-1]:
            rel = np.einsum('tba,tbc->tac', D[:-1, j], D[1:, j])
            om = Rotation.from_matrix(rel).as_rotvec()
            acc.append(np.linalg.norm(np.diff(om, axis=0), axis=1))
    global _ACC
    _ACC = acc
    acc = np.concatenate(acc) if acc else np.zeros(1)
    infos = dict(extension_max_pct=round(100 * ext_max, 1), acoups_max_deg=round(float(np.degrees(acc.max())), 2),
                 acoups_p99_deg=round(float(np.degrees(np.percentile(acc, 99))), 2),
                 abaisse_pct=round(100 * float(locals().get('abaisse', 0.0)) / H, 1),
                 pattes=len(pattes), queues=len(queues), tetes=len(tetes), periode=T, foulee=round(float(S), 3),
                 appui=beta, phases=[round(p['phase'], 2) for p in pattes],
                 os_par_patte=[len(p['chaine']) for p in pattes],
                 sous_sol_pct=round(float(100 * (sol - Pw[..., 1].min()) / H), 1), pire_os=int(pire[1]), pire_image=int(pire[0]),
                 glissement_appui_pct=round(100 * max(gl) / H, 2) if gl else 0.0)
    ctx = (js, bn, joints, W, parent_noeud, fps)
    if brut:
        return (allure, R, racine_monde), infos, ctx
    return ecrire(js, bn, joints, [(allure, R, racine_monde)], W, parent_noeud, fps), infos


# ---------------------------------------------------------------- ecriture glTF
def ecrire(js, bn, joints, clips, W, parent_noeud, fps):
    """clips : [(nom, R (T,J,3,3), racine_monde (T,3))] -> un GLB avec une animation par clip."""
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
    js['animations'] = []
    for nom, R, racine_monde in clips:
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
        js['animations'].append({'name': nom, 'samplers': samplers, 'channels': canaux})
    while len(blob) % 4:
        blob.append(0)
    js['buffers'][0]['byteLength'] = len(blob)
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    return (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob))
            + struct.pack('<II', len(jb), 0x4E4F534A) + jb
            + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


if __name__ == '__main__':
    # python locomotion.py <rig.glb> <sortie.glb> [allure|toutes] [cycles]
    rig, sortie = sys.argv[1], sys.argv[2]
    allure = sys.argv[3] if len(sys.argv) > 3 else 'walk'
    cycles = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    liste = list(ALLURES) if allure == 'toutes' else [allure]
    clips, ctx = [], None
    for a in liste:
        clip, infos, ctx = animer(rig, a, 1 if a == 'idle' else cycles, brut=True)
        clips.append(clip)
        print(a, {k: infos[k] for k in ('pattes', 'periode', 'foulee', 'sous_sol_pct', 'glissement_appui_pct')})
    js, bn, joints, W, parent_noeud, fps = ctx
    open(sortie, 'wb').write(ecrire(js, bn, joints, clips, W, parent_noeud, fps))
    print('GLB', os.path.basename(sortie), len(clips), 'animations')
