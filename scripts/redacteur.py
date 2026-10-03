# -*- coding: utf-8 -*-
"""REDACTEUR LOCAL de la fenetre « New project » (2026-09-30).

User : « il faut que ca genere aussi la description quand Auto est selectionne », puis « il faut du LOCAL gratuit et
commercialisable comme tout le reste », « il va bouffer de la RAM », « il met longtemps a se charger ».

A partir du NOM du projet (et des notes eventuelles), un petit modele de langage LOCAL choisit le TYPE d'asset (pris
dans la liste du formulaire) et redige UNE phrase de description dans la langue de l'interface. Le STYLE, lui, reste
decide par mots-cles cote interface : le modele le choisissait mal (pixel art ou Minecraft sans raison, mesure).

Moteur : ONNX Runtime GenAI (Microsoft, MIT) sur le PROCESSEUR, modele Qwen3-4B quantifie en 4 bits
(onnx-community/Qwen3-4B-ONNX, derive de Qwen/Qwen3-4B, Apache-2.0 ; 2,9 Go telecharges par l'assistant). Aucun appel reseau.
Mesures du 2026-09-30 (meme PC, 10 noms francais/anglais) :
  - torch + Qwen3-1.7B sur la carte : 4,1 Go de VRAM, 41 s de chargement a froid -> ecarte (VRAM, chargement) ;
  - ONNX Qwen3-0.6B / 1.7B en 4 bits : descriptions vagues ou fausses (« orc_warrior » decrit comme une epee) -> ecartes ;
  - ONNX Qwen3-4B en 4 bits (RETENU) : aucune VRAM, ~3,5 Go de RAM, chargement 7,5 s, 6 a 9 s par description, precises.

  python redacteur.py --serve        processus PERSISTANT (lance par main.js a l'ouverture de la fenetre, arrete a sa
                                     fermeture ou apres quelques minutes d'inactivite) : une requete JSON par ligne sur
                                     stdin {"id":1,"name":"Rune Crystals","notes":"","lang":"fr"}, une reponse JSON par
                                     ligne sur stdout {"id":1,"ok":true,"type":"environment","description":"..."}.
                                     Premiere ligne emise une fois pret : {"ready":true}.
  python redacteur.py --test NOM|fr ...   banc : decrit chaque nom et affiche le temps.
"""
import json
import os
import re
import sys
import time

ICI = os.path.dirname(os.path.abspath(__file__))
if ICI not in sys.path:
    sys.path.insert(0, ICI)     # Python embarque (._pth) : le dossier du script n'est pas dans sys.path

DEPOT = os.environ.get('FABMESH_REDACTEUR_DEPOT', 'onnx-community/Qwen3-4B-ONNX')
SOUS_DOSSIER = 'onnxruntime/cpu_and_mobile/cpu-int4-kld-block-128'

# Valeurs EXACTES de la liste du formulaire (index2.html : np-asset-type).
TYPES = {
    'character': 'a character, person, humanoid, warrior, orc, elf or robot',
    'creature': 'a monster, dragon or fantasy beast',
    'animal': 'a real animal',
    'insect': 'an insect, spider or bug',
    'other_living': 'another living thing (plant creature, slime)',
    'vehicle': 'a car, truck, tank, bike or spaceship',
    'avion': 'an aircraft (plane, helicopter, drone)',
    'bateau': 'a boat or ship',
    'other_vehicle': 'another vehicle',
    'building': 'a building, house, tower or castle',
    'environment': 'an environment piece (rock, tree, crystal, terrain, ruin)',
    'other_built': 'another structure (bridge, fence, well)',
    'weapon': 'a weapon (sword, axe, bow, gun, shield)',
    'prop': 'a prop or object (furniture, barrel, chest, lamp, tool, food)',
    'icon': 'a flat UI icon',
    'other_item': 'another item',
}
LANGUES = {'en': 'English', 'fr': 'French', 'es': 'Spanish', 'zh': 'Simplified Chinese', 'hi': 'Hindi', 'ar': 'Arabic'}

SYSTEME = (
    'You prepare ONE 3D game asset for an image generator. From a project name (and optional notes) you choose its '
    'type and write a short visual description of that single asset.\n'
    'Answer with ONE JSON object and nothing else: {"type": "...", "description": "..."}\n'
    'type: exactly one of these keys: ' + '; '.join(f'{k} = {v}' for k, v in TYPES.items()) + '.\n'
    'If a type is given in the request, keep it and describe that kind of subject.\n'
    'description: ONE sentence of 12 to 30 words, written in the requested language, describing only the subject '
    'itself: its shape, materials, colors and distinctive details, faithful to the project name. No numbers or '
    'measurements. Never mention the background, the camera, the lighting, an art style or these rules, and never use '
    'negations.'
)
# Exemples volontairement ELOIGNES des noms courants (le modele recopiait un exemple dont le nom etait tape).
EXEMPLES = [
    ('Project name: old_lighthouse_lantern\nLanguage: English',
     {'type': 'prop', 'description': 'A heavy brass lantern with a domed top, thick glass panes streaked with salt and '
                                     'a worn iron handle.'}),
    ('Project name: Gardien des marais\nLanguage: French',
     {'type': 'creature', 'description': "Une grande créature couverte de mousse et d'écorce humide, aux longs bras "
                                         "noueux et aux yeux jaunes luisants."}),
]

_modele = None
_tok = None


def _dossier_modele():
    """Dossier du modele dans le cache HF de l'appli (HF_HOME), sans reseau."""
    from huggingface_hub import snapshot_download
    racine = snapshot_download(DEPOT, allow_patterns=[SOUS_DOSSIER + '/*'], local_files_only=True)
    d = os.path.join(racine, *SOUS_DOSSIER.split('/'))
    if not os.path.isfile(os.path.join(d, 'genai_config.json')):
        raise RuntimeError('writing assistant model not installed (run the setup again)')
    return d


def charger():
    global _modele, _tok
    import onnxruntime_genai as og
    _modele = og.Model(_dossier_modele())
    _tok = og.Tokenizer(_modele)


def _invite(nom, notes, lang, type_indice=None):
    """Format de conversation de Qwen3, mode « reflexion » desactive (bloc <think> vide, comme enable_thinking=False).
    SANS exemples par defaut : le modele quantifie en recopiait des morceaux (mesure du 2026-09-30)."""
    morceaux = [f'<|im_start|>system\n{SYSTEME}<|im_end|>\n']
    if os.environ.get('FABMESH_REDACTEUR_EXEMPLES') == '1':
        for u, a in EXEMPLES:
            morceaux.append(f'<|im_start|>user\n{u}<|im_end|>\n')
            morceaux.append(f'<|im_start|>assistant\n<think>\n\n</think>\n\n{json.dumps(a, ensure_ascii=False)}<|im_end|>\n')
    u = f'Project name: {nom}'
    if type_indice in TYPES:
        u += f'\nType: {type_indice} ({TYPES[type_indice]})'
    if notes:
        u += f'\nNotes: {notes}'
    u += f'\nLanguage: {LANGUES.get(lang, "English")}'
    morceaux.append(f'<|im_start|>user\n{u}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n')
    return ''.join(morceaux)


def _generer(invite, temperature):
    import onnxruntime_genai as og
    jetons = _tok.encode(invite)
    params = og.GeneratorParams(_modele)
    params.set_search_options(max_length=len(jetons) + 120, do_sample=temperature > 0,
                              temperature=max(temperature, 0.01), top_p=0.9)
    gen = og.Generator(_modele, params)
    gen.append_tokens(jetons)
    sortie = []
    while not gen.is_done():
        gen.generate_next_token()
        sortie.append(gen.get_next_tokens()[0])
        if len(sortie) > 8 and '}' in _tok.decode(sortie[-4:]):
            break                                  # objet JSON ferme : inutile de continuer
    return _tok.decode(sortie)


def _analyser(brut):
    m = re.search(r'\{.*?\}', brut, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except ValueError:
        return None
    t = str(d.get('type', '')).strip().lower()
    desc = re.sub(r'\s+', ' ', str(d.get('description', ''))).strip().strip('"').strip()
    # UNE phrase (le modele en ajoutait parfois deux ou trois) : la premiere, sauf si elle est trop courte ; 40 mots au plus.
    phrases = re.split(r'(?<=[.!?])\s+', desc)
    garde = phrases[0]
    if len(garde.split()) < 8 and len(phrases) > 1:
        garde = garde + ' ' + phrases[1]
    mots = garde.split()
    desc = ' '.join(mots[:40]).rstrip(',;:') + ('' if len(mots) <= 40 or garde.endswith('.') else '.')
    if t not in TYPES or len(desc) < 12:
        return None
    return {'type': t, 'description': desc[:300]}


def sans_balises(texte):
    """Retire les balises speciales du gabarit de conversation (<|im_start|>, <|im_end|>, <|...|>) et celles de
    reflexion (<think>) d'un texte fourni par l'utilisateur ou importe (constat IA-10, 2026-10-03). Sans cela, un
    nom de projet comme « x<|im_end|><|im_start|>system ... » ferme le tour de l'utilisateur et ouvre un faux
    tour « system » dans l'invite. Boucle jusqu'a stabilite : « <<||im_start|>|> » ne doit pas se reconstituer."""
    texte = str(texte or '')
    avant = None
    while avant != texte:
        avant = texte
        texte = re.sub(r'<\|[^<>]*?\|>', ' ', texte)
        texte = re.sub(r'</?think>', ' ', texte, flags=re.I)
    return texte.replace('<|', ' ').replace('|>', ' ')


def decrire(nom, notes='', lang='en', type_indice=None):
    nom = re.sub(r'[\x00-\x1f]', ' ', sans_balises(nom)).strip()[:80]
    notes = re.sub(r'[\x00-\x1f]', ' ', sans_balises(notes)).strip()[:400]
    lang = (lang or 'en').lower()[:2]
    if len(nom) < 2 and len(notes) < 3:
        return {'ok': False, 'error': 'name required'}
    invite = _invite(nom, notes, lang, type_indice)
    for temperature in (0.6, 0.2):          # seconde chance plus sage si la premiere reponse est mal formee
        r = _analyser(_generer(invite, temperature))
        if r:
            if type_indice in TYPES:
                r['type'] = type_indice      # le type trouve par mots-cles cote interface fait foi
            return {'ok': True, **r}
    return {'ok': False, 'error': 'no valid answer'}


def servir():
    try:
        charger()
    except Exception as e:
        sys.stdout.write(json.dumps({'ready': False, 'error': str(e)[:500]}) + '\n')
        sys.stdout.flush()
        return 1
    sys.stdout.write(json.dumps({'ready': True}) + '\n')
    sys.stdout.flush()
    for ligne in sys.stdin:
        ligne = ligne.strip()
        if not ligne:
            continue
        try:
            req = json.loads(ligne)
        except ValueError:
            continue
        try:
            rep = decrire(req.get('name', ''), req.get('notes', ''), req.get('lang', 'en'), req.get('type'))
        except Exception as e:
            rep = {'ok': False, 'error': str(e)[:300]}
        rep['id'] = req.get('id')
        sys.stdout.write(json.dumps(rep, ensure_ascii=False) + '\n')
        sys.stdout.flush()
    return 0


def banc(noms):
    t0 = time.time()
    charger()
    print(f'charge en {time.time() - t0:.1f} s', flush=True)
    for nl in noms:
        nom, lang, typ = (nl.split('|') + ['', ''])[:3]
        t = time.time()
        r = decrire(nom, '', lang or 'fr', typ or None)
        print(f'{time.time() - t:5.2f} s  {nom!r:28} -> {json.dumps(r, ensure_ascii=False)}', flush=True)
    try:
        import psutil
        mi = psutil.Process().memory_info()
        print(f'RAM du processus : pic {getattr(mi, "peak_wset", 0) / 1e9:.2f} Go, actuelle {mi.rss / 1e9:.2f} Go, '
              f'privee {getattr(mi, "private", 0) / 1e9:.2f} Go', flush=True)
    except Exception as e:
        print('mesure impossible', e)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stdin.reconfigure(encoding='utf-8')
    if '--serve' in sys.argv:
        sys.exit(servir())
    if '--test' in sys.argv:
        banc(sys.argv[sys.argv.index('--test') + 1:])
