# Troisieme passe du lexique des langues latines (lot securite du 24/10) : constructions « sans vetements », parties du corps decouvertes,
# verbe + adjectif ambigu, mesurees sur le troisieme jeu (textes_courts_cas_3.json, ecrit sans regarder le lexique). Script d'un seul usage.
import re, sys, io

CHEMIN = sys.argv[1]
s = io.open(CHEMIN, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

def produit(adjs, noms, apres=False):
    return [((n + ' ' + a) if apres else (a + ' ' + n)) for a in adjs.split() for n in noms.split()]

PHR = []
# croate, serbe, bosniaque, slovene : verbe + adjectif ambigu (« gol » = but au football)
PHR += [v + ' ' + a for a in "gol go gola nag naga".split() for v in "trci trcao trcala tece hoda stoji lezi spava sjedi sedi ples pliva ide kupa".split()]
PHR += ['fant gol', 'fant go', 'decko gol', 'decko go']
# danois : verbe + « nogen » (nøgen replie)
PHR += [v + ' nogen' for v in "lober danser svommer poserer".split()]
PHR += [v + ' nogne' for v in "lober gar star ligger sover danser svommer sidder poserer".split()]
# roumain : verbe + « gol »
PHR += [v + ' gol' for v in "alearga doarme danseaza inoata poza".split()]
PHR += ['sanii goi', 'sani goi', 'sanii dezgoliti', 'sani dezgoliti', 'sanii expusi']
# afrikaans
PHR += produit("kaal", "vrou man meisie seun kind baba tiener model mense paartjie liggaam dogtertjie", apres=False)
PHR += [v + ' kaal' for v in "hardloop loop slaap staan lê sit dans swem poseer".split()]
# swahili
PHR += ['aliye uchi', 'akiwa uchi', 'wakiwa uchi', 'walio uchi', 'uchi kabisa', 'amevaa uchi', 'aliyevua nguo', 'bila ya nguo']
# cebuano, tagalog
PHR += ['nga hubo', 'na hubo', 'ng hubo', 'walay saput', 'walay sul-ob', 'walay bisti']
# haoussa, zoulou, somali, irlandais, latin, javanais, malais
PHR += ['ba tufafi', 'babu tufafi', 'engenazo izingubo', 'ngaphandle kwezingubo', 'dhar la aan', 'gan eadai', 'gan aon eadai', 'gan culaith',
        'sine veste', 'sine vestimentis', 'sine amictu', 'tanpa sandhangan', 'tanpa seurat benang', 'tanpa sehelai benang']
# « sans vetements » : preposition + vetement, formes flechies
PHR += ['bez ubranek', 'bez zadnych ubran', 'bez zadnego ubrania', 'bez jakiegokolwiek ubrania', 'bez ikakve odjece', 'bez ikakve odece', 'bez nikakve odjece',
        'bez ikakvog odijela', 'bez jakehokoli obleceni', 'bez zadneho obleceni', 'bez siat', 'bez saty', 'fara nici o haina', 'fara nimic pe ea', 'fara nimic pe el',
        'uden noget pa', 'uten noe pa seg', 'utan nagot pa sig', 'ilman mitaan paalla', 'ei ole mitaan paalla', 'ei mitaan paalla', 'semmi ruha nelkul', 'semmi ruhaban',
        'uzerinde hicbir sey', 'ustunde hicbir sey', 'ustunde bir sey yok', 'zonder iets aan', 'zonder niets aan', 'zonder enige kleding', 'senza niente addosso',
        'senza nulla addosso', 'sem nada de roupa', 'sem nada no corpo', 'sin nada de ropa', 'sense res de roba', 'sen nada de roupa', 'pa asnje veshje', 'be jokiu drabuziu',
        'bez nekahdam drebem', 'ilma midagi seljas', 'an nokkurra fata', 'ekkert a ser', 'sonder enige klere', 'tanpa apa apa', 'tidak memakai apa apa', 'tak memakai apa apa',
        'tidak mengenakan apa apa', 'khong mac gi tren nguoi', 'khong co gi tren nguoi', 'walang suot na damit', 'wala siyang suot']
# parties du corps decouvertes
PHR += ['golymi piersiami', 'golych piersi', 'gole piersi', 'piersiami', 'piersiach', 'piersiom', 'odkryte piersi', 'odslonietymi piersiami',
        'odhalenymi prsy', 'odhalena prsa', 'odhalenych prs', 'odhalene prsia', 'gole prsi', 'otkrivenih grudi', 'otkrivene grudi', 'gole grudi', 'golih grudi',
        'fedetlen mell', 'fedetlen mellekkel', 'meztelen mell', 'paljain rinnoin', 'paljaat rinnat', 'paljas rinta', 'rinnoin', 'rintoja', 'rinnoilla',
        'bare bryst', 'bart bryst', 'blotta brost', 'bar brost', 'bar overkrop', 'bar overkropp', 'goe bors', 'blote borsten', 'blote borst', 'blote bovenlijf', 'ontbloot bovenlichaam',
        'seio de fora', 'seios de fora', 'seios a mostra', 'seno scoperto', 'seni scoperti', 'petto nudo', 'a seno nudo', 'pit descobert', 'pits descoberts',
        'payudara terbuka', 'dada terbuka', 'goi sani', 'toplessa', 'ciplak gogus', 'acik gogus', 'gogusleri acik', 'gogsu acik']
# uchi / gol etc. : « uchi » est aussi un mot japonais ; « kaal » un nom propre : seulement joints (ci-dessus)

# mineurs : constructions « petite fille » etc. des langues ou le nom seul est ambigu
MF = ['mala dziewczynka', 'maly chlopiec', 'mala devojcica', 'mala djevojcica', 'maly chlapec', 'mala holcicka', 'male dievcatko', 'malo dete', 'majhna deklica',
      'lille pige', 'lille dreng', 'liten jente', 'lita jente', 'liten gutt', 'liten pojke', 'liten flicka', 'pieni tytto', 'pieni poika', 'kicsi lany', 'kisfiu',
      'mica fetita', 'micul baiat', 'klein meisje', 'kleine jongen', 'kleine dogter', 'kleine seun', 'bambina piccola', 'menina pequena', 'nena petita', 'nena gran',
      'batang babae', 'bata na babae', 'gamay nga bata', 'msichana mdogo', 'mvulana mdogo', 'kichkina qiz', 'kicik qiz', 'kicik oglan', 'vajze e vogel',
      'maza meitene', 'mazs zens', 'maza mergaite', 'maly berniukas', 'lita stelpa', 'litill strakur', 'vaike tudruk', 'vaike poiss', 'bocah wadon', 'bocah lanang',
      'yarinya', 'yarinya kara', 'intombazane encane', 'umfana omncane', 'gabadh yar', 'wiil yar', 'cailin beag', 'buachaill beag', 'merch fach', 'bachgen bach',
      'tifla zghira', 'tifel zghir', 'knabino malgranda', 'knabo malgranda', 'puella parva', 'puer parvus']

def toks(l):
    return ["'" + x + "'" for x in l]

def bloc(titre, termes):
    lignes = ['  // ' + titre]
    ligne = '  '
    for t in termes:
        if len(ligne) + len(t) + 2 > 128:
            lignes.append(ligne.rstrip()); ligne = '  '
        ligne += t + ', '
    lignes.append(ligne.rstrip())
    return nl.join(lignes) + nl

TITRE = '2026-10-24 (lot securite, textes courts, troisieme passe) : « sans vetements », parties du corps decouvertes, verbe + adjectif ambigu'

def inserer(nom, termes, titre=TITRE):
    global s
    m = re.search(r'^const ' + re.escape(nom) + r': string\[\] = \[', s, re.M)
    assert m, nom
    f = s.index(nl + '];', m.end())
    s = s[:f + len(nl)] + bloc(titre, termes) + s[f + len(nl):]

dedup = []
for p in PHR:
    if p not in dedup:
        dedup.append(p)
nu = toks(dedup)
inserer('GENERAL_SEXUEL_DUR', nu)
inserer('NU_FORT', nu)
mf = []
for p in MF:
    if p not in mf:
        mf.append(p)
inserer('MINEURS_FORT', toks(mf), '2026-10-24 (lot securite, textes courts, troisieme passe) : « petite fille / petit garcon » des langues ou le nom seul est ambigu')
io.open(CHEMIN, 'w', encoding='utf-8', newline='').write(s)
print('ok', len(nu), len(mf))
