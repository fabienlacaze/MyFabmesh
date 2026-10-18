#!/usr/bin/env node
/**
 * PREUVE que les tests du filtrage des textures ECHOUENT sans le correctif (2026-10-18).
 *
 * Une suite de tests qui passe ne prouve rien tant qu'on n'a pas vu qu'elle ECHOUE quand le code est faux. Deux suites :
 *   - BUREAU : tests/bureau-interface/filtrage-textures.test.mjs (la suite complete, sur src/renderer/lib) ;
 *   - SITE   : cloud/tests/filtrage-textures-site.test.mjs (la copie livree au site, lancee par la construction du site).
 * Ce script :
 *   1. lance les deux suites sur le code tel que livre (TEMOINS : doivent passer, 0 echec) ;
 *   2. les lance sur l'etat d'AVANT le correctif (« base ») : un module sans effet (memes noms exportes, rien de fait) et les
 *      Viewer3D.js de l'ancienne base (git, --ref, defaut origin/integration-1410) pour les deux cibles ;
 *   3. fabrique des MUTANTS du module (une seule faute a la fois : un comportement retire ou inverse) et verifie que chacun
 *      est refuse par AU MOINS un des tests qu'il vise dans la suite BUREAU ; les mutants marques « site » doivent aussi
 *      etre refuses par la suite du SITE. Un mutant dont le texte a remplacer n'existe pas EXACTEMENT une fois est une erreur
 *      du script (jamais un mutant « qui survit » par oubli).
 * Rien n'est ecrit dans le depot : variantes dans un dossier temporaire, supprime a la fin.
 *
 * usage : node build/bancs/viewer/prouver_tests_filtrage.mjs [--ref origin/integration-1410] [--garder]
 * code de sortie : 0 si les temoins passent, si « base » est refusee par les deux suites et si tous les mutants sont tues ; 1 sinon.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const REF = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'origin/integration-1410';
const GARDER = args.includes('--garder');
const SUITES = {
  bureau: { fichier: join(RACINE, 'tests/bureau-interface/filtrage-textures.test.mjs'), cwd: RACINE },
  site: { fichier: join(RACINE, 'cloud/tests/filtrage-textures-site.test.mjs'), cwd: join(RACINE, 'cloud') },
};
const MODULE = join(RACINE, 'src/renderer/lib/filtrage-textures.js');
const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SOURCE = lire(MODULE);
const TEMP = mkdtempSync(join(tmpdir(), 'prouver-filtrage-'));

/** Lance une suite avec ces variables d'environnement ; rend { code, echecs: [titres], ok, total }. */
function lancerSuite(nom, env, delaiMs = 180000) {
  const s = SUITES[nom];
  const r = spawnSync(process.execPath, ['--test', s.fichier], { cwd: s.cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: delaiMs, maxBuffer: 64 * 1024 * 1024 });
  const sortie = (r.stdout || '') + '\n' + (r.stderr || '');
  const echecs = [...sortie.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].trim());
  const nombre = (cle) => { const m = new RegExp('^# ' + cle + ' (\\d+)$', 'm').exec(sortie); return m ? Number(m[1]) : NaN; };
  return { code: r.status, delai: r.error && r.error.code === 'ETIMEDOUT', echecs, ok: nombre('pass'), total: nombre('tests'), sortie };
}
/** Variables d'environnement qui injectent le module teste dans les DEUX suites. */
const envModule = (fichier) => ({ FICHIER_FILTRAGE: fichier, FICHIER_FILTRAGE_SITE: fichier });

/** Remplace `ancien` par `nouveau` dans le module ; ERREUR si `ancien` n'y est pas exactement une fois. */
function muter(nom, ancien, nouveau) {
  const n = SOURCE.split(ancien).length - 1;
  if (n !== 1) throw new Error(`mutant « ${nom} » : le texte a remplacer apparait ${n} fois (attendu : 1) : ${JSON.stringify(ancien).slice(0, 120)}`);
  return SOURCE.replace(ancien, nouveau);
}

// [nom, description, fabrication, tests vises (bureau), refuse aussi par la suite du site ?]
const MUTANTS = [
  ['sans-defaut', 'DEFAULT_ANISOTROPY non pose : les textures neuves (toiles de Paint Mesh, FBX...) restent a 1',
    () => muter('sans-defaut', 'THREE.Texture.DEFAULT_ANISOTROPY = Math.max(THREE.Texture.DEFAULT_ANISOTROPY || 1, plafondAnisotropie());', ''), ['toute texture NEUVE'], true],
  ['sans-enveloppe', 'GLTFLoader.parse non enveloppe : les cartes d un GLB ne sont pas reglees',
    () => muter('sans-enveloppe', '\nbrancherSurChargeurGLTF(GLTFLoader);', '\n'), ['GLTFLoader.parse REEL', 'parseAsync et load()', 'modeles charges plusieurs fois'], true],
  ['enveloppe-sans-scenes', 'l enveloppe ne regle plus aucune scene',
    () => muter('enveloppe-sans-scenes', 'for (const s of scenes) preparerTexturesModele(s, null);', ''), ['GLTFLoader.parse REEL', 'parseAsync et load()'], true],
  ['rappel-denature', 'le rappel de l appelant recoit un autre objet que le resultat du chargeur',
    () => muter('rappel-denature', 'onLoad.apply(this, arguments)', 'onLoad.call(this, { scenes: [] })'), ['l erreur du chargeur et le rappel'], false],
  ['enveloppe-empilee', 'brancherSurChargeurGLTF n est plus idempotent',
    () => muter('enveloppe-empilee', '|| proto.parse.__filtrageTextures) return false;', ') return false;'), ['brancherSurChargeurGLTF : idempotent'], false],
  ['sans-mipmaps', 'un filtre sans mipmaps n est jamais corrige',
    () => muter('sans-mipmaps', 'if (!minOk && (mipsFournis ||', 'if (false && !minOk && (mipsFournis ||'), ['GLTFLoader.parse REEL', 'mipmaps : un filtre sans mipmaps'], true],
  ['mipmaps-incomplets', 'une texture a filtre a mipmaps mais sans mipmaps (noire dans three) n est pas corrigee',
    () => muter('mipmaps-incomplets', 't.generateMipmaps === false\n    && (t.minFilter', 't.generateMipmaps === "jamais"\n    && (t.minFilter'), ['GLTFLoader.parse REEL', 'mipmaps : un filtre sans mipmaps'], false],
  ['gros-atlas', 'des mipmaps sont creees meme sur un atlas de 16384 x 16384 (+33 % de memoire de carte)',
    () => muter('gros-atlas', 'export const PIXELS_MAX_POUR_MIPMAPS = 8192 * 8192;', 'export const PIXELS_MAX_POUR_MIPMAPS = Infinity;'), ['un tres gros atlas'], false],
  ['ecrase-nearest', 'les textures Nearest voulues par l auteur sont reglees quand meme',
    () => muter('ecrase-nearest', 'if (t.magFilter === THREE.NearestFilter) { bilan.ignorees++; return; }', ''), ['echantillonneur NEAREST', 'cartes a NE PAS toucher'], true],
  ['sans-cles-ignorees', 'la rampe de toon (gradientMap) et envMap sont reglees',
    () => muter('sans-cles-ignorees', "const CLES_IGNOREES = new Set(['envMap', 'gradientMap']);", 'const CLES_IGNOREES = new Set([]);'), ['cartes a NE PAS toucher'], false],
  ['compressees-generees', 'des mipmaps sont « generees » sur une texture compressee',
    () => muter('compressees-generees', 'const generable = !t.isCompressedTexture && !mipsFournis;', 'const generable = true;'), ['textures compressees'], false],
  ['anisotropie-abaissee', 'une valeur plus haute posee ailleurs est abaissee',
    () => muter('anisotropie-abaissee', 'if (!(t.anisotropy >= cible)) {', 'if (t.anisotropy !== cible) {'), ['borne par la capacite de la carte, jamais abaissee'], false],
  ['anisotropie-jamais', 'l anisotropie n est jamais posee',
    () => muter('anisotropie-jamais', '    t.anisotropy = cible;', ''), ['GLTFLoader.parse REEL', 'TOUTES les cartes de TOUS les materiaux'], false],
  ['retelecharge-toujours', 'chaque texture reglee est renvoyee a la carte, meme une texture neuve',
    () => muter('retelecharge-toujours', 'if (change && _dejaTeleversee(t, renderer)) {', 'if (change) {'), ['GLTFLoader.parse REEL', 'televersement'], true],
  ['retelecharge-jamais', 'une texture deja sur la carte n est jamais renvoyee : le pilote ne voit jamais le reglage',
    () => muter('retelecharge-jamais', 'if (change && _dejaTeleversee(t, renderer)) {', 'if (false && change && _dejaTeleversee(t, renderer)) {'), ['televersement'], false],
  ['fuite', 'le module retient les textures (ensemble fort au lieu de WeakSet)',
    () => muter('fuite', 'const _traitees = new WeakSet();', 'const _traitees = new Set();'), ['sans fuite'], false],
  ['plafond-tactile-ignore', 'le plafond de 8 des ecrans tactiles est ignore',
    () => muter('plafond-tactile-ignore', 'return tactile ? ANISOTROPIE_TACTILE : ANISOTROPIE_ORDINATEUR;', 'return ANISOTROPIE_ORDINATEUR;'), ['plafond : 16 sur ordinateur', 'anisotropieCible'], false],
  ['capacite-ignoree', 'la capacite de la carte (getMaxAnisotropy) ne borne plus la valeur',
    () => muter('capacite-ignoree', "if (typeof m === 'number' && isFinite(m)) max = m;", ''), ['anisotropieCible', 'borne par la capacite de la carte, jamais abaissee'], false],
  ['plancher-zero', 'une carte sans extension (getMaxAnisotropy = 0) donne une anisotropie de 0',
    () => muter('plancher-zero', 'return Math.max(1, Math.min(plafond, max));', 'return Math.min(plafond, max);'), ['anisotropieCible'], false],
  ['tout-traverser', 'les etiquettes (Sprite) et lignes sont reglees comme des meshes',
    () => muter('tout-traverser', 'if (!obj.isMesh || !obj.material) return;', 'if (!obj.material) return;'), ['entrees degenerees'], false],
  ['materiau-unique', 'un tableau de materiaux n est pas parcouru',
    () => muter('materiau-unique', 'const materiaux = Array.isArray(obj.material) ? obj.material : [obj.material];', 'const materiaux = [obj.material];'), ['TOUTES les cartes de TOUS les materiaux'], false],
];

const BASE_MODULE_SANS_EFFET = `// Etat d'AVANT le correctif : memes noms exportes, aucun effet (pas de DEFAULT_ANISOTROPY, pas d'enveloppe de parse).
export const ANISOTROPIE_ORDINATEUR = 16;
export const ANISOTROPIE_TACTILE = 8;
export const PIXELS_MAX_POUR_MIPMAPS = 8192 * 8192;
export function plafondAnisotropie() { return ANISOTROPIE_ORDINATEUR; }
export function anisotropieCible() { return 1; }
export function preparerTexturesModele() { return { textures: 0, anisotropie: 0, mipmaps: 0, ignorees: 0, retelechargees: 0 }; }
export function brancherSurChargeurGLTF() { return false; }
`;

/** Dossier temporaire = copie des petits modules d'un dossier lib + Viewer3D.js de l'ancienne base. */
function viewerDeLaBase(nom, cheminDepot, dossierLib) {
  const dest = join(TEMP, 'base_' + nom);
  mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(join(RACINE, dossierLib))) {
    if (f.endsWith('.js') && f !== 'three.module.js' && f !== 'three-mesh-bvh.module.js' && f !== 'Viewer3D.js' && f !== 'filtrage-textures.js') copyFileSync(join(RACINE, dossierLib, f), join(dest, f));
  }
  const ancien = execFileSync('git', ['-C', RACINE, 'show', `${REF}:${cheminDepot}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(dest, 'Viewer3D.js'), ancien);
  return join(dest, 'Viewer3D.js');
}

let mauvais = 0;
const ligne = (s) => console.log(s);
try {
  ligne(`Preuve des tests du filtrage des textures (base de comparaison : ${REF})\n`);

  for (const nom of Object.keys(SUITES)) {
    const t = lancerSuite(nom, {});
    const ok = t.code === 0 && t.echecs.length === 0;
    ligne(`TEMOIN ${nom.padEnd(6)} (code livre)            : ${ok ? 'OK' : 'ECHEC'}  ${t.ok}/${t.total} tests passent`);
    if (!ok) { mauvais++; ligne('  le temoin doit passer : ' + t.echecs.join(' | ')); }
  }

  const fichierBase = join(TEMP, 'module_sans_effet.js');
  writeFileSync(fichierBase, BASE_MODULE_SANS_EFFET);
  const envBase = {
    ...envModule(fichierBase),
    FICHIER_VIEWER3D: viewerDeLaBase('bureau', 'src/renderer/lib/Viewer3D.js', 'src/renderer/lib'),
    FICHIER_VIEWER3D_SITE: viewerDeLaBase('site', 'cloud/public/app/lib/Viewer3D.js', 'cloud/public/app/lib'),
  };
  ligne('');
  for (const nom of Object.keys(SUITES)) {
    const base = lancerSuite(nom, envBase);
    const refusee = base.code !== 0 && base.echecs.length > 0;
    ligne(`SANS LE CORRECTIF ${nom.padEnd(6)} (etat de ${REF.replace('origin/', '')}) : ${refusee ? 'REFUSE' : 'ACCEPTE (MAUVAIS)'}  ${base.echecs.length} test(s) en echec sur ${base.total}`);
    for (const t of base.echecs) ligne('    - ' + t.slice(0, 150));
    if (!refusee) mauvais++;
  }

  ligne('');
  let tues = 0;
  for (const [nom, description, fabriquer, vise, aussiSite] of MUTANTS) {
    const fichier = join(TEMP, nom + '.js');
    writeFileSync(fichier, fabriquer());
    const r = lancerSuite('bureau', envModule(fichier));
    const touches = r.echecs.filter((t) => vise.some((v) => t.includes(v)));
    let tue = r.code !== 0 && touches.length > 0;
    let site = '';
    if (aussiSite) {
      const rs = lancerSuite('site', envModule(fichier));
      const tueSite = rs.code !== 0 && rs.echecs.length > 0;
      site = tueSite ? ` | site : ${rs.echecs.length} echec(s)` : ' | site : SURVIT';
      if (!tueSite) tue = false;
    }
    if (tue) tues++; else mauvais++;
    ligne(`${tue ? 'TUE      ' : 'SURVIT   '} ${nom.padEnd(24)} bureau : ${String(r.echecs.length).padStart(2)} echec(s)${site} | ${description}`);
    if (!tue) ligne(`    tests vises : ${JSON.stringify(vise)} ; en echec : ${JSON.stringify(r.echecs)}${r.delai ? ' (delai depasse)' : ''}`);
  }
  ligne(`\nMutants : ${tues} tues sur ${MUTANTS.length} (dont ${MUTANTS.filter((m) => m[4]).length} aussi refuses par la suite du site).`);
  ligne(mauvais ? `\nECHEC de la preuve : ${mauvais} point(s) a corriger.` : '\nPreuve complete : temoins verts, etat d avant le correctif refuse, tous les mutants tues.');
} finally {
  if (GARDER) console.log('dossier temporaire conserve : ' + TEMP); else rmSync(TEMP, { recursive: true, force: true });
}
process.exit(mauvais ? 1 : 0);
