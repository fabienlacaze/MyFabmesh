"""PREUVES D'ECHEC du test Modal de l'option (build/bancs/noyaux/test_option_normales_serveur.py) : chaque MUTANT de modal_app/ doit le
faire echouer. Rien n'est ecrit dans le depot : modal_app/ est copie dans le dossier temporaire, un mutant a la fois.

    python build/bancs/preuves-option-normales/preuves-serveur.py           (code de sortie 0 = tous les mutants sont detectes)

Preuve complementaire sur le code d'AVANT l'option : git archive 3886f61a modal_app | tar -x -C <dossier> ;
RACINE_MODAL=<dossier> python build/bancs/noyaux/test_option_normales_serveur.py   (5 echecs attendus)
"""
import os
import shutil
import subprocess
import sys
import tempfile

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TEST = os.path.join(RACINE, 'build', 'bancs', 'noyaux', 'test_option_normales_serveur.py')
COPIE = tempfile.mkdtemp(prefix='preuves_serveur_')
shutil.copytree(os.path.join(RACINE, 'modal_app'), os.path.join(COPIE, 'modal_app'))

MUTANTS = [
    ('_mesh.py', 'defaut vrai', 'normal_map: bool = False,', 'normal_map: bool = True,'),
    ('_mesh.py', 'cuisson sans garde', '    if normal_map is True:\n        try:\n            from modal_app import normal_bake as _normal_bake',
     '    if True:\n        try:\n            from modal_app import normal_bake as _normal_bake'),
    ('_mesh.py', 'garde non stricte', '    if normal_map is True:\n        try:\n            from modal_app import normal_bake as _normal_bake',
     '    if normal_map:\n        try:\n            from modal_app import normal_bake as _normal_bake'),
    ('app.py', 'lecture non stricte', 'normal_map=payload.get("normal_map") is True,', 'normal_map=bool(payload.get("normal_map")),'),
    ('app.py', 'valeur brute transmise', 'normal_map=payload.get("normal_map") is True,', 'normal_map=payload.get("normal_map"),'),
    ('app.py', 'option jamais transmise', '                normal_map=payload.get("normal_map") is True,\n', ''),
    ('app.py', 'option toujours vraie', 'normal_map=payload.get("normal_map") is True,', 'normal_map=True,'),
    ('_mesh_op.py', 'nouvel appelant non garde',
     'def _retirer_cartes_normales(scene) -> int:',
     'def _cuire_partout(scene, V, F):\n    from modal_app.normal_bake import ajouter_carte_normales\n    return ajouter_carte_normales(scene, V, F)\n\n\ndef _retirer_cartes_normales(scene) -> int:'),
]

detectes = 0
for fichier, nom, ancien, nouveau in MUTANTS:
    chemin = os.path.join(COPIE, 'modal_app', fichier)
    brut = open(chemin, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in brut else '\n'
    a, n = ancien.replace('\n', nl), nouveau.replace('\n', nl)
    if brut.count(a) != 1:
        print('ANCRE ABSENTE OU MULTIPLE (%d) : %s' % (brut.count(a), nom))
        sys.exit(2)
    open(chemin, 'w', encoding='utf-8', newline='').write(brut.replace(a, n))
    env = dict(os.environ, RACINE_MODAL=COPIE, PYTHONUTF8='1')
    r = subprocess.run([sys.executable, TEST], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    open(chemin, 'w', encoding='utf-8', newline='').write(brut)        # restaure
    if r.returncode != 0:
        detectes += 1
        print('detecte      : %s (%s)' % (nom, fichier))
    else:
        print('NON DETECTE  : %s (%s)' % (nom, fichier))
print('%d mutants, %d detectes' % (len(MUTANTS), detectes))
shutil.rmtree(COPIE, ignore_errors=True)
sys.exit(0 if detectes == len(MUTANTS) else 1)
