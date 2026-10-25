// 25/10 (user : « pourquoi je n'ai pas l'historique d'avant (image, ...) ») : le maillage rendu par « Reshape » / « Re-texture a region » porte son parent dans
// params.mesh_url_in (et non meta.parent) : la chronologie s'arretait sur lui. VRAIE fonction buildLineageTimeline des deux index2.js, API simulee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const acorn = createRequire(join(RACINE, 'cloud', 'tests', 'x.js'))('acorn');
const FICHIERS = { bureau: join(RACINE, 'src/renderer/index2.js'), site: join(RACINE, 'cloud/public/app/index2.js') };
const NOMS = ['buildLineageTimeline', '_OP_LABEL', '_OP_RE', '_meshVersionInfo', '_meshRootBase'];

function charger(chemin, API) {
  const src = readFileSync(chemin, 'utf-8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const morceaux = [], vus = new Set();
  for (const n of ast.body) {
    let nom = null;
    if (n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.type === 'Identifier') nom = n.declarations[0].id.name;
    else if (n.type === 'FunctionDeclaration') nom = n.id.name;
    if (nom && NOMS.includes(nom) && !vus.has(nom)) { vus.add(nom); morceaux.push(src.slice(n.start, n.end)); }
  }
  for (const n of NOMS) assert.ok(vus.has(n), chemin + ' : ' + n + ' introuvable');
  return new Function('API', '_resolveParentMeshPath', morceaux.join('\n') + '\nreturn buildLineageTimeline;')(API, () => null);
}

for (const [nom, chemin] of Object.entries(FICHIERS)) {
  test(`${nom} : la lignee d'un maillage Reshape remonte au maillage parent puis a l'image d'origine`, async () => {
    const IMG = 'https://x/r2/u/front/1792934702530_651113073.png';
    const PARENT = 'https://x/r2/mesh/modal_d024574247a348629468ab39a35e2a32.glb';
    const ENFANT = 'https://x/r2/mesh/modal_e7d760cf4ba144ba9f4ad8d6a5edfb65.glb?exp=1793548800&sig=abc';
    const metas = {
      [ENFANT.split('?')[0]]: { ts: 3, params: { prompt: 'Large engines', masque_3d: true, mesh_url_in: PARENT + '?exp=1793545200&sig=zzz' } },
      [PARENT]: { ts: 2, params: { preset: 'ultra_8k' }, source: IMG },
      [IMG]: { ts: 1, params: { prompt: 'mege boat' } },
    };
    const API = { getLineageMeta: async (p) => metas[String(p).split('?')[0]] || null };
    const p = {
      images: [{ path: IMG }],
      meshes: [
        { path: PARENT + '?exp=1793545200&sig=AUTRE', filename: 'benchy_d024.glb', meta: metas[PARENT], sourceImage: IMG },
        { path: ENFANT, filename: 'benchy_e7d7.glb', meta: metas[ENFANT.split('?')[0]] },
      ],
      animations: [], rigs: [], prompt: 'mege boat',
    };
    const steps = await charger(chemin, API)(ENFANT, p);
    const genres = steps.map((s) => s.kind);
    assert.ok(steps.length >= 3, 'au moins image + maillage + retouche : ' + genres.join(','));
    assert.equal(genres[genres.length - 1], 'op', 'la derniere etape est la reconstruction de zone');
    assert.ok(genres.includes('mesh'), 'le maillage d\'origine est present');
    assert.ok(genres.includes('image'), 'l\'image d\'origine est presente');
    assert.equal(steps[steps.length - 1].opLabel, 'Reshape a region');
  });
}
