"""Validation APPROFONDIE d'un GLB rigge ou anime (campagne 2026-10-02, suite). Une ligne JSON sur la sortie standard.
Usage : python valider_rig2.py <fichier.glb> [--rapide] [--anim]
  - squelette : os, racines, longueur des os, os hors du maillage, couverture (le squelette atteint-il toutes les extremites ?), symetrie (paires par position miroir)
  - poids : somme a 1, sommets sans poids, influences max, os orphelins, poids « lointains » (un os qui tire des sommets loin de lui), symetrie des masses
  - peau en pose : chaque articulation importante pliee de +/- 40 degres, etirement / ecrasement des aretes (candy-wrapper, lanieres)
  - animations : duree, images, raccord debut/fin, deplacement de la racine, glissement des pieds en appui, valeurs non finies
Aucune ecriture de fichier."""
import json, os, re, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig_lib import Rig, quat_mat, triangle_stretch
from scipy.spatial import cKDTree

chemin = sys.argv[1]
RAPIDE = '--rapide' in sys.argv
r = {'fichier': os.path.basename(chemin), 'taille_mo': round(os.path.getsize(chemin) / 1048576, 1)}


def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])


def axangle(ax, ang):
    ax = ax / (np.linalg.norm(ax) or 1.0); s = math.sin(ang / 2)
    return np.array([ax[0] * s, ax[1] * s, ax[2] * s, math.cos(ang / 2)])


def angle_quat(a, b):
    d = abs(float(np.dot(a / np.linalg.norm(a), b / np.linalg.norm(b)))); return math.degrees(2 * math.acos(min(1.0, d)))


try:
    g = Rig(chemin)
    prims = g.prims()
    r['peaux'] = len(g.skins); r['maillages'] = len(prims)
    sk_prims = [p for p in prims if p['J'] is not None and p['skin'] is not None]
    r['sommets'] = int(sum(len(p['P']) for p in prims)); r['faces'] = int(sum(len(p['F']) for p in prims))
    W0 = g.world()
    allP = np.vstack([p['P'] for p in prims]) if prims else np.zeros((1, 3))
    H = float(allP[:, 1].max() - allP[:, 1].min()) or float(np.linalg.norm(allP.max(0) - allP.min(0)))   # hauteur (Y vers le haut)
    r['hauteur'] = round(H, 3); r['boite'] = [round(float(x), 3) for x in (allP.max(0) - allP.min(0))]
    # ------------------------------------------------------------ squelette
    if g.skins:
        skin = g.skins[0]; joints = skin['joints']; nj = len(joints); jset = {n: i for i, n in enumerate(joints)}
        r['joints'] = nj
        r['noms_joints'] = [g.names[n] for n in joints][:200]
        jpos = np.array([W0[n][:3, 3] for n in joints])
        # racines (joints dont le parent n'est pas un joint)
        racines = [i for i, n in enumerate(joints) if g.parent[n] not in jset]
        r['racines'] = len(racines)
        parentj = [jset.get(g.parent[n], -1) for n in joints]
        enfants = [[] for _ in range(nj)]
        for i, p in enumerate(parentj):
            if p >= 0: enfants[p].append(i)
        prof = [0] * nj
        for i in range(nj):
            d = 0; p = parentj[i]
            while p >= 0 and d < 500: d += 1; p = parentj[p]
            prof[i] = d
        r['profondeur_max'] = int(max(prof)); r['feuilles'] = int(sum(1 for e in enfants if not e))
        L = np.array([np.linalg.norm(jpos[i] - jpos[parentj[i]]) if parentj[i] >= 0 else 0.0 for i in range(nj)])
        Ln = L[[i for i in range(nj) if parentj[i] >= 0]]
        if len(Ln): r['os_longueur'] = {'min_rel': round(float(Ln.min() / H), 5), 'med_rel': round(float(np.median(Ln) / H), 4), 'max_rel': round(float(Ln.max() / H), 4), 'nuls': int((Ln < 1e-6 * H).sum())}
        # couverture : points du squelette (os = segments echantillonnes)
        pts = [jpos]
        for i in range(nj):
            if parentj[i] >= 0:
                a, b = jpos[parentj[i]], jpos[i]
                pts.append(np.array([a + (b - a) * t for t in (0.25, 0.5, 0.75)]))
        sq = np.vstack(pts); tree_sq = cKDTree(sq)
        rng = np.random.default_rng(1)
        idx = rng.choice(len(allP), size=min(60000, len(allP)), replace=False)
        d_cov, _ = tree_sq.query(allP[idx])
        r['couverture'] = {'p50': round(float(np.percentile(d_cov, 50) / H), 4), 'p95': round(float(np.percentile(d_cov, 95) / H), 4), 'p99': round(float(np.percentile(d_cov, 99) / H), 4), 'max': round(float(d_cov.max() / H), 4)}
        # extremites : les 1 % de sommets les plus eloignes du squelette -> ou sont-ils ?
        ext = idx[np.argsort(-d_cov)[:max(20, len(idx) // 100)]]
        r['extremites_non_couvertes_pct'] = round(float(100 * (d_cov > 0.12 * H).mean()), 2)
        r['extension_squelette_vs_maillage'] = [round(float((jpos.max(0)[a] - jpos.min(0)[a]) / max(allP.max(0)[a] - allP.min(0)[a], 1e-9)), 3) for a in range(3)]
        # os hors du maillage
        tree_m = cKDTree(allP[rng.choice(len(allP), size=min(200000, len(allP)), replace=False)])
        d_in, _ = tree_m.query(jpos)
        r['os_hors_maillage'] = int((d_in > 0.04 * H).sum())
        # symetrie du squelette (paires par position miroir sur l'axe X, centre = milieu de la boite du maillage)
        cx = float((allP[:, 0].max() + allP[:, 0].min()) / 2)
        mir = jpos.copy(); mir[:, 0] = 2 * cx - mir[:, 0]
        tj = cKDTree(jpos); dm, im = tj.query(mir)
        lateral = np.abs(jpos[:, 0] - cx) > 0.01 * H
        paires = [(i, int(im[i])) for i in range(nj) if lateral[i] and dm[i] < 0.03 * H and im[i] != i]
        r['symetrie_squelette'] = {'os_lateraux': int(lateral.sum()), 'avec_partenaire': len(paires), 'ecart_moyen_rel': round(float(np.mean([dm[i] for i, _ in paires]) / H), 4) if paires else None}
        # ------------------------------------------------------------ poids
        if sk_prims:
            Jall = np.vstack([p['J'] for p in sk_prims]); Wall = np.vstack([p['W'] for p in sk_prims]); Pall = np.vstack([p['P'] for p in sk_prims])
            N = len(Pall)
            somme = Wall.sum(1)
            r['poids'] = {'sommets': int(N), 'influences_max': int(Jall.shape[1]), 'somme_min': round(float(somme.min()), 4), 'somme_max': round(float(somme.max()), 4), 'somme_hors_1_pct': round(float(100 * (np.abs(somme - 1) > 0.02).mean()), 3), 'sans_poids_pct': round(float(100 * (somme < 1e-4).mean()), 3), 'non_fini': int((~np.isfinite(Wall)).sum())}
            nb_inf = (Wall > 1e-4).sum(1)
            r['poids']['influences_moy'] = round(float(nb_inf.mean()), 2); r['poids']['influences_gt4_pct'] = round(float(100 * (nb_inf > 4).mean()), 3)
            Wd = np.zeros((N, nj), dtype=np.float32)
            rows = np.arange(N)
            for k in range(Jall.shape[1]):
                np.add.at(Wd, (rows, np.clip(Jall[:, k], 0, nj - 1)), Wall[:, k].astype(np.float32))
            masse = Wd.sum(0)
            r['poids']['os_orphelins'] = int((masse < 1e-3).sum()); r['poids']['os_mineurs'] = int((masse < 0.0005 * N).sum())
            r['poids']['os_orphelins_noms'] = [g.names[joints[i]] for i in range(nj) if masse[i] < 1e-3][:12]
            # poids lointains : sous-arbre de chaque joint
            sous = np.zeros((nj, nj), dtype=np.float32)
            for i in range(nj):
                pile = [i]
                while pile:
                    c = pile.pop(); sous[c, i] = 1.0; pile.extend(enfants[c])
            masse_sous = Wd @ sous          # (N, nj) : poids de chaque sommet dans le sous-arbre de chaque joint
            pires = []
            for i in range(nj):
                if parentj[i] < 0: continue
                m = masse_sous[:, i] > 0.3
                if m.sum() < 5: continue
                sub = [c for c in range(nj) if sous[c, i] > 0]
                sp = [jpos[c] for c in sub] + [(jpos[c] + jpos[parentj[c]]) / 2 for c in sub if parentj[c] >= 0 and c != i]
                dd, _ = cKDTree(np.array(sp)).query(Pall[m])
                loin = float((dd > 0.25 * H).sum())
                if loin > 0: pires.append((loin / N * 100, g.names[joints[i]], int(loin), round(float(dd.max() / H), 3)))
            pires.sort(reverse=True)
            r['poids']['poids_lointains_pct_total'] = round(float(sum(p[0] for p in pires)), 3)
            r['poids']['poids_lointains_pires'] = [{'os': p[1], 'sommets': p[2], 'dist_max_rel': p[3]} for p in pires[:5]]
            # symetrie des masses de poids sur les paires
            if paires:
                rap = []
                for i, j in paires:
                    if i < j and masse[i] > 0 and masse[j] > 0: rap.append((min(masse[i], masse[j]) / max(masse[i], masse[j]), g.names[joints[i]], g.names[joints[j]]))
                if rap:
                    rap.sort()
                    r['symetrie_poids'] = {'paires': len(rap), 'rapport_moyen': round(float(np.mean([x[0] for x in rap])), 3), 'pires': [{'a': x[1], 'b': x[2], 'rapport': round(float(x[0]), 3)} for x in rap[:4]]}
            # ------------------------------------------------------------ peau en pose : flexions de +/- 40 deg
            if not RAPIDE:
                top = [i for i in np.argsort(-masse) if enfants[i] and parentj[i] >= 0][:20]
                res = []
                for i in top:
                    n = joints[i]
                    # axe de flexion : perpendiculaire a l'os (vers le premier enfant)
                    d = jpos[enfants[i][0]] - jpos[i]; d = d / (np.linalg.norm(d) or 1.0)
                    a0 = np.cross(d, [0, 0, 1.0])
                    if np.linalg.norm(a0) < 0.3: a0 = np.cross(d, [1.0, 0, 0])
                    Rj = W0[n][:3, :3]; Rn = Rj / (np.linalg.norm(Rj, axis=0)[None, :] + 1e-12)
                    al = Rn.T @ (a0 / np.linalg.norm(a0))
                    for sg in (+1, -1):
                        t_, q_, s_ = g.local_trs(n)
                        qn = qmul(q_, axangle(al, sg * math.radians(40)))
                        Wp = g.world({n: (t_, qn, s_)})
                        st = []; pos_all = []
                        for p in sk_prims:
                            Pp = g.skinned(p, Wp)
                            st.append(triangle_stretch(p['P'], Pp, p['F']))
                        st = np.concatenate(st)
                        res.append({'os': g.names[n], 'sg': sg, 'etire_pct': float(100 * (st > 1.5).mean()), 'ecrase_pct': float(100 * (st < 0.67).mean()), 'max': float(st.max()), 'p999': float(np.percentile(st, 99.9))})
                if res:
                    r['flexion'] = {'tests': len(res), 'etire_pct_moy': round(float(np.mean([x['etire_pct'] for x in res])), 3), 'ecrase_pct_moy': round(float(np.mean([x['ecrase_pct'] for x in res])), 3), 'max_ratio': round(float(max(x['max'] for x in res)), 2),
                                    'pires': [{'os': x['os'], 'sg': x['sg'], 'etire_pct': round(x['etire_pct'], 3), 'ecrase_pct': round(x['ecrase_pct'], 3), 'max': round(x['max'], 2)} for x in sorted(res, key=lambda y: -(y['etire_pct'] + y['ecrase_pct']))[:5]]}
    # ------------------------------------------------------------ animations
    if g.anims and ('--anim' in sys.argv or True):
        out = []
        pose_skin = g.skins[0] if g.skins else None
        for k in range(len(g.anims)):
            a = g.anims[k]
            try:
                dur, nkeys = g.anim_info(k)
                info = {'nom': a.get('name'), 'duree_s': round(dur, 3), 'images_max': int(nkeys), 'fps': round((nkeys - 1) / dur, 1) if dur > 0 and nkeys > 1 else None, 'canaux': len(a.get('channels', []))}
                # valeurs non finies
                nf = 0
                for s in a.get('samplers', []): nf += int((~np.isfinite(g.acc(s['output']))).sum())
                info['non_fini'] = nf
                tg = {}
                for ch in a.get('channels', []): tg.setdefault(ch['target'].get('path'), set()).add(ch['target'].get('node'))
                info['noeuds_anime'] = {p: len(v) for p, v in tg.items()}
                if pose_skin is not None and dur > 0:
                    joints = pose_skin['joints']; jset = {n: i for i, n in enumerate(joints)}
                    info['noeuds_hors_squelette'] = int(len(set().union(*tg.values()) - set(joints))) if tg else 0
                    # raccord debut / fin : rotation par os
                    angs = []
                    for ch in a['channels']:
                        if ch['target'].get('path') != 'rotation': continue
                        s = a['samplers'][ch['sampler']]; vs = g.acc(s['output'])
                        if s.get('interpolation') == 'CUBICSPLINE': vs = vs[1::3]
                        if len(vs) > 1: angs.append(angle_quat(np.array(vs[0], dtype=np.float64), np.array(vs[-1], dtype=np.float64)))
                    if angs: info['raccord_rot_deg'] = {'max': round(float(max(angs)), 1), 'moy': round(float(np.mean(angs)), 2), 'os_gt10deg': int(sum(1 for x in angs if x > 10))}
                    # positions monde par image (30 images / s)
                    nf_ = max(2, int(round(dur * 30)) + 1); ts = np.linspace(0, dur, nf_)
                    JP = np.zeros((nf_, len(joints), 3))
                    for fi, t in enumerate(ts):
                        Wf = g.world(g.anim_pose(k, t)); JP[fi] = Wf[joints][:, :3, 3]
                    # hauteur de reference : le maillage de repos
                    Hh = H
                    # racine : joint sans parent joint, ou celui qui bouge le moins parmi les hauts
                    roots = [i for i, n in enumerate(joints) if g.parent[n] not in jset]
                    rt = roots[0] if roots else 0
                    # le bassin : on suit la racine
                    trace = JP[:, rt, :]
                    deplac = trace[-1] - trace[0]
                    info['racine'] = {'os': g.names[joints[rt]], 'deplacement_rel_hauteur': [round(float(x / Hh), 3) for x in deplac], 'course_rel': round(float(np.linalg.norm(np.diff(trace[:, [0, 2]], axis=0), axis=1).sum() / Hh), 3), 'vitesse_h_par_s': round(float(np.linalg.norm(deplac[[0, 2]]) / Hh / dur), 3)}
                    # raccord en position (sans la racine)
                    rel0 = JP[0] - JP[0, rt]; rel1 = JP[-1] - JP[-1, rt]
                    info['raccord_pos_rel_max'] = round(float(np.linalg.norm(rel1 - rel0, axis=1).max() / Hh), 4)
                    # pieds : joints les plus bas au repos (ou noms)
                    noms = [g.names[n] for n in joints]
                    pied_idx = [i for i, nm in enumerate(noms) if re.search(r'foot|ankle|toe|heel|paw|hoof|ball', nm, re.I)]
                    if not pied_idx:
                        ordre = np.argsort(JP[0][:, 1]); pied_idx = [int(i) for i in ordre[:4]]
                    plancher = JP[:, pied_idx, 1].min()
                    seuil = plancher + 0.04 * Hh
                    vit = []
                    for i in pied_idx:
                        y = JP[:, i, 1]; hv = np.linalg.norm(np.diff(JP[:, i][:, [0, 2]], axis=0), axis=1) * 30 / Hh   # H/s
                        appui = (y[:-1] < seuil) & (y[1:] < seuil)
                        if appui.sum() >= 2: vit.append(float(np.mean(hv[appui])))
                    # mesure robuste (2026-10-02) : 30e centile de la vitesse horizontale de chaque pied sur le cycle (un pied pose a une vitesse ~0 pendant ~40 % du cycle)
                    v30 = []
                    for i in pied_idx:
                        hv_ = np.linalg.norm(np.diff(JP[:, i][:, [0, 2]], axis=0), axis=1) * 30 / Hh
                        if len(hv_): v30.append(float(np.percentile(hv_, 30)))
                    if v30:
                        vr_ = info['racine']['vitesse_h_par_s']
                        info['pieds_p30'] = {'moy_h_par_s': round(float(np.mean(v30)), 3), 'max_h_par_s': round(float(np.max(v30)), 3), 'vitesse_racine_h_par_s': vr_, 'rapport_sur_racine': round(float(np.mean(v30) / vr_), 2) if vr_ > 0.05 else None,
                                         'glissement': bool(vr_ > 0.05 and np.mean(v30) / vr_ > 0.25)}
                    if vit:
                        vr = info['racine']['vitesse_h_par_s']
                        info['pieds'] = {'os_pieds': len(pied_idx), 'en_appui': len(vit), 'vitesse_appui_moy_h_par_s': round(float(np.mean(vit)), 3), 'vitesse_appui_max_h_par_s': round(float(np.max(vit)), 3), 'vitesse_racine_h_par_s': vr,
                                         'glissement': bool(vr > 0.05 and np.mean(vit) > 0.15 * vr + 0.03)}
                    # peau pendant l'animation : 6 instants, etirement
                    if sk_prims and not RAPIDE:
                        stt = []
                        for t in np.linspace(0, dur, 8)[:7]:
                            Wp = g.world(g.anim_pose(k, t))
                            s_ = np.concatenate([triangle_stretch(p['P'], g.skinned(p, Wp), p['F']) for p in sk_prims])
                            stt.append((float(100 * (s_ > 1.5).mean()), float(100 * (s_ < 0.67).mean()), float(s_.max())))
                        info['peau_en_anim'] = {'etire_pct_moy': round(float(np.mean([x[0] for x in stt])), 3), 'ecrase_pct_moy': round(float(np.mean([x[1] for x in stt])), 3), 'max_ratio': round(float(max(x[2] for x in stt)), 2)}
                out.append(info)
            except Exception as e:  # noqa
                out.append({'nom': a.get('name'), 'erreur': repr(e)[:200]})
        r['animations'] = out
except Exception as e:  # noqa
    import traceback
    r['erreur'] = repr(e)[:300]; r['trace'] = traceback.format_exc()[-400:]
print(json.dumps(r, ensure_ascii=False))
