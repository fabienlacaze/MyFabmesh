"""Rig COMPLET : pilote lance avec le python du rigger, cwd = depot SkinTokens.

    python rig_complet.py entree.glb sortie.glb [--tirages 3]
                          [--points points.json --graine G --tirage T]

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

GRAINE (2026-09-26) : chaque tirage i est seme avec `graine + i`, et la graine
comme le tirage retenu sont ranges dans le GLB. L'editeur de points les
renvoie : le rig refait avec les points de l'utilisateur rejoue le MEME tirage
de l'IA — seul ce que l'utilisateur a demande change, pas le reste du
squelette (les tirages varient beaucoup d'une fois a l'autre).

MODE POINTS (--points) : les extremites detectees sont remplacees par les
points de l'utilisateur. Echec EXPLICITE (code 4) si la completion echoue :
rendre le rig de l'IA seule ignorerait sans le dire ce qu'il a demande.

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


def semer(graine):
    """Tirage reproductible : le decodage echantillonne (torch) et le chargeur
    de donnees seme ses processus depuis le generateur torch principal."""
    import random
    import numpy as np
    import torch
    random.seed(graine)
    np.random.seed(graine % (2 ** 32))
    torch.manual_seed(graine)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(graine)


def lire_points(chemin):
    points = json.load(open(chemin, encoding='utf-8'))
    if not isinstance(points, list) or not points:
        raise ValueError('points : liste non vide attendue')
    return [[float(c) for c in p][:3] for p in points]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entree')
    ap.add_argument('sortie')
    ap.add_argument('--tirages', type=int, default=3)
    ap.add_argument('--points', help='JSON : liste de [x, y, z] (editeur de points)')
    ap.add_argument('--graine', type=int, default=None)
    ap.add_argument('--tirage', type=int, default=None,
                    help='rejouer d\'abord ce tirage (graine + tirage) : celui du rig edite')
    a = ap.parse_args()
    t0 = time.time()
    entree = Path(a.entree).resolve()
    sortie = Path(a.sortie).resolve()
    points = lire_points(a.points) if a.points else None
    graine = a.graine if a.graine is not None else int.from_bytes(os.urandom(4), 'little') & 0x7fffffff
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

    def tirer(i):
        dest = tmp / f'tirage_{i}.glb'
        try:
            semer(graine + i)
            if rigger(entree, dest, False):
                return dest
            journal(f'tirage {i + 1} : aucun fichier')
        except Exception as e:
            journal(f'tirage {i + 1} ecarte : {type(e).__name__}: {str(e)[:200]}')
        return None

    # 1. tirages. Rig edite : son tirage d'abord, seul s'il se reproduit.
    tirages = []   # (indice, fichier)
    if a.tirage is not None and a.tirage >= 0:
        f = tirer(a.tirage)
        if f:
            tirages.append((a.tirage, f))
        else:
            journal('tirage du rig edite non reproduit : tirages ordinaires')
    if not tirages:
        for i in range(max(1, a.tirages)):
            if i == a.tirage:
                continue
            f = tirer(i)
            if f:
                tirages.append((i, f))
    journal(f'{len(tirages)} tirage(s) valide(s) en {time.time() - t0:.0f} s (graine {graine})')
    if not tirages:
        sys.exit(3)

    # 2. meilleur tirage (repli immediat si l'analyse du maillage echoue)
    compte_rendu = {'tirages': len(tirages), 'graine': graine}
    retenu, meilleur = tirages[0]
    try:
        vol = sq.volume(str(entree))
        lignes_auto = sq.extremites(vol)
        lignes = sq.lignes_vers_points(vol, points) if points else lignes_auto
        notes = []
        for i, f in tirages:
            J, _, _ = sq.squelette_du_glb(str(f))
            notes.append((sq.noter(vol, lignes, J), i, f))
        notes.sort(key=lambda t: sq.cle_de_note(t[0]), reverse=True)
        note_ia, retenu, meilleur = notes[0]
        if points:
            journal(f'{len(points)} point(s) de l\'utilisateur, dont '
                    f'{sum(P is None for P in lignes)} dans le tronc')
        journal(f'{len(lignes)} extremites ; meilleur tirage : portee {note_ia["portee_moy"]:.2f}, '
                f'{note_ia["complets"]}/{note_ia["n"]} completes, {note_ia["rates"]} ratees')
        compte_rendu.update({
            # ce que l'editeur de points affichera : les points de
            # l'utilisateur s'il en a donne, sinon les pointes detectees
            'extremites': ([[round(float(x), 5) for x in p] for p in points] if points
                           else [[round(float(x), 5) for x in P[-1]] for P in lignes]),
            'points_utilisateur': bool(points),
            'note_ia': note_ia})
    except Exception as e:
        if points:
            journal(f'ECHEC : analyse du maillage impossible, points non appliques : {type(e).__name__}: {e}')
            sys.exit(4)
        journal(f'analyse du maillage impossible, meilleur = premier tirage : {type(e).__name__}: {e}')
        shutil.copyfile(meilleur, sortie)
        return
    compte_rendu['tirage_retenu'] = retenu

    # 3 + 4. completion puis peau par l'IA
    final = meilleur
    try:
        J, parents, noms = sq.squelette_du_glb(str(meilleur))
        try:
            influence = sq.influence_du_rig(str(meilleur))
        except Exception as e:
            journal(f'peau du tirage illisible, rattachement au plus proche : {e}')
            influence = None
        J2, parents2, noms2, rapport = sq.completer(vol, lignes, J, parents, noms, influence,
                                                    pointes=points)
        compte_rendu['completion'] = rapport
        if len(J2) > len(J):
            journal(f'completion : {len(J)} -> {len(J2)} os')
            arm = tmp / 'armature.glb'
            sq.greffer(str(entree), J2, parents2, noms2, str(arm))
            dest = tmp / 'complet.glb'
            semer(graine + 1000)
            if rigger(arm, dest, True):
                J3, _, _ = sq.squelette_du_glb(str(dest))
                note_c = sq.noter(vol, lignes, J3)
                journal(f'peau IA sur le squelette complete : {len(J3)} os, portee {note_c["portee_moy"]:.2f}, '
                        f'{note_c["complets"]}/{note_c["n"]} completes')
                # garde-fou : on ne rend le complete que s'il fait mieux —
                # sauf en mode points, ou c'est ce que l'utilisateur a demande
                if points or sq.cle_de_note(note_c) >= sq.cle_de_note(note_ia):
                    final = dest
                    compte_rendu['note_finale'] = note_c
                else:
                    journal('complete moins bon que l\'IA seule : on garde l\'IA')
            elif points:
                journal('ECHEC : peau IA sans resultat, points non appliques')
                sys.exit(4)
            else:
                journal('peau IA : aucun fichier, on garde le meilleur tirage')
        else:
            journal('squelette de l\'IA deja complet')
    except Exception as e:
        if points:
            journal(f'ECHEC : completion impossible, points non appliques : {type(e).__name__}: {str(e)[:300]}')
            sys.exit(4)
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
