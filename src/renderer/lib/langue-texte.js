// LANGUE DU TEXTE DE L'UTILISATEUR (2026-10-13, audit de la langue du 11/10 : TRADUCTION-01/06/07, CHAMPS-04, SERVEUR-01).
// FICHIER COMMUN bureau / site / worker : src/renderer/lib (source) = cloud/public/app/lib (copie, build/check-noyaux-partages.mjs) ;
// cloud/src/worker.ts l'importe aussi (filet de langue du serveur, route /api/translate). Aucune dependance, aucun reseau.
//
// POURQUOI. La traduction du prompt decidait d'apres la langue de l'INTERFACE seulement : un texte allemand sous une interface anglaise
// partait brut au moteur d'image (qui ne comprend que l'anglais), un texte espagnol sous une interface francaise etait traduit « depuis
// le francais », et la seule reconnaissance de l'anglais (_ressembleAnglais : deux mots outils anglais exiges) manquait un prompt anglais
// sur trois (« a red dragon », « wooden barrel », « A stone golem »...), renvoye au traducteur comme du francais.
//
// CE QUE FAIT LE MODULE (deterministe : expressions regulieres et listes de mots) :
//  - detecterLangue(texte) -> { langue, sure, ecriture } : langue du TEXTE. Ecriture non latine : la langue de l'ecriture (han, kana,
//    hangul, cyrillique, arabe, devanagari...). Ecriture latine : score par mots outils, mots courants des prompts et lettres accentuees.
//    `sure` = assez d'indices pour qu'un serveur agisse sans demander ; sinon langue PROBABLE (le client s'en sert pour choisir la
//    langue source), ou null quand le texte ne dit rien (un nom propre, « orc »).
//  - langueSource(texte, langueInterface) : langue DEPUIS laquelle traduire, ou null (deja de l'anglais, ou rien a traduire).
//  - morceauxEtrangers(texte) : parties MANIFESTEMENT non anglaises d'un texte, pour le filet du serveur qui peut recevoir un prompt deja
//    enrichi de gabarits anglais (bureau en mode Cloud, anciens clients, cles API) : seules ces parties sont traduites.
//  - LANGUES_TRADUCTIBLES : langues que le traducteur du site (m2m100-1.2b, Workers AI) sait traduire vers l'anglais.
//
// PRECISION AVANT RAPPEL (2026-10-14, revue du lot 2, bloquants B1 / B2). Un seul mot outil etranger suffisait a declarer un texte
// « surement » etranger : « camper van » (nl), « wolf den » (de), « Las Vegas sign », « sin eater », « con artist » (es), « pour over
// coffee » (fr) etaient traduits par le filet du serveur, ou refuses en 422 quand le traducteur etait en panne ; sous une interface
// ANGLAISE, 57 prompts anglais sur 195 partaient au traducteur (« beer mug » -> nl, « kobold archer » -> de, « sombrero » -> es).
// Desormais :
//  - un mot qui existe AUSSI en anglais, ou qui y vit comme nom propre ou emprunt (MOTS_AUSSI_ANGLAIS : van, den, die, el, las, con,
//    sin, per, pour, beer, rot, helm, kobold, rucksack, sombrero...), ne designe jamais a lui seul une langue ;
//  - « sure » exige DEUX indices distincts au moins (mots differents, ou un mot et des lettres accentuees propres a la langue), dont un
//    qui n'existe pas en anglais (ou trois mots) ;
//  - sous une interface ANGLAISE, seul un texte SUREMENT etranger part au traducteur (avant le lot : jamais rien) ;
//  - (seconde revue du 14/10) un NOM PROPRE ou une EXPRESSION empruntee dans un texte anglais ne compte plus pour une langue etrangere :
//    « Puerta del Sol clock tower », « Hôtel de Ville building », « C'est la vie coffee mug » (voir jetonsLatins).
// Un texte etranger tres court (« Drache », « casque ») reste traduit sous une interface dans sa langue ; sous une interface anglaise,
// il part tel quel, comme avant le lot : mieux vaut un mot etranger non traduit qu'un prompt anglais reecrit. Exception : un mot SEUL
// qui porte les lettres accentuees de sa langue (« épée », « Gdańsk ») est « sur » (deux indices : le mot et ses lettres).

export const VERSION = 2;

/** Codes de langue du modele m2m100 (100 langues, carte du modele facebook/m2m100_1.2B), anglais exclu. */
export const LANGUES_TRADUCTIBLES = new Set(('af am ar ast az ba be bg bn br bs ca ceb cs cy da de el es et fa ff fi fr fy ga gd gl gu ha he '
  + 'hi hr ht hu hy id ig ilo is it ja jv ka kk km kn ko lb lg ln lo lt lv mg mk ml mn mr ms my ne nl no ns oc or pa pl ps pt ro ru '
  + 'sd si sk sl so sq sr ss su sv sw ta th tl tn tr uk ur uz vi wo xh yi yo zh zu').split(' '));

const ALIAS_LANGUES = {
  iw: 'he', in: 'id', ji: 'yi', jw: 'jv', nb: 'no', nn: 'no', fil: 'tl', mo: 'ro', sh: 'sr',
  eng: 'en', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', jpn: 'ja', kor: 'ko',
  zho: 'zh', chi: 'zh', ara: 'ar', hin: 'hi', nld: 'nl', dut: 'nl', pol: 'pl', tur: 'tr', ukr: 'uk', vie: 'vi', ind: 'id',
  swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', ces: 'cs', cze: 'cs', ron: 'ro', rum: 'ro', hun: 'hu', ell: 'el', gre: 'el',
  heb: 'he', tha: 'th', ben: 'bn', fas: 'fa', per: 'fa', urd: 'ur', msa: 'ms', may: 'ms', cat: 'ca', hrv: 'hr', srp: 'sr',
};

/** « fr-FR » -> « fr », « zh_TW » -> « zh », « iw » -> « he », « fra » -> « fr », « FR » -> « fr ». '' si le code est illisible. */
export function normaliserCodeLangue(code) {
  const c = String(code == null ? '' : code).trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2,3}$/.test(c)) return '';
  return ALIAS_LANGUES[c] || c;
}

// ------------------------------------------------------------------ ECRITURES NON LATINES
// Ordre = priorite : un texte japonais contient des kanji (han) ET des kana ; un texte coreen peut contenir des hanja.
const ECRITURES = [
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'ja'],
  ['hangul', /\p{Script=Hangul}/u, 'ko'],
  ['han', /\p{Script=Han}/u, 'zh'],
  ['cyrillique', /\p{Script=Cyrillic}/u, 'ru'],
  ['arabe', /\p{Script=Arabic}/u, 'ar'],
  ['hebreu', /\p{Script=Hebrew}/u, 'he'],
  ['devanagari', /\p{Script=Devanagari}/u, 'hi'],
  ['bengali', /\p{Script=Bengali}/u, 'bn'],
  ['gurmukhi', /\p{Script=Gurmukhi}/u, 'pa'],
  ['gujarati', /\p{Script=Gujarati}/u, 'gu'],
  ['oriya', /\p{Script=Oriya}/u, 'or'],
  ['tamoul', /\p{Script=Tamil}/u, 'ta'],
  ['telougou', /\p{Script=Telugu}/u, 'te'],
  ['kannada', /\p{Script=Kannada}/u, 'kn'],
  ['malayalam', /\p{Script=Malayalam}/u, 'ml'],
  ['cingalais', /\p{Script=Sinhala}/u, 'si'],
  ['thai', /\p{Script=Thai}/u, 'th'],
  ['lao', /\p{Script=Lao}/u, 'lo'],
  ['khmer', /\p{Script=Khmer}/u, 'km'],
  ['birman', /\p{Script=Myanmar}/u, 'my'],
  ['georgien', /\p{Script=Georgian}/u, 'ka'],
  ['armenien', /\p{Script=Armenian}/u, 'hy'],
  ['grec', /\p{Script=Greek}/u, 'el'],
  ['ethiopien', /\p{Script=Ethiopic}/u, 'am'],
];
const LETTRE = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
const LOURDES = new Set(['kana', 'hangul', 'han']);   // un ideogramme vaut un mot : poids 3

// Kanji des reformes japonaises (shinjitai) qui ne s'ecrivent ni en chinois simplifie ni en chinois traditionnel : « 弁護士 » (avocat) est du
// japonais, pas du chinois (24/10, audit m11). Texte en caracteres chinois SANS aucun de ces kanji : chinois (le traducteur lit aussi les kanji).
const KANJI_JAPONAIS = /[弁広圧悪囲営駅桜応検権県験効済歯児辞釈渋縦浄摂斉専戦繊騒択沢団駐庁猟転塁拡挙帰気軽険圏剣謙剤雑歳仏払並変弐辺壊懐絵拠恵蔵続値窓鉄伝脳売抜訳様覧両緑労録]/;

/** Precisions dans une ecriture partagee par plusieurs langues. */
function affinerEcriture(ecriture, t, langue) {
  if (ecriture === 'han' && KANJI_JAPONAIS.test(t)) return 'ja';
  if (ecriture === 'cyrillique') {
    if (/[іїєґ]/i.test(t)) return 'uk';
    if (/[ђћџљњј]/i.test(t)) return 'sr';
    if (/[ѓќѕ]/i.test(t)) return 'mk';
    if (/[ў]/i.test(t)) return 'be';
    if (/[әғқңөұүһ]/i.test(t)) return 'kk';
    return 'ru';
  }
  if (ecriture === 'arabe') {
    if (/[ٹڈڑںے]/.test(t)) return 'ur';
    if (/[پچژگکی]/.test(t)) return 'fa';
    return 'ar';
  }
  return langue;
}

// ------------------------------------------------------------------ ECRITURE LATINE
// Trois listes par langue : mots OUTILS propres a la langue (poids 2), mots outils PARTAGES avec une langue voisine (poids 1), mots
// COURANTS des prompts propres a la langue (couleurs, matieres, sujets ; poids 1). Un mot qui s'ecrit pareil dans deux langues (« casa »,
// « robot », « dragon », « medieval », « grande », « pirate ») n'est dans AUCUNE liste : il ne departage rien. Mots en minuscules, forme
// EXACTE (accents compris) : retirer les accents ferait de « dragón » (es) un « dragon » anglais.
const LISTES = {
  en: [
    'the and with without of from into onto his its their which while this that these those are has wearing holding carrying riding '
    + 'wielding made very who whose behind above below around through between against toward towards upon they she he him them our your '
    + 'it not',
    'an in on at to for is was be been have had her my one two three four five some any all many small big tall old new by or but as '
    + 'no',
    'red blue green yellow black white brown purple pink grey gray golden silver wooden stone iron steel sword shield knight warrior '
    + 'castle house tree barrel chest helmet armor armour cloak staff wizard witch giant young ancient dark light fire ice glass '
    + 'bottle cat dog horse bear ship boat car truck tower wall bridge ruins mountain forest cabin skull bones cute scary tiny huge '
    + 'wings wing tail horns hair beard eyes face head body legs arms hands fur scales feathers clothes dress shirt pants boots '
    + 'gloves crown necklace belt bag backpack spear arrow axe dagger knife gun rifle pistol dwarf goblin skeleton ghost king queen '
    + 'soldier farmer worker woman boy girl child creature beast bird snake spider insect flower plant grass leaf leaves apple food '
    + 'cake window roof floor garden street city town river lake island space spaceship rocket airplane helicopter bicycle '
    + 'motorcycle wheel futuristic detailed colorful colourful shiny rusty broken clean dirty glowing burning flying sitting standing '
    + 'running walking warlock dungeon treasure lantern torch tavern blacksmith peasant villager hunter mermaid fairy unicorn fox owl '
    + 'eagle deer rabbit mouse pig cow sheep goat duck chicken frog turtle shark whale octopus crab jellyfish bee ant butterfly '
    + 'dinosaur realistic stylized cozy little short thin thick heavy bright night sky evil crystal airship magic epic mystical '
    + 'enchanted haunted hero undead demon beautiful ugly angry happy sad creepy spooky weapon weapons armored leather wood gem jewel '
    + 'moon sun star stars day sunset cloud clouds rain snow storm lightning ocean '
    // noms anglais courants des prompts a nom propre (2026-10-14, B1 residuel : « Santa Maria del Fiore dome », « tavern sign »)
    + 'dome travel tavern cable coffee mug cheese trophy skyline clock sign crane board church cathedral palace fountain market harbor '
    + 'harbour shop store bakery pub'],
  fr: [
    'le les une des du et avec sans sur sous dans pour qui est au aux ce cette ces sa ses leur leurs elle ils elles je nous vous '
    + 'mon mes très où par chez pas ne vers qu dont lui à tous toutes toute sont peut être',
    'la un de en son se ou que il ma mais',
    'rouge bleu bleue vert verte jaune noir noire blanc blanche marron grise doré dorée argenté argentée bois pierre fer acier épée '
    + 'bouclier chevalier guerrier château maison arbre tonneau coffre casque armure manteau bâton sorcier sorcière géant petit vieux '
    + 'vieille jeune ancien ancienne feu glace eau verre bouteille chat chien cheval loup navire bateau voiture mur pont ruines '
    + 'rocher montagne forêt cabane crâne effrayant énorme ailes aile cornes cheveux barbe yeux tête jambes fourrure écailles '
    + 'vêtements chapeau couronne collier ceinture sac flèche hache marteau dague couteau fusil pistolet nain gobelin squelette '
    + 'fantôme roi reine paysan ouvrier homme femme garçon fille enfant bébé créature bête oiseau poisson araignée insecte fleur plante '
    + 'herbe feuille pomme gâteau chaise lampe porte fenêtre toit jardin ville désert océan mer rivière île planète espace fusée avion '
    + 'hélicoptère vélo roue futuriste médiéval détaillé rouillé cassé propre lumineux volant assis debout massue guerrière lapin '
    + 'cochon vache mouton oie grenouille tortue requin baleine pieuvre crabe abeille fourmi papillon renard hibou aigle cerf souris '
    + 'géante gris vaisseau trésor '
    // 24/10 (audit des prompts, m11) : mots courts sous interface anglaise (« un avocat », « ver de terre »)
    + 'avocat terre ver tigre singe éléphant girafe zèbre sanglier tasse assiette fourchette cuillère fromage soupe poire fraise carotte '
    + 'camion moto soleil lune étoile nuage pluie neige orage plage sable grotte escalier église ferme moulin phare tente bougie '
    + 'chandelle corde triste joyeux longue belle femmes hommes enfants'],
  es: [
    'el los las y con sin por para que muy del al unos unas es está están su sus lleva tiene sobre hacia como pero estos estas ese esa '
    + 'todos todas cuando donde puede',
    'un una de en se la son este esta',
    'rojo roja amarillo amarilla blanco blanca morado plateado madera piedra hierro acero caballero guerrero castillo árbol barril '
    + 'bastón bruja pequeño pequeña viejo vieja joven antiguo oscuro fuego hielo vidrio botella perro caballo oso coche camión puente '
    + 'ruinas montaña cabaña calavera cuernos ojos cabeza cuerpo piernas brazos ropa pantalones guantes sombrero anillo cinturón hacha '
    + 'martillo daga cuchillo enano rey reina campesino trabajador hombre mujer niño niña pájaro pez araña insecto hoja manzana silla '
    + 'puerta ventana techo suelo jardín calle ciudad pueblo río isla cohete tren rueda detallado roto limpio sucio dragón alas zorro '
    + 'conejo cerdo oveja tortuga tiburón ballena pulpo cangrejo abeja hormiga mariposa búho águila plumas '
    + 'lobo gris gigante futurista tesoro cofre espada '
    // 24/10 (m11)
    + 'gato casa mesa serpiente león tigre mono elefante jirafa ciervo jabalí murciélago ratón libro lápiz taza tenedor cuchara pan queso '
    + 'vino cerveza sopa pera limón fresa cereza uva zanahoria barco moto bicicleta sol luna estrella nube lluvia nieve viento tormenta '
    + 'playa lago cascada volcán cueva torre escalera iglesia mezquita carretera camino aldea granja molino faro tienda vela '
    + 'antorcha cuerda larga largo barba burro hermoso rápido lento fuerte débil feliz'],
  de: [
    'der die das den dem ein eine einen einem einer und mit ohne auf im ist sind sein seine ihr ihre zu von vom zum zur für aus '
    + 'bei nach über unter hinter sehr nicht kein keine trägt hält auch oder wie er kann wird werden nur noch schon',
    'in',
    'rot rote roter rotes blau blaue blauer grün grüne grüner gelb gelbe schwarz schwarze schwarzer weiß weiße weißer braun grau '
    + 'silbern holz stein eisen stahl schwert schild ritter krieger burg schloss haus baum fass truhe helm rüstung umhang zauberer '
    + 'hexe riese klein kleine kleiner groß große großer alte jung dunkel feuer eis wasser flasche katze hund pferd bär schiff lkw '
    + 'turm mauer brücke ruine felsen berg wald hütte schädel knochen niedlich riesig flügel flügeln schwanz hörner haare bart augen '
    + 'gesicht kopf körper beine hände fell schuppen federn kleidung kleid hemd hose stiefel handschuhe krone kette gürtel tasche '
    + 'rucksack speer pfeil axt dolch messer gewehr pistole kanone zwerg kobold skelett geist engel könig königin bauer arbeiter mann '
    + 'frau mädchen kreatur vogel fisch schlange spinne insekt blume pflanze blatt apfel kuchen stuhl tisch tür fenster dach garten '
    + 'straße stadt dorf wüste ozean meer fluss insel weltraum rakete flugzeug hubschrauber zug fahrrad motorrad maschine futuristisch '
    + 'mittelalterlich detailliert glänzend rostig kaputt sauber schmutzig leuchtend fliegend sitzend stehend drache fuchs hase '
    + 'schwein kuh schaf frosch schildkröte krake krabbe biene ameise schmetterling eule adler hirsch '
    + 'haus hund buch bleistift tasse teller gabel löffel brot käse wein suppe birne zitrone erdbeere kirsche traube karotte auto '
    + 'lastwagen sonne mond stern wolke regen schnee wind sturm regenbogen strand sand wasserfall vulkan höhle treppe kirche moschee '
    + 'weg bauernhof mühle leuchtturm zelt kerze fackel seil lang lange schön schnell langsam stark schwach traurig fröhlich fertig '
    + 'altes alten grauer graue graues grauen magische magischer magisches magischen riesige riesiger riesiges futuristische '
    + 'futuristischer futuristisches goldene goldener goldenes goldenen großen kleinen schwarzen weißen roten blauen grünen'],
  it: [
    'lo gli della delle dello degli dei di nel nella nei sul sulla con senza per che è molto questo questa suoi sue alla alle dal '
    + 'dalla ha sono anche del al tutti tutte tutto tutta quando può essere',
    'una uno un la le e il ma da suo sua',
    'rosso rossa blu giallo gialla nero nera bianco bianca marrone grigio grigia dorato dorata argento legno pietra acciaio spada '
    + 'scudo cavaliere guerriero castello albero botte forziere elmo armatura mantello bastone strega piccolo piccola vecchio vecchia '
    + 'giovane antico scuro fuoco ghiaccio acqua vetro bottiglia gatto cavallo lupo orso macchina rovine roccia montagna foresta '
    + 'bosco capanna teschio ossa spaventoso ali coda corna capelli occhi viso testa gambe braccia mani pelliccia squame piume '
    + 'vestiti camicia pantaloni stivali guanti cappello anello collana borsa zaino freccia ascia martello pugnale coltello fucile '
    + 'cannone folletto scheletro angelo soldato contadino operaio uomo donna ragazzo ragazza bambino bambina uccello pesce ragno '
    + 'insetto fiore pianta erba foglia mela cibo sedia tavolo lampada letto finestra tetto pavimento giardino città villaggio '
    + 'fiume isola pianeta spazio razzo aereo elicottero treno ruota futuristico medievale dettagliato arrugginito rotto pulito '
    + 'sporco seduto drago volpe coniglio maiale mucca pecora anatra squalo balena polpo granchio farfalla gufo cervo '
    + 'gigante tesoro futuristico '
    // 24/10 (m11)
    + 'tavola casa cane libro matita tazza piatto forchetta cucchiaio pane formaggio vino birra zuppa pera limone fragola ciliegia uva '
    + 'carota barca nave camion moto bicicletta sole luna stella nuvola pioggia neve vento tempesta arcobaleno spiaggia sabbia lago '
    + 'cascata vulcano grotta torre scala chiesa moschea strada sentiero fattoria mulino faro tenda candela torcia corda lungo lunga '
    + 'bello bella veloce lento forte debole felice'],
  pt: [
    'os um uma uns umas com sem para do da dos das na nas em ao aos seus suas isso é tem muito segurando',
    'o as e de por que ou no nos à este esta está seu sua mais',
    'vermelho vermelha amarelo amarela preto preta branco branca marrom roxo roxa cinza dourado dourada prateado madeira pedra aço '
    + 'cavaleiro guerreiro castelo árvore baú capacete cajado bruxa pequeno pequena velho velha jovem antigo escuro fogo gelo água '
    + 'vidro garrafa cão cavalo urso navio caminhão ruínas rocha montanha floresta caveira fofo assustador asas cauda chifres cabelo '
    + 'olhos rosto cabeça pernas braços mão mãos roupas calças luvas chapéu coroa anel colar cinto lança machado martelo adaga faca '
    + 'espingarda canhão anão anjo rei rainha camponês trabalhador homem mulher menino menina criança bebê fera pássaro peixe aranha '
    + 'inseto grama folha maçã bolo cadeira lâmpada janela telhado chão jardim rua cidade aldeia ilha espaço foguete avião trem roda '
    + 'detalhado brilhante enferrujado sujo voando dragão raposa coelho porco ovelha tubarão baleia caranguejo abelha formiga '
    + 'borboleta coruja águia veado noite beira robô futurista gigante tesouro '
    // 24/10 (m11)
    + 'mesa casa cachorro gato livro lápis xícara prato garfo colher pão queijo vinho cerveja sopa pera limão morango cereja uva cenoura '
    + 'barco moto bicicleta sol lua estrela nuvem chuva neve vento tempestade praia areia lago cachoeira vulcão caverna torre escada '
    + 'igreja mesquita estrada caminho vila fazenda moinho farol barraca vela tocha corda longo longa bonito bonita rápido lento forte '
    + 'fraco triste feliz'],
  nl: [
    'het een met zonder van op voor zijn haar niet geen ook draagt houdt naar bij uit aan onder achter tussen wordt deze dit dat',
    'en de in is die er',
    'rode rood blauwe blauw groene groen gele geel zwarte zwart witte wit bruine bruin grijze grijs gouden zilveren houten stenen '
    + 'ijzeren zwaard ridder krijger kasteel huis kist harnas tovenaar heks reus groot grote oude jonge donker vuur ijs fles kat hond '
    + 'paard beer schip toren muur brug ruïne rots bos schedel draak vleugels staart hoorns baard ogen gezicht hoofd lichaam benen '
    + 'handen vacht schubben veren kleren jurk broek laarzen oud'],
  pl: [
    'się nie jest są oraz przy dla który która które bardzo jego jej ich tego tej',
    'na do ze bez pod nad od po w z to',
    'czerwony czerwona niebieski niebieska zielony zielona żółty czarny czarna biały biała smok miecz tarcza rycerz wojownik zamek dom '
    + 'drzewo beczka hełm zbroja płaszcz czarodziej wiedźma olbrzym mały duży stary młody ciemny ogień lód woda szkło butelka kot pies '
    + 'koń niedźwiedź statek łódź samochód wieża góra las chata czaszka skrzydła skrzydłami ogon rogi włosy broda oczy stalowy'],
  tr: [
    've bir ile bu şu için gibi çok olan değil ama veya ki mi daha',
    'da de',
    'kırmızı mavi yeşil sarı siyah beyaz kahverengi altın gümüş ahşap taş demir çelik kılıç kalkan şövalye savaşçı kale ev ağaç fıçı '
    + 'sandık miğfer zırh pelerin büyücü cadı dev küçük büyük yaşlı genç karanlık ateş buz su cam şişe kedi köpek at ayı gemi tekne '
    + 'araba kule duvar köprü dağ orman kulübe kafatası ejderha kanat kanatlı kuyruk boynuz saç sakal göz yüz kafa vücut'],
  id: [
    'yang dan dengan ke dari untuk ini itu tidak sangat sebuah seorang seekor memakai membawa memegang adalah pada atau juga akan sedang',
    'di ada',
    'merah biru hijau kuning hitam putih coklat emas perak kayu batu besi baja pedang perisai ksatria prajurit kastil rumah pohon tong '
    + 'peti zirah jubah tongkat penyihir raksasa kecil besar tua muda gelap api kaca botol kucing anjing kuda beruang kapal perahu mobil '
    + 'menara dinding jembatan gunung hutan pondok tengkorak naga sayap ekor tanduk rambut janggut wajah kepala'],
  vi: [
    'và của với có một những các là không trong trên dưới cho người con cái đang rất này đó',
    '',
    'đỏ xanh vàng đen trắng nâu bạc gỗ đá sắt thép kiếm khiên hiệp sĩ chiến binh lâu đài nhà cây thùng rương mũ áo giáp áo choàng '
    + 'gậy phù thủy khổng lồ nhỏ lớn già trẻ tối lửa băng nước thủy tinh chai mèo chó ngựa gấu tàu thuyền xe tháp tường cầu núi rừng '
    + 'rồng cánh đuôi sừng tóc râu mắt mặt đầu'],
  sv: ['och med utan ett på av för till är som inte mycket han hon sin sitt sina bär håller också eller under bakom', 'en den det',
    'röd röda blå grön gröna gul svart svarta vit vita brun grå guld trä sten järn stål svärd sköld riddare krigare slott hus träd '
    + 'tunna kista hjälm rustning stav trollkarl häxa jätte liten stor gammal ung mörk eld vatten flaska katt häst björn skepp båt '
    + 'bil torn skog stuga skalle vingar svans hår skägg ögon ansikte huvud'],
  da: ['og med uden et på af for til er som ikke meget han hun sin sit sine bærer holder også eller under bag', 'en den det',
    'rød røde blå grøn grønne gul sort sorte hvid hvide brun grå guld sølv træ sten jern stål sværd skjold kriger slot hus tønde '
    + 'kiste hjelm rustning kappe stav troldmand kæmpe lille stor gammel ung mørk ild vand flaske hest bjørn skib båd bil tårn bjerg '
    + 'skov hytte kranie drage vinger hår skæg øjne ansigt hoved'],
  no: ['og med uten et på av for til er som ikke veldig han hun sin sitt sine bærer holder også eller under bak', 'en den det',
    'rød røde blå grønn grønne gul svart svarte hvit hvite brun grå sølv stein jern stål sverd skjold kriger slott hus tønne kiste '
    + 'hjelm rustning kappe stav trollmann kjempe liten stor gammel ung mørk ild vann flaske katt hest bjørn båt bil tårn fjell skog '
    + 'hytte hodeskalle drage vinger hår skjegg øyne ansikt hode'],
  fi: ['ja ei joka jonka kanssa ilman hyvin erittäin kuin tai myös mutta', 'on se',
    'punainen sininen vihreä keltainen musta valkoinen ruskea harmaa kulta hopea kivi rauta teräs miekka kilpi ritari soturi linna '
    + 'talo puu tynnyri arkku kypärä haarniska viitta sauva velho noita jättiläinen pieni iso suuri vanha nuori tumma tuli jää vesi '
    + 'lasi pullo kissa koira hevonen karhu laiva vene torni muuri silta vuori metsä mökki kallo lohikäärme siivet häntä'],
  cs: ['ve ze pro jsou který která které velmi jeho její jejich také nebo', 'se na do je bez pod nad',
    'červený červená modrý modrá zelený zelená žlutý černý černá bílý bílá hnědý šedý zlatý stříbrný dřevo kámen železo ocel meč '
    + 'štít rytíř válečník hrad dům strom sud truhla helma brnění plášť hůl čaroděj čarodějnice obr malý velký starý mladý tmavý oheň '
    + 'led voda sklo láhev kočka pes kůň medvěd loď věž zeď hora les chata lebka drak křídla ocas rohy vlasy vousy oči'],
  ro: ['și cu fără pe în este care foarte pentru din sau dar', 'la de un o',
    'roșu roșie albastru albastră verde galben negru neagră alb albă maro gri auriu argintiu lemn piatră fier oțel sabie scut cavaler '
    + 'războinic castel casă copac butoi cufăr coif armură mantie toiag vrăjitor vrăjitoare uriaș bătrân tânăr întunecat foc gheață '
    + 'apă sticlă pisică câine cal urs navă barcă mașină zid munte pădure colibă craniu aripi coadă coarne păr'],
  hu: ['az és egy van nem hogy nagyon nélkül vagy mint', '',
    'piros kék zöld sárga fekete fehér barna szürke arany ezüst fa kő vas acél kard pajzs lovag harcos kastély ház hordó láda sisak '
    + 'páncél köpeny bot varázsló boszorkány óriás kicsi nagy öreg fiatal sötét tűz jég víz üveg palack macska kutya ló medve hajó '
    + 'csónak autó torony fal híd hegy erdő kunyhó koponya sárkány szárnyak farok szarvak haj szakáll szemek arc fej'],
  hr: ['koji koja koje vrlo njegov njegova također ili', 'je u na sa za od do bez pod nad',
    'crveni crvena plavi plava zeleni zelena žuti crni crna bijeli bijela smeđi sivi zlatni srebrni drvo kamen željezo čelik mač '
    + 'štit vitez ratnik dvorac kuća stablo bačva škrinja kaciga oklop plašt štap čarobnjak vještica div mali veliki stari mladi tamni '
    + 'vatra voda staklo boca mačka pas konj medvjed brod čamac toranj zid planina šuma koliba lubanja zmaj krila rep'],
  ca: ['els amb sense molt és dels als aquest aquesta seu seva', 'el la les un una de que per',
    'vermell vermella blau blava verd verda groc negre negra blanc blanca marró daurat platejat fusta pedra ferro acer espasa escut '
    + 'cavaller guerrer castell arbre bóta casc bastó bruixa gegant petit petita vell vella jove fosc foc aigua vidre ampolla gat gos '
    + 'cavall llop ós vaixell cotxe muntanya bosc crani drac ales'],
  tl: ['ang ng mga sa na may ay si ni kay para ito iyon hindi napaka', 'at', 'pula asul berde dilaw itim puti kayumanggi ginto pilak '
    + 'kahoy bato bakal kalasag kabalyero mandirigma kastilyo bahay puno bariles baul baluti kapa tungkod salamangkero mangkukulam '
    + 'higante maliit malaki matanda bata madilim apoy yelo tubig salamin pusa aso kabayo barko bangka kotse tore'],
  sw: ['na wa kwa za cha katika yenye mwenye hii hiyo sana au lakini', '', 'nyekundu bluu kijani njano nyeusi nyeupe '
    + 'kahawia dhahabu fedha mbao jiwe chuma upanga ngao shujaa ngome nyumba mti pipa sanduku kofia mavazi joho fimbo mchawi jitu '
    + 'ndogo kubwa mzee kijana giza barafu maji kioo chupa paka mbwa farasi dubu meli mashua gari mnara ukuta daraja mlima msitu'],
};

// Lettres qui signent une langue (ou une petite famille). Bonus plafonne par langue.
const SIGNES = [
  [/[ơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/g, { vi: 4 }],
  [/[ğşı]/g, { tr: 3 }],
  [/[ąęłńśźż]/g, { pl: 3 }],
  [/[řěů]/g, { cs: 3 }],
  [/[őű]/g, { hu: 3 }],
  [/[ășțţ]/g, { ro: 3 }],
  [/[ãõ]/g, { pt: 2 }],
  [/ñ/g, { es: 2 }],
  [/ß/g, { de: 2 }],
  [/œ/g, { fr: 2 }],
  [/ø/g, { da: 1.5, no: 1.5 }],
  [/æ/g, { da: 1, no: 1, fr: 0.5 }],
  [/å/g, { sv: 1, da: 1, no: 1 }],
  [/đ/g, { hr: 2 }],
  [/[èêëîïôûù]/g, { fr: 1 }],
  [/[ìò]/g, { it: 1 }],
  [/[àç]/g, { fr: 0.5, pt: 0.5, ca: 0.5 }],
  [/[áíóú]/g, { es: 0.5, pt: 0.5 }],
  [/é/g, { fr: 0.5, es: 0.3, pt: 0.3, it: 0.3 }],
  [/[âô]/g, { pt: 0.5, fr: 0.5 }],
  [/[äö]/g, { de: 1, sv: 0.5, fi: 1 }],
  [/ü/g, { de: 1, tr: 0.5 }],
  [/[čšž]/g, { cs: 1, hr: 1 }],
];
const PLAFOND_SIGNES = 4;
const LANGUES_LATINES = Object.keys(LISTES);

// Index mot -> [[langue, poids]].
const INDEX = new Map();
function indexer(mot, langue, poids) {
  const l = INDEX.get(mot) || [];
  if (!l.some(([lg]) => lg === langue)) { l.push([langue, poids]); INDEX.set(mot, l); }
}
for (const [langue, [forts, faibles, courants]] of Object.entries(LISTES)) {
  for (const m of forts.split(/\s+/)) if (m) indexer(m, langue, 2);
  for (const m of faibles.split(/\s+/)) if (m) indexer(m, langue, 1);
  for (const m of courants.split(/\s+/)) if (m) indexer(m, langue, 1);
}
// « a » : article anglais tres frequent dans les prompts, mais aussi preposition (es, it, pt), verbe (fr) ou conjonction (cs, hu) :
// petit poids, anglais seul.
INDEX.set('a', [['en', 0.5]]);

/* MOTS AUSSI ANGLAIS (2026-10-14, revue du lot 2, B1 / B2). Mots des listes ci-dessus qui s'ecrivent pareil en anglais, ou y vivent comme
 * particule de nom propre (Van Gogh, Las Vegas, El Dorado, Al Capone, da Vinci...), comme emprunt (sombrero, rucksack, kobold, piccolo,
 * chaise, femme...) ou comme sigle courant (OS, DOS, API, LED, EV...). Ils gardent leur poids (« la casa de los muertos » reste espagnol),
 * mais ils ne designent JAMAIS a eux seuls une langue : « camper van », « wolf den », « beer mug », « sin eater » ne sont plus du
 * neerlandais, de l'allemand ou de l'espagnol. Ajouter ici tout faux positif constate ; ne pas y mettre un mot qui n'existe pas en
 * anglais (il ne servirait plus d'indice). Minuscules, sans accents (un mot accentue n'est pas anglais). */
const MOTS_AUSSI_ANGLAIS = new Set((
  // particules et mots outils qui existent aussi en anglais (ou dans ses noms propres)
  'le la les un des du et ce sa se ne mon ma par pas dont est lui son en de il pour sous '      // fr
  + 'el los las y con sin para del al es su sus como '                                          // es
  + 'der die das den dem von mit im er in '                                                     // de
  + 'lo di della per che sue dal ha uno e da '                                                  // it
  + 'os um com do dos das na nas em o as no nos por '                                           // pt
  + 'van met op dat is '                                                                        // nl
  + 'jest pod od po w z to '                                                                    // pl
  + 'at ev dev cam kale mi ki ama '                                                             // tr
  + 'yang dan ada api tong '                                                                    // id
  + 'chai '                                                                                     // vi
  + 'med av till han hon under det '                                                            // sv
  + 'og for til sit sine holder bag sort slot hun af '                                          // da, no
  + 'ja on tai iso '                                                                            // fi
  + 'pro led '                                                                                  // cs
  + 'care din cu pe '                                                                           // ro
  + 'mint bot arc az fa '                                                                       // hu
  + 'u rep div '                                                                                // hr
  + 'sense molt als '                                                                           // ca
  + 'may si ni kay hindi ay '                                                                   // tl
  + 'au cha sana '                                                                              // sw
  // emprunts, noms propres et mots anglais presents dans les listes de mots courants
  + 'rouge vert blanc bleu petit chat bateau sac collier fusil femme fleur chaise papillon pierre eau sans chez cheval homme esa '
  + 'sombrero zorro rey amarillo calavera tortuga hombre pueblo alas isla guerrero mariposa fuego madera '
  + 'rot rote stein helm hose fell rucksack kobold geist bart braun seine engel adler burg berg klein bauer mann '
  + 'blu nero elmo piccolo donna ali coda angelo grigio strega drago argento bambino giallo bianca alla tutti '
  + 'bolo madeira rei '
  + 'rode wit groot beer kat bruin '
  + 'dom pies '
  + 'naga baja mobil '
  + 'torn sten lille vita '
  + 'verde cal kamen mali gat ales acer tore giza coif'
).split(/\s+/).filter(Boolean));

/* TEXTE COURT (24/10, audit des prompts m11, mandat du proprietaire : « tout texte, dans N'IMPORTE QUELLE langue, atteint l'IA en anglais »).
 * Jusqu'ici un mot ou deux mots etrangers sans lettre accentuee propre (« chaise », « gato », « Drache », « un avocat », « barba gris »)
 * n'etaient JAMAIS surs : sous une interface anglaise ils partaient bruts, sans erreur, et l'image ne correspondait pas.
 * Regle (texte de 1 a 4 mots, sans aucun mot anglais sur, donc « red dragon » n'est pas vise) : le texte est SUREMENT etranger quand
 *   (1) TOUS ses mots sont connus de la MEME langue (une des trois listes) et au moins un est un nom ou adjectif COURANT :
 *       « chaise », « gato », « barba gris », « ver de terre ». Un seul mot inconnu (« plush » dans « Elmo plush », « poster » dans
 *       « Moulin Rouge poster ») : on ne decide pas, c'est du texte anglais a nom etranger ;
 *   (2) ou il commence par un determinant etranger en minuscule (ou devant des mots en minuscules) : sans equivoque (« une », « du », « des »,
 *       « les », « una », « los », « ein », « der », « gli », « uma »...) il suffit, equivoque (« un », « le », « la », « el », « il », « lo »)
 *       il faut en plus un mot courant de la langue (« un avocat », « un burro »).
 * Les mots qui vivent aussi en anglais (van, den, die, beer, rot, helm, hose, sombrero...) restent ambigus : « camper van », « beer mug »,
 * « Die Hard » ne sont pas vises. Un mot sans aucune liste (« orc », « robot », « pizza », « taxi ») reste anglais. */
const AMBIGUS_COURT = new Set(('van den die el las con sin per pour beer rot rote helm hose fell stein bart rucksack kobold sombrero geist '
  + 'berg burg mann bauer seine zorro piccolo mi ki ama may bot arc az fa led pro care din au cha sana ev dev cam kale '
  + 'bolo naga baja mobil dom pies torn sten lille vita cal mali gat ales acer tore giza coif').split(' '));
// determinants SANS equivoque (aucun sens anglais) et EQUIVOQUES (aussi mots d'une autre langue ou noms propres : « El Camino », « Le Mans »)
const DETERMINANTS_SURS = {
  fr: ['une', 'du', 'des', 'les'], es: ['una', 'unos', 'unas', 'los'],
  de: ['ein', 'eine', 'einen', 'einem', 'einer', 'der', 'das', 'dem'], it: ['gli', 'uno'], pt: ['uma', 'uns', 'umas'],
};
const DETERMINANTS_EQUIVOQUES = { fr: ['un', 'le', 'la'], es: ['un', 'el'], it: ['il', 'lo', 'un'], pt: ['os'] };
const ORDRE_COURT = ['fr', 'es', 'it', 'pt', 'de', 'nl', 'pl', 'tr', 'id', 'vi', 'sv', 'da', 'no', 'fi', 'cs', 'ro', 'hu', 'hr', 'ca', 'tl', 'sw'];
// mot -> langues dont il est un nom ou adjectif COURANT (3e liste de LISTES), hors mots ambigus
const INDEX_COURANTS = new Map();
for (const [langue, [, , courants]] of Object.entries(LISTES)) {
  for (const m of (courants || '').split(/\s+/)) {
    if (!m || AMBIGUS_COURT.has(m)) continue;
    const l = INDEX_COURANTS.get(m) || [];
    if (!l.includes(langue)) { l.push(langue); INDEX_COURANTS.set(m, l); }
  }
}

/** Langue d'un texte COURT (voir ci-dessus), ou null. `t` : texte NFC ; `anglais` : score anglais deja calcule (>= 1 : jamais vise). */
function langueTexteCourt(t, anglais) {
  if (anglais >= 1) return null;
  const mots = [...t.matchAll(/[\p{L}\p{M}']+/gu)].map((m) => m[0]).filter((m) => /\p{L}/u.test(m.replace(/'/g, '')));
  if (mots.length < 1 || mots.length > 4) return null;
  const jetons = jetonsLatins(t).filter((x) => /\p{L}/u.test(x.bas.replace(/'/g, '')));
  // un nom propre (suite de mots a majuscule dans un texte a mots en minuscules) n'est pas du texte etranger : on ne decide pas
  if (jetons.some((x) => !x.etranger)) return null;
  const connu = (bas, lg) => {
    const morceaux = bas.split("'").filter((x) => x !== '');
    return morceaux.every((m) => m.length === 1 || (!AMBIGUS_COURT.has(m) && (INDEX.get(m) || []).some(([l]) => l === lg)));
  };
  const tete = mots[0];
  const teteMinuscule = tete === tete.toLowerCase() || mots.slice(1).every((m) => m === m.toLowerCase());
  let meilleure = null, meilleurScore = 0;
  for (const lg of ORDRE_COURT) {
    const courants = jetons.filter((x) => (INDEX_COURANTS.get(x.bas) || []).includes(lg)).length;
    const tous = jetons.every((x) => connu(x.bas, lg));
    let sc = 0;
    if (tous && courants >= 1) sc = 10 + courants;
    if (lg === 'fr' && mots.length >= 2 && tete === 'de' && ['la', 'le', 'les', "l'"].includes(mots[1].toLowerCase().slice(0, 2) === "l'" ? "l'" : mots[1].toLowerCase())) sc = Math.max(sc, 5 + courants);   // « de la chair »
    if (mots.length >= 2 && teteMinuscule) {
      const t0 = tete.toLowerCase();
      if ((DETERMINANTS_SURS[lg] || []).includes(t0)) sc = Math.max(sc, 5 + courants);
      else if ((DETERMINANTS_EQUIVOQUES[lg] || []).includes(t0)) {
        // determinant equivoque : il faut un mot courant de la langue, ou (3 mots au moins) un autre mot outil de cette langue (« un coin de rue »)
        const outils = jetons.slice(1).filter((x) => !AMBIGUS_COURT.has(x.bas) && (INDEX.get(x.bas) || []).some(([l]) => l === lg)).length;
        if (courants >= 1 || (mots.length >= 3 && outils >= 1)) sc = Math.max(sc, 5 + courants);
      }
    }
    if (sc > meilleurScore) { meilleurScore = sc; meilleure = lg; }
  }
  return meilleure;
}

const ELISIONS_FR = new Set(['l', 'd', 'j', 'n', 'm', 't', 's', 'c', 'qu', 'jusqu', 'lorsqu', 'puisqu']);
const LIMITE_ANALYSE = 2000;   // un prompt ne depasse guere quelques centaines de caracteres ; borne le cout sur un texte enorme

// Langues dont les lettres propres (ı ğ ş, ą ł ż, ř ů, ő ű, ș ț, ơ ư...) n'apparaissent pour ainsi dire dans aucun emprunt anglais :
// plusieurs de ces lettres valent DEUX indices (« Gerekli parametre, isteğe bağlı parametreden sonra gelemez » est surement turc). Pas le
// francais, l'espagnol, l'allemand ou le portugais : « crème brûlée », « jalapeño », « Mötley Crüe », « São Paulo » sont de l'anglais.
const SIGNES_SANS_EMPRUNT = new Set(['tr', 'pl', 'cs', 'hu', 'ro', 'vi']);

/* NOMS PROPRES ET EXPRESSIONS EMPRUNTEES (2026-10-14, seconde revue du lot 2, B1 residuel). Un prompt ANGLAIS qui contient un nom propre
 * ou une expression etrangere etait pris pour de l'etranger : « Puerta del Sol clock tower » (es), « Hôtel de Ville building » (fr),
 * « Santa Maria del Fiore dome » (it), « a vintage music box playing Für Elise » (de), « C'est la vie coffee mug » (fr). Le filet du
 * serveur les reecrivait, ou les refusait en 422 quand le traducteur etait en panne. Ne comptent donc plus pour une langue ETRANGERE
 * (l'anglais, lui, les compte toujours) :
 *  - un NOM PROPRE : suite d'au moins deux mots a majuscule, eventuellement reliees par des particules (« Puerta del Sol », « Côte
 *    d'Azur », « Gasthaus zum Goldenen Hirsch »), quand le texte contient AUSSI des mots en minuscules hors de ces suites (un texte tout
 *    en majuscules initiales, ou une liste de noms allemands, reste juge sur tous ses mots) ;
 *  - les lettres accentuees d'un mot a majuscule AU MILIEU du texte (« ... from Gdańsk ») ; les mots, eux, comptent encore (un nom
 *    commun allemand porte une majuscule) ;
 *  - une EXPRESSION empruntee par l'anglais (liste ci-dessous : « c'est la vie », « je ne sais quoi », « à la carte »...).
 * Limite connue : un nom propre SEUL en tete de texte (« Gdańsk port crane », « Łódź city skyline ») reste juge sur ses lettres : en
 * tete, rien ne le distingue d'un mot ordinaire (« Śliczny smok » est du polonais). */
// Particules qui relient les mots d'un nom propre. PAS les mots outils allemands (der, im, zum, am, und, von...) : l'allemand met une
// majuscule a tous ses noms, et « kleine Hütte im Wald », « der König der Elfen » ne sont pas des noms propres.
const PARTICULES_NOMS = new Set(('de del della delle dei degli di da do dos du des la le les los las el lo van y e et en al au aux '
  + "d' l' of the and on sur ten ter op").split(' '));
// Mots OUTILS etrangers : en tete de texte, leur majuscule est grammaticale ; ils n'ouvrent pas un nom propre (« Das Brandenburger Tor bei
// Nacht » garde « das » et « bei » ; « Le Mont Saint-Michel sous la pluie » garde « le », « sous » et « la »).
const MOTS_OUTILS = new Set(Object.entries(LISTES).filter(([lg]) => lg !== 'en')
  .flatMap(([, [forts, faibles]]) => (forts + ' ' + faibles).split(/\s+/)).filter(Boolean));
// Mots surement anglais : mots outils propres et mots courants de la liste anglaise (pas les « faibles » : in, on, a, to... existent ailleurs).
const MOTS_ANGLAIS_SURS = new Set((LISTES.en[0] + ' ' + LISTES.en[2]).split(/\s+/).filter(Boolean));
const EXPRESSIONS_EMPRUNTEES = [
  "c'est la vie", 'je ne sais quoi', 'crème de la crème', 'à la carte', 'à la mode', 'bon appétit', 'déjà vu', 'joie de vivre',
  "raison d'être", 'fin de siècle', 'belle époque', 'art nouveau', 'art déco', 'film noir', "hors d'oeuvre", "hors d'œuvre", 'coup de grâce',
  "coup d'état", 'savoir faire', 'savoir-faire', 'tête-à-tête', 'vis-à-vis', 'pièce de résistance', 'laissez-faire', 'carte blanche',
  "objet d'art", "trompe l'oeil", "trompe l'œil", 'mise en scène', 'papier-mâché', 'papier mâché', 'bon voyage', 'cul-de-sac',
  'femme fatale', 'nouveau riche', 'enfant terrible', 'esprit de corps', 'haute couture', 'haute cuisine', 'crème brûlée',
  'pain au chocolat', 'café au lait', 'eau de toilette', 'eau de parfum', 'fleur de lis', 'fleur-de-lis', 'fleur de lys', 'tour de force',
  'avant-garde', 'du jour', 'cordon bleu', 'nom de plume', 'noblesse oblige', 'bon vivant', 'la dolce vita', 'dolce vita', 'al fresco',
  'al dente', 'a cappella', 'que sera sera', 'che sarà sarà', 'hasta la vista', 'mi casa es su casa', 'día de los muertos',
  'dia de los muertos', 'feliz navidad', 'cinco de mayo', 'sturm und drang', 'glück auf', 'ein prosit', 'auf wiedersehen', 'über alles',
  'vive la france', 'mardi gras', 'ménage à trois', 'pas de deux', 'sous vide', 'crêpe suzette',
  // 24/10 (m11) : noms propres et titres que les nouveaux mots courants (moulin, soleil, casa...) feraient prendre pour de l'etranger
  'moulin rouge', 'cirque du soleil', 'mi casa su casa', 'das boot', 'casa blanca', 'casa bonita', 'la casa de papel', 'el camino',
];
// (pas de lookbehind : un Safari d'avant la 16.4 refuserait le module entier des son chargement)
const RE_EXPRESSIONS = new RegExp('(^|[^\\p{L}\\p{M}])('
  + EXPRESSIONS_EMPRUNTEES.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=$|[^\\p{L}\\p{M}])', 'giu');

/** Jetons du texte (mots, elisions comprises) et, pour chacun, s'il compte pour une langue ETRANGERE (`etranger`) et si ses lettres
 *  accentuees comptent (`signes`). Voir NOMS PROPRES ET EXPRESSIONS EMPRUNTEES. */
function jetonsLatins(t) {
  const norm = t.replace(/[’‘`´]/g, "'");
  const jetons = [];
  for (const m of norm.matchAll(/[\p{L}\p{M}']+/gu)) {
    jetons.push({ bas: m[0].toLowerCase(), debut: m.index, fin: m.index + m[0].length,
      majuscule: /^(?:\p{Ll}{1,2}')?\p{Lu}/u.test(m[0]), nom: false });
  }
  const colles = (a, b) => /^[\s-]*$/.test(norm.slice(a.fin, b.debut));
  for (let i = 0; i < jetons.length; i++) {
    if (!jetons[i].majuscule || MOTS_OUTILS.has(jetons[i].bas)) continue;
    let j = i, fin = i, majuscules = 1;
    while (j + 1 < jetons.length && colles(jetons[j], jetons[j + 1])) {
      const x = jetons[j + 1];
      if (x.majuscule) { majuscules++; j++; fin = j; } else if (PARTICULES_NOMS.has(x.bas)) j++; else break;
    }
    if (majuscules >= 2) { for (let k = i; k <= fin; k++) jetons[k].nom = true; i = fin; }
  }
  // Un nom propre n'est ecarte que dans un texte qui a AUSSI des mots en minuscules ET un mot surement anglais hors des noms (« Puerta
  // del Sol clock TOWER ») : dans « la Torre di Pisa con la neve », « la cathédrale Notre-Dame de Paris sous la neige », le nom reste un
  // indice (mesure : sans cette condition, 5 prompts etrangers a nom propre sur 28 n'etaient plus reconnus sous une interface anglaise).
  const minuscules = jetons.some((x) => !x.nom && !x.majuscule && /\p{L}/u.test(x.bas.replace(/'/g, '')));
  const anglais = jetons.some((x) => !x.nom && (MOTS_ANGLAIS_SURS.has(x.bas) || (x.bas.length >= 5 && /^[a-z]+(?:ing|ed)$/.test(x.bas))));
  if (!minuscules || !anglais) for (const x of jetons) x.nom = false;
  for (const e of norm.matchAll(RE_EXPRESSIONS)) {
    const d = e.index + e[1].length, f = d + e[2].length;
    for (const x of jetons) if (x.debut >= d && x.fin <= f) x.nom = true;
  }
  return jetons.map((x, i) => ({ bas: x.bas, etranger: !x.nom, signes: !x.nom && !(minuscules && x.majuscule && i > 0) }));
}

/** Scores par langue d'un texte en ecriture latine, et INDICES par langue : `mots` (mots distincts de la langue), `propres` (nombre de
 *  ces mots qui n'existent pas en anglais), `signes` (bonus cumule des lettres accentuees de la langue). Les noms propres et les
 *  expressions empruntees ne comptent que pour l'anglais (jetonsLatins). */
function scoresLatins(t) {
  const s = Object.fromEntries(LANGUES_LATINES.map((l) => [l, 0]));
  const mots = Object.fromEntries(LANGUES_LATINES.map((l) => [l, new Set()]));
  const propres = Object.fromEntries(LANGUES_LATINES.map((l) => [l, 0]));
  const signes = Object.fromEntries(LANGUES_LATINES.map((l) => [l, 0]));
  const jetons = jetonsLatins(t);
  let ing = 0, ed = 0;
  for (const { bas: brut, etranger } of jetons) {
    const morceaux = brut.split("'").filter((x) => x !== '');
    const elide = brut.includes("'") && morceaux.length >= 2;
    if (elide) {
      if (etranger && ELISIONS_FR.has(morceaux[0])) {
        s.fr += 1;
        // « l'épée », « d'eau » : un indice francais a part entiere (compte une fois par forme)
        if (!mots.fr.has(morceaux[0] + "'")) { mots.fr.add(morceaux[0] + "'"); propres.fr += 1; }
        if (morceaux[0] === 'l') s.it += 0.5;
      }
      const fin = morceaux[morceaux.length - 1];
      if (fin === 's' || fin === 'll' || fin === 're' || fin === 've' || (fin === 't' && /n$/.test(morceaux[0]))) s.en += 1;
    }
    // contractions anglaises (« I've », « we'll », « they're ») : la fin n'est jamais un mot etranger (« ve » = « et » turc, « dans » tcheque)
    const contraction = elide && /^(?:s|ll|re|ve|t|d|m)$/.test(morceaux[morceaux.length - 1]);
    for (let k = 0; k < morceaux.length; k++) {
      const m = morceaux[k];
      if (elide && m.length === 1) continue;   // « l' », « d' », « 's » : deja comptes ci-dessus
      if (contraction && k === morceaux.length - 1) continue;
      const entree = INDEX.get(m);
      if (entree) {
        for (const [lg, p] of entree) {
          if (lg !== 'en' && !etranger) continue;
          s[lg] += p;
          if (lg === 'en' || mots[lg].has(m)) continue;
          mots[lg].add(m);
          if (!MOTS_AUSSI_ANGLAIS.has(m)) propres[lg] += 1;
        }
        continue;
      }
      // morphologie anglaise : participes en -ing / -ed (« holding », « spiked »), hors listes
      if (m.length >= 5 && /^[a-z]+ing$/.test(m) && ing < 3) { s.en += 1; ing++; }
      else if (m.length >= 5 && /^[a-z]+ed$/.test(m) && ed < 3) { s.en += 0.5; ed++; }
    }
  }
  const bas = jetons.filter((x) => x.signes).map((x) => x.bas).join(' ');
  for (const [re, bonus] of SIGNES) {
    const n = (bas.match(re) || []).length;
    if (!n) continue;
    for (const [lg, p] of Object.entries(bonus)) {
      const b = Math.min(PLAFOND_SIGNES, n * p);
      s[lg] = (s[lg] || 0) + b;
      signes[lg] = (signes[lg] || 0) + b;
    }
  }
  return { s, mots, propres, signes };
}

/** Langue du texte.
 *  Rend { langue: code | null, sure: bool, ecriture: 'latin' | 'han' | 'cyrillique' | ... | null }.
 *  langue 'en' = anglais (sur ou probable) ; null = aucun indice (texte vide, nom propre, chiffres). */
export function detecterLangue(texte) {
  const t = String(texte == null ? '' : texte).normalize('NFC').slice(0, LIMITE_ANALYSE);
  let latines = 0;
  const comptes = new Map();
  for (const ch of t) {
    if (!LETTRE.test(ch)) continue;
    if (LATIN.test(ch)) { latines++; continue; }
    for (const [nom, re] of ECRITURES) {
      if (re.test(ch)) { comptes.set(nom, (comptes.get(nom) || 0) + 1); break; }
    }
  }
  let autres = 0, ecriture = null, maxPoids = 0;
  for (const [nom, n] of comptes) {
    const poids = n * (LOURDES.has(nom) ? 3 : 1);
    autres += poids;
    if (poids > maxPoids) { maxPoids = poids; ecriture = nom; }
  }
  // Japonais : des kana avec des kanji ; coreen : du hangul avec des hanja.
  if (comptes.get('kana')) ecriture = 'kana';
  else if (comptes.get('hangul')) ecriture = 'hangul';
  if (ecriture && autres >= 2 && autres >= 0.4 * (latines + autres)) {
    const base = ECRITURES.find(([nom]) => nom === ecriture)[2];
    return { langue: affinerEcriture(ecriture, t, base), sure: autres >= 3, ecriture };
  }
  if (!latines) return { langue: null, sure: false, ecriture: null };
  const { s, mots, propres, signes } = scoresLatins(t);
  const en = s.en;
  const court = langueTexteCourt(t, en);   // texte de 1 a 4 mots, aucun mot anglais : voir TEXTE COURT
  let meilleure = null, score = 0;
  for (const lg of LANGUES_LATINES) {
    if (lg !== 'en' && s[lg] > score) { score = s[lg]; meilleure = lg; }
  }
  if (en >= 1 && en >= 2 * score) {
    return { langue: 'en', sure: (en >= 3 && score * 3 <= en) || (en >= 2 && score === 0), ecriture: 'latin' };
  }
  if (meilleure && score >= 1 && score >= 1.5 * en) {
    // INDICES (2026-10-14, revue du lot 2, B1 / B2). Un mot qui existe aussi en anglais (MOTS_AUSSI_ANGLAIS) compte, mais ne designe
    // pas a lui seul une langue : « camper van », « sombrero », « Las Vegas sign » -> aucune langue. Les lettres accentuees de la langue
    // valent un indice (deux pour des lettres sans emprunt anglais : ı ğ ş, ą ł, ř ů...). « solides » = indices qui n'existent pas en
    // anglais (mots propres a la langue, lettres accentuees).
    const accents = signes[meilleure] >= 1 ? (SIGNES_SANS_EMPRUNT.has(meilleure) && signes[meilleure] >= 3 ? 2 : 1) : 0;
    const nMots = mots[meilleure].size;
    const solides = propres[meilleure] + accents;
    if (solides >= 1 || nMots >= 2) {
      const assez = (score >= 3 && score >= 2 * en) || (score >= 2 && en === 0);
      // SURE : assez de score ET deux indices distincts dont un solide, ou trois mots de la langue (« la casa de los muertos »), ou deux
      // indices solides (« caballero a caballo a galope », malgre ses « a » anglais). Un seul MOT de la liste ne suffit pas : « que sera
      // sera », « Sturm und Drang », « noir detective » restent anglais pour le serveur. MAIS les lettres accentuees de la langue valent
      // un indice de plus, meme portees par ce seul mot : « épée », « Für », « Gdańsk », « kılıç » seuls sont « surs » (seconde revue du
      // 14/10 : le commentaire disait le contraire). Voulu : ces lettres n'existent pas en anglais. Un nom propre au milieu d'un texte
      // anglais ne compte plus (jetonsLatins) ; reste vise un nom accentue SEUL en tete (« Gdańsk port crane »).
      const sure = (assez && ((solides >= 1 && nMots + accents >= 2) || nMots >= 3)) || (solides >= 2 && score >= 2);
      if (court && !sure) return { langue: court, sure: true, ecriture: 'latin' };
      return { langue: meilleure, sure, ecriture: 'latin' };
    }
  }
  if (court) return { langue: court, sure: true, ecriture: 'latin' };
  return { langue: null, sure: false, ecriture: 'latin' };
}

/** Vrai si le texte est (probablement) deja de l'anglais : il n'a pas besoin du traducteur. */
export function ressembleAnglais(texte) {
  return detecterLangue(texte).langue === 'en';
}

/** Langue DEPUIS laquelle traduire `texte`, ou null s'il n'y a rien a traduire (deja anglais, vide).
 *  La langue du TEXTE l'emporte ; sans indice, la langue de l'interface (si ce n'est pas l'anglais).
 *  Interface ANGLAISE (2026-10-14, revue du lot 2, B2) : seul un texte SUREMENT etranger part au traducteur. Un indice faible (un mot,
 *  des accents d'emprunt : « camper van », « piñata », « crème brûlée ») ne suffit pas a reecrire le prompt d'un anglophone.
 *  Interface inconnue (appel sans langue d'interface) : la langue probable du texte. */
export function langueSource(texte, langueInterface) {
  if (!String(texte == null ? '' : texte).trim()) return null;
  const d = detecterLangue(texte);
  if (d.langue === 'en') return null;
  const ui = normaliserCodeLangue(langueInterface);
  if (ui === 'en') return d.langue && d.sure ? d.langue : null;
  if (d.langue) return d.langue;
  return ui || null;
}

// ------------------------------------------------------------------ FILET DU SERVEUR
// Separateurs de propositions : virgule, point-virgule, retour a la ligne, ponctuation de fin (le point seulement suivi d'un blanc ou en
// fin de texte : « 2.5 m », « No.5 » et les poids « (medieval:1.4) » restent entiers), et leurs equivalents CJK / arabes / devanagari.
const COUPE = /([,;\n!?、。，；！？،؛।]+|\.(?=\s|$))/;

/** Parties MANIFESTEMENT non anglaises du texte : [{ debut, fin, langue, traductible }] (positions dans `texte`).
 *  Texte manifestement etranger SANS proposition anglaise : une seule partie, le texte entier (le traducteur a tout le contexte). Sinon
 *  (prompt enrichi de gabarits anglais, melange) : les propositions sures, etendues aux propositions voisines de la meme langue (meme
 *  seulement probable) ; une proposition anglaise ou sans indice arrete l'extension : un gabarit anglais n'est jamais retraduit. */
export function morceauxEtrangers(texte) {
  const t = String(texte == null ? '' : texte);
  if (!t.trim()) return [];
  const global = detecterLangue(t);
  const entier = () => [{ debut: 0, fin: t.length, langue: global.langue, traductible: LANGUES_TRADUCTIBLES.has(global.langue) }];
  const etranger = !!global.langue && global.langue !== 'en' && global.sure;
  if (t.length > 4 * LIMITE_ANALYSE) return etranger ? entier() : [];
  const morceaux = t.split(COUPE);
  const props = [];
  let pos = 0;
  for (let i = 0; i < morceaux.length; i++) {
    const m = morceaux[i];
    if (i % 2 === 0) {
      const d = m.trim() ? detecterLangue(m) : { langue: null, sure: false };
      const avant = m.length - m.replace(/^\s+/, '').length;
      const apres = m.length - m.replace(/\s+$/, '').length;
      props.push({ debut: pos + avant, fin: pos + m.length - apres, langue: d.langue, sure: d.sure, vide: !m.trim() });
    }
    pos += m.length;
  }
  if (etranger && !props.some((p) => p.langue === 'en')) return entier();
  const res = [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (!p.sure || !p.langue || p.langue === 'en') continue;
    let a = i, b = i;
    while (a > 0 && props[a - 1].langue === p.langue && !props[a - 1].vide) a--;
    while (b < props.length - 1 && props[b + 1].langue === p.langue && !props[b + 1].vide) b++;
    const precedent = res[res.length - 1];
    if (precedent && precedent.langue === p.langue && precedent.finIndex >= a - 1) {
      precedent.fin = props[b].fin; precedent.finIndex = b;
    } else {
      res.push({ debut: props[a].debut, fin: props[b].fin, langue: p.langue, finIndex: b });
    }
    i = b;
  }
  return res.map(({ debut, fin, langue }) => ({ debut, fin, langue, traductible: LANGUES_TRADUCTIBLES.has(langue) }));
}
