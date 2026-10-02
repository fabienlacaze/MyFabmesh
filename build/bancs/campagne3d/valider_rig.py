"""Mesures d'un GLB rigge / anime : os (joints), peaux, animations, duree, sommets, poids de peau. Usage : python valider_rig.py <fichier.glb> -> une ligne JSON."""
import json, os, struct, sys

chemin = sys.argv[1]
r = {'fichier': os.path.basename(chemin), 'taille_mo': round(os.path.getsize(chemin) / 1048576, 1)}
try:
    with open(chemin, 'rb') as f:
        magic, ver, total = struct.unpack('<4sII', f.read(12))
        r['gltf'] = magic == b'glTF'
        n, t = struct.unpack('<I4s', f.read(8))
        j = json.loads(f.read(n).decode('utf-8'))
    skins = j.get('skins', [])
    r['peaux'] = len(skins)
    r['joints'] = max([len(s.get('joints', [])) for s in skins] or [0])
    r['noeuds'] = len(j.get('nodes', []))
    r['maillages'] = len(j.get('meshes', []))
    anims = j.get('animations', [])
    r['animations'] = len(anims)
    if anims:
        a = anims[0]; r['animation0'] = a.get('name'); r['canaux'] = len(a.get('channels', []))
        # duree : plus grand `max` des accesseurs d'entree
        dur = 0.0
        for s in a.get('samplers', []):
            acc = j['accessors'][s['input']]
            if acc.get('max'): dur = max(dur, float(acc['max'][0]))
        r['duree_s'] = round(dur, 2)
    prims = [p for m in j.get('meshes', []) for p in m.get('primitives', [])]
    r['avec_poids'] = any('WEIGHTS_0' in p.get('attributes', {}) for p in prims)
    r['avec_joints'] = any('JOINTS_0' in p.get('attributes', {}) for p in prims)
    r['sommets'] = int(sum(j['accessors'][p['attributes']['POSITION']]['count'] for p in prims if 'POSITION' in p.get('attributes', {})))
except Exception as e:  # noqa
    r['erreur'] = repr(e)[:200]
print(json.dumps(r, ensure_ascii=False))
