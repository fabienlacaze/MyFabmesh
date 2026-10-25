/**
 * Aides communes des bancs NAVIGATEUR du dossier (banc_anisotropie.mjs, smoke_page_site.mjs) — rendu LOGICIEL uniquement.
 *
 *  - resoudrePatchright() : meme resolution que le skill browser-automation (patchright de l'extension CodeGPT) ;
 *  - lancerNavigateurLogiciel() : Chromium sans carte graphique (--disable-gpu + ANGLE / SwiftShader) : la carte du
 *    proprietaire n'est JAMAIS utilisee (Unreal tourne) ;
 *  - brancherReseauLocal() : three@0.170.0 d'unpkg (la page du site l'y charge) est servi depuis le dossier lib du depot
 *    (meme revision 170) ; toute autre requete externe est refusee, la sonde de l'antivirus du proprietaire (script
 *    injecte dans les pages HTTP, y compris locales) recoit un script vide pour ne pas polluer la console.
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

export function resoudrePatchright() {
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

export const ARGS_LOGICIEL = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export function lancerNavigateurLogiciel(chromium) {
  return chromium.launch({ headless: true, channel: 'chromium', args: ARGS_LOGICIEL });
}

/**
 * @param contexte    contexte patchright
 * @param libThree    dossier lib du depot qui contient three.module.js et les addons (src/renderer/lib)
 * @param etiquette   prefixe des messages
 * @param remplacants { 'examples/jsm/<chemin>': '<source du module>' } : modules d'addons que le depot ne copie pas (le bureau n'en
 *                    a que quelques-uns) mais que la page du site importe ; un remplacant sert a RESOUDRE l'import, jamais a l'executer
 * @param portAutorise port du serveur du banc : tout AUTRE port de 127.0.0.1 / localhost est refuse (l'API de controle de l'appli
 *                    de bureau, le serveur d'images local... ne sont jamais atteints par une page de test)
 */
export async function brancherReseauLocal(contexte, libThree, etiquette = 'banc', remplacants = {}, portAutorise = null) {
  if (portAutorise) {
    await contexte.route((u) => (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') && u.port !== String(portAutorise), (route) => {
      console.error(`[${etiquette}] port local refuse : ` + route.request().url().slice(0, 100));
      return route.abort();
    });
  }
  await contexte.route('https://unpkg.com/three@0.170.0/**', async (route) => {
    const u = new URL(route.request().url());
    const rel = u.pathname.replace('/three@0.170.0/', '');
    let f = null;
    if (rel === 'build/three.module.js') f = join(libThree, 'three.module.js');
    else if (rel.startsWith('examples/jsm/')) f = join(libThree, rel.slice('examples/jsm/'.length));
    if (f && existsSync(f)) await route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(f), headers: { 'Access-Control-Allow-Origin': '*' } });
    else if (remplacants[rel]) await route.fulfill({ status: 200, contentType: 'text/javascript', body: remplacants[rel], headers: { 'Access-Control-Allow-Origin': '*' } });
    else { console.error(`[${etiquette}] unpkg non servi en local : ${rel}`); await route.fulfill({ status: 404, body: 'absent' }); }
  });
  await contexte.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const u = route.request().url();
    if (u.startsWith('https://unpkg.com/three@0.170.0/')) return route.fallback();
    if (/kaspersky-labs\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });   // script injecte par l'antivirus
    console.error(`[${etiquette}] requete externe bloquee : ` + u.slice(0, 120));
    return route.abort();
  });
}
