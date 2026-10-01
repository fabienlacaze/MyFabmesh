"""Banc de la pause / reprise reelle de la 3D (scripts/trellis2_reprise.py), SANS GPU ni modele :
un faux modele deterministe, deux appels a l'echantillonneur (dense puis creux), pause au milieu du 2e, reprise, comparaison
bit a bit avec un calcul ininterrompu.   python build/test_pause_reprise.py"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
SCRIPTS = os.path.join(RACINE, 'scripts')
SRC_T2 = os.environ.get('FABMESH_TRELLIS2_SRC') or os.path.join(
    os.environ.get('LOCALAPPDATA', ''), 'Programs', 'myfabmesh-ai', 'resources', 'TRELLIS2_win', 'src')

ENFANT = r'''
import os, sys, hashlib, json
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
import torch
sys.argv = ['x', 'image_bidon.png']
import trellis2_reprise
trellis2_reprise.installer(print)
from trellis2.pipelines.samplers.flow_euler import FlowEulerSampler
try:
    from trellis2.modules.sparse import SparseTensor
except Exception as e:
    SparseTensor = None
appels = {'n': 0}
pause_apres = int(os.environ.get('PAUSE_APRES') or 0)
class Modele:
    def __call__(self, x, t, cond, **kw):
        appels['n'] += 1
        if pause_apres and appels['n'] == pause_apres:
            open(os.path.join(os.environ['FABMESH_CKPT_DIR'], 'PAUSE'), 'w').write('1')
        base = x.feats if hasattr(x, 'feats') else x
        v = torch.sin(base * 3.0 + t.reshape(-1, *([1] * (base.dim() - 1)))[:1].mean() * 0.001)
        return x.replace(v) if hasattr(x, 'replace') else v
torch.manual_seed(7)
s = FlowEulerSampler(sigma_min=1e-5)
a = s.sample(Modele(), torch.randn(1, 4, 3, 3), None, steps=6, rescale_t=3.0, verbose=False).samples
res = [hashlib.sha256(a.numpy().tobytes()).hexdigest()]
if os.environ.get('RECOMMENCER'):
    # meme mode : on repart du debut MAIS les points de reprise restent -> le 1er appel est rendu sans recalcul (cas : manque de VRAM au decodage)
    trellis2_reprise.recommencer()
    a2 = s.sample(Modele(), torch.randn(1, 4, 3, 3), None, steps=6, rescale_t=3.0, verbose=False).samples
    print('RECOMMENCER_EGAL ' + str(bool(torch.equal(a, a2))))
if SparseTensor is not None:
    noise = SparseTensor(feats=torch.randn(5, 4), coords=torch.tensor([[0, i, i, i] for i in range(5)], dtype=torch.int32))
    b = s.sample(Modele(), noise, None, steps=8, rescale_t=3.0, verbose=False).samples
    res.append(hashlib.sha256(b.feats.numpy().tobytes()).hexdigest())
c = s.sample(Modele(), torch.randn(1, 4, 3, 3), None, steps=5, rescale_t=3.0, verbose=False).samples
res.append(hashlib.sha256(c.numpy().tobytes()).hexdigest())
print('RESULTAT ' + json.dumps(res))
'''


def lancer(dossier, pause_apres=0, recommencer=False):
    env = dict(os.environ, FABMESH_CKPT_DIR=dossier, PAUSE_APRES=str(pause_apres), PYTHONIOENCODING='utf-8', RECOMMENCER='1' if recommencer else '',
               FABMESH_MEMOIRE_JOURNAL=os.path.join(os.path.dirname(dossier), 'memoire_pics.jsonl'))
    env.pop('FABMESH_TRELLIS2_NATIVE_MODE', None)
    p = subprocess.run([sys.executable, '-c', ENFANT, SCRIPTS, SRC_T2], capture_output=True, text=True, env=env, timeout=300)
    res = None
    for l in p.stdout.splitlines():
        if l.startswith('RESULTAT '):
            res = json.loads(l[9:])
    return p.returncode, res, p.stdout + p.stderr


def main():
    if not os.path.isdir(SRC_T2):
        print('SKIP : sources TRELLIS.2 introuvables (' + SRC_T2 + ')')
        return 0
    base = tempfile.mkdtemp(prefix='reprise_')
    try:
        d_ref = os.path.join(base, 'ref')
        code, ref, sortie = lancer(d_ref)
        assert code == 0 and ref, 'calcul de reference en echec : ' + sortie[-800:]
        print('reference :', [r[:12] for r in ref])
        d = os.path.join(base, 'pause')
        # pause apres 9 appels du modele : dans le 2e appel de l'echantillonneur (6 pas dense = 6 appels, puis creux)
        code, res, sortie = lancer(d, pause_apres=9)
        assert code == 77 and res is None, f'la pause devait quitter avec le code 77, recu {code} : ' + sortie[-600:]
        assert 'LOCAL_TRELLIS2_PAUSED' in sortie, 'marqueur de pause absent'
        assert os.path.isfile(os.path.join(d, 'fait_0.pt')), 'le 1er appel devait etre range'
        assert any(f.startswith('partiel_1') for f in os.listdir(d)), 'etat partiel du 2e appel absent'
        print('pause : code 77, points de reprise :', sorted(os.listdir(d)))
        os.remove(os.path.join(d, 'PAUSE'))
        code, res, sortie = lancer(d)
        assert code == 0 and res, 'la reprise a echoue : ' + sortie[-800:]
        assert 'repris sans recalcul' in sortie and 'repris au pas' in sortie, 'la reprise n\'a pas utilise les points : ' + sortie[-600:]
        assert res == ref, f'resultat different apres reprise : {res} != {ref}'
        print('reprise : resultat IDENTIQUE a un calcul ininterrompu ->', [r[:12] for r in res])
        # AUTO-APPRENTISSAGE des poids de la barre : le calcul de reference (d'une traite) a note ses durees ; la reprise (appels en cache) n'apprend rien
        f = os.path.join(base, 'progression_3d.json')
        assert os.path.isfile(f), 'progression_3d.json non ecrit apres un calcul d une traite'
        data = json.load(open(f, encoding='utf-8'))
        assert list(data) == ['simple'] and len(data['simple']) == 1 and len(data['simple'][0]) == 3 and abs(sum(data['simple'][0]) - 1) < 0.01, data
        print('apprentissage :', data)
        # recommencer() : meme mode, points de reprise gardes, le 1er appel est rendu depuis le disque
        code, res, sortie = lancer(os.path.join(base, 'recommencer'), recommencer=True)
        assert code == 0 and 'RECOMMENCER_EGAL True' in sortie and 'repris sans recalcul' in sortie, 'recommencer() : ' + sortie[-600:]
        print('recommencer : le 1er appel est rendu depuis le disque, resultat identique')
        print('OK')
        return 0
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
