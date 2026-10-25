"""Banc GPU : fill_holes de CuMesh repete dans un meme processus, SANS puis AVEC le correctif de la PR #41 (2026-10-14).

QUESTION. La PR #41 de CuMesh (ouverte le 21/08/2026) montre que la valeur initiale de la somme des sommets de bouchage
de fill_holes est construite cote hote avec un constructeur __device__ seulement (Vec3f, src/dtypes.cuh) : chaque sommet
ajoute vaut (G + somme des milieux du bord) / n, ou G = restes de la pile hote. Publie (Windows, CUDA 13.0) : premier
appel d'un processus juste, tous les suivants faux. Ce defaut touche-t-il NOTRE construction (Linux, gcc 11, CUDA 12.4,
torch 2.4.1) ? En production, to_glb appelle fill_holes 1 fois (remaillage) ou 3 fois (sans), et un conteneur chaud
enchaine les generations dans le meme processus. Rien ne l'a encore mesure : c'est l'objet de ce banc.

PROTOCOLE (un lancement, ~0,10-0,20 $ ; ne deploie rien, ne touche pas la production) :
  1. `construire_sans_correctif` (CPU) : recompile, dans l'image mesh_image, EXACTEMENT les sources de _CUMESH_MIT
     (CuMesh 12289e1 + cubvh MIT de1badf, meme garde des sources) mais SANS le correctif, en roue. La variante AVEC
     correctif est celle que _CUMESH_MIT installe dans l'image. Le chemin de fill_holes ne passe pas par cubvh : la
     variante SANS correctif se comporte comme la production deployee avant le 14/10.
  2. `mesurer` (L40S) : pour chaque variante, un processus NEUF importe cette variante (PYTHONPATH) puis, sur une
     sphere percee de trous CONNUS (triangles et quadrilateres, perimetre < 3e-2 = seuil de to_glb) :
       - N appels directs (CuMesh neuf, init, fill_holes, read) : chaque sommet ajoute est compare a son ORACLE, le
         centroide des sommets du bord de son trou (= moyenne des milieux des aretes, ce que calcule CuMesh) ;
       - K sequences « comme to_glb » sur un meme objet (fill_holes, simplify, remove_duplicate_faces,
         repair_non_manifold_edges, remove_small_connected_components, fill_holes, puis encore une fois) : sommets
         non finis, plus grande arete et plus grande coordonnee rapportees au maillage d'origine.
  3. Verdict (fonction `verdict`) : banc VALIDE si, AVEC correctif, tous les trous attendus sont bouches a moins de
     1e-5 de l'oracle a chaque appel ; defaut CONFIRME sur notre construction si, SANS correctif, un appel s'ecarte de
     plus de 1e-3, produit un sommet non fini, ou une sequence une arete > 50 fois l'arete mediane d'origine.

Lancer depuis la racine du depot (comme `modal deploy`, external/TRELLIS2_win/src doit etre la) :
    PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal run modal_app/test_cumesh_fill_holes.py
    (options : --appels 8 --sequences 3)
Les fonctions de calcul (numpy) sont testees sur CPU par build/bancs/noyaux/test_cumesh_mit.py
(FABMESH_BANC_SANS_MODAL=1 : le module se charge alors sans Modal).
"""
import json
import os
import subprocess
import sys

PERIMETRE_MAX = 3e-2          # max_hole_perimeter de o_voxel.postprocess.to_glb
NIVEAUX_SPHERE = 7            # 327 680 faces, arete ~0,0038 : triangle ~0,011, quadrilatere ~0,015 < 3e-2
RAYON_SPHERE = 0.4            # dans le cube [-0,5 ; 0,5] de TRELLIS
TROUS_TRIANGLES = 150
TROUS_QUADRILATERES = 50
SEUIL_ORACLE = 1e-5           # float32 : la moyenne de 3-4 sommets est juste a ~1e-7 pres
SEUIL_DEFAUT = 1e-3
SEUIL_ARETE_REL = 50.0
SANS_MODAL = os.environ.get('FABMESH_BANC_SANS_MODAL') == '1'


# ---------------------------------------------------------------------------------------------------------
# Calculs sur CPU (numpy) : maillage d'essai, oracle, mesures, verdict
# ---------------------------------------------------------------------------------------------------------
def icosphere(niveaux=NIVEAUX_SPHERE, rayon=RAYON_SPHERE):
    """Sphere fermee (variete, orientee) : icosaedre subdivise `niveaux` fois. Rend (sommets float32, faces int32)."""
    import numpy as np
    p = (1.0 + 5 ** 0.5) / 2.0
    v = np.array([[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p],
                  [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]], dtype=np.float64)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
                  [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
                  [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]], dtype=np.int64)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    for _ in range(niveaux):
        a, b, c = f[:, 0], f[:, 1], f[:, 2]
        aretes = np.sort(np.concatenate([np.stack([a, b], 1), np.stack([b, c], 1), np.stack([c, a], 1)]), axis=1)
        uniques, inv = np.unique(aretes, axis=0, return_inverse=True)
        milieux = (v[uniques[:, 0]] + v[uniques[:, 1]]) / 2.0
        ab, bc, ca = (len(v) + np.asarray(inv).reshape(-1)).reshape(3, -1)
        f = np.concatenate([np.stack([a, ab, ca], 1), np.stack([ab, b, bc], 1),
                            np.stack([ca, bc, c], 1), np.stack([ab, bc, ca], 1)])
        v = np.concatenate([v, milieux])
        v /= np.linalg.norm(v, axis=1, keepdims=True)
    return (v * rayon).astype(np.float32), f.astype(np.int32)


def percer(v, f, n_triangles=TROUS_TRIANGLES, n_quadrilateres=TROUS_QUADRILATERES, graine=0,
           perimetre_max=PERIMETRE_MAX):
    """Retire des faces isolees (trou triangulaire) et des paires de faces voisines (trou a 4 cotes), sans sommet
    commun entre deux trous (bords disjoints et simples) et de perimetre < 0,9 x perimetre_max (aucun cas limite).
    Rend (faces restantes int32, liste des trous = sommets du bord, dans l'ordre de leur creation)."""
    import numpy as np
    rng = np.random.default_rng(graine)
    f = np.asarray(f)
    v64 = np.asarray(v, dtype=np.float64)
    voisines = {}
    for i, (a, b, c) in enumerate(f.tolist()):
        for e in ((a, b), (b, c), (c, a)):
            voisines.setdefault(tuple(sorted(e)), []).append(i)
    # faces de chaque sommet (une fois pour toutes)
    plat = f.reshape(-1)
    tri = np.argsort(plat, kind='stable')
    debut = np.searchsorted(plat[tri], np.arange(len(v64) + 1))

    def faces_du_sommet(s):
        return (tri[debut[s]:debut[s + 1]] // 3).tolist()

    pris, retirees, trous = set(), set(), []

    def perimetre(sommets_cycle):
        return float(sum(np.linalg.norm(v64[sommets_cycle[k]] - v64[sommets_cycle[(k + 1) % len(sommets_cycle)]])
                         for k in range(len(sommets_cycle))))

    ordre = rng.permutation(len(f))
    voulus = [('quad', n_quadrilateres), ('tri', n_triangles)]
    for genre, n in voulus:
        faits = 0
        for i in ordre:
            if faits >= n:
                break
            i = int(i)
            if i in retirees:
                continue
            a, b, c = f[i].tolist()
            if genre == 'tri':
                bord, faces = [a, b, c], [i]
            else:
                j = next((k for k in voisines[tuple(sorted((a, b)))] if k != i), None)
                if j is None or j in retirees:
                    continue
                d = next(x for x in f[j].tolist() if x not in (a, b))
                bord, faces = [a, d, b, c], [i, j]
            if any(s in pris for s in bord) or perimetre(bord) >= 0.9 * perimetre_max:
                continue
            # sommets du bord ET leurs voisins reserves : deux trous ne se touchent jamais
            for s in bord:
                pris.add(s)
            for k in faces:
                for s in f[k].tolist():
                    pris.add(s)
            voisinage = [k for s in bord for k in faces_du_sommet(s)]
            for k in voisinage:
                for s in f[k].tolist():
                    pris.add(s)
            retirees.update(faces)
            trous.append(sorted(bord))
            faits += 1
    garde = np.array([k not in retirees for k in range(len(f))])
    return f[garde].astype(np.int32), trous


def ecarts_bouchage(v_avant, f_avant, v_apres, f_apres):
    """Compare chaque sommet AJOUTE par fill_holes (indices >= len(v_avant)) au centroide des sommets du bord qu'il
    bouche (sommets des faces ajoutees qui le contiennent). Rend un dict de mesures."""
    import numpy as np
    v0 = np.asarray(v_avant, dtype=np.float64)
    va = np.asarray(v_apres, dtype=np.float64)
    fa = np.asarray(f_apres, dtype=np.int64)
    n0, m0 = len(v0), len(f_avant)
    nouveaux = va[n0:]
    finis = np.isfinite(nouveaux).all(axis=1)
    mesures = {'sommets_ajoutes': int(len(nouveaux)), 'faces_ajoutees': int(len(fa) - m0),
               'non_finis': int((~finis).sum()), 'sans_bord': 0, 'ecart_max': 0.0, 'appel_premier_ecart': None}
    eventail = fa[m0:]
    ecarts = []
    for j in range(len(nouveaux)):
        idx = n0 + j
        faces_j = eventail[(eventail == idx).any(axis=1)]
        bord = np.unique(faces_j[faces_j != idx])
        bord = bord[bord < n0]
        if not len(bord):
            mesures['sans_bord'] += 1
            continue
        if not finis[j]:
            ecarts.append(float('inf'))
            continue
        ecarts.append(float(np.abs(va[idx] - v0[bord].mean(axis=0)).max()))
    if ecarts:
        mesures['ecart_max'] = max(ecarts)
        mesures['ecarts_au_dessus_1e-3'] = int(sum(e > SEUIL_DEFAUT for e in ecarts))
    return mesures


def mesures_globales(v, f, reference_v, reference_f):
    """Sommets non finis, plus grande arete / arete mediane d'origine, plus grande coordonnee / celle d'origine."""
    import numpy as np
    v = np.asarray(v, dtype=np.float64)
    f = np.asarray(f, dtype=np.int64)
    rv = np.asarray(reference_v, dtype=np.float64)
    rf = np.asarray(reference_f, dtype=np.int64)
    finis = np.isfinite(v).all(axis=1)

    def aretes(sommets, faces):
        return np.linalg.norm(sommets[faces[:, [1, 2, 0]]] - sommets[faces], axis=2).reshape(-1)

    ref_arete = float(np.median(aretes(rv, rf)))
    ok = finis[f].all(axis=1)
    longueurs = aretes(v, f[ok]) if ok.any() else np.zeros(1)
    return {'sommets': int(len(v)), 'faces': int(len(f)), 'non_finis': int((~finis).sum()),
            'arete_max_rel': float(longueurs.max() / ref_arete) if len(longueurs) else 0.0,
            'coordonnee_max_rel': float(np.abs(v[finis]).max() / np.abs(rv).max()) if finis.any() else float('inf')}


def verdict(resultats, n_trous):
    """resultats = {'avec_correctif': {...}, 'sans_correctif': {...}} (sortie de mesurer_dans_ce_processus)."""
    def appels_justes(r):
        return all(a['sommets_ajoutes'] == n_trous and a['non_finis'] == 0 and a['sans_bord'] == 0
                   and a['ecart_max'] < SEUIL_ORACLE for a in r['direct'])

    def appels_corrompus(r):
        return [i for i, a in enumerate(r['direct'])
                if a['ecart_max'] > SEUIL_DEFAUT or a['non_finis'] or a['sommets_ajoutes'] != n_trous]

    def sequences_corrompues(r):
        return [i for i, s in enumerate(r['sequences'])
                if s['non_finis'] or s['arete_max_rel'] > SEUIL_ARETE_REL or s['coordonnee_max_rel'] > 1.5]

    avec, sans = resultats['avec_correctif'], resultats['sans_correctif']
    return {
        'banc_valide': bool(appels_justes(avec) and not sequences_corrompues(avec)
                            and avec.get('variante') == 'avec_correctif' and sans.get('variante') == 'sans_correctif'),
        'defaut_confirme_sans_correctif': bool(appels_corrompus(sans) or sequences_corrompues(sans)),
        'appels_corrompus_sans_correctif': appels_corrompus(sans),
        'sequences_corrompues_sans_correctif': sequences_corrompues(sans),
        'premier_appel_sans_correctif': sans['direct'][0] if sans['direct'] else None,
    }


def mesurer_dans_ce_processus(appels=8, sequences=3, variante='', cumesh_module=None, device='cuda',
                              niveaux=NIVEAUX_SPHERE, n_triangles=TROUS_TRIANGLES, n_quadrilateres=TROUS_QUADRILATERES,
                              perimetre_max=PERIMETRE_MAX):
    """Execute dans un processus NEUF (une variante de cumesh deja en tete de sys.path) : N appels directs puis K
    sequences « comme to_glb ». Rend un dict JSON-isable. `cumesh_module`, `device` et les tailles ne servent qu'aux
    tests CPU (un faux cumesh, sans GPU)."""
    import numpy as np
    import torch
    if cumesh_module is None:
        import cumesh as cumesh_module
    cumesh = cumesh_module

    def attendre():
        if device == 'cuda':
            torch.cuda.synchronize()

    v, f = icosphere(niveaux)
    fp, trous = percer(v, f, n_triangles=n_triangles, n_quadrilateres=n_quadrilateres, perimetre_max=perimetre_max)
    vt = torch.from_numpy(np.ascontiguousarray(v)).to(device)
    ft = torch.from_numpy(np.ascontiguousarray(fp)).to(device)
    sortie = {'variante': variante, 'cumesh': getattr(cumesh, '__file__', '?'), 'trous': len(trous), 'direct': [],
              'sequences': []}
    for _ in range(int(appels)):
        m = cumesh.CuMesh()
        m.init(vt, ft)
        m.fill_holes(max_hole_perimeter=perimetre_max)
        va, fa = m.read()
        attendre()
        sortie['direct'].append(ecarts_bouchage(v, fp, va.cpu().numpy(), fa.cpu().numpy()))
    for _ in range(int(sequences)):
        m = cumesh.CuMesh()
        m.init(vt, ft)
        m.fill_holes(max_hole_perimeter=perimetre_max)
        for cible in (len(fp) // 2, len(fp) // 4):
            m.simplify(int(cible))
            m.remove_duplicate_faces()
            m.repair_non_manifold_edges()
            m.remove_small_connected_components(1e-5)
            m.fill_holes(max_hole_perimeter=perimetre_max)
        va, fa = m.read()
        attendre()
        sortie['sequences'].append(mesures_globales(va.cpu().numpy(), fa.cpu().numpy(), v, fp))
    return sortie


# ---------------------------------------------------------------------------------------------------------
# Modal
# ---------------------------------------------------------------------------------------------------------
CODE_ENFANT = ("import json; from modal_app.test_cumesh_fill_holes import mesurer_dans_ce_processus as m; "
               "print('RESULTAT ' + json.dumps(m(%d, %d, %r)))")

if not SANS_MODAL:
    import modal

    from modal_app.app import _CUMESH_MIT, mesh_image

    app = modal.App('myfabmesh-test-cumesh-fill-holes', image=mesh_image)

    @app.function(cpu=8.0, memory=16384, timeout=3600)
    def construire_sans_correctif():
        """Memes sources et meme garde que _CUMESH_MIT, SANS le correctif de fill_holes : rend (nom, octets) de la roue."""
        import glob
        from modal_app.construction_cumesh import verifier_sources_cubvh
        src, sortie = '/tmp/sans_correctif_src', '/tmp/roue_sans_correctif'
        subprocess.run(['sh', '-c', _CUMESH_MIT[0].replace('/tmp/cumesh_mit', src)], check=True)
        print('garde des sources :', verifier_sources_cubvh(os.path.join(src, 'third_party', 'cubvh')), flush=True)
        subprocess.run([sys.executable, '-m', 'pip', 'wheel', '--no-deps', '--no-build-isolation', '-w', sortie, src],
                       check=True)
        chemin = glob.glob(os.path.join(sortie, 'cumesh-*.whl'))[0]
        with open(chemin, 'rb') as fh:
            return os.path.basename(chemin), fh.read()

    @app.function(gpu='L40S', timeout=1800)
    def mesurer(nom_roue: str, roue: bytes, appels: int = 8, sequences: int = 3):
        os.makedirs('/tmp/roues', exist_ok=True)
        chemin = os.path.join('/tmp/roues', nom_roue)
        with open(chemin, 'wb') as fh:
            fh.write(roue)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-deps', '--target', '/tmp/v_sans', chemin],
                       check=True)
        import modal_app   # dossier qui contient le paquet modal_app dans le conteneur (pour le processus enfant)
        racine = os.path.dirname(os.path.abspath(list(modal_app.__path__)[0]))
        resultats = {}
        for variante, devant in (('sans_correctif', '/tmp/v_sans'), ('avec_correctif', '')):
            pp = os.pathsep.join(p for p in (devant, racine, os.environ.get('PYTHONPATH', '')) if p)
            env = dict(os.environ, PYTHONPATH=pp, FABMESH_BANC_SANS_MODAL='1')
            r = subprocess.run([sys.executable, '-c', CODE_ENFANT % (appels, sequences, variante)], env=env,
                               capture_output=True, text=True, timeout=1500)
            lignes = [l for l in r.stdout.splitlines() if l.startswith('RESULTAT ')]
            if r.returncode != 0 or not lignes:
                resultats[variante] = {'variante': variante, 'erreur': (r.stderr or r.stdout)[-3000:],
                                       'direct': [], 'sequences': []}
                continue
            resultats[variante] = json.loads(lignes[-1][len('RESULTAT '):])
        attendu_sans = resultats['sans_correctif'].get('cumesh', '').startswith('/tmp/v_sans')
        n_trous = resultats['avec_correctif'].get('trous', 0)
        bilan = verdict(resultats, n_trous) if resultats['avec_correctif'].get('direct') else {'banc_valide': False}
        bilan['variante_sans_correctif_bien_chargee'] = attendu_sans
        if not attendu_sans:
            bilan['banc_valide'] = False
        return {'verdict': bilan, 'resultats': resultats}

    @app.local_entrypoint()
    def main(appels: int = 8, sequences: int = 3):
        nom, roue = construire_sans_correctif.remote()
        rapport = mesurer.remote(nom, roue, appels, sequences)
        print(json.dumps(rapport, indent=1, ensure_ascii=False))
