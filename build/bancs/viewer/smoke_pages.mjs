#!/usr/bin/env node
/**
 * SMOKE des VRAIES pages (site : cloud/public/app/index.html ; bureau : src/renderer/index2.html), navigateur reel, rendu
 * LOGICIEL uniquement (2026-10-18, chantier « Filtrage anisotrope du visualiseur »).
 *
 * Sert une COPIE du dossier de la page (site : cloud/public ; bureau : src/renderer ; jamais cloud/out lui-meme : le serveur
 * verrouillerait le dossier et la construction suivante echouerait sur EBUSY), sans aucune connexion au vrai site ni au vrai
 * bureau : l'API du site est SIMULEE, celle du bureau (window.meshyAPI) est une doublure qui repond {} ; tout port local
 * autre que celui du banc est refuse (jamais l'API de controle de l'appli de bureau, ni le serveur d'images local) ; three.js
 * d'unpkg (la page du site l'y charge) est servi depuis le depot (revision 170). La vraie page demarre (index2.js, 1,1 Mo) ;
 * une sonde injectee comme <script type="module"> partage le monde des modules de la page (page.evaluate tourne dans un monde
 * isole : ni globales ni importmap) et verifie, dans CE monde :
 *   - que index2.js a ete EVALUE (son premier geste marque THREE.Mesh.prototype.__bvhPatched) : le graphe de modules de la page
 *     est complet, donc lib/filtrage-textures.js (importe par lib/Viewer3D.js) a ete charge ;
 *   - qu'aucun fichier de lib/ n'echoue (404) ;
 *   - Texture.DEFAULT_ANISOTROPY et GLTFLoader.prototype.parse tels que la page les voit ;
 *   - un GLB de test a cinq cartes (echantillonneurs : aucun, 9729, 9985, 9987, 9728), lu par le GLTFLoader de la page,
 *     rendu par le Viewer3D de la page : etat de chaque texture JUSTE apres le chargement, puis dans le pilote GL.
 * Variantes : « apres » = la copie telle que livree ; « avant » (--avant) = Viewer3D.js lu dans git a --ref et sans
 * lib/filtrage-textures.js (l'etat de la production). Le code de sortie est 1 si une attente n'est pas verifiee.
 *
 * Non couvert : le visualiseur PRINCIPAL de la page (etape Maillage) n'est pas ouvert ici (il demande un projet, des maillages
 * et leur lecture par l'API) ; son chemin de chargement (GLTFLoader.parse + _applyMeshTextureFilter) est celui que la sonde utilise.
 * Bureau : les erreurs d'execution dues a la doublure de l'API (index2.js attend de vraies reponses) ne comptent pas ; seules
 * celles du CHARGEMENT des modules (import introuvable, export absent, erreur de syntaxe) sont des echecs.
 *
 * usage : node build/bancs/viewer/smoke_pages.mjs [--cible site|bureau] [--avant] [--ref origin/integration-1410] [--capture <fichier.png>]
 * Lancer par `bash /c/tmp/lourd.sh --max-sec 300 node build/bancs/viewer/smoke_pages.mjs`.
 */
import http from 'node:http';
import { join, resolve, extname, dirname, sep } from 'node:path';
import { cpSync, mkdtempSync, writeFileSync, existsSync, rmSync, createReadStream, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resoudrePatchright, lancerNavigateurLogiciel, brancherReseauLocal } from './_navigateur.mjs';
import { glbMinimal, pngDamier } from '../../../tests/bureau-interface/_glb-minimal.mjs';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, def) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const AVANT = args.includes('--avant');
const REF = opt('--ref', 'origin/integration-1410');
const CAPTURE = opt('--capture', '');
const CIBLE = opt('--cible', 'site');
const CONF = {
  site: { source: 'cloud/public', page: '/app/', prefixeLib: '/app/lib/', libCopie: 'app/lib', viewerDepot: 'cloud/public/app/lib/Viewer3D.js' },
  bureau: { source: 'src/renderer', page: '/index2.html', prefixeLib: '/lib/', libCopie: 'lib', viewerDepot: 'src/renderer/lib/Viewer3D.js' },
}[CIBLE];
if (!CONF) { console.error('--cible : site ou bureau'); process.exit(2); }
const TRAVAIL = mkdtempSync(join(tmpdir(), `smoke-${CIBLE}-`));

// ---------- copie de la page ----------
const SITE = join(TRAVAIL, 'racine');
cpSync(join(RACINE, CONF.source), SITE, { recursive: true });   // tout le dossier : la page reference aussi ses logos, polices, styles
if (AVANT) {
  writeFileSync(join(SITE, CONF.libCopie, 'Viewer3D.js'), execFileSync('git', ['-C', RACINE, 'show', `${REF}:${CONF.viewerDepot}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }));
  rmSync(join(SITE, CONF.libCopie, 'filtrage-textures.js'), { force: true });
}
const GLB_ESSAI = Buffer.from(glbMinimal({ png: pngDamier(1024, 16), plan: { cote: 40, repetitions: 4 } }));

// ---------- serveur + API simulee (site) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' };
const PRIX = { text2image: 6, modify: 4, auto_inpaint: 6, mesh_fast: 8, mesh_balanced: 10, mesh_quality: 13, mesh_ultra_8k: 16, rig: 8, anim: 4, export: 1, tpose: 1 };
const requetesLib = [];   // { chemin, statut } pour tout fichier de lib/
function api(res, url) {
  const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  const p = url.pathname;
  if (p === '/api/me') return json({ user: { id: 'essai', email: 'essai@example.com', credits: 120, role: 'user' }, credits: 120 });
  if (p === '/api/pricing') return json({ prices: PRIX, version: 1 });
  if (p === '/api/pricing/availability') return json({ available: {}, ventes_ouvertes: false });
  if (p === '/api/health') return json({ ok: true });
  if (p === '/api/modal-status') return json({ services: [] });
  if (p === '/api/me/active-jobs') return json({ jobs: [] });
  if (p === '/api/projects/shells') return json({ projets: [] });
  if (p === '/api/me/projects' || p === '/api/projects') return json({ projects: [] });
  if (p === '/api/market/list') return json({ listings: [] });
  if (p === '/api/market/owned' || p === '/api/me/published-assets') return json({ items: [] });
  if (p === '/api/translate') return json({ text: '', translated: false });
  return json({});
}
const serveur = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(res, url);
  if (url.pathname === '/essai/echant.glb') { res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': GLB_ESSAI.length, 'Cache-Control': 'no-store' }); res.end(GLB_ESSAI); return; }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const fichier = resolve(join(SITE, rel));
  const ok = (fichier === SITE || fichier.startsWith(SITE + sep)) && existsSync(fichier) && statSync(fichier).isFile();
  if (url.pathname.startsWith(CONF.prefixeLib)) requetesLib.push({ chemin: url.pathname, statut: ok ? 200 : 404 });
  if (!ok) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(fichier).pipe(res);
});
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const PORT = serveur.address().port;

// ---------- la sonde (module de la page) ----------
const SONDE = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Viewer3D } from './lib/Viewer3D.js';
const sortie = (o) => { document.body.dataset.sonde = JSON.stringify(o); document.body.dataset.sondeFinie = '1'; };
try {
  // index2.js a-t-il ete EVALUE ? Son premier geste (avant tout le reste) est de marquer THREE.Mesh.prototype.__bvhPatched ; un module de
  // la page qui echoue au chargement (import 404, erreur de syntaxe) ne l'evalue jamais. Attente bornee a 20 s.
  for (let i = 0; i < 100 && !THREE.Mesh.prototype.__bvhPatched; i++) await new Promise((r) => setTimeout(r, 200));
  const indexEvalue = !!THREE.Mesh.prototype.__bvhPatched;
  const etatJs = (t) => ({ aniso: t.anisotropy, min: t.minFilter, mag: t.magFilter, mips: t.generateMipmaps, cs: t.colorSpace, version: t.version });
  const tampon = await (await fetch('/essai/echant.glb')).arrayBuffer();
  const gltf = await new Promise((ok, ko) => new GLTFLoader().parse(tampon, '', ok, ko));
  let maillage = null; gltf.scene.traverse((o) => { if (o.isMesh && !maillage) maillage = o; });
  const m0 = maillage.material;
  const cartes = [['map', m0.map], ['roughnessMap', m0.roughnessMap], ['normalMap', m0.normalMap], ['aoMap', m0.aoMap], ['emissiveMap', m0.emissiveMap]];
  const apresChargement = cartes.map(([cle, t]) => ({ cle, ...etatJs(t) }));
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 384;
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:512px;height:384px;z-index:99999';
  document.body.appendChild(canvas);
  const viewer = new Viewer3D({ canvas, fov: 40, bgColor: 0x000000, lighting: false, autoResize: false });
  viewer.renderer.setPixelRatio(1); viewer.renderer.setSize(512, 384, false);
  viewer.scene.add(gltf.scene);
  viewer.camera.position.set(0, 0.6, 14); viewer.camera.near = 0.1; viewer.camera.far = 400; viewer.camera.aspect = 512 / 384; viewer.camera.updateProjectionMatrix(); viewer.camera.lookAt(0, 0, 0);
  const gl = viewer.renderer.getContext();
  const ext = gl.getExtension('EXT_texture_filter_anisotropic');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const sortieCartes = [];
  for (const [cle, t] of cartes) {
    maillage.material = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    viewer.renderer.render(viewer.scene, viewer.camera);
    const p = viewer.renderer.properties.get(t);
    let g = null;
    if (p && p.__webglTexture) {
      gl.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
      g = { aniso: ext ? gl.getTexParameter(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT) : null, min: gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER) };
      gl.bindTexture(gl.TEXTURE_2D, null);
      viewer.renderer.resetState();
    }
    sortieCartes.push({ cle, js: etatJs(t), gl: g });
  }
  sortie({
    indexEvalue, rendu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, maxAnisoGPU: ext ? gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0,
    revision: THREE.REVISION, defautTextureNeuve: new THREE.Texture().anisotropy, parseEnveloppe: !!GLTFLoader.prototype.parse.__filtrageTextures,
    aMethodePreparer: typeof viewer.preparerTextures === 'function', sortieCouleur: viewer.renderer.outputColorSpace,
    apresChargement, cartes: sortieCartes,
  });
} catch (e) { sortie({ erreur: String((e && e.stack) || e) }); }
`;

// ---------- navigateur ----------
const navigateur = await lancerNavigateurLogiciel(resoudrePatchright());
const sortieJson = { cible: CIBLE, variante: AVANT ? 'avant' : 'apres', ref: AVANT ? REF : null };
let code = 0;
try {
  const contexte = await navigateur.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  // Le site importe SimplifyModifier (modifiers/), que le depot ne copie pas (le bureau ne s'en sert pas) : un remplacant vide
  // suffit a resoudre l'import statique de index2.js ; il n'est jamais execute ici.
  await brancherReseauLocal(contexte, join(RACINE, 'src/renderer/lib'), 'smoke', {
    'examples/jsm/modifiers/SimplifyModifier.js': 'export class SimplifyModifier { modify(g) { return g; } }',
  }, PORT);
  if (CIBLE === 'bureau') {
    // doublure de l'API du bureau : toute methode repond {} (aucun processus principal, aucun IPC)
    await contexte.addInitScript(() => {
      window.meshyAPI = new Proxy({}, { get: (t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : async () => ({})) });
    });
  }
  const page = await contexte.newPage();
  const erreurs = [], ignorees = [], reponsesEnEchec = [];
  const BRUIT = /GroupMarkerNotSet|swiftshader|Automatic fallback|GPU stall due to ReadPixels|model-viewer|Failed to load resource: net::ERR_FAILED|Failed to load resource: the server responded with a status of 404/i;
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); (BRUIT.test(t) ? ignorees : erreurs).push(t.slice(0, 240)); } });
  page.on('pageerror', (e) => erreurs.push('[uncaught] ' + String(e).slice(0, 300)));
  // un 404 de console n'a pas d'adresse : on la relit par les reponses (hors favicon, qui n'est pas dans la copie)
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) reponsesEnEchec.push(r.status() + ' ' + r.url().slice(0, 160)); });
  page.on('requestfailed', (r) => { if (r.url().startsWith('http://127.0.0.1')) reponsesEnEchec.push('echec ' + r.url().slice(0, 160) + ' ' + (r.failure() && r.failure().errorText)); });
  await page.goto(`http://127.0.0.1:${PORT}${CONF.page}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('#btn-new-project', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(1500);
  sortieJson.titre = await page.title();
  sortieJson.pageDemarree = await page.evaluate(() => !!document.getElementById('btn-new-project') && document.body.innerText.length > 100);
  await page.addScriptTag({ type: 'module', content: SONDE });
  await page.waitForFunction(() => document.body.dataset.sondeFinie, null, { timeout: 120000, polling: 250 });
  const sonde = JSON.parse(await page.evaluate(() => document.body.dataset.sonde));
  sortieJson.sonde = sonde;
  if (CAPTURE) { await page.screenshot({ path: CAPTURE }); sortieJson.capture = CAPTURE; }
  sortieJson.requetesLib = requetesLib;
  // bureau : les erreurs d'EXECUTION venant de la doublure de l'API ne comptent pas ; celles du CHARGEMENT des modules, si
  const MODULES = /Failed to resolve module specifier|Failed to fetch dynamically imported module|does not provide an export|Unexpected token|SyntaxError|Cannot use import statement|module script/i;
  const erreursBloquantes = CIBLE === 'bureau' ? erreurs.filter((e) => MODULES.test(e)) : erreurs;
  sortieJson.erreursConsole = erreurs;
  sortieJson.reponsesEnEchec = reponsesEnEchec;
  sortieJson.bruitIgnore = ignorees.length;

  // ---------- attentes ----------
  const echecs = [];
  const attendre = (cond, msg) => { if (!cond) echecs.push(msg); };
  attendre(sonde.indexEvalue === true, 'index2.js n a pas ete evalue (THREE.Mesh.prototype.__bvhPatched absent) : le graphe de modules de la page a echoue');
  attendre(sortieJson.pageDemarree, 'la page n\'a pas demarre (pas de bouton « nouveau projet »)');
  attendre(erreursBloquantes.length === 0, 'erreurs de console / de page : ' + erreursBloquantes.join(' || '));
  // seules les requetes vers model-viewer (script tiers, refuse par le banc) peuvent echouer ; toute autre reponse >= 400 est un defaut
  attendre(reponsesEnEchec.length === 0, 'reponses en echec : ' + reponsesEnEchec.join(' || '));
  attendre(!requetesLib.some((r) => r.statut !== 200), 'fichier de lib/ introuvable : ' + JSON.stringify(requetesLib.filter((r) => r.statut !== 200)));
  attendre(!sonde.erreur, 'la sonde a echoue : ' + sonde.erreur);
  if (!sonde.erreur) {
    attendre(sonde.revision === '170', 'revision de three : ' + sonde.revision);
    attendre(sonde.sortieCouleur === 'srgb', 'espace de sortie du renderer : ' + sonde.sortieCouleur);
    const servi = requetesLib.some((r) => r.chemin === CONF.prefixeLib + 'filtrage-textures.js' && r.statut === 200);
    const parCle = Object.fromEntries(sonde.cartes.map((c) => [c.cle, c]));
    attendre(parCle.map.js.cs === 'srgb' && parCle.normalMap.js.cs === '', 'espaces colorimetriques des cartes : ' + parCle.map.js.cs + ' / ' + parCle.normalMap.js.cs);
    attendre(parCle.emissiveMap.gl && parCle.emissiveMap.gl.aniso === 1 && parCle.emissiveMap.gl.min === 9728, 'la carte Nearest voulue doit rester intacte');
    if (!AVANT) {
      attendre(servi, 'lib/filtrage-textures.js n\'a pas ete servi');
      attendre(sonde.defautTextureNeuve === 16 && sonde.parseEnveloppe === true && sonde.aMethodePreparer === true, 'module non actif dans la page : DEFAULT=' + sonde.defautTextureNeuve + ' enveloppe=' + sonde.parseEnveloppe);
      for (const cle of ['map', 'roughnessMap', 'normalMap', 'aoMap']) {
        const c = parCle[cle];
        attendre(c.js.aniso === 16 && c.js.mips === true && c.js.min === 1008, cle + ' : etat JS apres chargement ' + JSON.stringify(c.js));
        attendre(c.gl && c.gl.aniso === Math.min(16, sonde.maxAnisoGPU) && c.gl.min === 9987, cle + ' : etat dans le pilote GL ' + JSON.stringify(c.gl));
      }
    } else {
      attendre(!servi, 'lib/filtrage-textures.js ne devrait pas exister dans l\'etat d\'avant');
      attendre(sonde.defautTextureNeuve === 1 && sonde.parseEnveloppe === false, 'l\'etat d\'avant doit rester a 1 : DEFAULT=' + sonde.defautTextureNeuve);
      for (const cle of ['map', 'roughnessMap', 'normalMap', 'aoMap']) attendre(parCle[cle].gl && parCle[cle].gl.aniso === 1, cle + ' : GL aniso attendu 1 (avant), lu ' + JSON.stringify(parCle[cle].gl));
    }
  }
  sortieJson.echecs = echecs;
  code = echecs.length ? 1 : 0;
  console.log(`Page du ${CIBLE}, variante « ${sortieJson.variante} » : ${echecs.length ? 'ECHEC' : 'OK'} | demarree : ${sortieJson.pageDemarree} | titre : ${sortieJson.titre}`);
  if (!sonde.erreur) {
    console.log(`  index2.js evalue (graphe de modules de la page complet) : ${sonde.indexEvalue}`);
    console.log(`  rendu : ${sonde.rendu} | three r${sonde.revision} | max anisotropie GPU ${sonde.maxAnisoGPU} | sortie ${sonde.sortieCouleur}`);
    console.log(`  Texture.DEFAULT_ANISOTROPY (monde de la page) : ${sonde.defautTextureNeuve} | GLTFLoader.parse enveloppe : ${sonde.parseEnveloppe} | Viewer3D.preparerTextures : ${sonde.aMethodePreparer}`);
    console.log('  apres chargement : ' + sonde.apresChargement.map((t) => `${t.cle}[aniso=${t.aniso} min=${t.min} mips=${t.mips} v=${t.version}]`).join(' '));
    console.log('  dans le pilote GL : ' + sonde.cartes.map((c) => `${c.cle}[GL aniso=${c.gl && c.gl.aniso} min=${c.gl && c.gl.min}]`).join(' '));
  }
  console.log(`  requetes lib/ : ${requetesLib.length} (${requetesLib.filter((r) => r.statut !== 200).length} en echec) | erreurs de console : ${erreurs.length}${CIBLE === 'bureau' ? ` (dont ${erreursBloquantes.length} de chargement de module ; le reste vient de la doublure de l'API)` : ''} | bruit ignore : ${ignorees.length}`);
  for (const e of echecs) console.log('  ATTENTE NON VERIFIEE : ' + e);
} catch (e) {
  console.log('ECHEC du smoke : ' + String((e && e.stack) || e).slice(0, 600));
  code = 1;
} finally {
  await navigateur.close().catch(() => {});
  serveur.close();
  const rapport = join(TRAVAIL, 'resultat.json');
  writeFileSync(rapport, JSON.stringify(sortieJson, null, 1));
  rmSync(SITE, { recursive: true, force: true });   // la copie de la page ne sert plus ; seul resultat.json reste
  console.log('resultat : ' + rapport);
}
process.exit(code);
