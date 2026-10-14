"""Assemble modal_app/_moderation_texte.py : les LISTES sont extraites mecaniquement de
cloud/src/nsfw_filter.ts (aucune retranscription a la main) et inserees dans le gabarit
_moderation_texte.tpl.py a la place du marqueur #@@LISTES@@.

Usage : python build/moderation_modal/gen_module.py             regenere modal_app/_moderation_texte.py
        python build/moderation_modal/gen_module.py --verifier   code 1 si le module installe differe de celui qui serait genere
                                                                 (garde de construction : le TypeScript est la source de verite ;
                                                                 le miroir du bureau, lui, vient de build/miroir-moderation.mjs)
        python build/moderation_modal/gen_module.py <chemin_ts> <sortie>

2026-10-13 (audit langue / moderation) : nouvelles listes (lexiques non latins, mots colles, ages, idiomes) ; les
echappements JavaScript a accolades (emoji hors du plan de base) sont decodes ; les fins de ligne du gabarit et du module
installe (CRLF dans une copie Windows) ne font plus diverger la verification : la comparaison se fait en LF et le module
est reecrit avec les fins de ligne qu'il avait.
"""
import io
import re
import sys
import os

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, '..', '..'))
VERIFIER = '--verifier' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
TS = ARGS[0] if len(ARGS) > 0 else os.path.join(RACINE, 'cloud', 'src', 'nsfw_filter.ts')
SORTIE = ARGS[1] if len(ARGS) > 1 else os.path.join(RACINE, 'modal_app', '_moderation_texte.py')

NOMS = [
    'MINEURS_FORT', 'MINEURS_AMBIGUS', 'MINEURS_INDICES', 'MINEURS_VIOLENCE', 'NU_FORT', 'NU_EXACTS', 'NU_MOYEN',
    'NU_FAIBLE_PLANCHER', 'NU_FAIBLE_GENERAL', 'SEXE_MINEUR_FORT', 'VIOLENCE_ENFANT_PLANCHER', 'PLANCHER_MOTS',
    'PLANCHER_COLLES', 'PLANCHER_UNICODE', 'MINEURS_FORT_UNICODE', 'MINEURS_AMBIGUS_UNICODE', 'NU_FORT_UNICODE',
    'NU_SUGGESTIF_UNICODE', 'NU_MOYEN_UNICODE', 'NU_FAIBLE_UNICODE', 'VIOLENCE_UNICODE', 'SERIE_MINEURS', 'SERIE_NUDITE',
    'COLLE_MINEURS', 'COLLE_NUDITE', 'COLLE_NUDITE_BORD', '_NOMBRES_LETTRES', 'NOMBRES_AMBIGUS', 'GRANDS_NOMBRES',
    'UNITES_AGE', 'UNITES_AGE_ROMANES', 'COMPLEMENTS_DE', 'PREFIXES_AGE', 'NOMBRES_COMPOSES_DE',
    'PREFIXES_NAISSANCE', 'UNITES_AGE_UNICODE', 'PREFIXES_AGE_UNICODE', 'IDIOMES', 'EXPRESSIONS_SURES', 'IDIOMES_EXACTS',
    'IDIOMES_UNICODE', 'VETEMENTS_ANIMAL', 'ANIMAUX_BEBE', 'ZEROS_CHIFFRES', 'GENERAL_SEXUEL_DUR', 'GENERAL_CTX_SEXUEL',
    'CONTEXTE_SEXUEL_FAIBLE', 'GENERAL_CTX_VIOLENCE', 'GENERAL_VIOLENCE_DUR', 'GENERAL_DROGUE_DUR',
    'GENERAL_EXTREMISME_DUR', 'GENERAL_AUTOBLESSURE_DUR', 'GENERAL_HAINE_DUR', 'GENERAL_ARMES_DUR',
    'PERSONNES', 'NUDITE_EXTREME', 'VIOLENCE_ENFANT_GENERAL',
    # 2026-10-14 (revue du lot moderation : B2, B3, B4)
    'NON_ASSIGNES_U14', 'IDIOMES_RACINES',
    # 2026-10-14 (seconde relecture : age, double sens, eleves de classe, ftfy)
    'DUREES_NON_AGE', 'ADJECTIFS_JEUNESSE', 'CLASSES_ORDINAUX', 'ELEVES_CLASSE', 'MOJIBAKE_EFFACES',
    # 2026-10-14 (troisieme relecture : lecture « production », gardes des tournures, mineurs construits)
    'TRANSLIT_HORS_PRODUCTION', 'GARDE_POSSESSIFS', 'GARDE_ARRETS', 'GARDE_CHANTIER', 'AVANT_ESCOLAR', 'NOMBRES_CLASSE',
]

src = io.open(TS, encoding='utf-8').read().replace('\r\n', '\n')
chaine = re.compile(r"'((?:[^'\\]|\\.)*)'")


def extraire(nom):
    m = re.search(r'^const ' + re.escape(nom) + r': string\[\] = \[(.*?)\];', src, re.S | re.M)
    if not m:
        raise SystemExit('liste introuvable : ' + nom)
    # retrait des commentaires de fin de ligne (// ...) hors chaines : les chaines de ces listes ne contiennent pas "//"
    corps = '\n'.join(re.sub(r'//.*$', '', l) for l in m.group(1).split('\n'))
    return chaine.findall(corps)


def decoder(s):
    # les chaines TS n'utilisent que des echappements \u{X...} (emoji) et \uXXXX ; on les convertit proprement.
    s = re.sub(r'\\u\{([0-9a-fA-F]+)\}', lambda m: chr(int(m.group(1), 16)), s)
    return re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)


sorties = []
for nom in NOMS:
    elems = [decoder(s) for s in extraire(nom)]
    lignes = []
    cur = '   '
    for e in elems:
        lit = '"' + e.encode('ascii', 'backslashreplace').decode('ascii').replace('"', '\\"') + '"'
        piece = ' ' + lit + ','
        if len(cur) + len(piece) > 118:
            lignes.append(cur)
            cur = '   '
        cur += piece
    lignes.append(cur)
    nom_py = nom.lstrip('_') if nom != '_NOMBRES_LETTRES' else 'NOMBRES_LETTRES'
    sorties.append('%s = (\n%s\n)\n' % (nom_py, '\n'.join(lignes)))

tpl = io.open(os.path.join(ICI, '_moderation_texte.tpl.py'), encoding='utf-8', newline='').read().replace('\r\n', '\n')
assert tpl.count('#@@LISTES@@') == 1
res = tpl.replace('#@@LISTES@@', '\n'.join(sorties))
if VERIFIER:
    try:
        actuel = io.open(SORTIE, encoding='utf-8', newline='').read().replace('\r\n', '\n')
    except OSError as e:
        raise SystemExit('[moderation-modal] ECHEC : module illisible (%s)' % e)
    if actuel != res:
        a, b = actuel.split('\n'), res.split('\n')
        k = 0
        while k < len(a) and k < len(b) and a[k] == b[k]:
            k += 1
        print('[moderation-modal] DIVERGENCE : modal_app/_moderation_texte.py differe de celui genere depuis cloud/src/nsfw_filter.ts (premiere difference ligne %d)' % (k + 1))
        print('  installe :', (a[k] if k < len(a) else '')[:140])
        print('  genere   :', (b[k] if k < len(b) else '')[:140])
        print('  Corriger avec : python build/moderation_modal/gen_module.py')
        raise SystemExit(1)
    print('[moderation-modal] OK : modal_app/_moderation_texte.py est identique a celui genere depuis nsfw_filter.ts')
else:
    fin_de_ligne = '\n'
    try:
        if b'\r\n' in io.open(SORTIE, 'rb').read():
            fin_de_ligne = '\r\n'
    except OSError:
        pass
    io.open(SORTIE, 'w', encoding='utf-8', newline=fin_de_ligne).write(res)
    print('ecrit', SORTIE, len(res), 'octets')
