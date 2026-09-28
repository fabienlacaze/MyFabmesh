"""Aucun appel reseau a Hugging Face quand les modeles sont deja sur le disque.

POURQUOI (2026-09-28). Charger un modele par son NOM (« microsoft/TRELLIS.2-4B »)
fait interroger huggingface.co A CHAQUE generation pour verifier la version,
meme quand tous les fichiers sont en cache. Deux consequences :
  - le site promet « works offline once the models are downloaded » : faux ;
  - un antivirus qui inspecte le HTTPS (Kaspersky chez le user) presente son
    propre certificat, Python le refuse, et huggingface_hub NE RETOMBE PAS sur
    le cache pour une erreur SSL (il le fait pour une coupure reseau, pas pour
    SSLError / ProxyError). La generation 3D echouait a chaque essai.

On pose donc HF_HUB_OFFLINE=1 quand TOUT ce que le moteur va charger est sur
le disque — jamais sinon : un premier telechargement doit rester possible.

A appeler AVANT tout import de huggingface_hub, transformers ou diffusers : ces
bibliotheques lisent la variable a leur import.
"""
import json
import os


def _dossier_hub():
    for var in ('HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE'):
        if os.environ.get(var):
            return os.environ[var]
    home = os.environ.get('HF_HOME') or os.path.join(os.path.expanduser('~'), '.cache', 'huggingface')
    return os.path.join(home, 'hub')


def _instantanes(depot):
    """Dossiers snapshots/<revision> d'un depot en cache (liste vide si absent)."""
    base = os.path.join(_dossier_hub(), 'models--' + depot.replace('/', '--'), 'snapshots')
    try:
        return [os.path.join(base, s) for s in os.listdir(base)]
    except OSError:
        return []


def fichier_en_cache(depot, fichier):
    """Chemin local du fichier s'il est en cache, sinon None."""
    for snap in _instantanes(depot):
        chemin = os.path.join(snap, *fichier.split('/'))
        if os.path.isfile(chemin):
            return chemin
    return None


def _poids_presents(depot):
    for snap in _instantanes(depot):
        try:
            if any(f.endswith(('.safetensors', '.bin')) for f in os.listdir(snap)):
                return True
        except OSError:
            pass
    return False


def manquants_trellis2(config='pipeline.json', depot='microsoft/TRELLIS.2-4B'):
    """Ce qui manque au disque pour charger le pipeline TRELLIS-2 (liste vide =
    tout est la). Lit la config EN CACHE : elle nomme chaque sous-modele, dont
    ceux d'autres depots (« microsoft/TRELLIS-image-large/ckpts/... »), ainsi que
    l'extracteur d'image et le detoureur."""
    chemin = fichier_en_cache(depot, config)
    if not chemin:
        return [f'{depot}/{config}']
    try:
        with open(chemin, 'r', encoding='utf-8') as f:
            args = json.load(f)['args']
    except Exception as e:  # config illisible : on laisse le reseau decider
        return [f'{depot}/{config} ({e})']
    manque = []
    for v in (args.get('models') or {}).values():
        parties = str(v).split('/')
        # « org/depot/chemin » = autre depot ; « ckpts/x » = ce depot-ci
        # (meme regle que trellis2/models/__init__.py : from_pretrained)
        if len(parties) > 2:
            d, f = '/'.join(parties[:2]), '/'.join(parties[2:])
        else:
            d, f = depot, str(v)
        for ext in ('.json', '.safetensors'):
            if not fichier_en_cache(d, f + ext):
                manque.append(f'{d}/{f}{ext}')
    for cle in ('image_cond_model', 'rembg_model'):
        nom = ((args.get(cle) or {}).get('args') or {}).get('model_name')
        if nom and not (fichier_en_cache(nom, 'config.json') and _poids_presents(nom)):
            manque.append(nom)
    return manque


def hors_ligne_si_complet(manque, log=print):
    """Pose HF_HUB_OFFLINE=1 si rien ne manque. Rend True si hors ligne."""
    if os.environ.get('HF_HUB_OFFLINE') == '1':
        return True
    if manque:
        log(f'[hf] telechargement necessaire, reseau garde : {", ".join(manque[:4])}'
            + (f' (+{len(manque) - 4})' if len(manque) > 4 else ''))
        return False
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    log('[hf] modeles sur le disque : aucun appel reseau')
    return True
