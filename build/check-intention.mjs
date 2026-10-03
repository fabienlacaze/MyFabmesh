#!/usr/bin/env node
/**
 * Garde du composeur d'intention, cote JavaScript (2026-10-03).
 *
 * Le composeur existe en DEUX langages (scripts/composeur_intention.py = modal_app/composeur_intention.py ; src/renderer/lib/composeur-intention.js
 * = cloud/public/app/lib/composeur-intention.js). Sans verification ils divergeraient en silence : un prompt composé sur le bureau ne serait
 * plus celui que Modal recompose. Ce garde rejoue les 64 cas de build/intention_cas.json dans le module JS et exige les MEMES sorties que le
 * module Python, gravees par `python build/check_intention.py --ecrire` dans build/intention_attendus.json :
 *   - l'analyse complete (objets tenus, classe, nombre, main, pose, vue, buste, non-humain, parties, quantite, couleurs...) ;
 *   - la clause d'objet tenu et le gabarit adapte, avec TOUTES les regles et avec les regles ACTIVES ;
 *   - les notes.
 * Il verifie aussi que les regles actives sont les memes dans les deux fichiers, et que le cas temoin « An orc » ne change pas d'un octet.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lf = (s) => s.split('\r\n').join('\n');

// Node traite les .js de ce depot comme du CommonJS : on importe une copie .mjs temporaire.
const dossier = mkdtempSync(join(tmpdir(), 'intention-'));
let J;
try {
  const copie = join(dossier, 'composeur-intention.mjs');
  writeFileSync(copie, readFileSync(join(RACINE, 'src/renderer/lib/composeur-intention.js'), 'utf-8'));
  J = await import(pathToFileURL(copie).href);
} finally {
  rmSync(dossier, { recursive: true, force: true });
}

/** JSON canonique : cles triees (le module Python grave avec sort_keys). */
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = canon(x[k]);
    return o;
  }
  return x;
}
const egal = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const grave = JSON.parse(readFileSync(join(RACINE, 'build/intention_attendus.json'), 'utf-8'));
const attendus = grave.cas;
let echecs = 0;
const dit = (m) => { console.error('  ' + m); echecs++; };

for (const a of attendus) {
  const it = J.analyser(a.texte, a.type, a.style);
  if (!egal(it, a.intent)) dit(`cas ${a.id} « ${a.texte.slice(0, 60)} » : analyse differente\n      JS     : ${JSON.stringify(canon(it))}\n      Python : ${JSON.stringify(canon(a.intent))}`);
  const gabarit = grave.gabarits[a.type];
  const [tplT, notesT] = J.composerGabarit(gabarit, a.type, it, 'toutes');
  const [tplD, notesD] = J.composerGabarit(gabarit, a.type, it);
  const verifs = [
    ['clause (toutes les regles)', J.clauseObjetTenu(it, 'toutes'), a.clause_toutes],
    ['gabarit (toutes les regles)', tplT, a.tpl_toutes],
    ['notes (toutes les regles)', notesT, a.notes_toutes],
    ['clause (regles actives)', J.clauseObjetTenu(it), a.clause_defaut],
    ['gabarit (regles actives)', tplD, a.tpl_defaut],
    ['notes (regles actives)', notesD, a.notes_defaut],
  ];
  for (const [nom, js, py] of verifs) {
    if (!egal(js, py)) dit(`cas ${a.id} : ${nom} different\n      JS     : ${JSON.stringify(js)}\n      Python : ${JSON.stringify(py)}`);
  }
}

// regles actives identiques dans les deux fichiers
const py = lf(readFileSync(join(RACINE, 'scripts/composeur_intention.py'), 'utf-8'));
const m = py.match(/^REGLES_ACTIVES\s*=\s*\(([^)]*)\)/m);
const pyActives = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : null;
if (!pyActives || !egal(pyActives, J.REGLES_ACTIVES)) dit(`REGLES_ACTIVES differentes : JS ${JSON.stringify(J.REGLES_ACTIVES)} / Python ${JSON.stringify(pyActives)}`);
const mt = py.match(/^TOUTES_REGLES\s*=\s*\(([^)]*)\)/m);
const pyToutes = mt ? [...mt[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : null;
if (!pyToutes || !egal(pyToutes, J.TOUTES_REGLES)) dit(`TOUTES_REGLES differentes : JS ${JSON.stringify(J.TOUTES_REGLES)} / Python ${JSON.stringify(pyToutes)}`);

// temoin : un texte sans objet tenu ne change pas le gabarit d'un octet
const gabCharacter = grave.gabarits.character;
const itT = J.analyser('An orc', 'character', 'realistic');
const [tplT] = J.composerGabarit(gabCharacter, 'character', itT);
if (tplT !== gabCharacter || J.clauseObjetTenu(itT) !== null) dit('le cas temoin « An orc » a change (JS)');

// relecture d'un prompt enrichi : la clause GENEREE est retiree, jamais l'ecriture de l'utilisateur
{
  const cas = [
    // [texte relu, attendu]
    ['An orc warrior, holding a massive spiked club, holding exactly one massive spiked club in the right hand, left hand open and empty', 'An orc warrior, holding a massive spiked club'],
    ['A knight with a sword in his left hand, holding exactly one sword in the left hand, right hand open and empty', 'A knight with a sword in his left hand'],
    ['A samurai wielding two katanas, holding exactly two katanas, one in each hand', 'A samurai wielding two katanas'],
    ['A barbarian wielding a greatsword with both hands, holding exactly one greatsword with both hands', 'A barbarian wielding a greatsword with both hands'],
    ['A knight holding a sword and a shield, holding sword in the right hand and shield in the left hand', 'A knight holding a sword and a shield'],
    // l'ecriture de l'utilisateur n'est pas touchee : le texte restant ne regenere pas la clause
    ['knight holding exactly one sword in the right hand, left hand open and empty', 'knight holding exactly one sword in the right hand, left hand open and empty'],
    ['A knight holding a sword in the right hand and a shield in the left hand', 'A knight holding a sword in the right hand and a shield in the left hand'],
    ['An orc', 'An orc'],
    ['', ''],
  ];
  for (const [entree, attendu] of cas) {
    const got = J.retirerClauseFinale(entree);
    if (got !== attendu) dit(`retirerClauseFinale(${JSON.stringify(entree.slice(0, 70))}) : ${JSON.stringify(got)} au lieu de ${JSON.stringify(attendu)}`);
  }
  // idempotence : composer puis relire redonne le texte d'origine, pour chaque cas ecrit a la main qui tient quelque chose
  for (const a of attendus) {
    if (!/^\d+$/.test(a.id) || !a.intent.objets.length) continue;
    const clause = J.clauseObjetTenu(a.intent);
    if (!clause) continue;
    const enrichi = a.texte + ', ' + clause;
    const relu = J.retirerClauseFinale(enrichi);
    if (relu !== a.texte && !a.texte.toLowerCase().includes('holding exactly')) dit(`cas ${a.id} : composer puis relire ne redonne pas le texte (${JSON.stringify(relu)})`);
  }
}

if (echecs) {
  console.error(`\n[intention] ${echecs} difference(s) entre le module JavaScript et le module Python.`);
  console.error('  Corriger le module en tort ; si le changement du module Python est VOULU : python build/check_intention.py --ecrire\n');
  process.exit(1);
}
console.log(`[intention] module JavaScript identique au module Python sur ${attendus.length} cas (regles actives : ${J.REGLES_ACTIVES.join(', ')})`);
