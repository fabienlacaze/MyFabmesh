"""Pour chaque patte : longueur, pliure au repos (ecart max des articulations a la droite hanche-pied, % longueur),
et, sur un clip, extension max (distance hanche-pied / longueur) et a-coups (acceleration angulaire des os)."""
import sys
import numpy as np
sys.path.insert(0, r'C:\tmp\procedural_test')
import locomotion as L

rig = sys.argv[1]
js, bn, joints, par, P0, W, pn = L.charger(rig)
racine, pattes, queues, tetes, sol = L.detecter_pattes(par, P0)
for p in pattes:
    ch = p['chaine']
    Q = P0[ch]
    Lc = np.linalg.norm(np.diff(Q, axis=0), axis=1).sum()
    a, b = Q[0], Q[-1]
    u = (b - a) / np.linalg.norm(b - a)
    ecart = max(np.linalg.norm((q - a) - np.dot(q - a, u) * u) for q in Q[1:-1]) if len(Q) > 2 else 0
    print('patte cote %+d rang %d : %d os, longueur %.3f, hanche->pied %.0f %% de la longueur, pliure au repos %.1f %%'
          % (p['cote'], p.get('rang', -1), len(ch) - 1, Lc, 100 * np.linalg.norm(b - a) / Lc, 100 * ecart / Lc))
