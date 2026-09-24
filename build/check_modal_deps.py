"""Refuse une construction si une operation mesh importe un module absent de
l'image Modal.

POURQUOI. DEUX fois, une dependance manquante a rendu une operation FACTUREE
inoperante, sans que rien ne le signale tant que personne ne cliquait :

  * `fast_simplification` — l'outil « Nombre de triangles » rendait le
    maillage INTACT en debitant 1 credit (constate le 2026-07-27 : cible
    4 500, resultat 481 202 triangles) ;
  * `scikit-image` — l'op « watertight » levait ModuleNotFoundError a chaque
    appel depuis qu'elle est proposee (constate le 2026-09-24). Les credits
    etaient rembourses, mais l'outil n'avait jamais fonctionne.

Le point commun : le code est correct, l'image ne l'est pas. Aucun test de
syntaxe ne peut le voir, et le defaut ne se manifeste qu'en production, sur
un clic payant.

CE QUE FAIT CE GARDE. Il lit les imports de `modal_app/_mesh_op.py` — le
fichier des operations mesh, toutes facturees — et verifie que chaque module
tiers est fourni par un `pip_install` de `modal_app/app.py`. Il ne couvre pas
tout Modal : il couvre l'endroit ou l'accident s'est produit deux fois.

Usage : python build/check_modal_deps.py
"""
import ast
import io
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPS = os.path.join(RACINE, 'modal_app', '_mesh_op.py')
APP = os.path.join(RACINE, 'modal_app', 'app.py')

#: Module importe -> paquet pip qui le fournit. Seuls les cas ou les deux noms
#: different ont besoin d'une ligne ici.
PAQUET = {
    'skimage': 'scikit-image',
    'cv2': 'opencv-python-headless',
    'PIL': 'pillow',
    'sklearn': 'scikit-learn',
    'yaml': 'pyyaml',
    'fast_simplification': 'fast_simplification',
    'mapbox_earcut': 'mapbox_earcut',
}

#: Modules fournis par l'image de base ou la bibliotheque standard etendue.
FOURNIS = {
    'numpy', 'scipy', 'trimesh', 'modal', 'fastapi', 'starlette',
    'pygltflib', 'torch', 'PIL',
}


def modules_importes(chemin):
    arbre = ast.parse(io.open(chemin, encoding='utf-8').read())
    vus = set()
    for n in ast.walk(arbre):
        if isinstance(n, ast.Import):
            for a in n.names:
                vus.add(a.name.split('.')[0])
        elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
            vus.add(n.module.split('.')[0])
    return vus


def paquets_declares(chemin):
    txt = io.open(chemin, encoding='utf-8').read()
    noms = set()
    # .pip_install("a", "b", ...) et pip install a b c dans un run_commands
    for bloc in re.findall(r'pip_install\(([^)]*)\)', txt, re.S):
        noms |= {m.lower() for m in re.findall(r'"([A-Za-z0-9_.\-]+)', bloc)}
    for bloc in re.findall(r'pip install ([^"\']+)', txt):
        noms |= {m.lower() for m in re.findall(r'([A-Za-z0-9_.\-]+)', bloc)}
    # on retire les specificateurs de version accroches au nom
    return {re.split(r'[=<>!\[]', n)[0] for n in noms}


def stdlib(nom):
    return nom in getattr(sys, 'stdlib_module_names', set())


#: Fonctions de trimesh qui delegent a un moteur OPTIONNEL. C'est ICI que se
#: sont produits les deux accidents : le code n'importe rien lui-meme, c'est
#: trimesh qui charge le moteur au moment de l'appel — un scan des `import` ne
#: peut donc RIEN voir. La premiere version de ce garde avait ce defaut et
#: n'aurait pas attrape le cas qui l'a fait naitre.
TRIMESH_EXIGE = {
    'simplify_quadric_decimation': 'fast_simplification',
    'marching_cubes':              'scikit-image',
    'triangulate':                 'mapbox_earcut',
}

importes = modules_importes(OPS)
declares = paquets_declares(APP)

manquants = []
for mod in sorted(importes):
    if stdlib(mod) or mod in FOURNIS or mod.startswith('modal_app') or mod == 'modal_app':
        continue
    paquet = PAQUET.get(mod, mod)
    if paquet.lower() not in declares and mod.lower() not in declares:
        manquants.append((mod, paquet))

texte_ops = io.open(OPS, encoding='utf-8').read()
for appel, paquet in sorted(TRIMESH_EXIGE.items()):
    if appel not in texte_ops:
        continue
    if paquet.lower() not in declares:
        manquants.append(('trimesh.%s()' % appel, paquet))

if manquants:
    print()
    print('=' * 72)
    print("  OPERATIONS MESH : une dependance manque a l'image Modal.")
    print()
    for mod, paquet in manquants:
        print('  modal_app/_mesh_op.py importe « %s »' % mod)
        print('     -> aucun pip_install ne fournit « %s » dans modal_app/app.py' % paquet)
    print()
    print("  Ces operations sont FACTUREES. Une dependance absente les rend")
    print("  inoperantes en production sans qu'aucun test de syntaxe ne le voie :")
    print("  c'est arrive deux fois (fast_simplification, scikit-image).")
    print('=' * 72)
    print()
    sys.exit(1)

print('[modal] %d module(s) importe(s) par les ops mesh, tous fournis par l image'
      % len([m for m in importes if not stdlib(m)]))
