"""Banc BUREAU du detourage UNION Lucida + u2net (piste L, 2026-10-18) : le VRAI `_detourer_sujet` de
scripts/trellis2_native_full_pipeline.py, avec les VRAIS poids, sur la carte graphique de l'utilisateur, image par image.

A LANCER PAR LE PROPRIETAIRE (ou l'agent principal, sur son accord). Ce banc UTILISE LA CARTE (Lucida, dans un sous-processus : ~1 a 3 Go de VRAM
pendant quelques secondes par image) et lit les poids de u2net (176 Mo) et de Lucida (844 Mo) : il REFUSE de tourner sans `--oui-gpu`, et les tests
ne le lancent jamais avec. C'est le seul endroit ou la chaine bureau est exercee avec les vrais poids ; les tests (build/bancs/noyaux/
test_lucida_shims.py) n'ont qu'un faux modele de trois nombres.

    <python de l'appli> build/bancs/fidelite/detourage_union_bureau.py --oui-gpu [--images FICHIER_OU_DOSSIER ...] [--limite N] [--sortie DOSSIER]
    <python de l'appli> build/bancs/fidelite/detourage_union_bureau.py --a-blanc         (liste ce qui serait fait : aucun modele, aucune carte)

Images par defaut (celles du banc Modal modal_app/test_lucida_vs_u2net.py, a lancer depuis la racine de l'arbre principal, qui garde images/) : l'orc, les
quatre images A_avant / B_apres / C_libre de C:/tmp/fidelite/ab/orc1 et les paires de C:/tmp/fidelite/paires_r2 (RGB seulement : une image deja
detouree n'est pas masquee par la preparation d'image). `--limite` (12 par defaut) garde la duree et la charge de la carte raisonnables ; 0 = toutes.

Pour CHAQUE image, trois passes de `_detourer_sujet` (FABMESH_DETOURAGE = u2net, lucida, union) :
  - u2net  : l'ancien detourage (le resultat d'avant, a l'octet) ;
  - lucida : Lucida seul (le sous-processus de lucida_matte.py, repli u2net si indisponible) ;
  - union  : le defaut de la production.
Mesures : duree du sous-processus Lucida, pic de VRAM de PyTorch qu'il rapporte, aires de chaque masque, ce que l'union ajoute a u2net, LISERE
(epaisseur moyenne de ce que u2net ajoute le long du contour de Lucida : `_frange`, reprise de modal_app/test_lucida_union.py), controles (PASS / FAIL) :
  1. l'union contient les deux masques, pixel par pixel au seuil 127 ;
  2. l'union egale fusionner_alphas(u2net, Lucida) (tolerance de 2 niveaux : l'inference sur carte n'est pas deterministe a l'octet) ;
  3. Lucida a fonctionne (journal « detourage: lucida ») : sinon la chaine bureau n'est PAS validee (poids absents, code distant refuse...) ;
  4. le mode u2net n'a jamais sollicite Lucida.
Sortie : <sortie>/metriques.json et <sortie>/planche_N.png [original | u2net sur blanc | union sur blanc | ce que l'union ajoute (rouge)].
Code de sortie : 0 tout PASS ; 1 un FAIL ; 2 lancement refuse ; 3 Lucida n'a fonctionne sur AUCUNE image.
"""
import argparse
import ast
import json
import os
import re
import statistics
import sys
import time

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SCRIPTS = os.path.join(RACINE, 'scripts')
PIPELINE = os.environ.get('NOYAU_PIPELINE3D') or os.path.join(SCRIPTS, 'trellis2_native_full_pipeline.py')     # NOYAU_PIPELINE3D : copie (tests)
BANC_MODAL = os.path.join(RACINE, 'modal_app', 'test_lucida_union.py')
SEUIL = 127
FONCTIONS_PIPELINE = ('_detourer_sujet', '_masque_lucida_sous_processus')
RE_DUREE = re.compile(r'^detourage: lucida \((\d+(?:\.\d+)?) s\)$')
RE_PIC = re.compile(r'pic de VRAM PyTorch du sous-processus (\d+) Mo')


def extraire(chemin, noms):
    """Les fonctions de premier niveau `noms` du fichier, compilees telles quelles (ast) : le script du pipeline ne s'importe pas (il pose des plafonds
    de memoire et des variables d'environnement a l'import)."""
    with open(chemin, 'r', encoding='utf-8') as f:
        arbre = ast.parse(f.read(), chemin)
    trouvees = [n for n in arbre.body if isinstance(n, ast.FunctionDef) and n.name in noms]
    manquantes = set(noms) - {n.name for n in trouvees}
    if manquantes:
        raise SystemExit('fonction(s) introuvable(s) dans %s : %s' % (chemin, sorted(manquantes)))
    return compile(ast.Module(body=trouvees, type_ignores=[]), chemin, 'exec')


def images_par_defaut():
    """(nom, chemin) des images du banc Modal qui existent sur cette machine."""
    sortie = []
    orc = os.path.join(RACINE, 'images', 'verif_t80_orc', 'ref_0.png')
    if os.path.isfile(orc):
        sortie.append(('orc_verif_t80', orc))
    for bras in ('A_avant', 'B_apres', 'C_libre'):
        d = 'C:/tmp/fidelite/ab/orc1/' + bras
        if os.path.isdir(d):
            sortie += [('ab_%s_%s' % (bras, f[4:-4]), d + '/' + f) for f in sorted(os.listdir(d)) if f.startswith('ref_') and f.endswith('.png')]
    racine_p = 'C:/tmp/fidelite/paires_r2'
    if os.path.isdir(racine_p):
        for nom in sorted(os.listdir(racine_p)):
            p = os.path.join(racine_p, nom, 'ref.png')
            if os.path.isfile(p):
                sortie.append(('paire_' + nom, p))
    return sortie


def lister(chemins, limite):
    """Images demandees (fichiers ou dossiers) ou, sans argument, celles du banc Modal ; coupees a `limite` (0 = toutes)."""
    if chemins:
        images = []
        for c in chemins:
            if os.path.isdir(c):
                images += [(os.path.splitext(f)[0], os.path.join(c, f)) for f in sorted(os.listdir(c))
                           if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
            elif os.path.isfile(c):
                images.append((os.path.splitext(os.path.basename(c))[0], c))
            else:
                raise SystemExit('image ou dossier introuvable : %s' % c)
    else:
        images = images_par_defaut()
    return images[:limite] if limite else images


def main(argv=None):
    ap = argparse.ArgumentParser(description='Banc bureau du detourage union Lucida + u2net (utilise la carte graphique).')
    ap.add_argument('--oui-gpu', action='store_true', help='obligatoire : confirme que la carte graphique et les poids peuvent etre utilises')
    ap.add_argument('--a-blanc', action='store_true', help='liste les images et les passes, sans aucun modele ni carte')
    ap.add_argument('--images', nargs='*', default=[], help='fichiers ou dossiers (defaut : les images du banc Modal)')
    ap.add_argument('--limite', type=int, default=12, help='nombre maximal d\'images (0 = toutes ; defaut 12)')
    ap.add_argument('--sortie', default='C:/tmp/fidelite/lucida_union_bureau', help='dossier des mesures et des planches')
    a = ap.parse_args(argv)

    images = lister(a.images, a.limite)
    if a.a_blanc:
        print('%d image(s), 3 passes chacune (u2net, lucida, union), %d passage(s) de Lucida sur la carte :' % (len(images), 2 * len(images)))
        for nom, chemin in images:
            print('  %-34s %s' % (nom[:34], chemin))
        extraire(PIPELINE, FONCTIONS_PIPELINE)              # les fonctions existent dans le pipeline
        extraire(BANC_MODAL, ('_frange',))                  # la mesure du lisere existe dans le banc Modal
        print('a blanc : aucun modele charge, aucune carte utilisee')
        return 0
    if not a.oui_gpu:
        print('REFUSE : ce banc utilise la carte graphique et les poids de u2net et de Lucida. Relancer avec --oui-gpu (ou --a-blanc pour voir le plan).',
              file=sys.stderr)
        return 2
    if not images:
        print('aucune image : passer --images, ou lancer depuis la racine de l\'arbre principal (images/ et C:/tmp/fidelite/)', file=sys.stderr)
        return 2

    import numpy as np
    from PIL import Image, ImageDraw
    try:
        import cv2
    except Exception as e:                                  # pragma: no cover
        print('OpenCV est necessaire pour la mesure du lisere : %s' % e, file=sys.stderr)
        return 2

    sys.path.insert(0, SCRIPTS)                             # fusion_masques et le paquet rembg local (u2net par onnxruntime), comme dans le pipeline
    import fusion_masques as FM
    journal = []
    ns = {'os': os, 'sys': sys, 'time': time, 'SCRIPTS': SCRIPTS, 'log': journal.append}
    exec(extraire(PIPELINE, FONCTIONS_PIPELINE), ns)
    ns_banc = {}
    exec(extraire(BANC_MODAL, ('_frange',)), ns_banc)
    frange = ns_banc['_frange']
    detourer = ns['_detourer_sujet']

    def passe(chemin, mode):
        os.environ['FABMESH_DETOURAGE'] = mode
        del journal[:]
        t0 = time.time()
        with Image.open(chemin) as f:
            res = detourer(f, chemin)
        return np.asarray(res.convert('RGBA'))[..., 3], list(journal), time.time() - t0

    def sur_blanc(chemin, alpha):
        with Image.open(chemin) as f:
            rgb = f.convert('RGB')
        base = Image.new('RGB', rgb.size, (255, 255, 255))
        base.paste(rgb, (0, 0), Image.fromarray(alpha))
        return base

    os.makedirs(a.sortie, exist_ok=True)
    sortie, lignes_planche, verifications = {'images': [], 'verifications': []}, [], []
    T = 256

    def verifier(nom, ok, detail=''):
        verifications.append({'nom': nom, 'ok': bool(ok), 'detail': detail})
        print('[%s] %s %s' % ('PASS' if ok else 'FAIL', nom, detail), flush=True)

    sans_lucida, inclusion, fusion, sollicite = [], [], [], []
    for nom, chemin in images:
        with Image.open(chemin) as f:
            if f.mode == 'RGBA' and not (np.asarray(f)[..., 3] == 255).all():
                print('%-34s deja detoure (alpha utile) : ignore' % nom[:34])
                continue
        try:
            a_u2, j_u2, t_u2 = passe(chemin, 'u2net')
            a_lu, j_lu, t_lu = passe(chemin, 'lucida')
            a_un, j_un, t_un = passe(chemin, 'union')
        except Exception as e:                              # u2net qui leve : le meme echec qu'avant, a signaler et passer
            print('%-34s ECHEC : %s: %s' % (nom[:34], type(e).__name__, e))
            sans_lucida.append(nom)
            continue
        if any(l.startswith('detourage: lucida (') for l in j_u2):
            sollicite.append(nom)
        lucida_ok = any(l.startswith('detourage: lucida (') for l in j_un) and any(l.startswith('detourage: lucida (') for l in j_lu)
        e = {'nom': nom, 'taille': list(a_u2.shape[::-1]), 't_u2net_s': round(t_u2, 2), 't_lucida_s': round(t_lu, 2), 't_union_s': round(t_un, 2),
             'lucida_fonctionne': lucida_ok, 'journal_union': j_un}
        b_u2, b_lu, b_un = a_u2 >= SEUIL, a_lu >= SEUIL, a_un >= SEUIL
        e.update({'aire_u2net': round(float(b_u2.mean()), 4), 'aire_union': round(float(b_un.mean()), 4)})
        for l in j_un:
            m = RE_DUREE.match(l)
            if m:
                e['sous_processus_lucida_s'] = float(m.group(1))
            m = RE_PIC.search(l)
            if m:
                e['pic_vram_pytorch_mo'] = int(m.group(1))
        if lucida_ok:
            e['aire_lucida'] = round(float(b_lu.mean()), 4)
            e['ajout_vs_u2net'] = round(float((b_un & ~b_u2).sum() / max(int(b_u2.sum()), 1)), 4)
            e.update(frange(np, cv2, b_lu, b_un))
            if not ((b_u2 <= b_un).all() and (b_lu <= b_un).all()):
                inclusion.append(nom)
            ecart = int(np.abs(FM.fusionner_alphas(a_u2, a_lu).astype(int) - a_un.astype(int)).max())
            e['ecart_fusion'] = ecart
            if ecart > 2:
                fusion.append('%s (ecart %d)' % (nom, ecart))
            diff = np.zeros(b_un.shape + (3,), np.uint8) + 90
            diff[b_u2] = (235, 235, 235)
            diff[b_un & ~b_u2] = (230, 40, 40)
            etiquette = '%s | u2net %.1f %% | union %.1f %% (+%.1f %%) | lisere %.1f px | Lucida %.1f s' % (
                nom[:24], 100 * e['aire_u2net'], 100 * e['aire_union'], 100 * e['ajout_vs_u2net'], e['frange_epaisseur_px'], e.get('sous_processus_lucida_s', 0))
        else:
            sans_lucida.append(nom)
            diff = np.full(b_un.shape + (3,), 90, np.uint8)
            etiquette = '%s | LUCIDA N\'A PAS FONCTIONNE : %s' % (nom[:24], (j_un[-1] if j_un else '?')[:80])
        sortie['images'].append(e)
        print('%-34s u2net %5.1f %%  union %5.1f %%  %s' % (nom[:34], 100 * e['aire_u2net'], 100 * e['aire_union'],
                                                           ('lisere %.1f px, Lucida %.1f s, pic VRAM %s Mo' % (
                                                               e['frange_epaisseur_px'], e.get('sous_processus_lucida_s', 0), e.get('pic_vram_pytorch_mo', '?')))
                                                           if lucida_ok else 'Lucida indisponible : ' + (j_un[-1] if j_un else '?')), flush=True)
        ligne = Image.new('RGB', (T * 4, T + 14), (20, 20, 28))
        with Image.open(chemin) as f:
            panneaux = [f.convert('RGB'), sur_blanc(chemin, a_u2), sur_blanc(chemin, a_un), Image.fromarray(diff)]
        for k, p in enumerate(panneaux):
            ligne.paste(p.resize((T, T), Image.LANCZOS), (k * T, 14))
        ImageDraw.Draw(ligne).text((4, 1), etiquette, fill=(235, 235, 240))
        lignes_planche.append(ligne)

    for d0 in range(0, len(lignes_planche), 8):
        bloc = lignes_planche[d0:d0 + 8]
        feuille = Image.new('RGB', (T * 4, (T + 14) * len(bloc)), (20, 20, 28))
        for k, lg in enumerate(bloc):
            feuille.paste(lg, (0, k * (T + 14)))
        feuille.save(os.path.join(a.sortie, 'planche_%d.png' % (d0 // 8 + 1)))

    ok_lucida = [e for e in sortie['images'] if e['lucida_fonctionne']]
    verifier('le mode u2net ne sollicite jamais Lucida', not sollicite, str(sollicite[:5]))
    verifier('Lucida a fonctionne sur %d / %d images' % (len(ok_lucida), len(sortie['images'])), bool(ok_lucida) and not sans_lucida, str(sans_lucida[:5]))
    verifier('union >= chaque masque (inclusion au seuil 127)', not inclusion, str(inclusion[:5]))
    verifier('union == fusionner_alphas(u2net, Lucida) a 2 niveaux pres', not fusion, str(fusion[:5]))
    if ok_lucida:
        def med(cle):
            v = [e[cle] for e in ok_lucida if cle in e]
            return round(statistics.median(v), 3) if v else None
        sortie['resume'] = {'images_avec_lucida': len(ok_lucida), 'sous_processus_lucida_s_mediane': med('sous_processus_lucida_s'),
                            'pic_vram_pytorch_mo_median': med('pic_vram_pytorch_mo'), 'ajout_vs_u2net_median': med('ajout_vs_u2net'),
                            'frange_epaisseur_px_mediane': med('frange_epaisseur_px'), 'frange_epaisseur_px_max': max(e['frange_epaisseur_px'] for e in ok_lucida)}
        print('resume :', json.dumps(sortie['resume'], ensure_ascii=False))
    sortie['verifications'] = verifications
    with open(os.path.join(a.sortie, 'metriques.json'), 'w', encoding='utf-8') as f:
        json.dump(sortie, f, indent=1, ensure_ascii=False)
    print('mesures et planches dans', a.sortie)
    if not ok_lucida:
        return 3
    return 0 if all(v['ok'] for v in verifications) else 1


if __name__ == '__main__':
    sys.exit(main())
