// Simulation du serveur pour les essais navigateur de « Reshape a region » (2026-10-20).
// Le site est servi par un petit serveur statique (copie de cloud/public/app) ; tout /api et /r2 est simule ici,
// three.js vient de node_modules (r182) au lieu d'unpkg (r170) : aucun reseau, aucun compte.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// three.js (r182 de node_modules, a la place d'unpkg r170) : R3D_THREE pour une autre copie ; la racine du depot par defaut
export const THREE_DIR = (process.env.R3D_THREE || path.resolve(fileURLToPath(new URL('../../../node_modules/three/', import.meta.url)))).replace(/\\/g, '/').replace(/\/?$/, '/');
export const SORTIE = (process.env.R3D_SORTIE || 'C:/tmp/trellis_cloud/montages/').replace(/\/?$/, '/');
export const MAILLAGE = process.env.R3D_MAILLAGE || 'C:/tmp/trellis_cloud/glb/orc_A2_sans_socle.glb';

export async function brancher(page, { port, vus, captures, prefixe }) {
  mkdirSync(SORTIE, { recursive: true });
  const O = `http://127.0.0.1:${port}`;
  const K = 'exp=9999999999&sig=abc';
  const meshUrl = `${O}/r2/mesh/orc_test.glb?${K}`;
  const json = (route, o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
  const televerses = new Map();   // cle R2 -> Buffer (images deposees par la page : upload-image)
  let nUpload = 0;

  // tout ce qui n'est pas local est refuse (enregistre en premier : les routes suivantes ont priorite)
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => { vus.push('BLOQUE ' + route.request().url().slice(0, 80)); return route.abort(); });
  await page.route('https://unpkg.com/three@0.170.0/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/three@0.170.0/', '');
    const f = THREE_DIR + rel;
    if (!existsSync(f)) { vus.push('THREE ABSENT ' + rel); return route.fulfill({ status: 404, body: 'nf' }); }
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(f) });
  });
  await page.route('**/r2/**', (route) => {
    const u = new URL(route.request().url());
    const cle = decodeURIComponent(u.pathname.slice(4));
    vus.push('R2 ' + cle);
    if (cle === 'mesh/orc_test.glb') {
      return route.fulfill({ status: 200, contentType: 'model/gltf-binary', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(MAILLAGE) });
    }
    if (televerses.has(cle)) return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: televerses.get(cle) });
    return route.fulfill({ status: 404, body: 'nf' });
  });
  await page.route('**/api/**', (route) => {
    const r = route.request(), u = new URL(r.url());
    vus.push(r.method() + ' ' + u.pathname);
    switch (u.pathname) {
      case '/api/me': return json(route, { user: { id: 'u1', email: 'test@example.com', credits: 100, role: 'user' }, authenticated: true });
      case '/api/cloud-projects': return json(route, { projects: [{ name: 'orc', path: 'cloud://orc', images: [], imagesData: [], count: 0, created: '2026-10-20T00:00:00Z', prompt: '', backPhotos: {}, meshes: [] }] });
      case '/api/meshes': return json(route, { meshes: [
        { filename: 'orc_trellis2_0123456789.glb', path: meshUrl, url: meshUrl, size: 25e6, created: '2026-10-20T10:00:00Z', format: 'GLB', thumb: null, sourceImage: null, asset_type: 'character', projectName: 'orc', id: 'job-mesh-1' }] });
      case '/api/mesh-light/find': return json(route, { found: false });
      case '/api/projects': return json(route, { projects: [] });
      case '/api/upload-image': {
        let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (_) {}
        const m = /^data:image\/png;base64,(.*)$/.exec(String(b.dataUrl || ''));
        if (!m) return json(route, { success: false, error: 'bad data url' });
        const buf = Buffer.from(m[1], 'base64');
        nUpload++;
        const cle = `u1/reshape_vue_${nUpload}.png`;
        televerses.set(cle, buf);
        const f = path.join(SORTIE, `${prefixe}_rendu_${nUpload}.png`);
        writeFileSync(f, buf);
        captures.uploads.push({ n: nUpload, suffix: b.suffix, octets: buf.length, fichier: f });
        return json(route, { success: true, path: `${O}/r2/${cle}?${K}` });
      }
      case '/api/mesh-reshape': {
        let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (_) {}
        captures.reshape.push(b);
        return json(route, { success: true, jobId: 'job-reshape-1' });
      }
      default:
        if (u.pathname.startsWith('/api/jobs/')) return json(route, { status: 'processing', progress: 5 });   // jamais de fin : l'echec afficherait un bandeau qui recouvre la page
        return json(route, {});
    }
  });
  return { meshUrl };
}
