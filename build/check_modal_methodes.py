"""Refuse une construction si une classe Modal appelle une methode qu'elle n'a pas.

POURQUOI (mesure du 2026-09-26). L'affinage d'atlas « Detail refine » a ete
branche le 2026-09-24 dans `MyFabmeshMesh`, qui appelait
`self._get_tile_pipe()` — methode definie seulement dans `MyFabmeshBackview`.
Chaque appel levait AttributeError, rattrape par un `except` qui ecrivait
« [refine] ignore ». L'option etait FACTUREE 2 credits et ne faisait rien.

Rien ne pouvait le voir : la syntaxe est valide, l'import aussi, le
deploiement Modal passe, et l'erreur n'apparait qu'a l'execution — dans un
bloc volontairement tolerant (« un affinage rate ne doit pas ruiner le
maillage »), qui la transforme en silence. C'est le MEME defaut que
`translateUserPrompt()` cote web, le meme jour : un bloc deplace, une
dependance restee derriere.

CE QUE FAIT CE GARDE. Pour chaque classe de `modal_app/`, il liste les
methodes definies et les attributs affectes (`self.x = …`), puis refuse tout
appel `self.m()` qui ne correspond a aucun des deux. Il ne suit pas
l'heritage : les classes Modal de ce projet n'heritent de rien, et une
classe qui heriterait serait signalee — prudence preferable au silence.

Usage : python build/check_modal_methodes.py
"""
import ast
import glob
import io
import os
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

trous = []
for chemin in sorted(glob.glob(os.path.join(RACINE, 'modal_app', '*.py'))):
    try:
        arbre = ast.parse(io.open(chemin, encoding='utf-8').read())
    except SyntaxError:
        continue   # la syntaxe n'est pas l'affaire de ce garde
    rel = os.path.relpath(chemin, RACINE).replace(os.sep, '/')
    for classe in [n for n in ast.walk(arbre) if isinstance(n, ast.ClassDef)]:
        definies = {n.name for n in classe.body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        affectes = set()
        for n in ast.walk(classe):
            if (isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)
                    and n.value.id == 'self' and isinstance(n.ctx, ast.Store)):
                affectes.add(n.attr)
            # setattr(self, 'nom', …) : meme effet qu'une affectation.
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                    and n.func.id == 'setattr' and len(n.args) > 1
                    and isinstance(n.args[1], ast.Constant)):
                affectes.add(n.args[1].value)
        for n in ast.walk(classe):
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and isinstance(n.func.value, ast.Name) and n.func.value.id == 'self'):
                nom = n.func.attr
                if nom not in definies and nom not in affectes:
                    trous.append((rel, n.lineno, classe.name, nom))

# ── NOMS INDEFINIS ─────────────────────────────────────────────────────────
# Meme famille de defaut, autre forme : un nom utilise sans avoir ete defini ni
# importe. Deux cas reels le 2026-09-26, tous deux invisibles au deploiement :
#   * `payload.get('smooth')` dans MyFabmeshMesh.inference_bytes, qui n'a pas
#     de `payload` — NameError a chaque appel du lot d'entrainement ;
#   * `Image.open(...)` dans une route neuve d'app.py, ou PIL n'est importe que
#     localement dans chaque fonction — rattrape avant le deploiement.
# pyflakes le voit statiquement ; on ne retient QUE « undefined name ».
noms = []
try:
    from pyflakes import api as _pf_api
    from pyflakes import reporter as _pf_rep

    class _Collecte(_pf_rep.Reporter):
        def __init__(self):
            super().__init__(io.StringIO(), io.StringIO())

        def flake(self, message):
            if type(message).__name__ == 'UndefinedName':
                noms.append(str(message))

    _r = _Collecte()
    for chemin in sorted(glob.glob(os.path.join(RACINE, 'modal_app', '*.py'))):
        _pf_api.checkPath(chemin, _r)
except ImportError:
    print("[modal] ATTENTION : pyflakes absent, noms indefinis NON verifies "
          "(pip install pyflakes)")

if noms:
    print()
    print('=' * 72)
    print('  MODAL : nom utilise sans definition ni import.')
    print()
    for n in noms:
        print('  ' + os.path.relpath(n, RACINE) if os.path.isabs(n.split(':')[0]) else '  ' + n)
    print()
    print("  NameError a l'execution seulement — le deploiement passe quand meme.")
    print('=' * 72)
    print()
    sys.exit(1)

if trous:
    print()
    print('=' * 72)
    print("  CLASSE MODAL : appel d'une methode que la classe ne possede pas.")
    print()
    for rel, ligne, classe, nom in trous:
        print('  %s:%d  %s appelle self.%s()' % (rel, ligne, classe, nom))
    print()
    print("  L'erreur n'apparait qu'a l'execution, souvent dans un bloc qui la")
    print("  tolere : « Detail refine » a ete facture sans rien faire ainsi.")
    print('=' * 72)
    print()
    sys.exit(1)

print('[modal] toutes les methodes appelees sur self existent dans leur classe')
