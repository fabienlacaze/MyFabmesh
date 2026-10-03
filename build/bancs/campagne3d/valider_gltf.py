"""Coherence glTF d'un GLB (sans bibliotheque) : tous les attributs d'une primitive ont-ils le meme nombre d'elements ? les indices sont-ils dans les bornes ? y a-t-il des indices ?
Usage : python valider_gltf.py <fichier.glb> [...]  -> une ligne JSON par fichier."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig_lib import Rig
for f in sys.argv[1:]:
    r = {'fichier': os.path.basename(f)}
    try:
        g = Rig(f); prob = []; prims = 0
        for mi, m in enumerate(g.j.get('meshes', [])):
            for pi, p in enumerate(m.get('primitives', [])):
                prims += 1
                at = p.get('attributes', {})
                cnt = {k: g.j['accessors'][v]['count'] for k, v in at.items()}
                if len(set(cnt.values())) > 1: prob.append('attributs de comptes differents %s' % json.dumps(cnt))
                if 'indices' not in p: prob.append('aucun indice (primitive sans faces)')
                else:
                    idx = g.acc(p['indices']); n = max(cnt.values()) if cnt else 0
                    if len(idx) and int(idx.max()) >= min(cnt.values()): prob.append('indice hors bornes : max %d, plus petit attribut %d' % (int(idx.max()), min(cnt.values())))
        r['primitives'] = prims; r['problemes'] = prob
    except Exception as e:  # noqa
        r['erreur'] = repr(e)[:200]
    print(json.dumps(r, ensure_ascii=False))
