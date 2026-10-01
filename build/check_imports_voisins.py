"""Garde : un script de scripts/ qui importe un module VOISIN doit d'abord ajouter son propre dossier a sys.path.

POURQUOI (audit de l'installation de zero, 2026-09-30). L'appli installee lance les scripts avec un Python EMBARQUE
dont le fichier ._pth fixe sys.path : ni le dossier du script, ni le dossier courant, ni PYTHONPATH n'y sont. En
developpement le python systeme ajoute le dossier du script, donc le defaut est INVISIBLE sur le poste de dev. Livre
en production au moins cinq fois :
  - skintokens_bridge.py : `from patch_skintokens_transfert import ...` en echec silencieux -> sur chaque PC neuf,
    rig SANS texture et sans squelette complet ;
  - sdxl_server.py : outils Outfit et Face fix (« No module named 'outfit_cutout' ») ;
  - mesh_tools.py : Decimate retombait sur l'ancienne methode (acceleration_glb introuvable) ;
  - face_inpaint_atlas.py, et plus tot rembg (detourage) et flash_attn_interface (env du rig).

REGLE. Import d'un module de scripts/ (fichier du meme dossier ou de scripts/) :
  - au niveau du module : il faut AVANT lui, au niveau du module, un `sys.path.insert/append(...)` qui mentionne
    __file__ (directement ou via une variable qui en derive), ou l'appel d'une fonction du fichier qui le fait ;
  - dans une fonction : une telle insertion au niveau du module, ou plus haut dans la MEME fonction.
Les modules copies dans site-packages par l'assistant (rembg, minisbd) sont exclus. EXCEPTIONS ci-dessous, chacune justifiee :
un script qui n'est JAMAIS lance par le Python embarque (Blender, outil de dev) ou un module seulement importe par des
ponts qui posent deja le chemin.

    python build/check_imports_voisins.py            # code 1 si un script enfreint la regle
"""
import ast
import os
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(RACINE, 'scripts')
COPIES_SITE_PACKAGES = {'rembg', 'minisbd'}   # wizard_install_deps._poser_detourage / _poser_minisbd_neutre
EXCEPTIONS = {
    'anytop_retarget.py': "module importe par mesh2motion_bridge / clips_fbx_bridge / kimodo_bridge, qui posent le chemin",
    'fbx_motion.py': "module importe par anytop_retarget (meme situation)",
    'kimodo_bridge.py': "les fonctions qui importent anytop_retarget ne sont appelees que depuis retarget(), qui pose le chemin",
    'rokoko_batch_retarget.py': "execute DANS Blender (bpy), pas par le Python embarque",
    'fabmesh_autorig.py': "ancien auto-rig, lance par aucun appel de l'appli",
    'generate_back_view_hybrid.py': "lance par aucun appel de l'appli",
    'generate_side_view.py': "lance par aucun appel de l'appli",
    'generate_back_view_mvadapter.py': "moteur MV-Adapter non livre ; import protege",
}


def _mentionne_fichier(noeud, variables):
    """Le noeud utilise-t-il __file__, ou une variable qui en derive ? (arbre seul : pas de decoupage du source, rapide)"""
    return any(isinstance(x, ast.Name) and (x.id == '__file__' or x.id in variables) for x in ast.walk(noeud))


def _est_insertion_chemin(appel):
    """x.path.insert(...) / x.path.append(...) (sys.path, _sys.path...)."""
    f = appel.func
    return (isinstance(f, ast.Attribute) and f.attr in ('insert', 'append')
            and isinstance(f.value, ast.Attribute) and f.value.attr == 'path')


class _Analyse(ast.NodeVisitor):
    def __init__(self):
        self.pile = []              # fonctions englobantes
        self.variables = set()      # noms assignes depuis une expression mentionnant __file__
        self.insertions = []        # (ligne, portee)
        self.imports = []           # (module, ligne, portee)
        self.fonctions_qui_inserent = set()
        self.appels = []            # (nom de fonction appelee, ligne, portee)

    def portee(self):
        return self.pile[-1] if self.pile else '<module>'

    def visit_FunctionDef(self, n):
        self.pile.append(n.name)
        self.generic_visit(n)
        self.pile.pop()
    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, n):
        self.pile.append(n.name)
        self.generic_visit(n)
        self.pile.pop()

    def visit_Lambda(self, n):
        # un appel DANS une lambda n'est pas execute au chargement (ex. table de dispatch de mesh_tools.py)
        self.pile.append(f'<lambda:{n.lineno}>')
        self.generic_visit(n)
        self.pile.pop()

    def visit_Assign(self, n):
        if _mentionne_fichier(n.value, self.variables):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    self.variables.add(t.id)
        self.generic_visit(n)

    def visit_Call(self, n):
        if _est_insertion_chemin(n) and any(_mentionne_fichier(a, self.variables) for a in n.args):
            self.insertions.append((n.lineno, self.portee()))
            if self.pile:
                self.fonctions_qui_inserent.add(self.pile[-1])
        if isinstance(n.func, ast.Name):
            self.appels.append((n.func.id, n.lineno, self.portee()))
        self.generic_visit(n)

    def visit_Import(self, n):
        for a in n.names:
            self.imports.append((a.name.split('.')[0], n.lineno, self.portee()))

    def visit_ImportFrom(self, n):
        if not n.level and n.module:
            self.imports.append((n.module.split('.')[0], n.lineno, self.portee()))


def _voisin(nom, dossier):
    for base in (dossier, SCRIPTS):
        if os.path.isfile(os.path.join(base, nom + '.py')) or os.path.isfile(os.path.join(base, nom, '__init__.py')):
            return True
    return False


def verifier(chemin):
    src = open(chemin, encoding='utf-8', errors='replace').read()
    try:
        arbre = ast.parse(src)
    except SyntaxError:
        return []                   # la syntaxe est l'affaire d'un autre garde
    a = _Analyse()
    a.visit(arbre)
    # appel, au niveau du module, d'une fonction du fichier qui pose le chemin = insertion a cette ligne
    module = [l for l, p in a.insertions if p == '<module>']
    module += [l for nom, l, p in a.appels if p == '<module>' and nom in a.fonctions_qui_inserent]
    dossier = os.path.dirname(chemin)
    fautes = []
    for nom, ligne, portee in a.imports:
        if nom in COPIES_SITE_PACKAGES or nom in sys.stdlib_module_names or not _voisin(nom, dossier):
            continue
        if portee == '<module>':
            ok = any(l < ligne for l in module)
        else:
            ok = bool(module) or any(p == portee and l < ligne for l, p in a.insertions)
        if not ok:
            fautes.append(f'{nom} (ligne {ligne}{"" if portee == "<module>" else ", dans " + portee})')
    return fautes


def main():
    fautifs = []
    for dp, dn, fn in os.walk(SCRIPTS):
        dn[:] = [d for d in dn if d not in ('__pycache__', '.venv')]
        for f in sorted(fn):
            if not f.endswith('.py') or (f in EXCEPTIONS and dp == SCRIPTS):
                continue
            fautes = verifier(os.path.join(dp, f))
            if fautes:
                fautifs.append((os.path.relpath(os.path.join(dp, f), RACINE).replace(os.sep, '/'), fautes))
    if fautifs:
        print('[voisins] ECHEC : scripts qui importent un module de scripts/ sans ajouter leur dossier a sys.path.')
        print('[voisins] Le Python embarque de l\'appli installee (fichier ._pth) ne l\'ajoute PAS : ces imports echouent sur un PC neuf.')
        for f, fautes in fautifs:
            print(f'  {f} : {", ".join(fautes)}')
        print('[voisins] Correctif : en tete du script, sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))')
        return 1
    print(f'[voisins] tous les imports de modules voisins de scripts/ posent leur chemin ({len(EXCEPTIONS)} exceptions justifiees)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
