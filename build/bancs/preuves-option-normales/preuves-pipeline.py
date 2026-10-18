"""PREUVES D'ECHEC du test du pipeline bureau (build/bancs/noyaux/test_carte_normales_bureau.py) : chaque MUTANT de
scripts/trellis2_native_full_pipeline.py doit faire echouer le test. Rien n'est ecrit dans le depot (copies dans le dossier temporaire).

    python build/bancs/preuves-option-normales/preuves-pipeline.py          (code de sortie 0 = tous les mutants sont detectes)

Preuve complementaire sur le code d'AVANT l'option : git show 3886f61a:scripts/trellis2_native_full_pipeline.py > <fichier> ;
PIPELINE_BUREAU=<fichier> python build/bancs/noyaux/test_carte_normales_bureau.py   (3 echecs attendus)
"""
import os
import subprocess
import sys
import tempfile

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TEST = os.path.join(RACINE, 'build', 'bancs', 'noyaux', 'test_carte_normales_bureau.py')
SRC = os.path.join(RACINE, 'scripts', 'trellis2_native_full_pipeline.py')
SORTIE = tempfile.mkdtemp(prefix='preuves_pipeline_')

texte = open(SRC, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in texte else '\n'

MUTANTS = [
    ('interrupteur d urgence retire (option seule)',
     'if carte_normales_voulue(option_carte_normales()):', 'if option_carte_normales():'),
    ('option retiree (interrupteur seul : cuisson par defaut)',
     'if carte_normales_voulue(option_carte_normales()):', 'if carte_normales_voulue(True):'),
    ('option non stricte (toute valeur non vide)',
     'if carte_normales_voulue(option_carte_normales()):', 'if carte_normales_voulue(bool(os.environ.get("FABMESH_NORMAL_MAP_OPTION"))):'),
    ('cuisson depuis le maillage final et non le fin',
     "ajouter_carte_normales(glb, mesh.vertices, mesh.faces, log=log)", "ajouter_carte_normales(glb, glb.vertices, glb.faces, log=log)"),
    ('taille explicite passee par le pipeline',
     "ajouter_carte_normales(glb, mesh.vertices, mesh.faces, log=log)", "ajouter_carte_normales(glb, mesh.vertices, mesh.faces, 4096, log=log)"),
    ('panne de la cuisson non rattrapee',
     "    except Exception as _e:\n        log(f'carte de normales ignoree", "    except KeyError as _e:\n        log(f'carte de normales ignoree"),
    ('carte posee annoncee meme si non posee',
     ".get('posee'))", ".get('posee', True))"),
]

detectes = 0
for i, (nom, ancien, nouveau) in enumerate(MUTANTS):
    a, n = ancien.replace('\n', nl), nouveau.replace('\n', nl)
    if texte.count(a) != 1:
        print('ANCRE ABSENTE OU MULTIPLE (%d) : %s' % (texte.count(a), nom))
        sys.exit(2)
    chemin = os.path.join(SORTIE, 'pipeline_mutant_%d.py' % i)
    with open(chemin, 'w', encoding='utf-8', newline='') as f:
        f.write(texte.replace(a, n))
    env = dict(os.environ, PIPELINE_BUREAU=chemin, PYTHONUTF8='1')
    r = subprocess.run([sys.executable, TEST], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    if r.returncode != 0:
        detectes += 1
        print('detecte      : %s' % nom)
    else:
        print('NON DETECTE  : %s' % nom)
print('%d mutants, %d detectes' % (len(MUTANTS), detectes))
sys.exit(0 if detectes == len(MUTANTS) else 1)
