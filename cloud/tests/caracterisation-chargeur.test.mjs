// Tests du CHARGEUR lui-meme (tests/_charge-worker.mjs) : si l'extraction de declarations se trompait (accolade dans une chaine, un gabarit, une regex, un
// commentaire, un type generique), tous les autres tests de caracterisation mentiraient. On le prouve ici sur un texte synthetique, puis sur le vrai worker.ts.
// Lancer : cd cloud && node --test tests/caracterisation-chargeur.test.mjs   (WORKER_SRC=<autre exemplaire> pour viser un autre worker.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerDepuisSource, chargerFonctions, chargerConstante, existe, lireSource, creerR2, creerSupabase } from './_charge-worker.mjs';

const PIEGES = `
import { x } from './ailleurs';
const A = 1;
function enChaine(): string { return "}} { fausse fin }"; }
function enGabarit(n: number): string { return \`a \${ n > 1 ? \`{\${n}}\` : '}' } }\`; }
function enRegex(s: string): boolean { return /[{}]+\\}/.test(s) || /\\//.test(s); }
function enCommentaire(): number {
  // } accolade fermante en commentaire ligne
  /* } et { en commentaire bloc */
  return 7;
}
async function generique(a: Record<string, { x: number }>): Promise<{ ok: boolean }> { return { ok: !!a }; }
const flechee = (n: number): number => { return n + A; };
const objet = { a: 1, b: { c: [1, 2, { d: 3 }] } };
let compteur = 0;
function incremente(): number { compteur += 1; return compteur; }
class Boite { v = 5; lire() { return this.v; } }
export function exportee(): string { return 'ok'; }
function suivante(): string { return 'apres les pieges'; }
export default { fetch() { return 1; } };
interface Env { a: string }
type T = { z: number };
`;

test('chargeur : une declaration n\'embarque que ce qu\'on demande (la suivante n\'est pas avalee)', () => {
  const m = chargerDepuisSource(PIEGES, ['enChaine']);
  assert.equal(m.enChaine(), '}} { fausse fin }');
  assert.equal(m.suivante, undefined);
});
test('chargeur : accolades dans chaines, gabarits imbriques, regex et commentaires', () => {
  const m = chargerDepuisSource(PIEGES, ['enGabarit', 'enRegex', 'enCommentaire']);
  assert.equal(m.enGabarit(2), 'a {2} }'); assert.equal(m.enGabarit(0), 'a } }');
  assert.equal(m.enRegex('{}}'), true); assert.equal(m.enRegex('abc'), false);
  assert.equal(m.enCommentaire(), 7);
});
test('chargeur : type de retour generique avec accolades, fonction fleche, constantes, classes', async () => {
  const m = chargerDepuisSource(PIEGES, ['generique', 'flechee', 'A', 'objet', 'Boite']);
  assert.deepEqual(await m.generique({}), { ok: true }); assert.equal(m.flechee(1), 2); assert.equal(m.A, 1);
  assert.equal(m.objet.b.c[2].d, 3); assert.equal(new m.Boite().lire(), 5);
});
test('chargeur : "export" retire, interfaces et types ignores, export default non nommable', () => {
  const m = chargerDepuisSource(PIEGES, ['exportee', 'suivante']);
  assert.equal(m.exportee(), 'ok'); assert.equal(m.suivante(), 'apres les pieges');
  assert.throws(() => chargerDepuisSource(PIEGES, ['Env']), /introuvable/);
  assert.throws(() => chargerDepuisSource(PIEGES, ['T']), /introuvable/);
});
test('chargeur : nom absent -> erreur explicite ; nom a la fois charge et doublure -> erreur', () => {
  assert.throws(() => chargerDepuisSource(PIEGES, ['nExistePas']), /nExistePas/);
  assert.throws(() => chargerDepuisSource(PIEGES, ['A'], { A: 2 }), /a la fois/);
});
test('chargeur : les doublures sont injectees ; l\'etat `let` du worker est partage entre fonctions et lisible par ev()', () => {
  const m = chargerDepuisSource(PIEGES + '\nfunction utilise(): number { return voisine() + 1; }', ['utilise'], { voisine: () => 41 });
  assert.equal(m.utilise(), 42);
  const c = chargerDepuisSource(PIEGES, ['compteur', 'incremente']);
  c.incremente(); c.incremente();
  assert.equal(c.ev('compteur'), 2); c.ev('compteur = 10'); assert.equal(c.incremente(), 11);
});
test('chargeur : deux chargements sont independants (aucun etat partage entre fermetures)', () => {
  const a = chargerDepuisSource(PIEGES, ['compteur', 'incremente']), b = chargerDepuisSource(PIEGES, ['compteur', 'incremente']);
  a.incremente(); assert.equal(b.incremente(), 1);
});
test('chargeur : plusieurs noms pour une meme instruction `const a = 1, b = 2` ne dupliquent pas la declaration', () => {
  const m = chargerDepuisSource('const p = 1, q = 2;\nfunction s(): number { return p + q; }', ['p', 'q', 's']);
  assert.equal(m.s(), 3);
});
test('chargeConstante : trouve une constante imbriquee dans une fonction (comme l\'ancienne table PALIERS)', () => {
  const src = 'async function h() {\n  const PALIERS: Record<string, { pas: number }> = { fast: { pas: 24 } };\n  return PALIERS;\n}';
  assert.deepEqual(chargerConstante('PALIERS', {}, src), { fast: { pas: 24 } });
  assert.equal(chargerConstante('absente', {}, src), undefined);
});
test('chargeur : existe() reflete le texte ; lireSource() normalise CRLF en LF', () => {
  assert.equal(existe('enChaine', PIEGES), true); assert.equal(existe('nExistePas', PIEGES), false);
  assert.ok(!lireSource().includes('\r'));
});
test('chargeur sur le VRAI worker.ts : fonctions connues extraites en entier et executables', () => {
  const w = chargerFonctions(['timingSafeEqualHex', '_plafond', 'todayUTC']);
  assert.equal(w.timingSafeEqualHex('ab', 'ab'), true); assert.equal(w._plafond('0', 5), 0); assert.match(w.todayUTC(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(existe('handleGenerate') && existe('handleStripeWebhook') && existe('getSessionUser'));
});

test('doublure R2 : onlyIf etagMatches / etagDoesNotMatch se comporte comme Cloudflare R2', async () => {
  const r2 = creerR2();
  assert.ok(await r2.put('k', '1', { onlyIf: { etagDoesNotMatch: '*' } }));
  assert.equal(await r2.put('k', '2', { onlyIf: { etagDoesNotMatch: '*' } }), null, 'existe deja');
  const o = await r2.get('k');
  assert.equal(await r2.put('k', '3', { onlyIf: { etagMatches: 'mauvais' } }), null);
  assert.ok(await r2.put('k', '3', { onlyIf: { etagMatches: o.etag } }));
  assert.equal(await r2.put('k', '4', { onlyIf: { etagMatches: o.etag } }), null, 'l\'etag a change');
  assert.equal(r2.lire('k'), '3'); assert.equal(await r2.get('absent'), null);
  assert.deepEqual((await r2.list({ prefix: 'k' })).objects.map((x) => x.key), ['k']);
});
test('doublure Supabase : filtres eq / is / in / gt, update conditionnel qui rend les lignes touchees', async () => {
  const sb = creerSupabase({ t: [{ id: 1, a: 'x', c: 0 }, { id: 2, a: 'y', c: 5 }] });
  assert.equal((await sb.from('t').select().eq('a', 'x').maybeSingle()).data.id, 1);
  assert.equal((await sb.from('t').select().gt('c', 0).maybeSingle()).data.id, 2);
  assert.equal((await sb.from('t').select().in('id', [1, 2]).limit(1).maybeSingle()).data.id, 1);
  const r = await sb.from('t').update({ c: 9 }).eq('a', 'x').is('z', null).select('id');
  assert.deepEqual(r.data, [{ id: 1 }]);
  assert.equal((await sb.from('t').update({ c: 9 }).eq('a', 'absent').select('id')).data.length, 0);
});
