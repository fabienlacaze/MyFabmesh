// Harnais commun des tests « noms de projet non latins » du BUREAU (audit de la langue du 11/10, lot 3, et sa revue du 13/10).
// Ce fichier n'est PAS un test (le prefixe _ l'exclut du motif *.test.mjs).
//
// Il branche les unes sur les autres, sur un dossier temporaire, les VRAIES fonctions :
//   - de src/main/main.js : gestionnaires IPC (generate-images, list-image-folders, projet-vide:*, get-project-display-names,
//     delete-project, rename-project-files, import-dropped-file...) et leurs aides de premier niveau (_memoriserNomProjet...) ;
//   - de src/main/cloud_fallback.js : shareAsset (partage vers le site) et downloadItem (« Cloud library » -> projet ouvert) ;
//   - de src/main/animation.js : le gestionnaire anim:motion (clip d'animation envoye au site), enregistre par register() ;
//   - de src/renderer/index2.js : refreshProjectsPage, reloadCurrentProject et les expressions exactes que la page passe au
//     processus principal (nom du projet pour le telechargement, le partage, le clip) ;
//   - de cloud/public/app/index2.js : refreshProjectsPage du SITE, pour compter les cartes qu'un projet du bureau y forme.
// Le reseau (site, R2, Modal) est une doublure : aucun appel reel, aucun GPU, aucun Python.
//
// Variables pour viser un autre exemplaire (preuve qu'un test ECHOUE sur l'ancien code) : MAIN_JS, CLOUD_FALLBACK_JS, ANIMATION_JS,
// BUREAU_INDEX2, WEB_INDEX2, SLUG_PROJET (un chemin absent = module absent, comme avant le lot).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
export const RACINE_DEPOT = path.resolve(ici, '..', '..');
const source = (env, rel) => process.env[env] || path.join(RACINE_DEPOT, rel);
export const CHEMINS = {
  main: source('MAIN_JS', 'src/main/main.js'),
  cloudFallback: source('CLOUD_FALLBACK_JS', 'src/main/cloud_fallback.js'),
  animation: source('ANIMATION_JS', 'src/main/animation.js'),
  bureau: source('BUREAU_INDEX2', 'src/renderer/index2.js'),
  web: source('WEB_INDEX2', 'cloud/public/app/index2.js'),
  slug: source('SLUG_PROJET', 'src/main/slug_projet.js'),
};
export let S = null;
try { S = require(CHEMINS.slug); } catch (_) { S = null; }

const lire = (p) => fs.readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');
const analyser = (texte, sourceType) => acorn.parse(texte, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: sourceType === 'script' });
const TEXTES = Object.fromEntries(Object.entries(CHEMINS).filter(([k]) => k !== 'slug').map(([k, p]) => [k, lire(p)]));
const AST = {
  main: analyser(TEXTES.main, 'script'),
  cloudFallback: analyser(TEXTES.cloudFallback, 'script'),
  animation: analyser(TEXTES.animation, 'script'),
  bureau: analyser(TEXTES.bureau, 'module'),
  web: analyser(TEXTES.web, 'module'),
};

/** Fonction de premier niveau `nom` de `cle` (null si cette copie ne la declare pas). */
export function fonction(cle, nom) {
  const n = AST[cle].body.find((x) => x.type === 'FunctionDeclaration' && x.id && x.id.name === nom);
  return n ? TEXTES[cle].slice(n.start, n.end) : null;
}
/** Declarations de premier niveau (fonctions, const/let/var) d'une page, par nom. */
function declarations(cle) {
  const m = new Map();
  for (const n of AST[cle].body) {
    if (n.type === 'FunctionDeclaration' && n.id) m.set(n.id.name, TEXTES[cle].slice(n.start, n.end));
    else if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') m.set(d.id.name, TEXTES[cle].slice(n.start, n.end));
  }
  return m;
}
const DECL = { bureau: declarations('bureau'), web: declarations('web') };
export const pageDeclare = (cle, nom) => DECL[cle].has(nom);

/** Source du gestionnaire passe a ipcMain.handle('<canal>', ...) dans main.js. */
export function gestionnaire(canal) {
  let src = null;
  (function visiter(n) {
    if (!n || typeof n.type !== 'string' || src) return;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object && n.callee.object.name === 'ipcMain'
        && n.callee.property.name === 'handle' && n.arguments[0] && n.arguments[0].value === canal) { src = TEXTES.main.slice(n.arguments[1].start, n.arguments[1].end); return; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  })(AST.main);
  if (!src) throw new Error('gestionnaire introuvable dans main.js : ' + canal);
  return src;
}

/** Dependances que main.js passe VRAIMENT a un module : proprietes de l'objet litteral de l'appel `<module>.register({...})`
 *  (`estAppel` reconnait l'appel), rendues sous la forme { propriete: identifiant } (seules les valeurs qui sont des identifiants). */
function depsPasseesParMain(estAppel) {
  const deps = {};
  (function visiter(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property && n.callee.property.name === 'register'
        && estAppel(n.callee.object) && n.arguments[0] && n.arguments[0].type === 'ObjectExpression') {
      for (const p of n.arguments[0].properties) {
        if (p.type !== 'Property' || !p.key) continue;
        const cle = p.key.name || p.key.value;
        if (p.value && p.value.type === 'Identifier') deps[cle] = p.value.name;
      }
    }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visiter); else if (v && typeof v.type === 'string') visiter(v); }
  })(AST.main);
  return deps;
}
/** require('./animation').register({...}) et cloudFallback.register({...}) dans main.js. */
const DEPS_ANIMATION = depsPasseesParMain((o) => o.type === 'CallExpression' && o.callee.name === 'require' && o.arguments[0] && o.arguments[0].value === './animation');
const DEPS_CLOUD = depsPasseesParMain((o) => o.type === 'Identifier' && o.name === 'cloudFallback');

/** Expressions EXACTES que la page du bureau passe au processus principal (texte de src/renderer/index2.js). */
const expression = (re, quoi) => {
  const m = TEXTES.bureau.match(re);
  if (!m) throw new Error('expression introuvable dans la page du bureau : ' + quoi);
  return m[1].trim();
};
export const EXPRESSIONS_PAGE = {
  // panneau « Cloud library » : projet de destination d'un telechargement
  telechargement: expression(/const destProject = \(\) => (.+);$/m, 'destProject'),
  // _cloudShare : nom du projet joint au partage vers le site
  partage: expression(/API\.cloudShareAsset\(\{ filePath, projectName: ([^}]+?) \}\)/, 'cloudShareAsset'),
  // bouton Animate : nom du projet joint au clip (anim:motion -> /api/animate)
  animation: expression(/API\.animMotion\(\{[^}]*?projectName: ([^,}]+)/, 'animMotion'),
};

// Aides de premier niveau de main.js utilisees par les gestionnaires (celles que la copie declare), evaluees dans UNE portee commune.
const AIDES_MAIN = ['_memoriserNomProjet', '_nomsSaisisDesMarqueurs', '_nomsSaisisPourLeSite', '_nomPourLeSiteDuProjet', '_cheminProjetVide', '_meshProjectBackend',
  // negations de l'utilisateur (piste N, fusionnee le 20/10) : generate-images nettoie `negativeExtra` et le rend au filtre ; sans elles le gestionnaire
  // leve un ReferenceError que son propre catch transforme en erreur sur _manqueMemoireDansSortie
  '_assainirNegativeExtra', '_texteDeModeration'];
// Fonctions de cloud_fallback.js exercees ici (et l'aide de nom, si la copie la declare).
const FONCTIONS_CF = ['_nomProjetPourLeSite', 'shareAsset', 'downloadItem'];
// Aides de nom des pages (presentes ou non selon la copie : sur l'ancien code les tests echouent par COMPORTEMENT).
const AIDES_PAGE = ['_estNomAscii', '_nomsEquivalents', '_projetDuNom', '_nomSaisiDuProjet', '_nomPourLeSite'];
const silence = { log() {}, warn() {}, error() {}, info() {} };
const octetsPng = () => Buffer.alloc(300, 7);

/** Bureau simule. `config` : config.json de depart. Rend les gestes de l'utilisateur et ce qui est parti vers le site. */
export function bureau({ config: configInitiale = { blenderPath: '' } } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'noms-projet-chaine-'));
  const IMAGES_DIR = path.join(racine, 'images'), MESHES_DIR = path.join(racine, 'meshes');
  const PROJETS_VIDES_DIR = path.join(racine, 'projets_vides'), HISTORY_DIR = path.join(racine, 'history');
  for (const d of [IMAGES_DIR, MESHES_DIR, HISTORY_DIR]) fs.mkdirSync(d, { recursive: true });
  let config = JSON.parse(JSON.stringify(configInitiale));
  let compteur = 0;
  /** Ce que le site a recu : images generees (user_assets), enregistrements de partage, clips demandes (/api/animate). */
  const site = { images: [], partages: [], animations: [] };

  // ---------- processus principal (main.js) ----------
  const doubluresMain = {
    fs, path, IMAGES_DIR, MESHES_DIR, PROJETS_VIDES_DIR, HISTORY_DIR, HF_CACHE_DIR: path.join(racine, 'hf'), Buffer,
    process: { env: {} }, console: silence, log: silence,
    loadConfig: () => JSON.parse(JSON.stringify(config)), saveConfig: (c) => { config = JSON.parse(JSON.stringify(c)); },
    isCloudMode: () => true, _localPyLibsUsable: () => true,
    checkPromptSafety: () => ({ safe: true }), checkPromptSafetyAI: async () => ({ safe: true }),
    detectNvidiaGpu: async () => ({ hasNvidia: false }), safeSend() {}, _BUILD_STAGE_MODIFIERS: [],
    cloudFallback: {
      generateImages: async (args) => {
        site.images.push(args.projectName);
        fs.mkdirSync(args.imagesDir, { recursive: true });
        const p = path.join(args.imagesDir, `gen_${Date.now()}_${compteur++}.png`);
        fs.writeFileSync(p, octetsPng());
        return { success: true, images: [p] };
      },
    },
    cheminAutorise: (p, racines) => racines.some((r) => path.resolve(p).startsWith(path.resolve(r) + path.sep)),
    slugProjet: S ? S.slugProjet : undefined, nomAffichageAMemoriser: S ? S.nomAffichageAMemoriser : undefined,
    nomPourLeSite: S ? S.nomPourLeSite : undefined,
  };
  const clesMain = Object.keys(doubluresMain);
  const aidesPresentes = AIDES_MAIN.filter((n) => fonction('main', n));
  const aides = new Function(...clesMain, aidesPresentes.map((n) => fonction('main', n)).join('\n') + '\nreturn { ' + aidesPresentes.join(', ') + ' };')
    (...clesMain.map((k) => doubluresMain[k]));
  const dansMain = (src) => new Function(...clesMain, ...aidesPresentes, 'return (' + src + ');')
    (...clesMain.map((k) => doubluresMain[k]), ...aidesPresentes.map((n) => aides[n]));
  const appeler = async (canal, args) => dansMain(gestionnaire(canal))({}, args);

  // ---------- cloud_fallback.js (partage, telechargement) ----------
  /** Branche sur `deps` les aides de main.js que CETTE copie passe vraiment a register (lu dans l'appel, pas suppose). */
  const brancher = (deps, passees) => {
    for (const [cle, ident] of Object.entries(passees)) if (typeof aides[ident] === 'function') deps[cle] = aides[ident];
    return deps;
  };
  /** Dependances passees par main.js a cloudFallback.register. */
  const depsCloud = brancher({ IMAGES_DIR, MESHES_DIR }, DEPS_CLOUD);
  const reponse = (corps, status = 200) => ({ ok: status < 400, status, headers: { get: () => null },
    json: async () => corps, arrayBuffer: async () => new Uint8Array(400).buffer });
  const doubluresCF = {
    fs, path, Buffer, console: silence, _deps: depsCloud, WORKER_URL: 'https://site.example', CLOUD_LOGIN_ERR: 'login required',
    slugProjet: S ? S.slugProjet : undefined,
    _verifierUrlTelechargement: (u) => ({ ok: true, url: u }),
    fetch: async () => reponse({}),
    _authedFetch: async (chemin, init = {}) => {
      const corps = init.body ? JSON.parse(init.body) : null;
      if (chemin === '/api/user-assets/record') { site.partages.push(corps.projectName); return { resp: reponse({ ok: true }) }; }
      if (chemin === '/api/upload-image') return { resp: reponse({ ok: true, path: '/r2/u1/front/partage.png?exp=1&sig=1' }) };
      if (chemin === '/api/upload-mesh') return { resp: reponse({ success: true, path: 'u1/edited/partage.glb' }) };
      return { resp: reponse({ error: 'route inconnue du test' }, 404) };
    },
  };
  const clesCF = Object.keys(doubluresCF);
  const fonctionsCF = FONCTIONS_CF.filter((n) => fonction('cloudFallback', n));
  const CF = new Function(...clesCF, fonctionsCF.map((n) => fonction('cloudFallback', n)).join('\n') + '\nreturn { ' + fonctionsCF.join(', ') + ' };')
    (...clesCF.map((k) => doubluresCF[k]));

  // ---------- animation.js (anim:motion) ----------
  const gestionnairesAnim = new Map();
  const faussesRequetes = {
    './cloud_fallback': {
      startMeshJob: async ({ bodyFor }) => {
        site.animations.push(bodyFor('https://site.example/r2/u1/rig.glb').projectName);
        return { success: false, error: 'arret du test apres l envoi' };
      },
    },
  };
  const doubluresAnim = {
    fs, path, os, process, console: silence, app: undefined, writeMeta() {},
    require: (m) => { if (faussesRequetes[m]) return faussesRequetes[m]; throw new Error('module non prevu par le test : ' + m); },
    MOTION_THUMBS_DIR: path.join(racine, 'motion_thumbs'), _ensureDir: (d) => fs.mkdirSync(d, { recursive: true }),
    _safeId: () => 'job_' + (compteur++), _sendToAllWindows() {},
  };
  const clesAnim = Object.keys(doubluresAnim);
  const register = new Function(...clesAnim, 'return (' + fonction('animation', 'register') + ');')(...clesAnim.map((k) => doubluresAnim[k]));
  /** Dependances passees par main.js a require('./animation').register. */
  const depsAnim = brancher({
    ipcMain: { handle: (canal, fn) => gestionnairesAnim.set(canal, fn) }, BrowserWindow: {}, MESHES_DIR,
    isPathAllowed: () => true, trackProc() {}, isCloudMode: () => true, aiPython: () => null,
  }, DEPS_ANIMATION);
  register(depsAnim);

  // ---------- page du bureau (src/renderer/index2.js) ----------
  const state = { currentProject: null, projects: [], jobs: [], page: 'workspace' };
  const API = {
    listImageFolders: async () => appeler('list-image-folders'),
    listMeshes: async () => [],
    listAnimations: async () => [],
    listerProjetsVides: async () => appeler('projet-vide:lister'),
    getProjectDisplayNames: async () => appeler('get-project-display-names'),
  };
  const nomsPage = [...AIDES_PAGE.filter((n) => pageDeclare('bureau', n)), 'refreshProjectsPage', 'reloadCurrentProject'];
  const injPage = {
    state, API, document: { getElementById: () => null, querySelector: () => null }, console: silence,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    renderProjectsGrid() {}, _runNsfwBackgroundScan() {}, populateWorkspace() {},
    _checkMultiviewForCurrentImage() {}, _offerMultiviewRegenerate() {}, setTimeout: () => 0, Date,
  };
  const clesPage = Object.keys(injPage);
  const page = new Function(...clesPage, nomsPage.map((n) => DECL.bureau.get(n)).join('\n') + '\nreturn { ' + nomsPage.join(', ') + ' };')
    (...clesPage.map((k) => injPage[k]));
  /** Evalue une expression de la page avec `state`, `p` = `proj` = projet ouvert, et les aides de nom de CETTE copie. */
  const evaluerPage = (expr) => {
    const aidesNom = AIDES_PAGE.filter((n) => page[n]);
    return new Function('state', 'p', 'proj', ...aidesNom, 'return (' + expr + ');')
      (state, state.currentProject, state.currentProject, ...aidesNom.map((n) => page[n]));
  };

  // ---------- gestes de l'utilisateur ----------
  /** Bouton « Create » de la fenetre New project : marqueur de projet vide, projet ouvert vide. */
  const creerProjet = async (name) => {
    await appeler('projet-vide:creer', { name, assetType: 'character' });
    state.currentProject = { name, images: [], meshes: [], rigs: [], animations: [] };
  };
  /** Generate (mode Cloud) : la page passe `projectName: p.name` du projet ouvert (index2.js, _genArgs) ; `nom` pour forcer un nom. */
  const generer = async (nom = state.currentProject.name) => appeler('generate-images', {
    prompt: 'an orc warrior', userPrompt: 'an orc warrior', numImages: 1, projectName: nom,
    engine: 'local-lightning', steps: 4, assetType: 'character', computeMode: 'cloud',
  });
  /** Partage d'une image du projet ouvert vers le site : expression de la page, puis le gestionnaire (shareAsset). */
  const partager = async () => {
    const fichier = path.join(racine, 'a_partager.png');
    fs.writeFileSync(fichier, octetsPng());
    return CF.shareAsset({ filePath: fichier, projectName: evaluerPage(EXPRESSIONS_PAGE.partage) });
  };
  /** Clip d'animation du projet ouvert : expression de la page, puis le VRAI gestionnaire anim:motion d'animation.js. */
  const animer = async () => {
    const rig = path.join(MESHES_DIR, 'rig_rigged_test.glb');
    fs.writeFileSync(rig, octetsPng());
    return gestionnairesAnim.get('anim:motion')({}, { meshPath: rig, animType: 'idle', assetType: 'character',
      projectName: evaluerPage(EXPRESSIONS_PAGE.animation), batchId: 'lot1' });
  };
  /** « Cloud library » -> Import d'une image du site dans le projet ouvert : expression de la page, puis downloadItem. */
  const telecharger = async (fname) => CF.downloadItem({ url: 'https://site.example/r2/u1/front/x.png?exp=1&sig=1', fname, kind: 'image',
    project: evaluerPage(EXPRESSIONS_PAGE.telechargement) });
  const dossiers = () => fs.readdirSync(IMAGES_DIR).sort();
  const marqueurs = () => (fs.existsSync(PROJETS_VIDES_DIR) ? fs.readdirSync(PROJETS_VIDES_DIR).sort() : []);
  const nomsAffiches = () => ({ ...(config.projectDisplayNames || {}) });
  /** Cartes de la grille : « nom affiche (dossier) : fichiers ». */
  const cartes = () => state.projects.map((p) => `${p.displayName || p.name} (${p.name}) : ${p.images.map((i) => path.basename(String(i.path || i))).sort().join(', ') || 'vide'}`).sort();
  const fin = () => { try { fs.rmSync(racine, { recursive: true, force: true }); } catch (_) {} };
  return {
    appeler, aides, page, state, site, creerProjet, generer, partager, animer, telecharger, dossiers, marqueurs, nomsAffiches, cartes, fin,
    IMAGES_DIR, MESHES_DIR, PROJETS_VIDES_DIR, CF, depsCloud, depsAnim, config: () => config,
    setConfig: (c) => { config = JSON.parse(JSON.stringify(c)); },
    ecrireImage: (dossier, nom = `img_${compteur++}.png`) => { fs.mkdirSync(path.join(IMAGES_DIR, dossier), { recursive: true }); fs.writeFileSync(path.join(IMAGES_DIR, dossier, nom), octetsPng()); },
  };
}

/** Le SITE (vraie refreshProjectsPage de cloud/public/app/index2.js) avec ce que le bureau y a envoye : images generees et partagees
 *  rangees sous le nom de projet recu, clips sous le nom joint a /api/animate. Rend les cartes « nom (images n, clips n) ». */
export async function cartesDuSite(envoye) {
  const parProjet = new Map();
  for (const nom of [...envoye.images, ...envoye.partages]) parProjet.set(nom, (parProjet.get(nom) || 0) + 1);
  const state = { currentProject: null, projects: [], jobs: [] };
  const API = {
    listImageFolders: async () => [...parProjet].map(([name, n]) => ({ name, count: n, images: Array.from({ length: n }, (_, i) => `https://r2.example/${encodeURIComponent(name)}/${i}.png`), created: '2026-10-13T10:00:00Z', prompt: '' })),
    listMeshes: async () => envoye.animations.map((projectName, i) => ({ filename: `rig_idle_lot1abcd_176000000000${i}.glb`, path: `https://r2.example/a${i}.glb`, url: `https://r2.example/a${i}.glb`,
      created: '2026-10-13T11:00:00Z', format: 'GLB', asset_type: 'animation', anim_type: 'idle', batch_id: 'lot1abcd', projectName, id: 'anim' + i })),
    listProjectShells: async () => [],
  };
  const noms = [...AIDES_PAGE.filter((n) => pageDeclare('web', n)), 'refreshProjectsPage'];
  const inj = { state, API, document: { getElementById: () => null, querySelector: () => null }, console: silence,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, renderProjectsGrid() {}, _runNsfwBackgroundScan() {}, setTimeout: () => 0, Date };
  const cles = Object.keys(inj);
  const F = new Function(...cles, noms.map((n) => DECL.web.get(n)).join('\n') + '\nreturn { ' + noms.join(', ') + ' };')(...cles.map((k) => inj[k]));
  await F.refreshProjectsPage();
  return state.projects.map((p) => `${p.name} (images ${(p.images || []).length}, clips ${(p.animations || []).length})`).sort();
}
