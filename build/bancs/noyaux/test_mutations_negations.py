"""Mutations de extraire_negations (2026-10-03) : un changement du lexique ou des regles, applique a une COPIE du module, doit etre DETECTE par les gardes.

Chaque mutation (nom, fichier, ancien, nouveau) remplace UNE occurrence exacte dans une copie temporaire du module Python (scripts/composeur_intention.py) ou du jumeau
JavaScript (src/renderer/lib/composeur-intention.js) ; la garde correspondante tourne sur la copie :
    Python     INTENTION_SCRIPTS=<dossier> python build/check_intention.py
    JavaScript INTENTION_JS=<fichier>      node build/check-intention.mjs
La mutation est DETECTEE quand la garde sort en erreur. Une mutation non detectee fait echouer ce test : le lexique ou la regle n'est alors couvert par aucun cas
(ajouter un cas dans build/intention_cas.json ou dans balayage_negations de build/check_intention.py).
Aucun fichier du depot n'est modifie.

Lancer :  <python de l'appli> build/bancs/noyaux/test_mutations_negations.py -v      (une soixantaine de secondes)
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PY_SOURCE = os.path.join(RACINE, 'scripts', 'composeur_intention.py')
JS_SOURCE = os.path.join(RACINE, 'src', 'renderer', 'lib', 'composeur-intention.js')

# (nom, ancien Python, nouveau Python, ancien JavaScript, nouveau JavaScript)
MUTATIONS = [
    ('faux ami « no kidding » retire', "such problem kidding'.split())", "such problem'.split())", "such problem kidding'),", "such problem'),"),
    ('faux ami « not only » retire', "'not': frozenset(('only just too", "'not': frozenset(('just too", "not: _mots('only just too", "not: _mots('just too"),
    ('faux ami « never again » retire', "'never': frozenset('before again ever", "'never': frozenset('before ever", "never: _mots('before again ever", "never: _mots('before ever"),
    ('faux ami « without fail » retire', "'without': frozenset('further fail doubt", "'without': frozenset('further doubt", "without: _mots('further fail doubt", "without: _mots('further doubt"),
    ('garde-robe « clothes » retiree', "'clothes clothing clothe clothed", "'clothing clothe clothed", "_mots('clothes clothing clothe clothed", "_mots('clothing clothe clothed"),
    ('garde-robe « underwear » retiree', "pants trousers underwear underpants", "pants trousers underpants", "pants trousers underwear underpants", "pants trousers underpants"),
    ('mot vide « else » retire', "'else other others more", "'other others more", "'else other others more", "'other others more"),
    ('mot vide « none » retire', "nothing none anyone", "nothing anyone", "nothing none anyone", "nothing anyone"),
    ('plafond de termes 8 -> 9', "MAX_TERMES_NEGATIFS = 8 ", "MAX_TERMES_NEGATIFS = 9 ", "MAX_TERMES_NEGATIFS = 8;", "MAX_TERMES_NEGATIFS = 9;"),
    ('plafond de mots 3 -> 4', "MAX_MOTS_TERME = 3 ", "MAX_MOTS_TERME = 4 ", "MAX_MOTS_TERME = 3;", "MAX_MOTS_TERME = 4;"),
    ('plafond de caracteres 40 -> 41', "MAX_CARS_TERME = 40\n", "MAX_CARS_TERME = 41\n", "MAX_CARS_TERME = 40;", "MAX_CARS_TERME = 41;"),
    ('troncature 2000 -> 2001', "MAX_TEXTE_NEGATIONS = 2000 ", "MAX_TEXTE_NEGATIONS = 2001 ", "MAX_TEXTE_NEGATIONS = 2000;", "MAX_TEXTE_NEGATIONS = 2001;"),
    ('verbe « holding » retire', "_NEG_VERBES = frozenset(('holding wearing", "_NEG_VERBES = frozenset(('wearing", "NEG_VERBES = _mots('holding wearing", "NEG_VERBES = _mots('wearing"),
    ('fin de groupe « with » retiree', "'and or nor but with without in on at", "'and or nor but without in on at", "'and or nor but with without in on at", "'and or nor but without in on at"),
    ('conjonction « but » retiree', "_NEG_CONJ = frozenset('and or nor but'.split())", "_NEG_CONJ = frozenset('and or nor'.split())",
     "NEG_CONJ = _mots('and or nor but')", "NEG_CONJ = _mots('and or nor')"),
    ('« wearing no X » non reconnu', "'with and but or plus having has holding wearing carrying", "'with and but or plus having has holding carrying",
     "_mots('with and but or plus having has holding wearing carrying", "_mots('with and but or plus having has holding carrying"),
    ('« not wearing X » en milieu de phrase retire', "_NEG_LEGERS_NOT = frozenset('wearing holding", "_NEG_LEGERS_NOT = frozenset('holding",
     "NEG_LEGERS_NOT = _mots('wearing holding", "NEG_LEGERS_NOT = _mots('holding"),
    ('liaison « plus » retiree', "_NEG_DEBUT = frozenset('and but or with plus also yet'", "_NEG_DEBUT = frozenset('and but or with also yet'",
     "NEG_DEBUT = _mots('and but or with plus also yet')", "NEG_DEBUT = _mots('and but or with also yet')"),
    ('« without » au milieu d\'une phrase ignore', "            elif w == 'without':\n", "            elif w == 'without_':\n", "} else if (w === 'without') {", "} else if (w === 'without_') {"),
    ('garde des titres (« Without Remorse ») retiree', "            elif _neg_majuscule(jeton):\n", "            elif False:\n", "} else if (negMajuscule(jeton)) {", "} else if (false) {"),
    ('negation entre parentheses non reconnue', "            elif jeton[0] in '([{':\n", "            elif jeton[0] in '[{':\n", "} else if ('([{'.includes(jeton[0])) {", "} else if ('[{'.includes(jeton[0])) {"),
    ('citation « "No entry" » prise pour une negation', "                if jeton[0] not in '\"\\u201c':", "                if True:", "if (!'\"\\u201c'.includes(jeton[0])) decl = w;", "decl = w;"),
    ('point final perdu', "gardes[-1][1] = '.' if morceaux[-1][1].startswith('.') else ''", "gardes[-1][1] = ''",
     "gardes[gardes.length - 1][1] = morceaux[morceaux.length - 1][1].startsWith('.') ? '.' : '';", "gardes[gardes.length - 1][1] = '';"),
    ('les premiers mots au lieu des trois derniers', "mots = mots[-MAX_MOTS_TERME:]", "mots = mots[:MAX_MOTS_TERME]", "mots = mots.slice(-MAX_MOTS_TERME);", "mots = mots.slice(0, MAX_MOTS_TERME);"),
    ('doublon dans une meme liste accepte', "if t not in etat and t not in nouveaux:", "if t not in etat:", "if (!etat.includes(t) && !nouveaux.includes(t)) nouveaux.push(t);",
     "if (!etat.includes(t)) nouveaux.push(t);"),
    ('« without X and Y » ne prolonge plus', "if not repete and w == 'and' and decl != 'without':", "if not repete and w == 'and' and decl != 'no':",
     "if (!repete && w === 'and' && decl !== 'without') return null;", "if (!repete && w === 'and' && decl !== 'no') return null;"),
    ('« and holding » orphelin garde', "and _neg_verbal(jetons[i + 1]):", "and False:", "&& negVerbal(jetons[i + 1])) i++;", "&& false) i++;"),
    ('separateur « | » retire', "c in ',;|\\r\\n'", "c in ',;\\r\\n'", "',;|\\r\\n'.includes(c)", "',;\\r\\n'.includes(c)"),
    ('plafond de assainir 8 -> 9', "if len(sortie) >= MAX_TERMES_NEGATIFS:", "if len(sortie) > MAX_TERMES_NEGATIFS:",
     "if (sortie.length >= MAX_TERMES_NEGATIFS) break;", "if (sortie.length > MAX_TERMES_NEGATIFS) break;"),
    ('apostrophe acceptee dans un terme', "if not (('a' <= ch <= 'z') or ch == '-'):\n            return False\n    return True",
     "if not (('a' <= ch <= 'z') or ch == '-' or ch == \"'\"):\n            return False\n    return True",
     "if (!((ch >= 'a' && ch <= 'z') || ch === '-')) return false;\n  }\n  return true;", "if (!((ch >= 'a' && ch <= 'z') || ch === '-' || ch === \"'\")) return false;\n  }\n  return true;"),
    ('regle « negations » eteinte par defaut', "REGLES_ACTIVES = ('objets', 'negations')", "REGLES_ACTIVES = ('objets',)", "REGLES_ACTIVES = ['objets', 'negations'];", "REGLES_ACTIVES = ['objets'];"),
]


def appliquer(texte, ancien, nouveau, nom):
    n = texte.count(ancien)
    if n != 1:
        raise AssertionError('mutation « %s » : %d occurrence(s) de %r (la specification de la mutation est perimee)' % (nom, n, ancien))
    return texte.replace(ancien, nouveau)


def lire(chemin):
    with io.open(chemin, 'r', encoding='utf-8', newline='') as f:
        return f.read()


class MutationsDesNegations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dossier = tempfile.mkdtemp(prefix='mutations-negations-')
        cls.py = lire(PY_SOURCE)
        cls.js = lire(JS_SOURCE)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dossier, ignore_errors=True)

    def lancer(self, commande, env):
        e = dict(os.environ)
        e.update(env)
        e['PYTHONUTF8'] = '1'
        return subprocess.run(commande, cwd=RACINE, env=e, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=240)

    def test_le_code_non_mute_passe_les_deux_gardes(self):
        """Temoin : sans mutation les deux gardes sortent en succes (sinon l'echec d'une mutation ne prouverait rien)."""
        d = os.path.join(self.dossier, 'temoin')
        os.makedirs(d)
        shutil.copy(PY_SOURCE, os.path.join(d, 'composeur_intention.py'))
        self.assertEqual(self.lancer([sys.executable, 'build/check_intention.py'], {'INTENTION_SCRIPTS': d}).returncode, 0)
        shutil.copy(JS_SOURCE, os.path.join(d, 'lib.js'))
        self.assertEqual(self.lancer(['node', 'build/check-intention.mjs'], {'INTENTION_JS': os.path.join(d, 'lib.js')}).returncode, 0)

    def test_chaque_mutation_est_detectee(self):
        non_detectees = []
        for i, (nom, ancien_py, nouveau_py, ancien_js, nouveau_js) in enumerate(MUTATIONS):
            d = os.path.join(self.dossier, 'm%02d' % i)
            os.makedirs(d)
            with io.open(os.path.join(d, 'composeur_intention.py'), 'w', encoding='utf-8', newline='') as f:
                f.write(appliquer(self.py, ancien_py, nouveau_py, nom))
            with io.open(os.path.join(d, 'lib.js'), 'w', encoding='utf-8', newline='') as f:
                f.write(appliquer(self.js, ancien_js, nouveau_js, nom))
            r_py = self.lancer([sys.executable, 'build/check_intention.py'], {'INTENTION_SCRIPTS': d})
            r_js = self.lancer(['node', 'build/check-intention.mjs'], {'INTENTION_JS': os.path.join(d, 'lib.js')})
            etat = ('Python %s, JavaScript %s' % ('detectee' if r_py.returncode else 'NON DETECTEE', 'detectee' if r_js.returncode else 'NON DETECTEE'))
            print('  mutation %02d « %s » : %s' % (i + 1, nom, etat))
            if not r_py.returncode:
                non_detectees.append('%s (Python)' % nom)
            if not r_js.returncode:
                non_detectees.append('%s (JavaScript)' % nom)
        print('  %d mutations, %d non detectee(s)' % (len(MUTATIONS), len(non_detectees)))
        self.assertEqual(non_detectees, [], 'mutations non detectees : le lexique ou la regle n\'est couvert par aucun cas')


if __name__ == '__main__':
    unittest.main()
