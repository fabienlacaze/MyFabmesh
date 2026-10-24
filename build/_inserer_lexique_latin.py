# Insere le lexique des langues latines hors du filtre general (lot securite du 24/10) dans cloud/src/nsfw_filter.ts.
# Script d'un seul usage (documente la provenance des termes) : les termes vivent ensuite dans nsfw_filter.ts, qui reste la source.
# Termes ecrits sous leur forme repliee (sans accents, ø -> o, ł -> l...) comme le reste des listes ; seuls les mots dont la forme
# repliee est un mot courant d'une autre langue ou de l'anglais passent par la vue Unicode (NU_FORT_UNICODE) ou par des tournures.
import re, sys, io

CHEMIN = sys.argv[1]
s = io.open(CHEMIN, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

# (langue, termes) : nudite / sous-vetements / sexe, ajoutes a GENERAL_SEXUEL_DUR ET NU_FORT
NU = [
 ('neerlandais', "bloot blote blootje* blootgelegd* ontbloot* 'zonder kleren' 'zonder kleding' 'zonder kleertjes' tepel tepels borsten geslachtsdeel* "
   "geslachtsorga* verkracht* verkrachting onderbroek* slipje* 'in zijn blootje' 'in haar blootje'"),
 ('indonesien, malais, javanais, soundanais', "'tanpa busana' 'tanpa pakaian' 'tanpa baju' 'tidak berpakaian' 'tak berpakaian' bogel berbogel payudara 'alat kelamin' "
   "kemaluan 'celana dalam' perkosa perkosaan seksual* erotis* wuda taranjang buligir"),
 ('polonais', "'naga kobieta' 'naga dziewczyna' 'naga dziewczynka' 'naga dziewczynke' 'nagi mezczyzna' 'nagi chlopiec' 'nagi chlopak' 'nagi chlopczyk' "
   "'bez ubrania' 'bez ubran' 'bez odziezy' rozneglizowan* sutek sutki piersi cipka 'narzady plciowe' gwalt gwalty gwalcic gwalcen* majtki erotyczn* seksown*"),
 ('roumain', "goala goale golas* nud dezbracat* 'fara haine' 'fara imbracaminte' 'organe genitale' lenjerie* chiloti 'femeie gol' 'copil gol' 'baiat gol' 'barbat gol'"),
 ('suedois', "naken naket nakna nakenhet avkladd* 'utan klader' barbrostad* brostvarta* brostvartor underklader* trosor kalsonger sexig* erotisk* porr porrig "
   "valdtakt* konsorgan* 'naken barn' 'naket barn'"),
 ('danois, norvegien', "afklaedt* 'uden toj' 'uden klaeder' brystvorte* underbukser* trusser voldtaegt* voldtekt* voldta* ubekledd* avkledd* 'uten klaer' "
   "'uten kler' naken nakne nakent truse 'nogen kvinde' 'nogen pige' 'nogent barn' 'nogen dreng' 'nogen mand' 'nogne piger' 'nogne born'"),
 ('finnois, estonien', "alaston* alasti alastomuus 'ilman vaatteita' vaatteeton vaatteettom* riisut* riisuutu* rinnat alusvaate* alushousu* sukupuolielin* raiskaus raiskat* "
   "seksikas* erootti* 'ilma riieteta' riieteta 'alasti naine' 'alasti tudruk' 'alasti laps' 'alasti poiss'"),
 ('hongrois', "meztelen* ruhatlan* 'ruha nelkul' levetkozott levetkoz* felmeztelen* mellbimbo* szemeremtest* 'nemi szerv*' alsonem* bugyi bugyik szexi szexualis* erotikus*"),
 ('tcheque, slovaque', "nahy nahych 'naha zena' 'naha divka' 'naha holka' 'naha holcicka' 'nahe dite' 'nahe deti' 'nahy chlapec' 'nahy muz' 'naha dievcina' 'nahe dievca' 'nahe dieta' "
   "svlecen* vysvlecen* 'bez oblecenia' 'bez obleceni' 'bez satu' bradavk* 'pohlavni organ*' 'pohlavne organ*' 'spodni pradlo' 'spodne pradlo' kalhotky znasilne* erotick*"),
 ('croate, serbe, bosniaque, slovene', "'gola zena' 'gola djevojka' 'gola djevojcica' 'golo dijete' 'gol decko' 'gol djecak' 'goli muskarac' 'golo dete' 'gola devojka' 'gola devojcica' "
   "'gola zenska' 'gola deklica' 'gol fant' 'goli fant' razodjeven* razgoljen* svucen* svlacen* 'bez odjece' 'bez odece' 'bez oblacil' 'bez obleke' bradavic* "
   "'spolni organ*' 'donje rublje' gacice silovan* silovanje"),
 ('turc, azeri, ouzbek', "cilpaq* geyimsiz yalangoch 'yalang och' kiyimsiz"),
 ('vietnamien sans accents', "'tran truong' 'khong mac quan ao' 'khong mac do' 'khong mac gi' 'khong quan ao' 'quan lot' 'cuong dam'"),
 ('tagalog, cebuano', "hubad 'hubo t hubad' 'hubong hubad' 'walang damit' 'walang saplot' 'walang suot'"),
 ('swahili', "'mwanamke uchi' 'msichana uchi' 'mtoto uchi' 'mvulana uchi' 'mwanaume uchi' 'mtu uchi' 'bila nguo' 'bila nguo yoyote'"),
 ('catalan, galicien, occitan', "despull* 'sense roba' 'sen roupa' espid* nudu"),
 ('albanais, letton, lituanien', "lakuriq* zhveshur* 'pa rroba' nuog* 'be drabuziu' kails 'kaila sieviete' 'kaila meitene' 'kaila sieva' 'bez drebem'"),
 ('islandais, afrikaans, basque, gallois', "nakin* nakid naak 'sonder klere' biluzi* 'arroparik gabe' noeth noethlymun 'heb ddillad'"),
 ('latin, esperanto, celtiques, frison', "nudus nudum nudae nudos 'sen vestoj' nocht* ruisgte noazh nackeg* neaken"),
 ('langues d afrique, d oceanie', "qaawan* tsirara ihoho qunube tahanga olohelohe toutouni gharwien* gharwiena"),
]

# MINEURS_FORT : enfant sans ambiguite (un seul de ces mots + une nudite = plancher)
MF = [
 ('neerlandais', "kindje* tiener* dreumes* schoolmeisje* schooljongen* 'klein meisje' 'kleine jongen' zuigeling* 'naakt kind' 'bloot kind' 'blote kleuter'"),
 ('indonesien, malais', "bocah* 'kanak kanak' budak 'budak budak' batita siswi* 'anak perempuan' 'anak laki laki' 'budak perempuan'"),
 ('polonais', "maluch* nastolat* nieletnia uczennic* dzieciak* dziewczynce 'maly chlopiec' 'mala dziewczynka' 'nagie dziecko'"),
 ('roumain', "copil copii copilul copila copilasi baietel* bebelus* fetita fetite fetitei 'copil gol'"),
 ('suedois, danois, norvegien, islandais', "barnet barnen barna 'ett barn' 'et barn' 'lite barn' 'litet barn' 'lille barn' tonaring* minderarig* mindrearig* skolflicka* skolepige* skoledreng* "
   "spadbarn* spaedbarn* smabarn* bebis* 'naken barn' 'naket barn' 'nakent barn' 'nogent barn' 'nakid barn' 'nakin barn'"),
 ('finnois', "lapsi lapsen lapsia lapset lasta lapsena lapselle lapsella teini* alaikais* vauva* taapero* koulutyto* 'alasti lapsi' 'alaston lapsi'"),
 ('estonien', "teismeline 'alasti laps'"),
 ('hongrois', "gyerek* gyermek* kisgyerek* csecsemo* kamasz* kiskoru* kislany* kisfiu*"),
 ('tcheque, slovaque', "dite ditete deti detmi holcicka holcicku holcicky chlapecek* nezletil* miminko mimino batole kojenec kojenc* dospivajici dievcatko 'nahe dieta' 'male dieta'"),
 ('croate, serbe, slovene', "dijete djeteta djetetu djeca djece djecu dete deteta deca dece djevojcic* devojcic* djecak* decak* otrok otroka otroci deklic* fantek* najstnic* mladoletn* dojencek*"),
 ('vietnamien sans accents', "'thieu nien' 'nhi dong'"),
 ('tagalog', "'batang babae' 'batang lalaki' 'mga bata' sanggol paslit binatilyo dalagita musmos 'hubad na bata'"),
 ('swahili', "mtoto watoto 'mtoto mchanga'"),
 ('catalan', "nen nens nenes"),
 ('albanais, letton, lituanien, basque, galicien', "femije* berns berni bernu berna bernam pusaudz* vaikas vaikai vaiko vaiku vaikus paaugl* kudik* haur* nerabe neno nenos nenas"),
 ('turc, azeri, ouzbek', "usaq usaqlar korpe"),
 ('latin, esperanto, celtiques', "infans infano infanoj leanbh leanabh bugale"),
 ('langues d afrique, d oceanie', "ilmo ilmaha carruur dhallaan tfal tarbija timoun ingane abantwana umntwana tamariki tamaiti keiki"),
 ('luxembourgeois', "kanner meedchen*"),
]

# MINEURS_AMBIGUS : fille / garcon (plancher seulement avec une nudite explicite)
MA = [
 ('neerlandais, afrikaans', "meisies seun seuns"),
 ('indonesien', "gadis cewek"),
 ('polonais', "panienk*"),
 ('roumain', "baiat baieti"),
 ('suedois, danois, norvegien, islandais', "flicka* flickor pojk* pige piger dreng* jente* jenter gutt gutten gutter stelpa stulka stelpur strakur drengur"),
 ('finnois, estonien', "tytto* tytot poika pojan poikaa pojat tudruk* poiss poisi poisid"),
 ('hongrois', "lany lanyok lanyt lanyka fiu fiut fiuk"),
 ('tcheque, slovaque, croate, serbe', "divka divky divku holka holky holku chlapec chlapce chlapci dievca djevojk* devojk* dijevojka"),
 ('vietnamien sans accents', "'thieu nu' 'co gai' 'chang trai'"),
 ('tagalog', "dalaga bata"),
 ('swahili', "msichana mvulana"),
 ('catalan', "noia noies"),
 ('albanais, letton, lituanien, basque', "vajze* djale* meitene* mergait* berniuk* neska mutil*"),
 ('turc, azeri, ouzbek, somali', "qiz qizlar gabadh wiil"),
 ('latin, esperanto, celtiques, gallois', "puella puellae puer pueri knabino knabinoj knabo cailin buachaill* nighean balach bachgen geneth"),
 ('langues d afrique, d oceanie', "yarinya yaro omobinrin omokunrin intombazane umfana kotiro kaikamahine tifel tifla"),
]

# NU_FORT_UNICODE : formes dont la version repliee est un mot courant (« nøgen » -> « nogen », danois : quelqu un)
NUU = [
 ('danois, norvegien, polonais', "nøgen nøgne nøgent nøgenhed goła gołe goły gołą gołego gołej gołych"),
]

def bloc(titre, groupes):
    lignes = ['  // ' + titre]
    for langue, termes in groupes:
        toks = re.findall(r"'[^']*'|\S+", termes)
        toks = [t if t.startswith("'") else "'" + t + "'" for t in toks]
        # une ligne par langue, coupee vers 125 caracteres
        cur = '  // ' + langue
        lignes.append(cur)
        ligne = '  '
        for t in toks:
            if len(ligne) + len(t) + 2 > 128:
                lignes.append(ligne.rstrip())
                ligne = '  '
            ligne += t + ', '
        lignes.append(ligne.rstrip())
    return nl.join(lignes) + nl

ENTETE = ('2026-10-24 (lot securite, textes courts) : langues latines HORS du filtre general. Mots de nudite / mineur courants et non ambigus ; '
          'les mots dont la forme repliee est un mot courant sont ecrits en tournures ou dans la vue Unicode')

def inserer(nom, groupes):
    global s
    m = re.search(r'^const ' + re.escape(nom) + r': string\[\] = \[', s, re.M)
    assert m, nom
    f = s.index(nl + '];', m.end())
    s = s[:f + len(nl)] + bloc(ENTETE, groupes) + s[f + len(nl):]

inserer('GENERAL_SEXUEL_DUR', NU)
inserer('NU_FORT', NU)
inserer('MINEURS_FORT', MF)
inserer('MINEURS_AMBIGUS', MA)
inserer('NU_FORT_UNICODE', NUU)
io.open(CHEMIN, 'w', encoding='utf-8', newline='').write(s)
print('ok')
