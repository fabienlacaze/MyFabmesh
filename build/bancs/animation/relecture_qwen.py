"""RELECTURE + CORRECTION d'une allure de course par Qwen3.6 (app Modal `myfabmesh-reglage-gpu`, methode `voir`), sur PLUSIEURS rigs.

    PYTHONUTF8=1 python build/bancs/animation/relecture_qwen.py --allure sprint --rigs a.glb b.glb ... [--tours 6] [--sortie dossier]

A chaque tour : le moteur anime chaque rig avec les leviers courants (mesures_course.mjs), on note le realisme (relecture_noyau.note),
on dessine les squelettes d'un rig (profil + face, sans navigateur), Qwen3.6 regarde les images et les violations mesurees et propose
des changements de leviers ; ils sont valides et bornes (relecture_noyau.valider_changements), puis GARDES SEULEMENT s'ils ameliorent
la moyenne sans degrader un rig (relecture_noyau.decider). Sinon on revient au meilleur et le refus est rappele au modele.

Robustesse : reponse illisible -> redemande (2 fois) avec le message d'erreur ; appel Modal en echec -> 3 essais espaces ; rendu en echec ->
le tour continue sur les seuls chiffres ; mesure en echec sur un rig -> ce rig vaut 10 (le candidat ne peut pas gagner) ; patience :
arret apres 3 refus d'affilee ; journal JSON ecrit a chaque tour (reprise possible avec --reprendre).
Le moteur n'est JAMAIS modifie : la sortie est une proposition de leviers (proposition.json) a relire puis a reporter a la main dans COURSE_DEFAUT.
Cout : ~10 mots/s a chaud, ~20-40 s par tour sur L40S, conteneur eteint 30 s apres le dernier appel.
"""
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import time

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import relecture_noyau as N  # noqa: E402

RACINE = os.path.normpath(os.path.join(ICI, '..', '..', '..'))
MOTEUR = os.path.join(RACINE, 'cloud', 'public', 'app', 'lib', 'locomotion-procedurale.js')
NOM_ALLURE = {'run': 'run', 'jog': 'jog', 'sprint': 'sprint'}
VARIANTE = {'run': 'normal', 'jog': 'jog', 'sprint': 'sprint'}
SYSTEME = 'You are an expert character animator and biomechanics specialist. Reply with ONE valid JSON object only, no markdown.'


def lire_defauts(allure, moteur=MOTEUR):
    """Leviers de COURSE_DEFAUT du moteur pour cette allure (valeurs numeriques seulement)."""
    import re
    s = open(moteur, encoding='utf-8').read()
    d = s.index('const COURSE_DEFAUT = {')
    m = re.search(r'\n\s*' + NOM_ALLURE[allure] + r': \{(.*?)\},?\n', s[d:], re.S)
    return {k: float(v) for k, v in re.findall(r'(\w+):\s*(-?[\d.]+)', m.group(1))}


def mesurer(rig, allure, leviers, positions=None, moteur=MOTEUR):
    """Mesures d'un rig avec ces leviers (dict) ; None si la mesure echoue."""
    env = dict(os.environ, REGLAGES=json.dumps({NOM_ALLURE[allure]: leviers}))
    if positions:
        env['POSITIONS'] = positions
    else:
        env.pop('POSITIONS', None)
    try:
        r = subprocess.run(['node', os.path.join(ICI, 'mesures_course.mjs'), moteur, rig, 'run', VARIANTE[allure]],
                           capture_output=True, text=True, timeout=300, env=env)
        lignes = [l for l in r.stdout.splitlines() if l.startswith('{')]
        return json.loads(lignes[-1]) if lignes else None
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return None


def dessiner(positions_json, taille=256):
    """4 images JPEG (base64), 2 images du cycle chacune ; colonne gauche = profil (z, y), droite = face (x, y)."""
    from PIL import Image, ImageDraw
    d = json.load(open(positions_json, encoding='utf-8'))
    par, roles, sol, imgs = d['par'], {int(k): v for k, v in d['roles'].items()}, d['sol'], d['images']
    coul = {'jambe': (30, 80, 220), 'bras': (210, 40, 40), 'colonne': (0, 0, 0)}
    sorties = []
    for k in range(4):
        im = Image.new('RGB', (2 * taille, 2 * taille), (245, 245, 245)); g = ImageDraw.Draw(im)
        for rang in range(2):
            F = imgs[2 * k + rang]
            cz = sum(p[2] for p in F) / len(F); cx = sum(p[0] for p in F) / len(F)
            for vue in range(2):
                ox, oy = vue * taille, rang * taille
                def pt(p):
                    h = (p[2] - cz) if vue == 0 else -(p[0] - cx)
                    return (ox + taille / 2 + h * taille * 0.8, oy + taille * 0.92 - (p[1] - sol) * taille * 0.8)
                g.line([(ox, oy + taille * 0.92), (ox + taille, oy + taille * 0.92)], fill=(160, 160, 160))
                for j, pj in enumerate(par):
                    if pj < 0:
                        continue
                    c = coul.get(roles.get(j), (150, 150, 150))
                    g.line([pt(F[pj]), pt(F[j])], fill=c, width=3 if j in roles else 1)
                g.text((ox + 4, oy + 4), f'frame {2 * k + rang + 1}/8 ' + ('side' if vue == 0 else 'front'), fill=(0, 0, 0))
        b = io.BytesIO(); im.save(b, 'JPEG', quality=85); sorties.append(base64.b64encode(b.getvalue()).decode())
    return sorties


def demander_modal(texte, images, max_jetons=500):
    """Appel reel : Qwen3.6 sur Modal (3 essais espaces en cas d'echec reseau ou de conteneur)."""
    import modal
    C = modal.Cls.from_name('myfabmesh-reglage-gpu', 'ReglageGpu')
    derniere = None
    for attente in (0, 10, 30):
        time.sleep(attente)
        try:
            return C().voir.remote(texte, images, max_jetons, SYSTEME)['texte']
        except Exception as e:  # noqa: BLE001 - toute panne du service se traite pareil : on reessaie
            derniere = e
    raise RuntimeError(f'Qwen3.6 injoignable apres 3 essais : {derniere}')


def demander_valide(demander, texte, images, journal):
    """Demande + 2 relances si la reponse n'est pas un JSON exploitable ; rend le dict ou None."""
    msg = texte
    for essai in range(3):
        t0 = time.time()
        brut = demander(msg, images)
        rep = N.extraire_json(brut)
        journal.append({'essai': essai, 's': round(time.time() - t0, 1), 'brut': (brut or '')[:1500]})
        if rep is not None and isinstance(rep.get('changements'), dict):
            return rep
        msg = (texte + '\n\nYOUR PREVIOUS REPLY WAS NOT USABLE (' + ('no JSON object found' if rep is None else 'missing "changements" object') +
               '). Reply with ONE JSON object exactly like {"analyse": "...", "changements": {"buste": 12}}.')
    return None


def boucle(rigs, allure, leviers_depart, tours=6, demander=None, mesurer_=mesurer, dessiner_=dessiner, sortie=None, patience=3, journal_init=None):
    demander = demander or demander_modal
    sortie = sortie or tempfile.mkdtemp(prefix='relecture_')
    os.makedirs(sortie, exist_ok=True)
    noms = {r: os.path.splitext(os.path.basename(r))[0] for r in rigs}

    def evaluer(lev, avec_positions):
        mes, notes, pos = {}, {}, None
        for i, r in enumerate(rigs):
            p = os.path.join(sortie, '_positions.json') if (avec_positions and i == 0) else None
            m = mesurer_(r, allure, lev, p)
            mes[noms[r]] = m; notes[noms[r]] = N.note(m, allure)
            if p and m is not None:
                pos = p
        return mes, notes, pos

    J = journal_init or {'allure': allure, 'rigs': list(noms.values()), 'tours': []}
    meilleur_lev = dict(leviers_depart)
    mes_b, notes_b, pos_b = evaluer(meilleur_lev, True)
    # un rig que la course anatomique n'anime pas (pagne, squelette incomplet : l'ancien moteur prend le relais) ne reagit pas aux leviers : on l'ecarte
    ecartes = [r for r in rigs if not mes_b[noms[r]] or mes_b[noms[r]].get('moteur') != 'anatomique']
    if ecartes:
        J['rigs_ecartes'] = [noms[r] for r in ecartes]
        rigs = [r for r in rigs if r not in ecartes]
        if not rigs:
            J['fin'] = 'aucun rig anime par la course anatomique'; json.dump(J, open(os.path.join(sortie, 'journal.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            return J
        mes_b, notes_b, pos_b = evaluer(meilleur_lev, True)
    J['depart'] = {'leviers': meilleur_lev, 'notes': notes_b}
    refus, d_affilee, deja_refuses = [], 0, set()

    def ecrire():
        J['meilleur'] = {'leviers': meilleur_lev, 'notes': notes_b, 'moyenne': round(sum(notes_b.values()) / len(notes_b), 3)}
        json.dump(J, open(os.path.join(sortie, 'journal.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        json.dump({NOM_ALLURE[allure]: meilleur_lev}, open(os.path.join(sortie, 'proposition.json'), 'w', encoding='utf-8'), indent=1)

    ecrire()
    for tour in range(1, tours + 1):
        if all(v == 0 for v in notes_b.values()):
            J['fin'] = 'toutes les normes sont tenues'; break
        if d_affilee >= patience:
            J['fin'] = f'{patience} refus d\'affilee'; break
        T = {'tour': tour}
        try:
            images = dessiner_(pos_b) if pos_b else []
        except Exception as e:  # noqa: BLE001 - le tour continue sur les chiffres seuls
            images = []; T['rendu'] = f'echec : {e}'
        texte = N.texte_demande(allure, meilleur_lev, mes_b, notes_b, refus, noms[rigs[0]])
        T['appels'] = []
        try:
            rep = demander_valide(demander, texte, images, T['appels'])
        except RuntimeError as e:
            T['erreur'] = str(e); J['tours'].append(T); J['fin'] = 'modele injoignable'; break
        if rep is None:
            T['resultat'] = 'reponse inexploitable apres 3 essais'; refus.append('(unreadable reply)'); d_affilee += 1
            J['tours'].append(T); ecrire(); continue
        ch, rejets = N.valider_changements(rep, meilleur_lev)
        T.update(analyse=str(rep.get('analyse', ''))[:300], propose=rep.get('changements'), retenu=ch, ajustements=rejets)
        if not ch:
            T['resultat'] = 'aucun changement exploitable'; refus.append('(no usable change)'); d_affilee += 1
            J['tours'].append(T); ecrire(); continue
        if N.cle_changement(ch) in deja_refuses:
            # 29/10 : Qwen3.6 reproposait le changement refuse au tour precedent ; on ne le remesure pas
            T.update(accepte=False, raison='changement deja refuse'); d_affilee += 1
            refus.append(json.dumps(ch) + ' -> already rejected, propose something DIFFERENT')
            J['tours'].append(T); ecrire(); continue
        cand = dict(meilleur_lev, **ch)
        mes_c, notes_c, pos_c = evaluer(cand, True)
        ok, raison = N.decider(notes_b, notes_c, mes_b, mes_c, allure)
        T.update(notes=notes_c, accepte=ok, raison=raison)
        if ok:
            meilleur_lev, mes_b, notes_b, pos_b, d_affilee = cand, mes_c, notes_c, pos_c, 0
        else:
            refus.append(json.dumps(ch) + ' -> ' + raison); d_affilee += 1; deja_refuses.add(N.cle_changement(ch))
        J['tours'].append(T); ecrire()
    ecrire()
    return J


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--allure', choices=sorted(N.NORMES), default='run')
    ap.add_argument('--rigs', nargs='+', required=True)
    ap.add_argument('--tours', type=int, default=6)
    ap.add_argument('--depart', help='fichier JSON de leviers de depart (sinon : COURSE_DEFAUT du moteur)')
    ap.add_argument('--sortie')
    a = ap.parse_args()
    dep = lire_defauts(a.allure)
    if a.depart:
        f = json.load(open(a.depart, encoding='utf-8'))
        dep.update(f.get(NOM_ALLURE[a.allure], f))
    J = boucle(a.rigs, a.allure, dep, a.tours, sortie=a.sortie)
    print(json.dumps({'fin': J.get('fin', 'tours epuises'), 'depart': J['depart']['notes'], 'meilleur': J['meilleur']}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
