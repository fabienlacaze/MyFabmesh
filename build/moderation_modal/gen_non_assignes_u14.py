"""Table FIGEE des points de code NON ASSIGNES en Unicode 14 (categorie Cn), inscrite dans cloud/src/nsfw_filter.ts.

POURQUOI (revue du 14/10/2026 du lot moderation, bloquant B3). Le worker tourne sur un Node recent (Unicode 16) ; le Python de
Modal (3.11) et le tokenizer CLIP qui y tourne connaissent Unicode 14. Une lettre attribuee en Unicode 15 ou 16 (ex. U+1E030,
U+1B132) est une LETTRE pour le worker, qui la garde, mais un caractere NON ASSIGNE (Cn) pour Modal, qui l'efface : « na<U+1E030>ked »
passait le filtre general du worker puis arrivait « naked » au generateur. Le filtre efface desormais, des deux cotes, tout
point de code non assigne en Unicode 14 (cette table), quelle que soit la version d'Unicode du moteur qui l'execute.

Usage (avec un Python dont unicodedata.unidata_version == '14.0.0', ex. Python 3.11, celui de Modal) :
  python build/moderation_modal/gen_non_assignes_u14.py             reecrit la liste NON_ASSIGNES_U14 de nsfw_filter.ts
  python build/moderation_modal/gen_non_assignes_u14.py --verifier  code 1 si la liste differe de la table d'Unicode 14 (garde des
                                                                    deux prebuild ; sous un autre Python : avertissement, code 0)
Ensuite : node build/miroir-moderation.mjs --sync ; python build/moderation_modal/gen_module.py.
"""
import io
import os
import re
import sys
import unicodedata

ICI = os.path.dirname(os.path.abspath(__file__))
TS = os.path.abspath(os.path.join(ICI, '..', '..', 'cloud', 'src', 'nsfw_filter.ts'))
VERSION = '14.0.0'


def plages():
    """Plages [debut, fin] des points de code de categorie Cn (hors demi-substituts, qui sont Cs)."""
    sortie = []
    debut = None
    for cp in range(0x110000):
        cn = unicodedata.category(chr(cp)) == 'Cn'
        if cn and debut is None:
            debut = cp
        elif not cn and debut is not None:
            sortie.append((debut, cp - 1))
            debut = None
    if debut is not None:
        sortie.append((debut, 0x10FFFF))
    return sortie


def liste_ts():
    elems = ["'%04X'" % a if a == b else "'%04X-%04X'" % (a, b) for a, b in plages()]
    lignes = []
    cur = ' '
    for e in elems:
        if len(cur) + len(e) + 2 > 128:
            lignes.append(cur.rstrip())
            cur = ' '
        cur += ' ' + e + ','
    lignes.append(cur.rstrip())
    return 'const NON_ASSIGNES_U14: string[] = [\n' + '\n'.join(lignes) + '\n];'


def main():
    if unicodedata.unidata_version != VERSION and '--verifier' in sys.argv:
        # garde des deux prebuild (seconde relecture du 14/10) : sous un autre Python, la table ne peut pas etre recalculee ;
        # la construction continue (la table est figee ; elle ne change qu'en la regenerant sous Python 3.11)
        print('[non-assignes-u14] NON VERIFIE : ce Python connait Unicode %s ; la verification demande Unicode %s (Python 3.11)'
              % (unicodedata.unidata_version, VERSION))
        return
    if unicodedata.unidata_version != VERSION:
        raise SystemExit('[non-assignes-u14] ce Python connait Unicode %s ; il faut Unicode %s (Python 3.11, celui de Modal)'
                         % (unicodedata.unidata_version, VERSION))
    brut = io.open(TS, encoding='utf-8', newline='').read()
    fin = '\r\n' if '\r\n' in brut else '\n'
    texte = brut.replace('\r\n', '\n')
    motif = re.compile(r'^const NON_ASSIGNES_U14: string\[\] = \[\n.*?\n\];', re.S | re.M)
    m = motif.search(texte)
    if not m:
        raise SystemExit('[non-assignes-u14] liste NON_ASSIGNES_U14 introuvable dans ' + TS)
    attendu = liste_ts()
    if '--verifier' in sys.argv:
        if m.group(0) != attendu:
            print('[non-assignes-u14] DIVERGENCE : NON_ASSIGNES_U14 differe de la table d\'Unicode 14. Corriger avec : '
                  'python build/moderation_modal/gen_non_assignes_u14.py')
            raise SystemExit(1)
        print('[non-assignes-u14] OK : NON_ASSIGNES_U14 = points de code non assignes en Unicode 14 (%d plages)' % len(plages()))
        return
    nouveau = texte[:m.start()] + attendu + texte[m.end():]
    io.open(TS, 'w', encoding='utf-8', newline=fin).write(nouveau)
    print('ecrit', TS, '(%d plages)' % len(plages()))


if __name__ == '__main__':
    main()
