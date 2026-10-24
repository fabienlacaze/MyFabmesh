"""Mesure du nombre de jetons CLIP REELS (tokenizer lu depuis le cache local, aucun reseau) des prompts que le serveur envoie a l'encodeur (24/10, chantier ingestion).

Pour chaque entree du corpus d'essai du proprietaire (reference anglaise + type), sans GPU ni torch (doublure) :
  - prompt positif de la generation d'image (build_enriched_prompt) et negatif (build_prompts, avec les negations de l'utilisateur) ;
  - route T-pose du site (personnages) : positif = prompt enrichi + queue, negatif = NEG + termes.
Rejouer sur un ancien exemplaire du depot : RACINE_DEPOT=<dossier avec modal_app/> python build/bancs/noyaux/mesure_jetons_clip.py [--json sortie.json]
Python de l'appli (transformers) : C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/python/python.exe
"""
import glob
import json
import os
import statistics
import sys
import types

ICI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RACINE = os.environ.get('RACINE_DEPOT') or ICI
CORPUS = os.environ.get('CORPUS_ESSAI') or 'C:/Users/Utilisateur/Documents/MyFabmesh_corrections_prompts_2026-10-24/corpus.json'
sys.path.insert(0, RACINE)

def tokenizer():
    from transformers import CLIPTokenizer
    for motif in ('C:/Users/Utilisateur/.cache/huggingface/hub/models--Lykon--dreamshaper-xl-lightning/snapshots/*/tokenizer',
                  'C:/Users/Utilisateur/AppData/Roaming/myfabmesh-ai/hf_cache/hub/models--*/snapshots/*/tokenizer'):
        for d in sorted(glob.glob(motif)):
            if os.path.exists(os.path.join(d, 'vocab.json')):
                return CLIPTokenizer.from_pretrained(d, local_files_only=True)
    raise SystemExit('tokenizer CLIP introuvable dans le cache local')


def main():
    tok = tokenizer()          # d'abord : transformers veut le VRAI torch (ou aucun)
    if 'torch' not in sys.modules:
        _torch = types.ModuleType('torch')
        _torch.Generator = object
        sys.modules['torch'] = _torch
    from modal_app import _prompts as P
    from modal_app import _realvis as R
    from modal_app import _tpose as T
    n = lambda t: max(0, len(tok(t).input_ids) - 2)   # sans <|startoftext|> / <|endoftext|>
    with open(CORPUS, encoding='utf-8') as f:
        corpus = json.load(f)
    vus, lignes = set(), []
    for e in corpus['entrees']:
        cle = (e['reference_en'], e['type'])
        if cle in vus or e['type'] not in P.ASSET_TYPE_PROMPTS or len(e['reference_en']) > 2000:
            continue
        vus.add(cle)
        texte, typ = e['reference_en'], e['type']
        enrichi = P.build_enriched_prompt(texte, typ, 'realistic')
        negs = P.negatifs_utilisateur(texte)
        pos, neg = R.build_prompts(P.build_enriched_prompt(P._epurer_demande(texte) if False else texte, typ, 'realistic'), typ, negatif_utilisateur=negs)
        ligne = {'id': e['id'], 'type': typ, 'pos': n(pos), 'neg': n(neg), 'negs': len(negs),
                 'negs_gardes': sum(1 for t in negs if ('(%s:' % t) in neg or t in neg)}
        if typ == 'character':
            q = getattr(T, 'queue_sans_doublons', None)
            queue = q(enrichi) if q else T.FRONT_PROMPT_TAIL
            ligne['tpose_pos'] = n(enrichi.rstrip('.,') + queue)
            ligne['tpose_neg'] = n(T.NEG)
        lignes.append(ligne)
    return lignes


if __name__ == '__main__':
    lignes = main()
    def stat(cle):
        v = [l[cle] for l in lignes if cle in l]
        return {'n': len(v), 'mediane': statistics.median(v), 'max': max(v), 'min': min(v)} if v else None
    resume = {'racine': RACINE, 'entrees': len(lignes), 'positif': stat('pos'), 'negatif': stat('neg'), 'tpose_positif': stat('tpose_pos'), 'tpose_negatif': stat('tpose_neg'),
              'termes_utilisateur': sum(l['negs'] for l in lignes), 'termes_gardes': sum(l['negs_gardes'] for l in lignes)}
    print(json.dumps(resume, ensure_ascii=False, indent=1))
    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8') as f:
            json.dump({'resume': resume, 'lignes': lignes}, f, ensure_ascii=False, indent=1)
