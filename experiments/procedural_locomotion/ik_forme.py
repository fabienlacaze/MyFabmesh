"""Cinematique inverse « a forme gardee » (remplace FABRIK dans locomotion.py, 28/09).

FABRIK ne contraint rien : la pliure derive d'une image a l'autre (genou qui plie de cote,
pattes de l'araignee retournees de 138 deg, chaine droite qui ne sait pas de quel cote plier).

Ici la patte garde la FORME de sa pose de repos, exprimee dans son plan de pliure :
  - chaque os a un angle phi_k dans ce plan (zigzag du repos : coude en arriere, poignet en avant...) ;
  - pour rapprocher ou eloigner le pied, on multiplie TOUS ces angles par un meme facteur k
    (k > 1 : plus plie, k < 1 : plus tendu), trouve par dichotomie ;
  - puis on oriente la patte entiere : axe hanche -> pied sur la cible, plan de pliure sur le pole.
Calcul refait depuis le repos a chaque image : aucune derive, aucun retournement possible.
"""
import numpy as np


def preparer(P0_chaine, pole_repos):
    """P0_chaine : positions de repos (n, 3) de la hanche a la cheville ; pole_repos : sens de pliure."""
    a, b = P0_chaine[0], P0_chaine[-1]
    e1 = (b - a) / (np.linalg.norm(b - a) + 1e-12)
    e2 = pole_repos - np.dot(pole_repos, e1) * e1
    if np.linalg.norm(e2) < 1e-6:
        e2 = np.cross(e1, [1.0, 0, 0]) if abs(e1[0]) < 0.9 else np.cross(e1, [0, 1.0, 0])
    e2 /= np.linalg.norm(e2)
    e3 = np.cross(e1, e2)
    v = np.diff(P0_chaine, axis=0)
    x, y, z = v @ e1, v @ e2, v @ e3
    l = np.hypot(x, y)
    phi = np.arctan2(y, x)
    if np.abs(phi).max() < 0.05 and len(phi) >= 2:
        # patte presque droite au repos : legere pliure vers le pole (genou vers l'avant)
        phi = np.array([0.08 if k % 2 == 0 else -0.08 for k in range(len(phi))])
    return dict(l=l, phi=phi, z=z, n=len(P0_chaine))


def _chaine_locale(F, k):
    ang = k * F['phi']
    loc = np.stack([F['l'] * np.cos(ang), F['l'] * np.sin(ang), F['z']], -1)
    return np.vstack([np.zeros(3), np.cumsum(loc, axis=0)])


def resoudre(F, base, cible, pole_monde):
    """Positions monde (n, 3) de la chaine, hanche en `base`, bout vers `cible`."""
    d = float(np.linalg.norm(cible - base))
    kmax = min(0.9 * np.pi / max(float(np.abs(F['phi']).max()), 1e-3), 8.0)
    longueur = lambda k: float(np.linalg.norm(_chaine_locale(F, k)[-1]))
    # au-dela d'un certain repli, la patte se RALLONGE (elle se retourne) : la recherche
    # s'arrete au minimum de longueur (patte 32 de l'araignee : mauvaise racine sinon)
    ks = np.linspace(0.0, kmax, 65)
    ls = [longueur(k_) for k_ in ks]
    kmax = float(ks[int(np.argmin(ls))])
    lo, hi = 0.0, kmax
    if d >= longueur(0.0):
        k = 0.0
    elif d <= longueur(kmax):
        k = kmax
    else:
        # longueur decroissante avec k sur [0, kmax] (plus plie = plus court) : dichotomie
        for _ in range(40):
            m = 0.5 * (lo + hi)
            if longueur(m) > d:
                lo = m
            else:
                hi = m
        k = 0.5 * (lo + hi)
    C = _chaine_locale(F, k)
    g1 = C[-1] / (np.linalg.norm(C[-1]) + 1e-12)
    g2 = np.array([0.0, 1.0, 0.0]) - g1[1] * g1
    g2 /= np.linalg.norm(g2) + 1e-12
    g3 = np.cross(g1, g2)
    f1 = (cible - base) / (d + 1e-12)
    f2 = pole_monde - np.dot(pole_monde, f1) * f1
    if np.linalg.norm(f2) < 1e-6:
        f2 = g2
    f2 /= np.linalg.norm(f2)
    f3 = np.cross(f1, f2)
    M = np.stack([f1, f2, f3], 1) @ np.stack([g1, g2, g3], 0)
    return base + C @ M.T
