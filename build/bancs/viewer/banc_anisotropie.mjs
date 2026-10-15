#!/usr/bin/env node
/**
 * BANC NAVIGATEUR de l'anisotropie des visualiseurs 3D (2026-10-15), rendu LOGICIEL uniquement.
 *
 * Charge le VRAI lib/Viewer3D.js (bureau ET site), le VRAI GLTFLoader de three r170 et un VRAI GLB texture dans un
 * Chromium de patchright lance avec SwiftShader (--disable-gpu --use-angle=swiftshader) : la carte graphique du
 * proprietaire n'est JAMAIS utilisee (Unreal tourne). Pour chaque variante (avant / apres le correctif) il rend les
 * memes poses obliques et mesure la nettete (variance du laplacien de la luminance) par zone d'incidence :
 * rasante (cos < 0,30), oblique, de face. Il interroge aussi l'etat REEL de la texture cote pilote GL
 * (TEXTURE_MAX_ANISOTROPY_EXT) : c'est la preuve que le reglage atteint le pilote, independamment de l'image.
 *
 * Variantes : bureau_avant, bureau_apres, site_avant, site_apres. « avant » = lib/Viewer3D.js lu dans git a --ref et
 * sans lib/filtrage-textures.js ; « apres » = l'arbre de travail. Le site charge three depuis unpkg dans la vraie page :
 * ces URL sont servies en local depuis src/renderer/lib (meme revision 170).
 *
 * usage : node build/bancs/viewer/banc_anisotropie.mjs [--glb <fichier.glb>] [--ref origin/integration-1410]
 *           [--sortie C:/tmp/trellis_cloud/montages] [--variantes bureau_avant,bureau_apres,...] [--forcer 8,16]
 *           [--poses trois_quarts,cote_rasant,...] [--sans-damier]
 * Lancer par `bash /c/tmp/lourd.sh --max-sec 900 node build/bancs/viewer/banc_anisotropie.mjs ...` (un seul processus lourd a la fois).
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve, extname, dirname, sep } from 'node:path';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, createReadStream, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, def) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const GLB = resolve(opt('--glb', 'C:/tmp/trellis_cloud/glb/hr_G1792_tranches_t4096_f500000.glb'));
const REF = opt('--ref', 'origin/integration-1410');
const SORTIE = resolve(opt('--sortie', 'C:/tmp/trellis_cloud/montages'));
const VARIANTES = opt('--variantes', 'bureau_avant,bureau_apres,site_avant,site_apres').split(',').filter(Boolean);
const FORCER = opt('--forcer', '').split(',').filter(Boolean).map(Number);
const POSES = opt('--poses', '');
const SANS_DAMIER = args.includes('--sans-damier');
const SEUL_DAMIER = args.includes('--seul-damier');
const ATTENTE_S = Number(opt('--attente', '300'));   // delai maximal d une page, en secondes
const HORO = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const TRAVAIL = resolve(opt('--travail', `C:/tmp/trellis_cloud/aniso_banc/essai_${HORO}`));

if (!existsSync(GLB)) { console.error('GLB introuvable : ' + GLB); process.exit(2); }
mkdirSync(SORTIE, { recursive: true });
mkdirSync(TRAVAIL, { recursive: true });

// ---------- patchright (meme resolution que le skill browser-automation) ----------
function resoudrePatchright() {
  const bases = [join(homedir(), '.vscode/extensions'), join(homedir(), '.vscode-server/extensions')];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const dossiers = readdirSync(base).filter((d) => d.startsWith('danielsanmedium.dscodegpt-')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const dernier = dossiers[dossiers.length - 1];
    if (!dernier) continue;
    try { return createRequire(join(base, dernier, 'standalone') + '/')('patchright').chromium; } catch (_) { /* suivant */ }
  }
  throw new Error('patchright introuvable (extension CodeGPT absente)');
}

// ---------- variantes ----------
const git = (...a) => execFileSync('git', ['-C', RACINE, ...a], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
const importmapBureau = '<script type="importmap">{"imports":{"three":"./lib/three.module.js","three/addons/":"./lib/"}}</script>';
// identique a cloud/public/app/index.html (unpkg, three 0.170.0) : servi en local par page.route
const importmapSite = '<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.170.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.170.0/examples/jsm/"}}</script>';

function preparer(nom) {
  const [cible, etat] = nom.split('_');            // bureau|site , avant|apres
  const racine = join(TRAVAIL, nom);
  const srcLib = cible === 'bureau' ? join(RACINE, 'src/renderer/lib') : join(RACINE, 'cloud/public/app/lib');
  const relViewer = cible === 'bureau' ? 'src/renderer/lib/Viewer3D.js' : 'cloud/public/app/lib/Viewer3D.js';
  rmSync(racine, { recursive: true, force: true });
  cpSync(srcLib, join(racine, 'lib'), { recursive: true });
  if (etat === 'avant') {
    writeFileSync(join(racine, 'lib/Viewer3D.js'), git('show', `${REF}:${relViewer}`));
    rmSync(join(racine, 'lib/filtrage-textures.js'), { force: true });
  }
  const page = readFileSync(join(RACINE, 'build/bancs/viewer/page_banc.html'), 'utf8').replace('__IMPORTMAP__', cible === 'bureau' ? importmapBureau : importmapSite);
  writeFileSync(join(racine, 'banc.html'), page);
  return { nom, cible, etat, racine };
}

// ---------- serveur statique ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.css': 'text/css' };
const racines = new Map();
const serveur = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const morceaux = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    let fichier = null;
    if (morceaux[0] === 'glb') fichier = GLB;
    else if (racines.has(morceaux[0])) {
      const base = racines.get(morceaux[0]);
      fichier = resolve(base, ...morceaux.slice(1));
      if (!(fichier === base || fichier.startsWith(base + sep))) fichier = null;   // jamais hors de la variante
    }
    if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end('absent'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] || 'application/octet-stream', 'Content-Length': statSync(fichier).size, 'Cache-Control': 'no-store' });
    createReadStream(fichier).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const PORT = serveur.address().port;

// ---------- navigateur logiciel ----------
const chromium = resoudrePatchright();
const navigateur = await chromium.launch({
  headless: true, channel: 'chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const contexte = await navigateur.newContext({ locale: 'en-US', viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
// three de unpkg -> fichiers locaux (revision 170 identique)
const LIB_BUREAU = join(RACINE, 'src/renderer/lib');
await contexte.route('https://unpkg.com/three@0.170.0/**', async (route) => {
  const u = new URL(route.request().url());
  const rel = u.pathname.replace('/three@0.170.0/', '');
  let f = null;
  if (rel === 'build/three.module.js') f = join(LIB_BUREAU, 'three.module.js');
  else if (rel.startsWith('examples/jsm/')) f = join(LIB_BUREAU, rel.slice('examples/jsm/'.length));
  if (f && existsSync(f)) await route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(f), headers: { 'Access-Control-Allow-Origin': '*' } });
  else { console.error('[banc] unpkg non servi en local : ' + rel); await route.fulfill({ status: 404, body: 'absent' }); }
});
await contexte.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
  const u = route.request().url();
  if (u.startsWith('https://unpkg.com/three@0.170.0/')) return route.fallback();
  console.error('[banc] requete externe bloquee : ' + u.slice(0, 120));
  return route.abort();
});

async function lancer(variante, requete) {
  const page = await contexte.newPage();
  const messages = [];
  page.on('console', (m) => { if (m.type() === 'log' && m.text().startsWith('[banc]')) { console.log('    ' + m.text().slice(0, 300)); return; } if (['error', 'warning'].includes(m.type())) { const t = m.text(); if (!/GroupMarkerNotSet|swiftshader|Automatic fallback/i.test(t)) messages.push(`[${m.type()}] ${t.slice(0, 240)}`); } });
  page.on('pageerror', (e) => { messages.push('[uncaught] ' + String(e).slice(0, 300)); console.log('    ERREUR de page : ' + String(e).slice(0, 300)); });
  page.on('requestfailed', (r) => { if (r.url().startsWith('http://127.0.0.1')) console.log('    requete echouee : ' + r.url().slice(0, 160) + ' ' + (r.failure() && r.failure().errorText)); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1')) console.log('    HTTP ' + r.status() + ' ' + r.url().slice(0, 160)); });
  const url = `http://127.0.0.1:${PORT}/${variante}/banc.html?${requete}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => document.body && document.body.dataset.fini, null, { timeout: ATTENTE_S * 1000, polling: 500 });
  } catch (e) {
    console.log(`    DELAI de ${ATTENTE_S} s depasse. Messages de la page : ${messages.join(' || ') || '(aucun)'}`);
    await page.close().catch(() => {});
    return { erreur: `delai de ${ATTENTE_S} s depasse`, messages, secondes: ATTENTE_S };
  }
  const brut = await page.locator('#resultat').textContent();
  await page.close();
  const r = JSON.parse(brut);
  r.messages = messages;
  r.secondes = Math.round((Date.now() - t0) / 100) / 10;
  return r;
}

const resume = [];
const toutes = {};
function enregistrerPng(base, png) { if (!png) return null; const f = join(SORTIE, `aniso_${base}.png`); writeFileSync(f, Buffer.from(png.split(',')[1], 'base64')); return f; }
function sansPng(r) {
  const c = JSON.parse(JSON.stringify(r, (k, v) => (k === 'pngs' ? undefined : (k === 'png' && typeof v === 'string' ? '<png>' : v))));
  return c;
}

try {
  for (const nom of VARIANTES) {
    const v = preparer(nom);
    racines.set(nom, v.racine);
    if (SEUL_DAMIER) continue;
    console.log(`\n=== ${nom} (${v.racine})`);
    const q = `mode=glb&glb=${encodeURIComponent('/glb/modele.glb')}` + (POSES ? `&poses=${POSES}` : '');
    const r = await lancer(nom, q);
    if (r.erreur) { console.error('ERREUR : ' + r.erreur); toutes[nom] = r; continue; }
    for (const [pose, png] of Object.entries(r.pngs || {})) enregistrerPng(`${nom}_${pose}`, png);
    toutes[nom] = sansPng(r);
    console.log(`  rendu : ${r.rendu} | max anisotropie GPU : ${r.maxAnisoGPU} | triangles : ${r.triangles} | ${r.secondes} s (${JSON.stringify(r.ms)})`);
    console.log(`  sortie couleur : ${r.sortieCouleur} | tone mapping : ${r.toneMapping} (exposition ${r.exposition}) | pixel ratio : ${r.pixelRatio}`);
    console.log(`  Texture.DEFAULT_ANISOTROPY vu par une texture neuve : ${r.defautTextureNeuve} | Viewer3D.preparerTextures : ${r.aMethodePreparer} | GLTFLoader.parse enveloppe : ${r.parseEnveloppe}`);
    console.log('  textures juste apres le chargement (avant tout rendu) : ' + r.apresChargement.map((t) => `${t.cle}[aniso=${t.aniso} min=${t.min} mips=${t.mips} v=${t.version}]`).join(' '));
    console.log('  textures dans le pilote GL apres rendu : ' + r.textures.map((t) => `${t.cle}[espace=${t.cs || 'aucun'} ${t.w}x${t.h} JS=${t.aniso} GL=${t.gl ? t.gl.aniso : 'non televersee'} min=${t.gl ? t.gl.min : '-'}]`).join(' '));
    for (const p of r.poses) { const g = (z) => `${String(p.regions[z].lapVar).padStart(9)} (n=${p.regions[z].n}, lum ${p.regions[z].lum})`; console.log(`  pose ${p.nom.padEnd(15)} rasant ${g('rasant')} | oblique ${g('oblique')} | face ${g('face')} | tout ${g('tout')}`); }
    if (r.messages.length) console.log('  messages console : ' + r.messages.join(' || '));
  }
  for (const n of FORCER) {
    // l'anisotropie IMPOSEE s'applique sur l'ancien code (bureau_avant) : c'est ce que fait _applyMeshTextureFilter de
    // index2.js apres le chargement dans la vue principale ; a defaut, sur bureau_apres
    const nom = VARIANTES.includes('bureau_avant') ? 'bureau_avant' : (VARIANTES.includes('bureau_apres') ? 'bureau_apres' : null);
    if (!nom) break;
    const q = `mode=glb&glb=${encodeURIComponent('/glb/modele.glb')}&forcer=${n}` + (POSES ? `&poses=${POSES}` : '');
    console.log(`\n=== ${nom}, anisotropie IMPOSEE a ${n} apres le chargement`);
    const r = await lancer(nom, q);
    if (r.erreur) { console.error('ERREUR : ' + r.erreur); continue; }
    for (const [pose, png] of Object.entries(r.pngs || {})) enregistrerPng(`${nom}_forcer${n}_${pose}`, png);
    toutes[`${nom}_forcer${n}`] = sansPng(r);
    console.log('  textures GL : ' + r.textures.map((t) => `${t.cle}[JS=${t.aniso} GL=${t.gl ? t.gl.aniso : '-'}]`).join(' '));
    for (const p of r.poses) console.log(`  pose ${p.nom.padEnd(15)} rasant ${String(p.regions.rasant.lapVar).padStart(9)} | oblique ${String(p.regions.oblique.lapVar).padStart(9)} | face ${String(p.regions.face.lapVar).padStart(9)} | tout ${String(p.regions.tout.lapVar).padStart(9)}`);
  }
  if (!SANS_DAMIER || SEUL_DAMIER) {
    for (const nom of VARIANTES) {
      if (!racines.has(nom)) continue;
      console.log(`\n=== ${nom} : plan a damier vu de tres bas (controle du rendu logiciel)`);
      const r = await lancer(nom, 'mode=damier');
      if (r.erreur) { console.error('ERREUR : ' + r.erreur); continue; }
      for (const b of r.balayage) if (b.png) enregistrerPng(`${nom}_damier_${b.demande === null ? 'defaut' : 'a' + b.demande}`, b.png);
      toutes[`${nom}_damier`] = sansPng(r);
      console.log(`  Texture.DEFAULT_ANISOTROPY : ${r.defautTextureNeuve}`);
      for (const b of r.balayage) console.log(`  demande ${String(b.demande).padStart(4)} -> JS ${String(b.anisoJS).padStart(2)} GL ${String(b.anisoGL).padStart(2)} | rasant lapVar ${String(b.regions.rasant.lapVar).padStart(9)} (n=${b.regions.rasant.n}) | oblique ${String(b.regions.oblique.lapVar).padStart(9)}`);
    }
  }
} finally {
  await navigateur.close().catch(() => {});
  serveur.close();
}
const fichierJson = join(TRAVAIL, 'resultats.json');
writeFileSync(fichierJson, JSON.stringify({ glb: GLB, ref: REF, horodatage: HORO, resultats: toutes }, null, 1));
console.log('\nresultats : ' + fichierJson + ' | captures : ' + SORTIE + sep + 'aniso_*.png');
