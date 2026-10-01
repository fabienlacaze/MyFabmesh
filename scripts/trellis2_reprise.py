"""Pause / reprise REELLES de la generation 3D (2026-10-01, demande du user : « je clique sur pause et ca fait une vraie pause en
liberant la RAM et tout, jusqu'a ce que je re-clique sur reprendre »).

Principe : le calcul 3D est une suite d'appels a l'echantillonneur (structure creuse, forme basse resolution, forme haute resolution,
texture) de 12 a 50 pas chacun. On remplace `FlowEulerSampler.sample` par une version qui
  - range le RESULTAT de chaque appel termine dans FABMESH_CKPT_DIR (fait_<n>.pt) : a la reprise, les appels deja faits sont rendus
    tels quels, sans recalcul (le code autour s'execute de nouveau, mais l'echantillonneur ne consomme aucun tirage aleatoire : la
    graine du pipeline donne donc exactement la meme suite) ;
  - regarde, avant CHAQUE pas, si le fichier PAUSE existe : si oui, il range l'etat courant (partiel_<n>.pt : numero de pas + x_t),
    ecrit LOCAL_TRELLIS2_PAUSED et QUITTE (code 77). Le processus disparait : VRAM et RAM sont entierement rendues.
Reprise : main.js relance le meme script avec le meme dossier ; l'appel interrompu repart au pas rangé.

Un dossier de reprise appartient a UN lancement : `meta.json` garde les arguments et le mode ; s'ils different, le dossier est vide.
"""
import json
import os
import sys
import time

CODE_PAUSE = 77
_etat = {'dir': None, 'n': 0, 'log': print, 'mode': '1024', 'pct': -1}

# AVANCEMENT PRECIS (user 2026-10-01 : « ca permet d'avoir une progress bar plus precise ») : entre 40 % (structure creuse) et 80 %
# (inference finie) la barre ne bougeait pas pendant ~5 min. Chaque pas de chaque appel fait avancer la barre ; poids = part du temps
# d'inference (estimee sur les mesures du 30/09 : la forme haute resolution et la texture dominent).
_PHASES_CASCADE = (('structure', 0.06), ('forme', 0.14), ('forme_fine', 0.42), ('texture', 0.38))
_PHASES_SIMPLE = (('structure', 0.08), ('forme', 0.47), ('texture', 0.45))


def _phases():
    return _PHASES_CASCADE if 'cascade' in str(_etat.get('mode') or '') else _PHASES_SIMPLE


def _annoncer_pas(n, i, steps):
    """Marqueurs lus par l'appli : la barre (LOCAL_TRELLIS2_PROGRESS) et l'etape ecrite sous la barre (LOCAL_TRELLIS2_STEP)."""
    phases = _phases()
    k = min(n, len(phases) - 1)
    avant = sum(w for _, w in phases[:k])
    frac = avant + phases[k][1] * (i + 1) / max(1, steps)
    pct = int(40 + 40 * min(1.0, frac))
    if pct != _etat['pct']:
        _etat['pct'] = pct
        print(f'LOCAL_TRELLIS2_PROGRESS: {pct} sampling', flush=True)
    print('LOCAL_TRELLIS2_STEP: ' + json.dumps({'phase': phases[k][0], 'pas': i + 1, 'total': int(steps)}), flush=True)


def _chemin(nom):
    return os.path.join(_etat['dir'], nom)


def _ecrire_atomique(nom, objet):
    import torch
    tmp = _chemin(nom + '.tmp')
    torch.save(objet, tmp)
    os.replace(tmp, _chemin(nom))


def _serialiser(x):
    if hasattr(x, 'feats') and hasattr(x, 'coords'):
        return {'k': 'sparse', 'f': x.feats.detach().cpu(), 'c': x.coords.detach().cpu()}
    return {'k': 'dense', 't': x.detach().cpu()}


def _restaurer(d, modele):
    """modele = le bruit passe a l'appel (donne le type et le peripherique)."""
    if d['k'] == 'sparse':
        dev = modele.feats.device
        return type(modele)(feats=d['f'].to(dev), coords=d['c'].to(dev))
    return d['t'].to(modele.device)


def _charger(nom, modele):
    import torch
    p = _chemin(nom)
    if not os.path.isfile(p):
        return None
    try:
        return torch.load(p, map_location='cpu', weights_only=False)
    except Exception as e:
        _etat['log'](f'reprise : point de reprise {nom} illisible ({type(e).__name__}) : calcul normal')
        try:
            os.remove(p)
        except OSError:
            pass
        return None


def reinitialiser(mode=None):
    """Vide le dossier (changement de mode : les appels ne se correspondent plus) et repart a zero."""
    if mode:
        _etat['mode'] = mode
    d = _etat.get('dir')
    if not d:
        _etat['n'] = 0
        return
    try:
        for f in os.listdir(d):
            if f.endswith('.pt') or f.endswith('.tmp') or f == 'meta.json':
                try:
                    os.remove(os.path.join(d, f))
                except OSError:
                    pass
    except OSError:
        pass
    _etat['n'] = 0


def _verifier_meta():
    """Le dossier ne sert que pour le MEME lancement (arguments, mode, image)."""
    img = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        st = os.stat(img)
        empreinte = [st.st_size, int(st.st_mtime)]
    except OSError:
        empreinte = None
    meta = {'argv': sys.argv[1:], 'mode': os.environ.get('FABMESH_TRELLIS2_NATIVE_MODE', '1024'), 'image': empreinte}
    p = _chemin('meta.json')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            ancien = json.load(f)
    except Exception:
        ancien = None
    if ancien is not None and ancien != meta:
        _etat['log']('reprise : dossier d\'un autre lancement, vide')
        reinitialiser()
    try:
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(meta, f)
    except OSError:
        pass


def installer(log=print):
    """A appeler une fois le pipeline importe. Sans FABMESH_CKPT_DIR : ne fait rien."""
    d = os.environ.get('FABMESH_CKPT_DIR') or None
    _etat.update(dir=d, n=0, log=log, mode=os.environ.get('FABMESH_TRELLIS2_NATIVE_MODE', '1024'), pct=-1)
    if d:
        os.makedirs(d, exist_ok=True)
        _verifier_meta()
    import numpy as np
    import torch
    from easydict import EasyDict as edict
    from tqdm import tqdm
    from trellis2.pipelines.samplers import flow_euler as fe

    @torch.no_grad()
    def sample(self, model, noise, cond=None, steps=50, rescale_t=1.0, verbose=True, tqdm_desc='Sampling', **kwargs):
        n = _etat['n']
        _etat['n'] = n + 1
        kwargs.pop('return_traj', None)          # jamais demande par le pipeline ; la reprise ne rejoue pas la trajectoire
        fait = _charger(f'fait_{n}.pt', noise) if _etat['dir'] else None
        if fait is not None:
            log(f'reprise : appel {n} deja calcule, repris sans recalcul')
            return edict({'samples': _restaurer(fait, noise), 'pred_x_t': [], 'pred_x_0': []})
        t_seq = np.linspace(1, 0, steps + 1)
        t_seq = rescale_t * t_seq / (1 + (rescale_t - 1) * t_seq)
        t_seq = t_seq.tolist()
        t_pairs = list((t_seq[i], t_seq[i + 1]) for i in range(steps))
        sample_courant = noise
        debut = 0
        part = _charger(f'partiel_{n}.pt', noise) if _etat['dir'] else None
        if part is not None and 0 <= int(part.get('pas', -1)) < steps:
            debut = int(part['pas'])
            sample_courant = _restaurer(part['x'], noise)
            log(f'reprise : appel {n} repris au pas {debut}/{steps}')
            try:
                os.remove(_chemin(f'partiel_{n}.pt'))
            except OSError:
                pass
        pause = _chemin('PAUSE') if _etat['dir'] else None
        for i in tqdm(range(debut, steps), desc=tqdm_desc, disable=not verbose, initial=debut, total=steps):
            if pause and os.path.exists(pause):
                _ecrire_atomique(f'partiel_{n}.pt', {'pas': i, 'x': _serialiser(sample_courant)})
                print(f'LOCAL_TRELLIS2_PAUSED: appel {n}, pas {i}/{steps}', flush=True)
                try:
                    sys.stdout.flush()
                    sys.stderr.flush()
                except Exception:
                    pass
                os._exit(CODE_PAUSE)             # le processus disparait : VRAM et RAM rendues
            t, t_prev = t_pairs[i]
            out = self.sample_once(model, sample_courant, t, t_prev, cond, **kwargs)
            sample_courant = out.pred_x_prev
            _annoncer_pas(n, i, steps)
        if _etat['dir']:
            _ecrire_atomique(f'fait_{n}.pt', _serialiser(sample_courant))
        return edict({'samples': sample_courant, 'pred_x_t': [], 'pred_x_0': []})

    fe.FlowEulerSampler.sample = sample
    log(f'sampler hook active (progress per step' + (f'; pause/resume checkpoints in {d})' if d else ')'))
    return True
