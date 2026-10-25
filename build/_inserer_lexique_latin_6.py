# Sixieme passe (lot securite du 24/10) : langues a ecriture NON latine ecrites en LETTRES LATINES (hindi / ourdou, russe, japonais, chinois pinyin,
# persan, coreen, grec). Le filtre lit deja ces langues dans leur ecriture d origine (vue Unicode) ; la romanisation passait. Mots de nudite et
# d enfant courants et non ambigus ; les mots qui sont aussi des noms propres connus (Nanga Parbat, Aryan, Kodak) ne sont ecrits que joints.
# Script d un seul usage.
import re, sys, io

CHEMIN = sys.argv[1]
s = io.open(CHEMIN, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

NU = ("'nangi ladki' 'nangi aurat' 'nangi mahila' 'nanga ladka' 'nanga bacha' 'nanga admi' 'nangi bachi' 'nange bacche' 'nangi larki' 'nanga larka' nangi "
      "'bina kapde' 'bina kapdon' 'bina kapdon ke' "
      "golaya golyj golyy golyshom razdetaya razdetyj 'razdeta' obnazhennaya obnazhyonnaya obnazhennyj 'bez odezhdy' 'bez odezhdi' 'golaya devushka' 'golaya zhenshchina' "
      "hadaka zenra oppai chikubi pantsu shitagi "
      "luoti 'luo ti' quanluo banluo chiluo tuoguang 'tuo guang' "
      "berahne berahneh lokht lokhti nachae "
      "gymnos gymni gimnos gimni 'xoris rouxa' 'xwris rouxa' 'choris rouxa'")
MF = ("bachcha bachchi bacche bachche 'chhota bacha' 'chhoti bachi' rebenok rebyonok rebenka devochka devochku malchik malchika podrostok rori kodomo akachan haizi "
      "'xiao haizi' ertong yinger xiaonvhai 'xiao nuhai' kudak paidi paidia paidaki paidakia")
MA = "ladki ladka larki larka devushka shoujo nvhai nuhai dokhtar pesar sonyeo sonyeon koritsi koritsaki agori agoraki"
MOY = "mizugi sukumizu"

def toks(t):
    return [x if x.startswith("'") else "'" + x + "'" for x in re.findall(r"'[^']*'|\S+", t)]

TITRE = '2026-10-24 (lot securite, textes courts, sixieme passe) : langues non latines ecrites en lettres latines (romanisations)'

def inserer(nom, termes):
    global s
    m = re.search(r'^const ' + re.escape(nom) + r': string\[\] = \[', s, re.M)
    assert m, nom
    f = s.index(nl + '];', m.end())
    lignes = ['  // ' + TITRE]
    ligne = '  '
    for t in termes:
        if len(ligne) + len(t) + 2 > 128:
            lignes.append(ligne.rstrip()); ligne = '  '
        ligne += t + ', '
    lignes.append(ligne.rstrip())
    s = s[:f + len(nl)] + nl.join(lignes) + nl + s[f + len(nl):]

inserer('GENERAL_SEXUEL_DUR', toks(NU))
inserer('NU_FORT', toks(NU))
inserer('MINEURS_FORT', toks(MF))
inserer('MINEURS_AMBIGUS', toks(MA))
inserer('NU_MOYEN', toks(MOY))
io.open(CHEMIN, 'w', encoding='utf-8', newline='').write(s)
print('ok')
