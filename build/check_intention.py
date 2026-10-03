#!/usr/bin/env python3
"""Garde du composeur d'intention (2026-10-03), cote Python.

 1. Les ATTENDUS ECRITS A LA MAIN (build/intention_cas.json, 64 cas : 60 de l'audit de fidelite + 4 gardes-fous) sont verifies contre
    scripts/composeur_intention.py avec TOUTES les regles (celles qui ne sont pas encore actives sont testees quand meme).
 2. Le cas temoin "An orc" doit rester IDENTIQUE a l'octet avec les regles actives : un texte qui ne dit rien d'un objet tenu ne change pas
    le gabarit. Idem pour chaque type de gabarit.
 3. Les SORTIES COMPLETES du module (64 cas ecrits + un balayage GENERE de tout le lexique : chaque verbe de prise, chaque mot d'arme ou d'objet,
    chaque pose, vue, couleur...) sont comparees a build/intention_attendus.json ; le jumeau JavaScript (src/renderer/lib/composeur-intention.js)
    est verifie contre le MEME fichier par build/check-intention.mjs : les deux langages donnent donc les memes sorties, mot par mot.
 4. Les deux copies Python (scripts/ et modal_app/) sont identiques (aussi garde par build/check-noyaux-partages.mjs).

    python build/check_intention.py            verifie
    python build/check_intention.py --ecrire   regrave build/intention_attendus.json (apres un changement VOULU du module)
"""
import io
import json
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, 'scripts'))
sys.path.insert(0, RACINE)
import composeur_intention as C  # noqa: E402
from modal_app import _prompts as P  # noqa: E402

CAS = os.path.join(RACINE, 'build', 'intention_cas.json')
ATTENDUS = os.path.join(RACINE, 'build', 'intention_attendus.json')
TEMOIN = 'An orc'

VERBES = ['holding', 'wielding', 'carrying', 'gripping', 'grasping', 'brandishing', 'clutching', 'swinging', 'raising', 'lifting',
          'hefting', 'bearing', 'armed with', 'equipped with', 'dual wielding', 'dual wields', 'wields', 'holds', 'carries']
PHRASES_TENUES = [
    'A man holding his breath', 'A man holding a pose', 'A man holding onto a rope', 'A man holding on tight', 'A guard holding up a sign',
    'A guard holding out a letter', 'A man holding the line', 'Two warriors holding hands', 'A knight holding a sword, a shield and a lance',
    'A monk holding nothing', 'A thief with a dagger in her left hand', 'A hunter with a bow in both hands',
    'An archer holding a bow in his right hand', 'A giant swinging a huge club with both hands',
    'A king holding a golden scepter in his left hand', 'A dwarf wielding a hammer and an axe', 'A boy holding three apples',
    'A woman holding a baby in a blue dress', 'A man carrying water in a bucket',
]
POSES_A_LA_MAIN = ['sitting', 'seated', 'crouching', 'kneeling', 'lying', 'riding a horse', 'running', 'jumping', 'dancing', 'flying', 'swimming',
         'climbing', 'in a combat stance', 'with arms crossed', 'with hands on hips', 'waving', 'pointing', 'praying', 'saluting',
         'meditating', 'bowing', 'punching', 'kicking', 'aiming a rifle', 'casting a spell', 'leaning on a wall']
VUES_A_LA_MAIN = ['back view', 'rear view', 'seen from behind', 'from the side', 'from above', 'side view', 'in profile', 'three-quarter view',
        '3/4 view', 'top view', 'aerial view', 'isometric view', 'low angle', 'high-angle', "bird's-eye view"]
BUSTES_A_LA_MAIN = ['bust', 'portrait', 'head only', 'headshot', 'close-up', 'face only', 'waist up']
NONHUMAINS_A_LA_MAIN = ['robot', 'android', 'cyborg', 'mech', 'golem', 'skeleton', 'statue', 'ghost', 'spirit', 'elemental', 'slime',
              'automaton', 'wraith', 'living armor']
ADJ_PARTIES = [('single', 'headed'), ('single', 'eyed'), ('three', 'headed'), ('four', 'armed'), ('six', 'legged'), ('one', 'eyed'), ('six', 'winged'), ('two', 'tailed'), ('four', 'horned')]
NOMS_PARTIES = [('single', 'head'), ('three', 'heads'), ('four', 'arms'), ('six', 'legs'), ('three', 'eyes'), ('four', 'wings'), ('two', 'tails'), ('4', 'horns'),
                ('three', 'faces')]
QUANTITES = ['A pair of leather boots', 'A set of four chess pieces', 'Three potion bottles', 'Two crossed swords', 'A couple of mugs',
             'A set of 6 plates', 'Ten coins', 'A twin-engine airplane', 'A double bed', 'A pair of shoes']
DIVERS = ['A one-armed pirate', 'A scarred soldier', 'An asymmetric mask', 'A rock golem', 'A statue on a pedestal',
          'A diorama of a knight', 'A mountain climber']
STYLES = ['anime', 'cartoon', 'stylized', 'pixel-art', 'realistic', 'dark-fantasy']


def alternatives(rx):
    """Les alternatives d'une regex de mots (a|b|c) du module, ecrites comme du texte (les groupes optionnels (?:his |her )? sont ecartes)."""
    pat = rx.pattern
    debut = pat.index('(')
    prof, fin = 0, None
    for i in range(debut, len(pat)):
        if pat[i] == '(':
            prof += 1
        elif pat[i] == ')':
            prof -= 1
            if prof == 0:
                fin = i
                break
    interieur = pat[debut + 1:fin]
    morceaux, courant, prof = [], '', 0
    for ch in interieur:
        if ch == '(':
            prof += 1
        elif ch == ')':
            prof -= 1
        if ch == '|' and prof == 0:
            morceaux.append(courant)
            courant = ''
        else:
            courant += ch
    morceaux.append(courant)
    sortie = []
    for m in morceaux:
        m = re.sub(r"\(\?:[^)]*\)\?", '', m)       # groupes optionnels
        m = m.replace("'?", '').replace(chr(92) + 'w*', '').replace(chr(92), '')
        m = re.sub(r"\s+", ' ', m).strip()
        if m and m not in sortie:
            sortie.append(m)
    return sortie


def balayage():
    """Cas GENERES, sans attendu ecrit a la main : ils servent a ce que le jumeau JavaScript soit sensible a CHAQUE mot du lexique (un mot
    oublie d'un cote ne serait vu par aucun des 64 cas ecrits a la main)."""
    cas = []

    def ajoute(texte, typ='character', style='realistic'):
        cas.append({'id': 'b%03d' % (len(cas) + 1), 'texte': texte, 'type': typ, 'style': style, 'attendu': {}})

    for v in VERBES:
        ajoute('A knight %s a sword' % v)
    for cl, mots in sorted(C.CLASSES_ARME.items()):
        liste = mots.split()
        for w in liste:
            ajoute('A warrior holding a %s' % w)
        ajoute('A warrior holding two %ss' % liste[0])
    ajoute('A warrior holding a morning star')
    for w in C.OBJETS_TENUS:
        ajoute('A traveler holding a %s' % w)
    for t in PHRASES_TENUES:
        ajoute(t)
    for p in POSES_A_LA_MAIN + alternatives(C.POSE_LIBRE):
        ajoute('A man %s' % p)
    for v in VUES_A_LA_MAIN + alternatives(C.VUE):
        ajoute('A knight, %s' % v)
    for b in BUSTES_A_LA_MAIN + alternatives(C.BUSTE):
        ajoute('A %s of an elf' % b)
    for h in NONHUMAINS_A_LA_MAIN + alternatives(C.NONHUMAIN):
        ajoute('A %s warrior' % h)
    for w in alternatives(C.DESACCORD_SOCLE) + alternatives(C.ROCHE_VOULUE):
        ajoute('A knight near a %s' % w)
    for w in sorted(C.STOP_TENU):
        ajoute('A man holding his %s' % w)
    for w in sorted(C.PARTICULES_REFUS):
        ajoute('A man holding %s a rope' % w)
    for w in sorted(C.PARTICULES_ELISION):
        ajoute('A guard holding %s a sign' % w)
    for w in C.OBJETS_TENUS:
        ajoute('A traveler with a %s in his left hand' % w)
    for w in sorted(C.NOMBRE):
        ajoute('A man wielding %s swords' % w)
        ajoute('%s potion bottles' % w.capitalize(), 'prop')
    for t in ['A monk, unarmed', 'A monk, empty-handed', 'A monk, empty handed', 'A knight without a weapon', 'A knight without any sword',
              'A knight without shields', 'A knight with no weapons', 'A knight with no weapon', 'A monk, bare-handed', 'A monk, bare handed',
              'A knight not holding anything', 'A monk holding nothing', 'A samurai with a katana in each hand', 'A samurai with a katana in both hands',
              'A samurai, two-handed katana', 'A samurai, dual-wield katana', 'A man one-eyed', 'A one-armed man', 'A man missing an arm',
              'A man missing a leg', 'An asymmetrical cape', 'A twin tower', 'Twins', 'A double axe', 'A couple walking', 'A pair of dancers']:
        ajoute(t)
    for st in sorted(C.STYLES_NON_PHOTO):
        ajoute('A knight', 'character', st)
    for adj in sorted(C.ADJ_PARTIE):
        ajoute('A two-%s monster' % adj, 'creature')
    for nom in sorted(C.PARTIES.values()):
        ajoute('A monster with five %s' % nom, 'creature')
    for n, w in ADJ_PARTIES:
        ajoute('A %s-%s monster' % (n, w), 'creature')
    for n, w in NOMS_PARTIES:
        ajoute('A monster with %s %s' % (n, w), 'creature')
    for t in QUANTITES:
        ajoute(t, 'prop')
    for c in C.COULEURS:
        ajoute('A %s dragon' % c, 'creature', 'synthwave')
    for t in DIVERS:
        ajoute(t)
    for st in STYLES:
        ajoute('A knight', 'character', st)
    return cas


def canon(x):
    """JSON canonique (cles triees, tuples -> listes) pour comparer deux langages."""
    return json.loads(json.dumps(x, sort_keys=True, ensure_ascii=False))


def sorties(cas):
    typ = cas['type']
    gab = P.ASSET_TYPE_PROMPTS[typ]
    it = C.analyser(cas['texte'], typ, cas['style'])
    tpl_t, notes_t = C.composer_gabarit(gab, typ, it, 'toutes')
    tpl_d, notes_d = C.composer_gabarit(gab, typ, it)
    tpl_l, notes_l = C.composer_gabarit(gab, typ, it, None, tpose=False)
    arm = C.composer_negatif_armes(typ, it, True, 'toutes')
    ajout, retire = C.negatifs_extra(typ, it, 'toutes')
    return {
        'id': cas['id'], 'texte': cas['texte'], 'type': typ, 'style': cas['style'],
        'intent': canon(it),
        'clause_toutes': C.clause_objet_tenu(it, 'toutes'), 'tpl_toutes': tpl_t, 'notes_toutes': notes_t,
        'clause_defaut': C.clause_objet_tenu(it), 'tpl_defaut': tpl_d, 'notes_defaut': notes_d,
        'tpl_libre': tpl_l, 'notes_libre': notes_l,
        'negatif_armes': canon(arm), 'negatifs_extra': canon([ajout, retire]),
        '_retire_tot': list(retire) + (arm[1] if arm else []),
        '_ajout_tot': list(ajout) + (arm[2] if arm else []),
    }


def verifier(cas, s):
    att, pb = cas['attendu'], []
    it = s['intent']
    if 'held' in att:
        got = [[o['cls'], o['count'], o['hand']] for o in it['objets']]
        exp = att['held']
        ok = len(got) == len(exp) and all(g[0] == e[0] and g[1] == e[1] and (e[2] is None or g[2] == e[2]) for g, e in zip(got, exp))
        if not ok:
            pb.append('held %s != %s' % (got, exp))
    for k, v in att.get('flags', {}).items():
        g = it.get(k)
        if isinstance(v, list):
            v = list(v)
        ok = (v in g) if (k == 'vue' and v is not None and g is not None) else (g == v)
        if not ok:
            pb.append('flag %s: %r != %r' % (k, g, v))
    tpl, clause = s['tpl_toutes'], s['clause_toutes'] or ''
    for x in att.get('tpl_has', []):
        if x not in tpl:
            pb.append('gabarit sans %r' % x)
    for x in att.get('tpl_not', []):
        if x in tpl:
            pb.append('gabarit contient %r' % x)
    for x in att.get('clause_has', []):
        if x not in clause:
            pb.append('clause sans %r (clause : %r)' % (x, clause))
    for x in att.get('neg_retire', []):
        if x not in s['_retire_tot']:
            pb.append('neg_retire sans %r' % x)
    if att.get('neg_retire') == [] and s['_retire_tot']:
        pb.append('neg_retire devrait etre vide : %s' % s['_retire_tot'])
    for x in att.get('neg_ajout', []):
        if not any(x in a for a in s['_ajout_tot']):
            pb.append('neg_ajout sans %r' % x)
    if att.get('neg_ajout') == [] and any('dual' in a or 'second' in a for a in s['_ajout_tot']):
        pb.append('neg_ajout devrait etre vide')
    return pb


def main():
    ecrire = '--ecrire' in sys.argv
    cas = json.load(io.open(CAS, 'r', encoding='utf-8'))
    nb_ecrits = len(cas)
    cas = cas + balayage()
    echecs, grav = [], []
    for c in cas:
        s = sorties(c)
        pb = verifier(c, s)
        if pb:
            echecs.append((c['id'], c['texte'], pb))
        grav.append({k: v for k, v in s.items() if not k.startswith('_')})
    print('[intention] %d cas ecrits a la main + %d de balayage du lexique, %d echec(s) contre les attendus'
          % (nb_ecrits, len(cas) - nb_ecrits, len(echecs)))
    for e in echecs:
        print('  cas %s "%s" : %s' % (e[0], e[1][:70], '; '.join(e[2])))
    code = 1 if echecs else 0

    # 2. temoin : octet pour octet avec les regles actives
    gab = P.ASSET_TYPE_PROMPTS['character']
    it = C.analyser(TEMOIN, 'character', 'realistic')
    tpl, notes = C.composer_gabarit(gab, 'character', it)
    if tpl != gab or C.clause_objet_tenu(it) is not None or notes:
        print('[intention] ECHEC : le cas temoin "%s" a change (regles actives %s)' % (TEMOIN, C.REGLES_ACTIVES))
        code = 1
    else:
        print("[intention] temoin '%s' : gabarit identique a l'octet (regles actives : %s)" % (TEMOIN, ', '.join(C.REGLES_ACTIVES)))
    for typ, g in sorted(P.ASSET_TYPE_PROMPTS.items()):
        t2, n2 = C.composer_gabarit(g, typ, C.analyser('A simple ' + typ, typ, 'realistic'))
        if t2 != g or n2:
            print('[intention] ECHEC : le gabarit "%s" change sans objet tenu : %r' % (typ, n2))
            code = 1

    # 3. sorties completes
    complet = {'gabarits': P.ASSET_TYPE_PROMPTS, 'cas': grav}
    if ecrire:
        io.open(ATTENDUS, 'w', encoding='utf-8', newline='\n').write(json.dumps(complet, ensure_ascii=False, indent=0, sort_keys=True) + '\n')
        print('[intention] %s regrave (%d cas)' % (os.path.relpath(ATTENDUS, RACINE), len(grav)))
    else:
        try:
            ref = json.load(io.open(ATTENDUS, 'r', encoding='utf-8'))
        except Exception as e:  # noqa: BLE001
            print('[intention] ECHEC : %s illisible (%s) ; lancer --ecrire' % (ATTENDUS, e))
            return 1
        if canon(complet) != canon(ref):
            diff = [g['id'] for g, r in zip(grav, ref.get('cas', [])) if canon(g) != canon(r)]
            print('[intention] ECHEC : les sorties du module different de build/intention_attendus.json (cas %s) ;'
                  ' si le changement est voulu : python build/check_intention.py --ecrire' % (', '.join(diff[:12]) if diff else 'gabarits ou nombre de cas'))
            code = 1
        else:
            print('[intention] sorties completes identiques a build/intention_attendus.json')

    # 4. copies identiques
    a = io.open(os.path.join(RACINE, 'scripts', 'composeur_intention.py'), 'r', encoding='utf-8', newline='').read().replace('\r\n', '\n')
    try:
        b = io.open(os.path.join(RACINE, 'modal_app', 'composeur_intention.py'), 'r', encoding='utf-8', newline='').read().replace('\r\n', '\n')
    except OSError:
        b = None
    if a != b:
        print('[intention] ECHEC : modal_app/composeur_intention.py absent ou different (node build/check-noyaux-partages.mjs --sync)')
        code = 1
    return code


if __name__ == '__main__':
    sys.exit(main())
