"""Usage : python patch_v4.py <locomotion.py> [mesures]   (« mesures » : controles seuls, sans correctifs)"""
import io
import sys

p = sys.argv[1]
SEULES = len(sys.argv) > 2
s = io.open(p, encoding='utf-8').read()


def rep(a, b, correctif=True):
    global s
    assert s.count(a) == 1, a
    if correctif and SEULES:
        return
    s = s.replace(a, b)


# 1. bassin abaisse (genoux plies) + foulee limitee a la portee de chaque patte
rep("""    S = A['foulee'] * (0.6 * portee + 0.8 * hanche)         # foulee par cycle
    h = A['h'] * (0.5 * portee + 0.5 * hanche)               # hauteur du pas
""", """    S = A['foulee'] * (0.6 * portee + 0.8 * hanche)         # foulee par cycle
    h = A['h'] * (0.5 * portee + 0.5 * hanche)               # hauteur du pas
    # Patte trop tendue en fin de poussee = pied hors de portee : la patte se bloque
    # droite puis « claque » (a-coups vus sur le lion et l'humain le 28/09 ; jambes de
    # l'humain a 99 % de leur longueur au repos, pied demande a 110 % en fin d'appui).
    # (a) bassin abaisse pour que chaque patte, pied au neutre, soit a <= 92 % de sa longueur ;
    # (b) demi-pas en appui limite pour rester a <= 97 % de la longueur aux extremites.
    TENDU_NEUTRE, TENDU_MAX = 0.92, 0.97
    geo = []
    for p in pattes:
        ch = p['chaine']
        Lc = float(np.linalg.norm(np.diff(P0[ch], axis=0), axis=1).sum())
        d = P0[p['bout']] - P0[ch[0]]
        geo.append((Lc, abs(d[0]), -d[1], abs(d[2])))
    abaisse = 0.0
    for Lc, dx, dy, dz in geo:
        r2 = (TENDU_NEUTRE * Lc) ** 2 - dx ** 2 - dz ** 2
        if r2 > 0:
            abaisse = max(abaisse, dy - np.sqrt(r2))
    marge_bob = A['bob'] * hanche * (2 if allure == 'run' else 0)
    if A['pas']:
        demi = min(np.sqrt(max((TENDU_MAX * Lc) ** 2 - dx ** 2 - (dy - abaisse + marge_bob) ** 2, 0)) - dz
                   for Lc, dx, dy, dz in geo)
        demi = max(demi, 0.05 * portee)
        S = min(S, 2 * demi / beta)
""")

# 2. bassin abaisse applique au corps
rep("    decal = c + np.stack([0 * t, bob, 0 * t], -1) + ",
    "    decal = c + np.stack([0 * t, bob - abaisse, 0 * t], -1) + ")

# 3. decollage et pose en douceur (vitesse verticale nulle aux deux bouts)
rep("                    cible[1] += h * np.sin(np.pi * u)",
    "                    cible[1] += h * np.sin(np.pi * u) ** 2")

# 4. cinematique inverse continue : part de la solution de l'image precedente
rep("""        for i in range(nT):
            if not A['pas']:""", """        Qprec = None
        for i in range(nT):
            if not A['pas']:""")
rep("""            Q = np.array([monde(i, P0[k_]) for k_ in ch])
            Q = fabrik(Q, cible)""", """            Q = np.array([monde(i, P0[k_]) for k_ in ch])
            if Qprec is not None:                            # continuite : meme sens de pliure
                Q = Qprec + (Q[0] - Qprec[0])
            Q = fabrik(Q, cible)
            Qprec = Q""")

# 5. controles : extension max des pattes et a-coups (acceleration angulaire des os de patte)
rep("""    infos = dict(pattes=len(pattes),""", """    ext_max = 0.0
    acc = []
    for p in pattes:
        ch = p['chaine']
        Lc = float(np.linalg.norm(np.diff(P0[ch], axis=0), axis=1).sum())
        ext_max = max(ext_max, float((np.linalg.norm(Pw[:, p['bout']] - Pw[:, ch[0]], axis=1) / Lc).max()))
        for j in ch[:-1]:
            rel = np.einsum('tba,tbc->tac', D[:-1, j], D[1:, j])
            om = Rotation.from_matrix(rel).as_rotvec()
            acc.append(np.linalg.norm(np.diff(om, axis=0), axis=1))
    acc = np.concatenate(acc) if acc else np.zeros(1)
    infos = dict(extension_max_pct=round(100 * ext_max, 1), acoups_max_deg=round(float(np.degrees(acc.max())), 2),
                 acoups_p99_deg=round(float(np.degrees(np.percentile(acc, 99))), 2),
                 abaisse_pct=round(100 * float(locals().get('abaisse', 0.0)) / H, 1),
                 pattes=len(pattes),""", correctif=False)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
