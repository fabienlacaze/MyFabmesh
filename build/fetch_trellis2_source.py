"""Reconstitue external/TRELLIS2_win/src/trellis2 (la source Python de TRELLIS.2 EMBARQUEE dans l'installateur).

POURQUOI (2026-10-01) : ce dossier est ignore par git (copie imbriquee de microsoft/TRELLIS.2) ; la CI GitHub qui construit l'installateur sur un
serveur Windows (sans Smart App Control) ne l'avait donc PAS et fabriquait un installateur sans la 3D locale. Ce script le refait a l'identique :

    amont microsoft/TRELLIS.2 (commit epingle)
  + external_patches/TRELLIS2_win/src/trellis2/**   (nos correctifs : Blackwell, RAM, kaolin a la place de nvdiffrast...)
  + scripts/trellis2_kaolin_shim.py -> renderers/nvdiffrast_kaolin_compat.py   (couche Apache-2.0)

et VERIFIE le resultat contre build/trellis2_source.sha256 (empreinte de chaque .py de la copie de reference). Un ecart = echec : on ne livre
jamais une source differente de celle qui a ete testee.

    python build/fetch_trellis2_source.py                 # reconstitue puis verifie
    python build/fetch_trellis2_source.py --ecrire-empreintes   # (apres une retouche voulue) regenere le fichier d'empreintes
    python build/fetch_trellis2_source.py --verifier-seulement  # verifie le dossier existant sans rien telecharger
"""
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPOT = 'https://github.com/microsoft/TRELLIS.2'
COMMIT = '75fbf0183001ed9876c8dbb35de6b68552ee08bd'     # amont du 2026-06-05, sur lequel nos correctifs ont ete ecrits
DEST_DEFAUT = os.path.join(RACINE, 'external', 'TRELLIS2_win', 'src', 'trellis2')
PATCHES = os.path.join(RACINE, 'external_patches', 'TRELLIS2_win', 'src', 'trellis2')
SHIM = os.path.join(RACINE, 'scripts', 'trellis2_kaolin_shim.py')
EMPREINTES = os.path.join(RACINE, 'build', 'trellis2_source.sha256')


def empreintes(dossier):
    out = {}
    for racine, _dirs, fichiers in os.walk(dossier):
        if '__pycache__' in racine:
            continue
        for f in fichiers:
            if not f.endswith('.py'):
                continue
            p = os.path.join(racine, f)
            rel = os.path.relpath(p, dossier).replace(os.sep, '/')
            with open(p, 'rb') as fh:
                data = fh.read().replace(b'\r\n', b'\n')       # fins de ligne ignorees (git / Windows)
            out[rel] = hashlib.sha256(data).hexdigest()
    return out


def lire_reference():
    ref = {}
    with open(EMPREINTES, 'r', encoding='utf-8') as fh:
        for l in fh:
            l = l.strip()
            if l and not l.startswith('#'):
                h, rel = l.split('  ', 1)
                ref[rel] = h
    return ref


def verifier(dossier):
    ref, now = lire_reference(), empreintes(dossier)
    manque = sorted(set(ref) - set(now))
    en_trop = sorted(set(now) - set(ref))
    diff = sorted(k for k in ref if k in now and ref[k] != now[k])
    if manque or en_trop or diff:
        print('ECART avec la copie de reference :')
        for k in manque:
            print('  manque   :', k)
        for k in en_trop:
            print('  en trop  :', k)
        for k in diff:
            print('  different:', k)
        return False
    print(f'source TRELLIS.2 conforme a la reference : {len(now)} fichiers .py')
    return True


def reconstituer(dest):
    tmp = tempfile.mkdtemp(prefix='trellis2_amont_')
    try:
        subprocess.check_call(['git', 'init', '-q', tmp])
        subprocess.check_call(['git', '-C', tmp, 'remote', 'add', 'origin', DEPOT])
        subprocess.check_call(['git', '-C', tmp, 'fetch', '--depth', '1', '-q', 'origin', COMMIT])
        subprocess.check_call(['git', '-C', tmp, 'checkout', '-q', 'FETCH_HEAD'])
        amont = os.path.join(tmp, 'trellis2')
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.copytree(amont, dest, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        # correctifs a nous (par-dessus l'amont)
        n = 0
        for racine, _d, fichiers in os.walk(PATCHES):
            for f in fichiers:
                src = os.path.join(racine, f)
                rel = os.path.relpath(src, PATCHES)
                cible = os.path.join(dest, rel)
                os.makedirs(os.path.dirname(cible), exist_ok=True)
                shutil.copyfile(src, cible)
                n += 1
        # couche kaolin (Apache-2.0) a la place de nvdiffrast (licence non commerciale)
        cible = os.path.join(dest, 'renderers', 'nvdiffrast_kaolin_compat.py')
        os.makedirs(os.path.dirname(cible), exist_ok=True)
        shutil.copyfile(SHIM, cible)
        print(f'amont {COMMIT[:8]} + {n} fichier(s) de correctifs + couche kaolin -> {dest}')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', default=DEST_DEFAUT)
    ap.add_argument('--ecrire-empreintes', action='store_true')
    ap.add_argument('--verifier-seulement', action='store_true')
    a = ap.parse_args()
    if a.ecrire_empreintes:
        e = empreintes(a.dest)
        with open(EMPREINTES, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write('# empreintes SHA-256 (fins de ligne normalisees) de la source TRELLIS.2 embarquee ; voir build/fetch_trellis2_source.py\n')
            for k in sorted(e):
                fh.write(f'{e[k]}  {k}\n')
        print(f'{len(e)} empreintes ecrites dans {EMPREINTES}')
        return 0
    if not a.verifier_seulement:
        reconstituer(a.dest)
    return 0 if verifier(a.dest) else 1


if __name__ == '__main__':
    sys.exit(main())
