import sys
import numpy as np
sys.path.insert(0, r'C:\tmp\procedural_test')
import locomotion as L
np.set_printoptions(precision=2, suppress=True)
js, bn, joints, par, P0, W, pn = L.charger(sys.argv[1])
E = L.enfants_de(par)
r = int(np.flatnonzero(par < 0)[0]); sol, H = P0[:, 1].min(), np.ptp(P0[:, 1]); ext = np.ptp(P0, 0).max()
print('J', len(joints), 'racine', r, P0[r], '| etendue', np.ptp(P0, 0), '| sol', round(sol, 3))
for j in range(len(par)):
    if not E[j]:
        prof, k = 0, j
        while par[k] >= 0:
            k = par[k]; prof += 1
        print('  feuille', j, 'prof', prof, 'haut/H %.2f' % ((P0[j, 1] - sol) / H), 'x %.2f' % ((P0[j, 0] - P0[r, 0]) / ext), 'z %.2f' % ((P0[j, 2] - P0[r, 2]) / ext))
