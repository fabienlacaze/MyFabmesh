// FAMILLES DE POLITIQUE DOCUMENTEES du filtre de texte : les seuls cas ou la version APRES refuse MOINS que la production (f86208c0)
// et que c'est VOULU (faux positifs de la production retires par le lot « Securite des mineurs et robustesse du filtre de texte », ou
// decisions du proprietaire a venir : AGENT_LOG.md, entrees des 13 au 18/10/2026, rubrique « Questions de POLITIQUE »).
// Lu par les balayages et le fuzz differentiel (balayages.mjs, fuzz.mjs) : un recul qui n'est dans AUCUNE de ces familles est un
// RECUL de securite (echec du banc). Chaque famille est un motif sur le texte MINIMAL normalise (`normaliser`) ; on reste etroit :
// une famille trop large masquerait un vrai recul. Un recul de la famille B1 a B5 de la cinquieme relecture (caractere exotique dans un mot
// epele, age « chiffre + deux lettres », mot court + lettre non ASCII, torse nus, idiome au contact de lettres isolees) n'en fait PAS partie.
// homoglyphes cyrilliques, grecs et armeniens ramenes en latin : [point de code, lettre]
const HOMO = Object.fromEntries([
  [0x430, 'a'], [0x435, 'e'], [0x43e, 'o'], [0x441, 'c'], [0x440, 'p'], [0x445, 'x'], [0x456, 'i'], [0x443, 'y'], [0x43a, 'k'], [0x43d, 'h'], [0x43f, 'n'], [0x3b7, 'n'], [0x3b1, 'a'], [0x3b5, 'e'], [0x3bf, 'o'], [0x3b9, 'i'], [0x3c5, 'u'], [0x3bc, 'u'], [0x455, 's'], [0x442, 't'], [0x3c4, 't'], [0x43c, 'm'], [0x433, 'r'], [0x131, 'i'], [0x261, 'g'], [0x3c1, 'p'], [0x3ba, 'k'], [0x432, 'b'], [0x3b2, 'b'], [0x501, 'd'], [0x51d, 'w'], [0x3c9, 'w'], [0x585, 'o'], [0x578, 'n'], [0x57d, 'u'],
].map(([cp, l]) => [String.fromCodePoint(cp), l]));

/** Texte reduit a [a-z0-9 ] : NFKC, minuscules, marques retirees, homoglyphes cyrilliques et grecs ramenes en latin, le reste en espaces. */
export function normaliser(t, leet = false) {
  let s = t.normalize('NFKC').toLowerCase();
  s = s.normalize('NFD').replace(/\p{M}/gu, '');
  s = s.replace(/[^\x00-\x7f]/gu, (c) => HOMO[c] ?? ' ');
  if (leet) s = s.replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!]/g, 'i').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/7/g, 't');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Comme `normaliser`, mais les lettres EPELEES sont recollees comme le fait le filtre (« s*e*m*i*n*u*e*v » -> « seminuev », « c h i l d »
 *  -> « child ») : le passage d'une famille de politique y est reconnaissable meme s'il est ecrit lettre par lettre. */
export function normaliserJoint(t, leet = false) {
  let s = t.normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  s = s.replace(/[^\x00-\x7f]/gu, (c) => HOMO[c] ?? '.');
  if (leet) s = s.replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!]/g, 'i').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/7/g, 't');
  s = s.replace(/(?<![a-z0-9])[a-z0-9](?:[^a-z0-9\s]+[a-z0-9]){2,}(?![a-z0-9])/g, (m) => m.replace(/[^a-z0-9]+/g, ''));
  const jetons = s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const lettre = (x) => x.length === 1 && x >= 'a' && x <= 'z';
  const sortie = [];
  for (let i = 0; i < jetons.length;) {
    if (lettre(jetons[i])) {
      let j = i;
      while (j < jetons.length && lettre(jetons[j])) j++;
      if (j - i >= 3) sortie.push(jetons.slice(i, j).join('')); else sortie.push(...jetons.slice(i, j));
      i = j;
    } else sortie.push(jetons[i++]);
  }
  return sortie.join(' ');
}

const GRANDS = '(?:thousands?|hundreds?|millions?|billions?|dozens?|mille|milles|cents?|milliers?|milliards?|mil|miles|millones|millon|tausend|hundert|millionen|milliarden|mila|cento|centinaia|milioni|centenas?|centenares|milhares|milhoes|milhao|[0-9]{3}(?: [0-9]{3})* ?(?:years?|yrs?|ans|anos|anni|annees|anys|jahre|jahren|mois|months?|meses|mesi|siecles?|centuries|century))';
const ANIMAUX_BEBE = 'dragon|dino|dinosaur|dinosaure|dinosaurio|drache|drago|animal|animaux|beast|creature|monster|monstre|bird|oiseau|chick|duck|goose|owl|eagle|hawk|penguin|parrot|cat|chat|gato|dog|chien|perro|wolf|loup|lobo|fox|renard|zorro|bear|ours|oso|panda|koala|lion|leon|tiger|tigre|leopard|cheetah|elephant|elefante|giraffe|girafe|zebra|hippo|rhino|horse|cheval|caballo|pony|poney|unicorn|licorne|unicornio|donkey|cow|pig|sheep|goat|deer|rabbit|lapin|conejo|bunny|squirrel|mouse|rat|hamster|monkey|singe|gorilla|sloth|otter|seal|phoque|walrus|whale|baleine|ballena|dolphin|dauphin|delfin|shark|requin|tiburon|fish|poisson|pez|octopus|turtle|tortue|tortuga|tortoise|frog|toad|lizard|snake|serpent|serpiente|crocodile|alligator|spider|bat|griffin|gryphon|griffon|phoenix|hydra|wyvern|yeti|slime|alien|robot|golem|kraken|chimera|mammoth|raptor|insect|butterfly|bee|ant|crab|lobster|kangaroo|camel|llama|alpaca|moose|elk|buffalo|bison|boar|hedgehog|raccoon|beaver|badger|weasel|ferret';

/** EXCEPTIONS DE TERMES documentees : faux positifs de la production retires par le lot (MODERATION-05 et relectures du 14/10). Un terme
 *  des listes de la production dont le dernier mot correspond n'est ni balaye ni compte comme recul. [motif du mot, raison]. */
export const EXCEPTIONS_TERMES = [
  [/^(?:infantr|infanter|infantaria)/, 'infanterie (infantry, infanteria) : pas un mineur'],
  [/^pornic$/, 'Pornic (ville) : CLIP le lit por|nic'],
  [/^poitrine$/, 'poitrine (torse, cuirasse) : terme de contexte sexuel, plus un terme dur'],
  [/^heroine$/, 'heroine (personnage), MODERATION-05'],
  [/^stab(?!b|s?$)/, 'stable, stability (racine stab* de la production) : seuls stab, stabs, stabb* sont violents'],
  [/^seminu(?:ov|ev)/, 'seminuovo, seminuevo (semi-neuf)'],
];

/** [nom, motif, renvoi a la rubrique du proprietaire]. */
export const FAMILLES = [
  ['grands nombres apres un age (« aged 10 000 years », « 12 mil »)', new RegExp('(?:^| )(?:aged?|age of|ages|age de|agee de|agee|edad de|edad|alter von|alter|eta di|idade de|idade|just turned) ?(?:[0-9]+|[a-z]+) ' + GRANDS), 'politique (6)'],
  ['grands nombres avant une unite d\'age', new RegExp('(?:^| )(?:[0-9]+|[a-z]+) ?' + GRANDS + ' ?(?:yo|years? old)'), 'politique (6)'],
  ['idiomes a racine (nudel*, nacktschneck*, spogliatoi*, pornic, seminuov*, seminuev*...)', /(?:^| )(?:nudel|nacktschneck|nacktmull|nacktsamer|nackthund|nacktkatze|spogliatoi|pornic|seminuov|seminuev|naaktslak|snaked)/, 'MODERATION-05'],
  ['infanterie (infantry, infanteria)', /(?:^| )infant(?:r|er|ar)/, 'MODERATION-05'],
  ['« menor » adjectif (dragon menor, Asia Menor)', /(?:asia|osa|ursa|dragon|dragones|dragao|dragoes|demonio|demonios|dios|dioses|deus|deuses|deidad|deidades|golem|golems|elemental|elementales|espiritu|espiritus|espirito|espiritos|pocion|pociones|pocao|pocoes|hechizo|hechizos|feitico|feiticos|reliquia|reliquias|artefacto|artefactos|artefato|artefatos|bestia|bestias|monstruo|monstruos|monstro|monstros|jefe|jefes|chefe|chefes|enemigo|enemigos|inimigo|inimigos|arcano|arcanos|nivel|niveles|rango|rangos|grado|grados|clase|clases|calidad|nobleza|orden|liga|ligas|escala|tono|acorde|tercera|septima|sexta) menor/, 'politique (3)'],
  ['« baby <animal> » (bebe dragon = jeune dragon)', new RegExp('(?:^| )(?:baby|bebe) (?:' + ANIMAUX_BEBE + ')'), 'politique (3)'],
  ['« nu » de corps ou d\'objet (pieds nus, tete nue, oeil nu, murs nus...)', /(?:^| )(?:pieds? nu|nus? pieds?|mains? nue|tetes? nue|oeil nu|bras nu|jambes? nue|arbres? nu|branches? nue|murs? nu|sols? nu|lames? nue|epees? nue|fils? nu|cables? nu|ciels? nu|pieces? nue|paredes? nua|stanz[ae] nud|mur[io] nud|paret[ei] nud)/, 'politique (3)'],
  ['« torse nu » (tenue, comme shirtless : refuse avec un mineur, pas avec un indice ni pour un adulte)', /(?:^| )tors[e]+s? nus?(?: |$)/, 'politique (3)'],
  ['« nu » + lettre a marque distinctive (nữ, nụ, nữa, nửa, ñu : vue exacte)', /(?:^| )n ?(?:x|u)(?:e|s|es|a|as)? ?(?:x| |$)/, 'MODERATION-05'],
  ['vocabulaire de jeu, outil ou objet (gore tex, hit points, toy gun, paint stripper, rapeseed, chinks of light...)', /(?:chinks? of light|gore tex|counter terror|anti terror|suicide door|opium popp|bedroom (?:furniture|set|decor|lamp|wallpaper|interior|design)|hit points?|hit box|critical hits?|scream mask|toy (?:gun|sword|knife|weapon|bow)|water gun|nerf gun|squirt gun|cap gun|bunk bed|hospital bed|knife and fork|attack (?:pose|animation|stance|move)|moby dick|dick whittington|pussy (?:cat|willow)|bottle nipple|cum laude|paint stripper|varnish stripper|wire stripper|anal fin|wild ass|senos? paranasal|spanking new|sperm whale|rapeseed|oilseed rape|rape (?:field|flower|plant|crop|seed|oil|blossom)|fields? of rape|yellow rape)/, 'politique (3)'],
  ['ferme et chantier (« a cock and two hens », « the erection of the tower »)', /(?:cock (?:and|or|with|among|beside|near) |(?:hens?|chickens?|chicks?|pullets?|poultry|ducks?|geese|turkeys?) (?:and|or|with) (?:a |an |the |one |two |its |their )?cocks?|crowing cock|crowed cock|cock crow|weather cock|cock a doodle|erection (?:of|crew|site|works|team|crane|phase|plan|stage|drawing))/, 'politique (2)'],
  ['pelada, viol, foursome, semen, cria, pupils', /(?:pelada|peladas|viol da|play(?:s|ing|ed)? (?:a|the|his|her) viol|bass viol|golf foursome|foursome of|semen (?:gudang|bangunan|putih)|pabrik semen|cria (?:um|uma)|pupils? (?:of|dilat)|(?:blank|dilated|slit|vertical|glowing|red|golden|gold|green|blue|empty|cat|catlike|feline|reptilian|snake|goat|pinpoint|eye|eyes) pupil)/, 'politique (3)'],
  ['duree « N ans de X » (liste fermee des durees)', /(?:^| )(?:[0-9]+|[a-z]+) ?(?:ans|anos|anni|mois|meses|mesi) (?:de|d|du|des|del|di|da|do|della|dei|dos|das) (?:guerres?|services?|travail|travaux|experiences?|carrieres?|mariage|prison|captivite|exil|paix|regne|combats?|mer|croisades?|retraites?|legions?|aventures?|servicio|servico|servizio|guerra|guerras|battaglia)/, 'politique (3)'],
  ['nombre ambigu apres un prefixe anglais (aged elf, ages due, age um, aged un, aged once)', /(?:^| )(?:aged?|age of|ages|just turned) ?(?:elf|due|um|un|une|once)(?: |$)/, 'politique (8)'],
  ['« stab* » reduit (stable, stability)', /(?:^| )stab(?!b)(?!s(?: |$))[a-z]+/, 'MODERATION-05'],
  ['poitrine, heroine, stable', /(?:^| )(?:poitrine|heroine|stabil|stable)(?: |$|[a-z])/, 'politique (1)'],
];

const RANG = { '.': 0, G: 1, P: 2 };

/** Noms des familles de politique documentee qui EXPLIQUENT un recul, ou null (recul de securite INEXPLIQUE).
 *  Un recul n'est explique que si, sur UN texte lu par le filtre (le texte normalise, ou une des VUES de la version APRES : lettres
 *  epelees recollees, ponctuation retiree...), (1) il se reproduit (un caractere exotique qui joue un role est donc un recul inexplique) et
 *  (2) les passages que reconnaissent les familles, remplaces par un mot neutre, font REFUSER MOINS la production : c'est bien ce passage
 *  (idiome, expression, grand nombre...) que la production refusait. Un recul B1 a B5 dont le texte contient un idiome
 *  (« a snaked c h i l d naked ») reste inexplique : la production le refuse aussi sans le mot « snaked ».
 *  `jug` = { prod(texte), apres(texte), vuesProd(texte), vues(texte) } : verdicts '.', 'G' ou 'P' ; vues lues par la PRODUCTION (le texte
 *  tel qu'elle le lisait, idiomes compris) et par la version APRES. */
export function explique(texte, jug) {
  // Marques distinctives (tilde, crochet, corne, point souscrit : nữ, nụ, nữa, nửa, ñu) : la vue exacte des mots courts « nu », « nue »...
  // ne les ramene pas a la lettre de base (MODERATION-05). Explique le recul si, ces marques retirees, la version APRES refuse comme la
  // production (les autres vues retirent toutes les marques : elles ne sont donc la cause d'aucun autre recul).
  const sansDistinctives = texte.normalize('NFD').replace(/[\u{303}\u{309}\u{31b}\u{323}]/gu, '').normalize('NFC');
  if (sansDistinctives !== texte.normalize('NFC')) {
    const vp = jug.prod(texte);
    if (vp !== '.' && RANG[jug.apres(texte)] < RANG[vp] && RANG[jug.apres(sansDistinctives)] >= RANG[vp]) {
      return '« nu » + lettre a marque distinctive (nữ, nụ, nữa, nửa, ñu : vue exacte)';
    }
  }
  // Caracteres attribues APRES Unicode 14 que NFKC change en lettre (U+1CCD6 a U+1CCF9 : lettres et chiffres cernes ; U+1E030 a U+1E06D :
  // lettres cyrilliques modificatives) : le moteur du worker (Unicode 16) y lisait une lettre, le tokenizer CLIP de Modal (Unicode 14)
  // les efface. Le lot les efface partout (B3 du 14/10) : « n<U+1E030>ked » n'est plus « naked ». Explique le recul si, ces caracteres
  // changes en lettre par NFKC, la version APRES refuse comme la production.
  const nfkcPost14 = texte.replace(/[\u{1ccd6}-\u{1ccf9}\u{1e030}-\u{1e06d}]/gu, (c) => c.normalize('NFKC'));
  if (nfkcPost14 !== texte) {
    const vp = jug.prod(texte);
    if (vp !== '.' && RANG[jug.apres(texte)] < RANG[vp] && RANG[jug.apres(nfkcPost14)] >= RANG[vp]) {
      return 'caractere attribue apres Unicode 14 que NFKC change en lettre (efface comme par le tokenizer CLIP de Modal)';
    }
  }
  const candidats = [...new Set([normaliser(texte), normaliser(texte, true), normaliserJoint(texte), normaliserJoint(texte, true)])];
  try { for (const v of [...jug.vuesProd(texte), ...jug.vues(texte)]) if (!candidats.includes(v)) candidats.push(v); } catch { /* pas de vues */ }
  for (const m of candidats) {
    const vp = jug.prod(m);
    if (vp === '.' || RANG[jug.apres(m)] >= RANG[vp]) continue;
    let neutre = m;
    const noms = [];
    for (const [nom, re] of FAMILLES) {
      if (new RegExp(re.source, 'g').test(neutre)) { noms.push(nom); neutre = neutre.replace(new RegExp(re.source, 'g'), ' zz '); }
    }
    if (noms.length && RANG[jug.prod(neutre)] < RANG[vp]) return noms.join(' + ');
  }
  return null;
}
