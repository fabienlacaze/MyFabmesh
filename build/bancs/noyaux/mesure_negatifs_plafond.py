"""Mesure (24/10, plafond de negations 20) : jetons CLIP REELS du negatif final et nombre de blocs de 75 jetons de l'encodeur long, pour 0 / 8 / 12 / 20 / 21 termes
de l'utilisateur (1 a 4 mots), pour chaque type d'asset, avec les pieces de l'application (_ANATOMY_NEG, armes, ombres, cadrage...). Sans GPU, sans reseau :
le tokenizer CLIP est lu depuis le cache local, et le comptage passe par la MEME fonction que l'encodeur (_sdxl_prompt_utils._get_prompt_tokens_and_weights : la syntaxe
« (terme:1.4) » ne coute aucun jeton). Mesure aussi le temps de preparation (tokenisation + decoupage en blocs), pas celui du GPU (non mesurable ici).
Python de l'appli (transformers) : C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe build/bancs/noyaux/mesure_negatifs_plafond.py [--json sortie.json]
"""
import glob
import json
import os
import sys
import time
import types

ICI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, ICI)

TERMES = ['helmet', 'red cape', 'long sword', 'wooden round shield', 'gold crown', 'bare feet', 'leather belt', 'big blue eyes', 'iron chain mail', 'tall pointed hat',
          'torn flag', 'glowing magic staff', 'fur collar', 'rusty old dagger', 'stone wall', 'green scarf', 'silver ring', 'horns', 'long white beard', 'black leather boots',
          'small wings', 'metal bracers', 'spiked club', 'cloth hood', 'sharp claws']
POSITIFS = {'character': 'a tired orc warrior standing, full body, plain white background',
            'animal': 'a brown bear walking, full body, plain white background',
            'creature': 'a six-legged swamp creature with a long tail, full body, plain white background',
            'building': 'a small wooden watchtower, plain white background',
            'prop': 'a rusty iron lantern, plain white background'}


def tokenizer():
    from transformers import CLIPTokenizer
    for motif in ('C:/Users/Utilisateur/.cache/huggingface/hub/models--Lykon--dreamshaper-xl-lightning/snapshots/*/tokenizer',
                  'C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/hf_cache/hub/models--*/snapshots/*/tokenizer'):
        for d in sorted(glob.glob(motif)):
            if os.path.exists(os.path.join(d, 'vocab.json')):
                return CLIPTokenizer.from_pretrained(d, local_files_only=True)
    raise SystemExit('tokenizer CLIP introuvable dans le cache local')


def main():
    tok = tokenizer()
    if 'torch' not in sys.modules:
        _torch = types.ModuleType('torch')
        _torch.Generator = object
        sys.modules['torch'] = _torch
    from modal_app import _prompts as P
    from modal_app import _realvis as R
    from modal_app import _sdxl_prompt_utils as U
    sortie = []
    for typ in P.ASSET_TYPE_PROMPTS:
        texte = POSITIFS.get(typ, 'a simple object, plain white background')
        pos0 = P.build_enriched_prompt(texte, typ, 'realistic')
        for n in (0, 8, 12, 20, 21, 25):
            termes = TERMES[:n]
            t0 = time.perf_counter()
            pos, neg = R.build_prompts(pos0, typ, negatif_utilisateur=termes)
            ids_neg, _ = U._get_prompt_tokens_and_weights(tok, neg)
            ids_pos, _ = U._get_prompt_tokens_and_weights(tok, pos)
            ms = (time.perf_counter() - t0) * 1000
            blocs = lambda k: max(1, -(-k // 75))
            sortie.append({'type': typ, 'termes': n, 'neg_jetons': len(ids_neg), 'neg_blocs': blocs(len(ids_neg)), 'pos_jetons': len(ids_pos), 'pos_blocs': blocs(len(ids_pos)),
                           'ms_preparation': round(ms, 2), 'termes_dans_neg': sum(1 for t in termes if t in neg)})
    # ROUTE T-POSE : negatif = T.NEG + termes de l'utilisateur ajoutes a la fin SANS ponderation (_tpose.generate) ; et SCENARIO « budget de 77 jetons estimes leve » pour
    # text2image : les 5 pieces generiques que le budget ecarte des qu'il y a des termes (anti-doublement, cadrage, texte, personnages en trop, qualite) restent en queue.
    from modal_app import _tpose as T
    generiques = ('duplicate, twin, split image, collage, side by side, headshot, portrait, close-up, partial body, cropped, out of frame, '
                  'text, watermark, logo, user interface, extra characters, bystanders, blurry, deformed, bad anatomy')
    for typ in ('character', 'creature'):
        pos0 = P.build_enriched_prompt(POSITIFS[typ], typ, 'realistic')
        for n in (0, 8, 12, 20):
            termes = TERMES[:n]
            neg_t = T.NEG + (', ' + ', '.join(termes) if termes else '')
            ids_t, _ = U._get_prompt_tokens_and_weights(tok, neg_t)
            _, neg = R.build_prompts(pos0, typ, negatif_utilisateur=termes)
            ids_l, _ = U._get_prompt_tokens_and_weights(tok, neg + ', ' + generiques)
            sortie.append({'type': typ + ' [tpose]', 'termes': n, 'neg_jetons': len(ids_t), 'neg_blocs': max(1, -(-len(ids_t) // 75)), 'pos_jetons': 0, 'pos_blocs': 0,
                           'ms_preparation': 0.0, 'termes_dans_neg': n})
            sortie.append({'type': typ + ' [budget leve]', 'termes': n, 'neg_jetons': len(ids_l), 'neg_blocs': max(1, -(-len(ids_l) // 75)), 'pos_jetons': 0, 'pos_blocs': 0,
                           'ms_preparation': 0.0, 'termes_dans_neg': n})
    print('%-10s %6s %9s %9s %9s %9s %8s' % ('type', 'termes', 'neg_jet', 'neg_blocs', 'pos_jet', 'pos_blocs', 'ms'))
    for l in sortie:
        print('%-10s %6d %9d %9d %9d %9d %8.2f  (termes presents : %d)' % (l['type'], l['termes'], l['neg_jetons'], l['neg_blocs'], l['pos_jetons'], l['pos_blocs'],
                                                                           l['ms_preparation'], l['termes_dans_neg']))
    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8') as f:
            json.dump(sortie, f, ensure_ascii=False, indent=1)
    return sortie


if __name__ == '__main__':
    main()
