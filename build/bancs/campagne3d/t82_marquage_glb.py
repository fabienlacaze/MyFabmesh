"""Verifie que les GLB produits depuis un instant donne portent le marquage « genere par IA » (AI Act art. 50, 2026-10-03).

Usage : python build/bancs/campagne3d/t82_marquage_glb.py <epoch_secondes> [dossier]      (defaut : meshes/ du depot)
Code de sortie : 0 = tous marques, 1 = au moins un GLB non marque, 2 = aucun GLB recent trouve.
Les copies d'affichage (« _light », « .light/ ») et l'historique (« .history/ ») ne sont pas des livrables : ignorees.
"""
import json
import os
import struct
import sys

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
depuis = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
dossier = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RACINE, 'meshes')


def json_glb(chemin):
    with open(chemin, 'rb') as f:
        tete = f.read(20)
        if tete[:4] != b'glTF' or tete[16:20] != b'JSON':
            return None
        n = struct.unpack('<I', tete[12:16])[0]
        return json.loads(f.read(n).decode('utf-8'))


trouves = 0
non_marques = 0
for racine, dirs, fichiers in os.walk(dossier):
    dirs[:] = [d for d in dirs if d not in ('.history', '.light')]
    for nom in fichiers:
        if not nom.lower().endswith('.glb') or nom.lower().endswith('_light.glb'):
            continue
        chemin = os.path.join(racine, nom)
        if os.path.getmtime(chemin) < depuis:
            continue
        trouves += 1
        try:
            j = json_glb(chemin)
        except Exception as e:                         # fichier illisible : on le dit, c'est aussi un defaut
            print('ILLISIBLE  %s : %s' % (nom, e))
            non_marques += 1
            continue
        asset = (j or {}).get('asset', {})
        extras = asset.get('extras') or {}
        ok = extras.get('aiGenerated') is True and extras.get('aiActArticle50') is True and 'AI-generated' in str(asset.get('generator'))
        print('%-8s %-92s generator=%r' % ('MARQUE' if ok else 'NON', nom[:92], asset.get('generator')))
        if not ok:
            non_marques += 1
print('--- %d GLB recents, %d non marques' % (trouves, non_marques))
sys.exit(2 if trouves == 0 else (1 if non_marques else 0))
