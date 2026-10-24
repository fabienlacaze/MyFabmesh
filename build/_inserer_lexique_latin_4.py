# Quatrieme passe du lexique des langues latines (lot securite du 24/10) : « topless », verbes « se deshabiller » (participes), « sans pantalon ».
# Le quatrieme jeu de textes courts (textes_courts_cas_4.json) a donne la couverture A L'AVEUGLE avant cette passe ; elle ne sert plus de mesure
# independante apres. Script d'un seul usage.
import re, sys, io

CHEMIN = sys.argv[1]
s = io.open(CHEMIN, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

NU = ("toples toplos toplesa topplos 'ylaosatto*' ylaosaton 'nahore bez' 'hore bez' 'nahoru bez' 'sense dessobre' 'walang pang itaas' 'ulakeha paljas' "
      "'paljas ulakeha' 'bila nguo za juu' 'vyzlecen*' 'slecen*' 'nusireng*' 'izgerb*' 'lahti riietatud' 'uitgekleed*' 'despir*' '*hubad*' '*vua nguo*'")
MOYEN = ("'sem calcas' 'sem calcoes' 'tanpa celana' 'bez spodni' 'bez spodenek' 'fara pantaloni' 'utan byxor' 'uden bukser' 'uten bukser' 'ilman housuja' "
         "'nadrag nelkul' 'bez kalhot' 'bez nohavic' 'bez hlaca' 'bez hlac' 'brez hlac' 'pantolonsuz' 'sense pantalons' 'sin pantalones' 'senza pantaloni' "
         "'tanpa seluar' 'walang pantalon' 'bila suruali' 'zonder pantalon' 'uden underbukser' 'bez majtek' 'bez gaci' 'fara chiloti'")
UNI = "'ber að ofan', 'berfættur'"

def toks(t):
    return [x if x.startswith("'") else "'" + x + "'" for x in re.findall(r"'[^']*'|\S+", t)]

def bloc(titre, termes):
    lignes = ['  // ' + titre]
    ligne = '  '
    for t in termes:
        if len(ligne) + len(t) + 2 > 128:
            lignes.append(ligne.rstrip()); ligne = '  '
        ligne += t + ', '
    lignes.append(ligne.rstrip())
    return nl.join(lignes) + nl

TITRE = '2026-10-24 (lot securite, textes courts, quatrieme passe) : « topless », participes « deshabille », « sans pantalon »'

def inserer(nom, termes):
    global s
    m = re.search(r'^const ' + re.escape(nom) + r': string\[\] = \[', s, re.M)
    assert m, nom
    f = s.index(nl + '];', m.end())
    s = s[:f + len(nl)] + bloc(TITRE, termes) + s[f + len(nl):]

inserer('GENERAL_SEXUEL_DUR', toks(NU))
inserer('NU_FORT', toks(NU))
inserer('NU_MOYEN', toks(MOYEN))
inserer('NU_FORT_UNICODE', ["'ber að ofan'"])
io.open(CHEMIN, 'w', encoding='utf-8', newline='').write(s)
print('ok')
