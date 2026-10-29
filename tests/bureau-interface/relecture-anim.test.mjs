// 29/10 : relecture du realisme des animations par Qwen3.6 a chaque generation (lib/relecture-anim.js, commun site + bureau). Sans GPU : Qwen et le
// dessin sont simules ; le moteur et les mesures sont les VRAIS (rig de test fix_humain si present).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validerChangements, gardeFous, relisible, mesurer, relireClip } from '../../cloud/public/app/lib/relecture-anim.js';
import { __interne } from '../../cloud/public/app/lib/locomotion-procedurale.js';

test('les copies site et bureau du module sont identiques', () => {
  assert.equal(readFileSync(new URL('../../cloud/public/app/lib/relecture-anim.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../../src/renderer/lib/relecture-anim.js', import.meta.url), 'utf8'));
});

test('validerChangements : leviers connus, bornes, pas maximal 0,35, 4 au plus', () => {
  assert.deepEqual(validerChangements({ deplacement: 9, inconnu: 2, bascule: 'x', vitesse: 1.2 }, {}), { deplacement: 1.35, vitesse: 1.2 });
  assert.deepEqual(validerChangements({ rebond: 0.1 }, { rebond: 0.5 }), { rebond: 0.3 });
  assert.equal(Object.keys(validerChangements({ deplacement: 1.2, bascule: 1.2, rebond: 1.2, rotation: 1.2, roulis: 1.2, tete: 1.2 }, {})).length, 4);
  assert.deepEqual(validerChangements(null, {}), {});
});

test('gardeFous : sol, glissement, a-coups', () => {
  const base = { ok: true, sous_sol_pctH: 0, glissement_pctH: 0.4, acoups_deg: 10 };
  assert.equal(gardeFous(base, { ...base }), null);
  assert.match(gardeFous(base, { ...base, sous_sol_pctH: 2 }), /ground/);
  assert.match(gardeFous(base, { ...base, glissement_pctH: 3 }), /slide/);
  assert.match(gardeFous(base, { ...base, acoups_deg: 120 }), /pops/);
  assert.match(gardeFous(base, { ok: false }), /impossible/);
});

test('seules les actions sont relues', () => {
  assert.ok(relisible('attack') && relisible('attack__kick') && relisible('hit'));
  assert.ok(!relisible('walk') && !relisible('run__sprint') && !relisible('death'));
});

const RIG = 'C:/tmp/procedural_test/fix_humain.glb';
test('boucle complete sur un vrai rig : un candidat qui GAGNE la comparaison est garde, un qui perd ne l\'est pas', { skip: !existsSync(RIG) }, async () => {
  const b = readFileSync(RIG), sq = __interne.charger(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const m0 = mesurer(sq, 'attack', { espece: 'humain' }), m2 = mesurer(sq, 'attack', { espece: 'humain', leviers: { deplacement: 1.35 } });
  assert.ok(m0.ok && m2.ok); assert.ok(m2.deplacement_avant_pctH > m0.deplacement_avant_pctH, 'le levier agit');
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {} }), toDataURL: () => 'data:image/jpeg;base64,QUJD' }) };
  const appels = [];
  // tour 1 : propose deplacement 1,35 -> gagne (l'ordre est normal : candidat = B) ; tour 2 : propose bascule -> perd ; tour 3 : rien d'utilisable
  const reps = [{ ok: true, jeton: 'j.s' }, { ok: true, changements: { deplacement: 1.35 } }, { ok: true, meilleur: 'B' },
    { ok: true, changements: { bascule: 1.3 } }, { ok: true, meilleur: 'B' }, { ok: true, changements: {} }];
  const r = await relireClip(sq, 'attack', { espece: 'humain', appeler: async (c) => { appels.push(c); return reps.shift(); } });
  assert.deepEqual(r.leviers, { deplacement: 1.35 });
  assert.equal(r.journal[0].resultat, 'kept'); assert.equal(r.journal[1].resultat, 'not better', 'tour pair : ordre inverse, B = la version courante');
  assert.equal(appels[0].action, 'debut'); assert.ok(appels.every((c, i) => i === 0 || c.jeton === 'j.s'));
  assert.equal(appels[2].images.length, 4);
});

test('Qwen injoignable des le 1er appel : remboursement demande, aucun levier', { skip: !existsSync(RIG) }, async () => {
  const b = readFileSync(RIG), sq = __interne.charger(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), toDataURL: () => 'data:image/jpeg;base64,QUJD' }) };
  const vus = [];
  const r = await relireClip(sq, 'attack', { espece: 'humain', appeler: async (c) => { vus.push(c.action); return c.action === 'debut' ? { ok: true, jeton: 'j.s' } : c.action === 'rembourser' ? { ok: true } : { ok: false, raison: 'unavailable' }; } });
  assert.deepEqual(r.leviers, {}); assert.equal(r.rembourse, true); assert.deepEqual(vus, ['debut', 'appel', 'rembourser']);
});
