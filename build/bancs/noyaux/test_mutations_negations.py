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
    ('faux ami « no kidding » retire', "such problem kidding thanks", "such problem thanks", "such problem kidding thanks", "such problem thanks"),
    # (« only » ferait un mutant EQUIVALENT : il est aussi dans _NEG_EXCEPT, le texte reste refuse ; « too » n'est dans aucune autre liste)
    ('faux ami « not too » retire', "'not': frozenset(('only just too very", "'not': frozenset(('only just very", "not: _mots('only just too very", "not: _mots('only just very"),
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
    # (« holding » ferait un mutant EQUIVALENT cote JavaScript depuis le 2026-10-18 : il est aussi dans la liste des participes du sujet ; « hanging » n'est que dans celle-ci)
    ('verbe « hanging » retire', "leaning resting hanging jumping", "leaning resting jumping", "leaning resting hanging jumping", "leaning resting jumping"),
    ('fin de groupe « with » retiree', "'and or nor but with without in on at", "'and or nor but without in on at", "'and or nor but with without in on at", "'and or nor but without in on at"),
    ('conjonction « but » retiree', "_NEG_CONJ = frozenset('and or nor but'.split())", "_NEG_CONJ = frozenset('and or nor'.split())",
     "NEG_CONJ = _mots('and or nor but')", "NEG_CONJ = _mots('and or nor')"),
    ('« wearing no X » non reconnu', "'with and but or plus having has holding wearing carrying", "'with and but or plus having has holding carrying",
     "_mots('with and but or plus having has holding wearing carrying", "_mots('with and but or plus having has holding carrying"),
    ('« not wearing X » en milieu de phrase retire', "_NEG_LEGERS_NOT = frozenset('wearing holding", "_NEG_LEGERS_NOT = frozenset('holding",
     "NEG_LEGERS_NOT = _mots('wearing holding", "NEG_LEGERS_NOT = _mots('holding"),
    # (« plus » ferait un mutant EQUIVALENT : il est aussi dans _NEG_AVANT_NO et _NEG_PENDANTS ; « also » n'est dans aucun des deux de la meme facon)
    ('liaison « also » retiree', "_NEG_DEBUT = frozenset('and but or with plus also yet'", "_NEG_DEBUT = frozenset('and but or with plus yet'",
     "NEG_DEBUT = _mots('and but or with plus also yet')", "NEG_DEBUT = _mots('and but or with plus yet')"),
    ('« without » au milieu d\'une phrase ignore', "            elif w == 'without':\n", "            elif w == 'without_':\n", "} else if (w === 'without') {", "} else if (w === 'without_') {"),
    ('garde des titres (« Without Remorse ») retiree', "            elif _neg_majuscule(jeton) and not casse_libre:\n", "            elif False:\n",
     "} else if (negMajuscule(jeton) && !casseLibre) {", "} else if (false) {"),
    ('negation entre parentheses non reconnue', "            elif jeton[0] in '([{':\n", "            elif jeton[0] in '[{':\n", "} else if ('([{'.includes(jeton[0])) {", "} else if ('[{'.includes(jeton[0])) {"),
    ('citation « "No entry" » prise pour une negation', "                if jeton[0] not in '\"\\u201c':", "                if True:",
     "if (!'\"\u201c'.includes(jeton[0])) {", "if (true) {"),
    ('point final perdu', "gardes[-1][1] = '.' if morceaux[-1][1].startswith('.') else ''", "gardes[-1][1] = ''",
     "gardes[gardes.length - 1][1] = morceaux[morceaux.length - 1][1].startsWith('.') ? '.' : '';", "gardes[gardes.length - 1][1] = '';"),
    ('les premiers mots au lieu des trois derniers', "mots = mots[-MAX_MOTS_TERME:]", "mots = mots[:MAX_MOTS_TERME]", "mots = mots.slice(-MAX_MOTS_TERME);", "mots = mots.slice(0, MAX_MOTS_TERME);"),
    # (tour 2, 24/10 : la boucle a ete reecrite en « if t in etat: continue » + « perdus » ; la specification de la mutation suit le code actuel)
    ('doublon dans une meme liste accepte', "                    if t in etat:\n                        continue\n", "                    if False:\n                        continue\n",
     "if (etat.includes(t)) continue;", "if (false) continue;"),
    ('liste par virgules : fermeture par conjonction retiree', "if items and (ferme_conj or (len(items) >= 2 and simples)):", "if items and (False or (len(items) >= 2 and simples)):",
     "if (items.length && (fermeConj || (items.length >= 2 && simples)))", "if (items.length && (false || (items.length >= 2 && simples)))"),
    ('liste par virgules : un seul element simple suffit', "if items and (ferme_conj or (len(items) >= 2 and simples)):", "if items and (ferme_conj or (len(items) >= 1 and simples)):",
     "if (items.length && (fermeConj || (items.length >= 2 && simples)))", "if (items.length && (fermeConj || (items.length >= 1 && simples)))"),
    ('liste par virgules : une locution en tete de segment prolonge la liste', "and not ferme_der and not debut_der)", "and not ferme_der)",
     "&& !fermeDer && !debutDer)", "&& !fermeDer)"),
    ('liste par virgules : un verbe est admis comme element', "or _neg_verbal(jt):", "or False:",
     "|| negVerbal(jt)) return null;", "|| false) return null;"),
    ('« without X and Y » ne prolonge plus', "if not repete and w == 'and' and decl != 'without':", "if not repete and w == 'and' and decl != 'no':",
     "if (!repete && w === 'and' && decl !== 'without') return null;", "if (!repete && w === 'and' && decl !== 'no') return null;"),
    ('« and holding » orphelin garde', "and fin + 1 < n and _neg_verbal(jetons[fin + 1]):", "and fin + 1 < n and False:",
     "&& fin + 1 < n && negVerbal(jetons[fin + 1])) return fin + 1;", "&& fin + 1 < n && false) return fin + 1;"),
    ('separateur « | » retire', "c in ',;|\\r\\n'", "c in ',;\\r\\n'", "',;|\\r\\n'.includes(c)", "',;\\r\\n'.includes(c)"),
    ('plafond de assainir 8 -> 9', "if len(sortie) >= MAX_TERMES_NEGATIFS:", "if len(sortie) > MAX_TERMES_NEGATIFS:",
     "if (sortie.length >= MAX_TERMES_NEGATIFS) break;", "if (sortie.length > MAX_TERMES_NEGATIFS) break;"),
    ('apostrophe acceptee dans un terme', "if not (('a' <= ch <= 'z') or ch == '-'):\n            return False\n    return True",
     "if not (('a' <= ch <= 'z') or ch == '-' or ch == \"'\"):\n            return False\n    return True",
     "if (!((ch >= 'a' && ch <= 'z') || ch === '-')) return false;\n  }\n  return true;", "if (!((ch >= 'a' && ch <= 'z') || ch === '-' || ch === \"'\")) return false;\n  }\n  return true;"),
    ('« wielding » n est plus un verbe leger', "_NEG_LEGERS = frozenset('wearing holding carrying wielding having", "_NEG_LEGERS = frozenset('wearing holding carrying having",
     "const NEG_LEGERS = _mots('wearing holding carrying wielding having", "const NEG_LEGERS = _mots('wearing holding carrying having"),
    ('garde de la double negation retiree', "            elif _neg_avant_negatif(sortie):\n                decl = None", "            elif False:\n                decl = None",
     "} else if (negAvantNegatif(sortie)) {", "} else if (false) {"),
    ('au-dela du plafond la locution reste dans le positif', "                modifie = True\n                if debut:", "                modifie = any(t in etat for t in termes)\n                if debut:",
     "        modifie = true;\n        if (debut) {", "        modifie = termes.some((t) => etat.includes(t));\n        if (debut) {"),
    ('morceau a tiret sensible accepte (« t-shirt »)', "any(p in _NEG_SENSIBLES for p in m.split('-'))", "m in _NEG_SENSIBLES",
     "if (!negMotPropre(m) || m.split('-').some((p) => NEG_SENSIBLES.has(p))) return null;", "if (!negMotPropre(m) || NEG_SENSIBLES.has(m)) return null;"),
    # 2026-10-15 : regles ajoutees aux passes du 14/10 (assainir, enveloppe, complement porte, titre suivi d'un nom)
    ('assainir_negatifs accepte la garde-robe', "        if any(p in _NEG_SENSIBLES for m in mots for p in m.split('-')):\n            continue\n", "",
     "    if (mots.some((m) => m.split('-').some((p) => NEG_SENSIBLES.has(p)))) continue;\n", ""),
    ('texte de plus de 2000 caracteres coupe par l\'enveloppe', "    if len(t) > MAX_TEXTE_NEGATIONS:\n        return {'positif': t, 'negatifs': []}\n    r = extraire_negations(t, regles)",
     "    r = extraire_negations(t, regles)", "  if (negTropLong(t)) return { positif: t, negatifs: [] };\n  const r = extraireNegations(t, regles);",
     "  const r = extraireNegations(t, regles);"),
    ('texte entierement negatif : positif vide', "    if not _neg_strip(r['positif']):", "    if False:", "  if (!negStrip(r.positif)) return { positif: t, negatifs: r.negatifs, ...(r.perdus", "  if (false) return { positif: t, negatifs: r.negatifs, ...(r.perdus"),
    ('complement « on his head » laisse dans le positif', "    if w in _NEG_PREP_PORTE and fin + 2 < n and", "    if False and fin + 2 < n and",
     "  if (NEG_PREP_PORTE.has(w) && fin + 2 < n &&", "  if (false && fin + 2 < n &&"),
    ('titre « Without Remorse hero » pris pour une negation', "titre = capitales >= 2 or _neg_titre_puis_nom(jetons, i)", "titre = capitales >= 2",
     "titre = capitales >= 2 || negTitrePuisNom(jetons, i);", "titre = capitales >= 2;"),
    ('possesseur garde (« knight\'s helmet »)', "    mots = _neg_apres_possessif(mots)\n    mots = mots[-MAX_MOTS_TERME:]", "    mots = mots[-MAX_MOTS_TERME:]",
     "  mots = negApresPossessif(mots);\n  mots = mots.slice(-MAX_MOTS_TERME);", "  mots = mots.slice(-MAX_MOTS_TERME);"),
    ('capitales (« WITHOUT ») prises pour un titre', "        if 'a' <= ch <= 'z':\n            return True\n    return False\n\n\ndef _neg_casse_libre",
     "        if 'a' <= ch <= 'z':\n            return True\n    return True\n\n\ndef _neg_casse_libre",
     "    if (jeton[k] >= 'a' && jeton[k] <= 'z') return true;\n  }\n  return false;\n}\n\n/** La casse du texte",
     "    if (jeton[k] >= 'a' && jeton[k] <= 'z') return true;\n  }\n  return true;\n}\n\n/** La casse du texte"),
    ('regle « negations » eteinte par defaut', "REGLES_ACTIVES = ('objets', 'negations')", "REGLES_ACTIVES = ('objets',)", "REGLES_ACTIVES = ['objets', 'negations'];", "REGLES_ACTIVES = ['objets'];"),
    # 2026-10-18 : participe du sujet, conjonction apres la locution, second declencheur avec un verbe leger
    ('participe du sujet en fin de segment ignore', "    if sujet and w in _NEG_PARTICIPES_SUJET:\n        return True\n", "    if False and sujet and w in _NEG_PARTICIPES_SUJET:\n        return True\n",
     "  if (sujet && NEG_PARTICIPES_SUJET.has(w)) return true;\n", "  if (false && sujet && NEG_PARTICIPES_SUJET.has(w)) return true;\n"),
    ('segment qui commence par la negation traite comme une phrase a sujet', "sujet = not (debut and not sortie)", "sujet = True",
     "const sujet = !(debut && !sortie.length);", "const sujet = true;"),
    ('participe pris pour un element de la liste nie', " or w3 in _NEG_PARTICIPES_SUJET or w3 in _NEG_FINIS):", " or w3 in _NEG_FINIS):",
     " || NEG_PARTICIPES_SUJET.has(w3) || NEG_FINIS.has(w3)) return null;", " || NEG_FINIS.has(w3)) return null;"),
    ('conjonction apres la locution ignoree', "suite = _neg_conj_apres(jetons, reprise) if reprise == fin else None", "suite = None",
     "let suite = reprise === res[1] ? negConjApres(jetons, reprise) : null;", "let suite = null;"),
    ('lien de la conjonction remplacee non repris', "                    elif lien:\n", "                    elif False:\n", "} else if (lien) {", "} else if (false) {"),
    ('verbe leger du second declencheur non saute', "saut_g = _NEG_SAUT_AUTRES if (repete or decl != 'no') else saut", "saut_g = saut",
     "const sautG = (repete || decl !== 'no') ? NEG_SAUT_AUTRES : saut;", "const sautG = saut;"),
    ('conjonction pendante en fin de texte gardee', "    if fin + 1 >= n:\n        return ('drop', n)\n", "    if fin + 1 >= n:\n        return None\n",
     "if (fin + 1 >= n) return ['drop', n];", "if (fin + 1 >= n) return null;"),
    ('preposition « with » apres la conjonction non reconnue', "_NEG_PREPS_COMPL = frozenset('with without in on", "_NEG_PREPS_COMPL = frozenset('without in on",
     "const NEG_PREPS_COMPL = _mots('with without in on", "const NEG_PREPS_COMPL = _mots('without in on"),
    ('pronom apres la conjonction pris pour un complement', "or t in _NEG_PRONOMS or t in _NEG_COPULES or _neg_verbal(jetons[fin + 1])", "or _neg_verbal(jetons[fin + 1])",
     "NEG_PRONOMS.has(t) || NEG_COPULES.has(t) || negVerbal(jetons[fin + 1])", "negVerbal(jetons[fin + 1])"),
    ('participe « smiling » retire', "dancing smiling laughing", "dancing laughing", "dancing smiling laughing", "dancing laughing"),
    ('verbe « raising » retire', "marching raising lifting", "marching lifting", "marching raising lifting", "marching lifting"),
    ('participe « standing » retire de la liste du sujet', "_NEG_PARTICIPES_SUJET = frozenset(('standing sitting", "_NEG_PARTICIPES_SUJET = frozenset(('sitting",
     "const NEG_PARTICIPES_SUJET = _mots('standing sitting", "const NEG_PARTICIPES_SUJET = _mots('sitting"),
]


def appliquer(texte, ancien, nouveau, nom):
    n = texte.count(ancien)
    if n != 1:
        raise AssertionError('mutation « %s » : %d occurrence(s) de %r (la specification de la mutation est perimee)' % (nom, n, ancien))
    return texte.replace(ancien, nouveau)


def lire(chemin):
    with io.open(chemin, 'r', encoding='utf-8', newline='') as f:
        # fins de ligne ramenees a LF : les specifications de mutation ci-dessus sont ecrites avec \n ; un arbre extrait avec core.autocrlf=true (CRLF) les rendait
        # « perimees » (0 occurrence) et faisait echouer ce banc sans que rien n'ait change (constate le 2026-10-14)
        return f.read().replace('\r\n', '\n')


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
