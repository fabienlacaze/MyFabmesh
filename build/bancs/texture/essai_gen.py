"""Lanceur AUTONOME des essais qui exigent une generation locale (#7 cuissons, #9 sampler, #12 marge de recadrage). N'ecrit ni dans scripts/ ni dans src/ ni dans les projets.
Importe scripts/trellis2_native_full_pipeline.py tel quel et y accroche, a l'execution seulement :
  - ESSAI_BAKES="1024,2048,4096" : o_voxel.postprocess.to_glb est appele une fois par taille d'atlas SUR LES MEMES VOXELS (memes arguments, meme graine) ; chaque cuisson brute est exportee
    (avant les retouches de couleur de l'appli) sous <sortie>/<etiquette>_atlas<taille>.glb avec ses secondes ; la derniere taille est celle que renvoie le pipeline ;
  - ESSAI_TEX_OVERRIDE='{"guidance_interval":[0.5,0.9]}' : surcharge des reglages de l'echantillonneur de texture (en plus de FABMESH_TEX_STEPS / GUIDANCE / RESCALE / RESCALE_T / CROP_PAD).
Usage : python essai_gen.py <etiquette> <image> <dossier_sortie>   (mode, graine, tailles : variables d'environnement FABMESH_TRELLIS2_NATIVE_MODE / _SEED / ESSAI_BAKES)."""
import json, os, sys, time

tag, image, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(outdir, exist_ok=True)
APPDATA = os.environ['APPDATA']
os.environ.setdefault('HF_HOME', APPDATA + '/myfabmesh-ai/hf_cache')
os.environ.setdefault('U2NET_HOME', APPDATA + '/myfabmesh-ai/ai-cache/u2net')
os.environ.setdefault('PYTHONUNBUFFERED', '1')
os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'     # aucun appel reseau (ni telechargement) : tout vient du cache local
SCRIPTS = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/scripts'
sys.path.insert(0, SCRIPTS)
bakes = [int(x) for x in os.environ.get('ESSAI_BAKES', '2048').split(',')]
ov = json.loads(os.environ.get('ESSAI_TEX_OVERRIDE', '{}'))
info = {'etiquette': tag, 'bakes': bakes, 'tex_override': ov, 'mode': os.environ.get('FABMESH_TRELLIS2_NATIVE_MODE', '1024'), 'seed': os.environ.get('FABMESH_TRELLIS2_NATIVE_SEED', '42'),
        'env_tex': {k: v for k, v in os.environ.items() if k.startswith('FABMESH_TEX_')}, 'cuissons': {}}
T0 = time.time()
import trellis2_native_full_pipeline as T       # noqa : le module ne lance rien a l'import (main() sous __main__)
import acceleration_glb

_orig_acc = acceleration_glb.accelerer_to_glb


def _acc(o_voxel, log=print):
    r = _orig_acc(o_voxel, log)
    import o_voxel.postprocess as pp
    real = pp.to_glb

    def multi(*a, **k):
        res = None
        for ts in bakes:
            t = time.time(); kk = dict(k); kk['texture_size'] = ts
            g = real(*a, **kk); dt = time.time() - t
            p = '%s/%s_atlas%d.glb' % (outdir, tag, ts)
            g.export(p, extension_webp=True)
            info['cuissons'][str(ts)] = {'secondes_to_glb': round(dt, 1), 'octets_glb': os.path.getsize(p), 'fichier': p}
            print('[essai_gen] cuisson %d : %.1fs ; %d octets' % (ts, dt, os.path.getsize(p)), flush=True)
            res = g
        return res
    pp.to_glb = multi
    return r


acceleration_glb.accelerer_to_glb = _acc

if ov:
    from trellis2.pipelines import Trellis2ImageTo3DPipeline as PL
    _orig_tex = PL.sample_tex_slat

    def _tex(self, cond, flow_model, shape_slat, sampler_params={}):
        p = dict(sampler_params); p.update(ov)
        print('[essai_gen] sample_tex_slat : parametres effectifs %s' % json.dumps(p), flush=True)
        info['tex_params_effectifs'] = p
        return _orig_tex(self, cond, flow_model, shape_slat, p)
    PL.sample_tex_slat = _tex

sys.argv = [SCRIPTS + '/trellis2_native_full_pipeline.py', image, '%s/%s_final_pipeline.glb' % (outdir, tag), str(max(bakes))]
try:
    T.main()
    info['statut'] = 'ok'
except SystemExit as e:
    info['statut'] = 'sortie code %s' % e.code
except Exception as e:
    import traceback; traceback.print_exc(); info['statut'] = 'erreur ' + type(e).__name__ + ' ' + str(e)[:200]
info['duree_totale_s'] = round(time.time() - T0, 1)
json.dump(info, open('%s/%s_info.json' % (outdir, tag), 'w'), indent=1, ensure_ascii=False)
print('[essai_gen] termine : %s en %.0fs' % (info['statut'], info['duree_totale_s']), flush=True)
