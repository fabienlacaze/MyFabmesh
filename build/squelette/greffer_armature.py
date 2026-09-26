"""Greffe un squelette (joints + parents) sur un GLB TEXTURE, en vue d'un
passage du rigger en mode `--use_skeleton` (l'IA ne predit alors que la
peau). Le maillage, ses UV et ses materiaux sont conserves tels quels.

Poids d'amorcage : chaque sommet sur son joint le plus proche ; un joint sans
sommet en recoit de force ses 60 plus proches. Sans cela, trim_skeleton()
elague tout os dont le sous-arbre ne porte aucun poids (les bouts de pattes).

Usage : python greffer_armature.py maillage.glb squelette.json sortie.glb
"""
import os, sys, json, struct, collections
import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'modal_app'))
from _unimate_moteur import lire_glb


def main():
    js, bn = lire_glb(open(sys.argv[1], 'rb').read())
    sq = json.load(open(sys.argv[2]))
    J = np.array(sq['joints'], np.float64)
    parents = sq['parents']
    noms = sq.get('noms') or [f'bone_{i}' for i in range(len(J))]
    blob = bytearray(bn)

    def pousser(arr, ctype, atype, cible=None, norm=False, minmax=False):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        brut = np.ascontiguousarray(arr).tobytes()
        blob.extend(brut)
        js['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(brut), **({'target': cible} if cible else {})})
        a = {'bufferView': len(js['bufferViews']) - 1, 'componentType': ctype, 'count': int(len(arr)), 'type': atype}
        if norm:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
        js['accessors'].append(a)
        return len(js['accessors']) - 1

    # sommets du maillage (seul noeud maillage, sans transformation — verifie)
    prim = js['meshes'][0]['primitives'][0]
    acc = js['accessors'][prim['attributes']['POSITION']]
    bv = js['bufferViews'][acc['bufferView']]
    V = np.frombuffer(bn, np.float32, acc['count'] * 3, bv.get('byteOffset', 0) + acc.get('byteOffset', 0)).reshape(-1, 3).astype(np.float64)
    noeud_maillage = next(i for i, n in enumerate(js['nodes']) if n.get('mesh') == 0)
    for i, n in enumerate(js['nodes']):
        if any(k in n for k in ('matrix', 'translation', 'rotation', 'scale')):
            raise SystemExit(f'noeud {i} transforme : cas non gere par ce greffon')

    # poids d'amorcage
    _, proche = cKDTree(J).query(V, k=1)
    J4 = np.zeros((len(V), 4), np.uint16); J4[:, 0] = proche
    occ = collections.Counter(proche.tolist())
    orphelins = [k for k in range(len(J)) if occ.get(k, 0) == 0]
    arbre_v = cKDTree(V)
    for k in orphelins:
        _, idx = arbre_v.query(J[k], k=60)
        J4[idx, 0] = k
    W4 = np.zeros((len(V), 4), np.uint8); W4[:, 0] = 255
    prim['attributes']['JOINTS_0'] = pousser(J4, 5123, 'VEC4', 34962)
    prim['attributes']['WEIGHTS_0'] = pousser(W4, 5121, 'VEC4', 34962, norm=True)

    # noeuds d'os : translation locale seule (le tokenizer ne lit que les positions)
    premier = len(js['nodes'])
    enfants = collections.defaultdict(list)
    for j, p in enumerate(parents):
        if p >= 0:
            enfants[p].append(j)
    for j in range(len(J)):
        p = parents[j]
        t = J[j] - (J[p] if p >= 0 else 0.0)
        n = {'name': noms[j], 'translation': [float(x) for x in t]}
        if enfants[j]:
            n['children'] = [premier + c for c in enfants[j]]
        js['nodes'].append(n)
    armature = len(js['nodes'])
    js['nodes'].append({'name': 'Armature', 'children': [premier + j for j in range(len(J)) if parents[j] < 0]})
    js['scenes'][js.get('scene', 0)]['nodes'].append(armature)
    ibm = np.stack([np.eye(4) for _ in range(len(J))])
    for k in range(len(J)):
        ibm[k][:3, 3] = -J[k]
    a_ibm = pousser(ibm.transpose(0, 2, 1).reshape(len(J), 16).astype(np.float32), 5126, 'MAT4')
    racine = next(j for j in range(len(J)) if parents[j] < 0)
    js['skins'] = [{'joints': [premier + j for j in range(len(J))], 'inverseBindMatrices': a_ibm,
                    'skeleton': premier + racine}]
    js['nodes'][noeud_maillage]['skin'] = 0

    while len(blob) % 4:
        blob.append(0)
    js['buffers'][0]['byteLength'] = len(blob)
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    with open(sys.argv[3], 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob)))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(bytes(blob))
    print(f'{len(J)} os greffes ({len(orphelins)} orphelins amorces), {len(V)} sommets -> {sys.argv[3]}')


if __name__ == '__main__':
    main()
