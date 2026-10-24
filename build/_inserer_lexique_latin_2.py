# Seconde passe du lexique des langues latines (lot securite du 24/10) : generalisation mesuree sur le second jeu de textes courts
# (build/bancs/moderation/textes_courts_cas_2.json). Meme principe que _inserer_lexique_latin.py. Script d'un seul usage.
# Les adjectifs de nudite dont la forme repliee est un mot courant (gol, nahe, naga, nogen, kaila) ne sont ecrits que JOINTS a un nom de
# personne ou de corps (« gola zena », « nahe telo »), jamais seuls.
import re, sys, io

CHEMIN = sys.argv[1]
s = io.open(CHEMIN, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

def produit(avant, adjs, noms, apres=False):
    out = []
    for a in adjs.split():
        for n in noms.split():
            out.append((n + ' ' + a) if apres else (a + ' ' + n))
    return out

PHR = []
# polonais : adjectif avant le nom
PHR += produit(False, "naga nagi nagie nagiego nagiej nagim nagich nadzy",
  "kobieta kobiety kobiet dziewczyna dziewczynka dziewczynki nastolatka nastolatek chlopak chlopiec mezczyzna mezczyzni para model modelka ludzie osoba osoby "
  "dziecko dzieci niemowle cialo ciala aktorka tancerka postac panie")
# roumain : nom avant l adjectif
PHR += produit(False, "gol goi", "bebelus copil copila copii baiat baieti barbat barbati adolescent adolescenta model corp cuplu om oameni persoana personaj actrita dansatoare femei fete", apres=True)
# tcheque
PHR += produit(False, "naha nahy nahe nahou nahych nahem",
  "zena zeny divka divky holka holcicka teenagerka dospivajici chlapec muz muzi par model modelka lide clovek dite deti miminko telo tela herecka tanecnice postava")
# slovaque
PHR += produit(False, "naha nahy nahe nahi nahych nahu",
  "zena zeny dievca dievcatko dievcina tinedzerka tinedzer chlapec muz par model modelka ludia clovek dieta deti babatko telo hereckyna postava")
# croate, serbe, bosniaque, slovene
PHR += produit(False, "gola gol golo goli gole golu golog golim",
  "zena zene zenska djevojka djevojcica djevojke devojka devojcica tinejdzerka tinejdzer najstnica najstnik decko decak djecak fant muskarac muz par model manekenka "
  "manekenke ljudi ljudje osoba dijete djeca dete deca dojencica beba bebe tijelo telo glumica plesacica lik punca dekle deklica")
# danois (forme repliee de « nøgen » = « nogen », quelqu un)
PHR += produit(False, "nogen", "kvinde pige dreng mand barn baby teenager model krop dame skuespillerinde danserinde")
PHR += produit(False, "nogne nogent",
  "kvinde kvinder pige piger dreng drenge mand maend barn born baby teenager teenagere model krop par mennesker person dame damer skuespillerinde danserinde")
# letton (« kaila » est aussi un prenom)
PHR += produit(False, "kaila kailas kailu kaili", "sieviete sievietes meitene meitenes vira viri pusaudze modele cilveki cilveks pars berns berni zidainis kermenis aktrise")
# swahili : nom avant « uchi »
PHR += produit(False, "uchi", "mwanamke msichana mtoto mvulana mwanaume mtu watu wapenzi mwili kijana mwanamitindo wanawake wasichana watoto mchanga", apres=True)
# islandais : « an fata » (sans vetements)
PHR += [n + ' an fata' for n in "stelpa stulka kona madur drengur barn strakur unglingur folk par".split()]
# divers
PHR += ["sine vestibus", "san rad", "tanpa klambi", "minghajr hwejjeg", "minghajr ilbies", "pa veshje", "roba interior"]

NU_MOTS = ("berpakaian dalam bertelanjang* undertoj undertoy alastom* alusvaat* fehernem* bielizen 'spodni prad*' 'donjem rublju' 'donjeg rublja' 'donjim rubljem' "
           "'spodnjem perilu' 'spodnje perilo' nudaj nudan nudajn")
NU_MOYEN = ("'zonder shirt' 'zonder trui' 'zonder t shirt' 'zonder bovenkleding' 'zonder broek' 'zonder ondergoed' 'bez koszulki' 'bez bluzki' 'bez gornej czesci' "
            "'fara tricou' 'fara bluza' 'fara camasa' 'bez tricka' 'bez trika' 'bez horni casti' 'bez majice' 'bez gornjeg dijela' 'brez majice' "
            "'utan troja' 'utan tshirt' 'utan skjorta' 'utan overdel' 'uden troje' 'uden trojen' 'uden overdel' 'uten genser' 'uten overdel' 'uten skjorte' 'uten topp' "
            "'ilman paitaa' paidaton paidatta 'polo nelkul' 'felsotest nelkul' tisortsuz gomleksiz 'khong mac ao' 'tanpa atasan' 'bez koszuli'")

def toks(t):
    return [x if x.startswith("'") else "'" + x + "'" for x in re.findall(r"'[^']*'|\S+", t)]

def bloc(titre, termes, entete):
    lignes = ['  // ' + titre, '  // ' + entete]
    ligne = '  '
    for t in termes:
        if len(ligne) + len(t) + 2 > 128:
            lignes.append(ligne.rstrip()); ligne = '  '
        ligne += t + ', '
    lignes.append(ligne.rstrip())
    return nl.join(lignes) + nl

TITRE = ('2026-10-24 (lot securite, textes courts, seconde passe) : generalisation mesuree sur un second jeu ; adjectifs ambigus (gol, nahe, naga, nogen, kaila) '
         'seulement JOINTS a un nom de personne ou de corps')

def inserer(nom, termes, entete):
    global s
    m = re.search(r'^const ' + re.escape(nom) + r': string\[\] = \[', s, re.M)
    assert m, nom
    f = s.index(nl + '];', m.end())
    s = s[:f + len(nl)] + bloc(TITRE, termes, entete) + s[f + len(nl):]

nu_tous = ["'" + p + "'" for p in PHR] + toks(NU_MOTS)
inserer('GENERAL_SEXUEL_DUR', nu_tous, 'nudite jointe a un nom ; sous-vetements')
inserer('NU_FORT', nu_tous, 'nudite jointe a un nom ; sous-vetements')
inserer('NU_MOYEN', toks(NU_MOYEN), 'torse nu / sans haut')
io.open(CHEMIN, 'w', encoding='utf-8', newline='').write(s)
print('ok', len(nu_tous), 'termes de nudite')
