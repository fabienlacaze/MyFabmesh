"""Remet a jour, dans docs/campagnes/resultats_outils_3d_suite.jsonl, les mesures d'animation des essais qui ont ete valides avec l'ancienne mesure de glissement des pieds
(avant l'ajout du 30e centile, « pieds_p30 »). A lancer quand AUCUNE chaine d'essais ne tourne (le fichier est reecrit). Usage : python revalider_anims.py"""
import json, io, os, subprocess, sys
REPO = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself'
SRC = REPO + '/docs/campagnes/resultats_outils_3d_suite.jsonl'
PY = os.path.join(os.environ['APPDATA'], 'myfabmesh-ai', 'python', 'python.exe')
ANIM = os.path.join(os.environ['APPDATA'], 'myfabmesh-ai', 'meshes', 'animated')
lignes = [json.loads(l) for l in io.open(SRC, encoding='utf-8') if l.strip()]
n = 0
for x in lignes:
    m = x.get('mesures') or {}
    anims = m.get('animations') or []
    if not anims or any('pieds_p30' in a for a in anims) or not x.get('nouvelle_version'):
        continue
    f = os.path.join(ANIM, x['nouvelle_version'])
    if not os.path.exists(f):
        continue
    try:
        out = subprocess.run([PY, REPO + '/build/bancs/campagne3d/valider_rig2.py', f, '--rapide'], capture_output=True, text=True, timeout=300, env={**os.environ, 'PYTHONUTF8': '1'}).stdout.strip().split('\n')[-1]
        nv = json.loads(out)
        for a, b in zip(anims, nv.get('animations') or []):
            if 'pieds_p30' in b: a['pieds_p30'] = b['pieds_p30']
        n += 1
    except Exception as e:  # noqa
        print('echec', x['nom'], e)
io.open(SRC, 'w', encoding='utf-8').write('\n'.join(json.dumps(x, ensure_ascii=False) for x in lignes) + '\n')
print('mesures remises a jour pour', n, 'essais')
