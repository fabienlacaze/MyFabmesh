"""Rig COMPLET : pilote lance avec le python du rigger, cwd = depot SkinTokens.

    python rig_complet.py entree.glb sortie.glb [--tirages 3]

  1. N tirages du rigger IA (texture conservee, --use_transfer), modele
     charge UNE fois ; un tirage qui plante (sequence mal formee au decodage,
     constate) est simplement ecarte.
  2. Note de completude de chaque tirage (squelette_complet.noter) : on garde
     le meilleur — ce qui regle deja les membres oublies.
  3. Completion generique du squelette (bouts de membres, extremites sans os,
     tronc sans os), greffee dans le GLB texture.
  4. L'IA recalcule la PEAU sur ce squelette (--use_skeleton --use_transfer).

JAMAIS PIRE QU'AVANT : si la completion ou la peau echoue, la sortie est le
meilleur tirage de l'IA ; si aucun tirage n'aboutit, code de sortie 3 et
l'appelant rejoue l'ancien chemin (un seul demo.py).

Fichier PARTAGE : source scripts/rig_complet.py, copie identique
modal_app/squelette/rig_complet.py (build/check-noyaux-partages.mjs).
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path


def journal(msg):
    print(f'[rig-complet] {msg}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entree')
    ap.add_argument('sortie')
    ap.add_argument('--tirages', type=int, default=3)
    a = ap.parse_args()
    t0 = time.time()
    entree = Path(a.entree).resolve()
    sortie = Path(a.sortie).resolve()
    sys.path.insert(0, os.getcwd())                                  # demo.py du rigger
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # squelette_complet
    import demo
    import squelette_complet as sq

    demo.start_bpy_server()
    demo.wait_for_bpy_server()
    ckpt = demo.MODEL_CKPTS[0]
    tmp = Path(tempfile.mkdtemp(prefix='rig_complet_'))

    def rigger(fichier, dest, squelette_impose):
        demo.run_rig([Path(fichier)], 5, 0.95, 1.0, 2.0, 10, squelette_impose, True, False,
                     [Path(dest)], ckpt, None)
        return Path(dest).is_file() and Path(dest).stat().st_size > 0

    # 1. tirages
    tirages = []
    for i in range(max(1, a.tirages)):
        dest = tmp / f'tirage_{i}.glb'
        try:
            if rigger(entree, dest, False):
                tirages.append(dest)
            else:
                journal(f'tirage {i + 1} : aucun fichier')
        except Exception as e:
            journal(f'tirage {i + 1} ecarte : {type(e).__name__}: {str(e)[:200]}')
    journal(f'{len(tirages)} tirage(s) valide(s) en {time.time() - t0:.0f} s')
    if not tirages:
        sys.exit(3)

    # 2. meilleur tirage (repli immediat si l'analyse du maillage echoue)
    compte_rendu = {'tirages': len(tirages)}
    meilleur = tirages[0]
    try:
        vol = sq.volume(str(entree))
        lignes = sq.extremites(vol)
        notes = []
        for f in tirages:
            J, _, _ = sq.squelette_du_glb(str(f))
            notes.append((sq.noter(vol, lignes, J), f))
        notes.sort(key=lambda t: sq.cle_de_note(t[0]), reverse=True)
        note_ia, meilleur = notes[0]
        journal(f'{len(lignes)} extremites ; meilleur tirage : portee {note_ia["portee_moy"]:.2f}, '
                f'{note_ia["complets"]}/{note_ia["n"]} completes, {note_ia["rates"]} ratees')
        compte_rendu.update({'extremites': [[round(float(x), 5) for x in P[-1]] for P in lignes],
                             'note_ia': note_ia})
    except Exception as e:
        journal(f'analyse du maillage impossible, meilleur = premier tirage : {type(e).__name__}: {e}')
        shutil.copyfile(meilleur, sortie)
        return

    # 3 + 4. completion puis peau par l'IA
    final = meilleur
    try:
        J, parents, noms = sq.squelette_du_glb(str(meilleur))
        J2, parents2, noms2, rapport = sq.completer(vol, lignes, J, parents, noms)
        compte_rendu['completion'] = rapport
        if len(J2) > len(J):
            journal(f'completion : {len(J)} -> {len(J2)} os')
            arm = tmp / 'armature.glb'
            sq.greffer(str(entree), J2, parents2, noms2, str(arm))
            dest = tmp / 'complet.glb'
            if rigger(arm, dest, True):
                J3, _, _ = sq.squelette_du_glb(str(dest))
                note_c = sq.noter(vol, lignes, J3)
                journal(f'peau IA sur le squelette complete : {len(J3)} os, portee {note_c["portee_moy"]:.2f}, '
                        f'{note_c["complets"]}/{note_c["n"]} completes')
                # garde-fou : on ne rend le complete que s'il fait mieux
                if sq.cle_de_note(note_c) >= sq.cle_de_note(note_ia):
                    final = dest
                    compte_rendu['note_finale'] = note_c
                else:
                    journal('complete moins bon que l\'IA seule : on garde l\'IA')
            else:
                journal('peau IA : aucun fichier, on garde le meilleur tirage')
        else:
            journal('squelette de l\'IA deja complet')
    except Exception as e:
        journal(f'completion abandonnee, on garde le meilleur tirage : {type(e).__name__}: {str(e)[:300]}')

    shutil.copyfile(final, sortie)
    try:
        sq.ajouter_extras(str(sortie), compte_rendu)
    except Exception as e:
        journal(f'compte rendu non ecrit dans le GLB : {e}')
    journal(f'TERMINE en {time.time() - t0:.0f} s ({"complete" if final != meilleur else "IA seule"})')


if __name__ == '__main__':
    # Garde OBLIGATOIRE : sous Windows, chaque worker du DataLoader reimporte
    # ce script ; sans elle, chacun relancerait le serveur bpy (port deja pris)
    # — constate le 2026-09-26, ~4 Go de processus laisses sur le poste.
    main()
