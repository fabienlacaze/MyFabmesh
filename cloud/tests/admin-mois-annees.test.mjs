// 29/10 (user : « rajoute par mois et par annee aussi » sur le selecteur de periode de /admin2) : stats.json expose series_mois (12 derniers mois)
// et series_annees. Ces tests echouent sur l'ancien worker (_seriesMoisAnnees n'existe pas, stats.json n'avait que series_30d).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerFonctions } from './_charge-worker.mjs';

const { _seriesMoisAnnees } = chargerFonctions(['_seriesMoisAnnees'], {});
const cumul = (ops, users, rev, cout) => ({ ops, users: new Set(users), revenue_eur: rev, cost_eur: cout, margin_eur: rev - cout });

test('12 derniers mois dans l\'ordre, mois vides a zero, passage d\'annee', () => {
  const now = Date.UTC(2026, 9, 29, 18, 0, 0);    // 29/10/2026
  const r = _seriesMoisAnnees({ '2026-10': cumul(5, ['a', 'b'], 1.234, 0.5), '2025-11': cumul(2, ['a'], 0, 0.2), '2025-10': cumul(9, ['z'], 9, 9) }, {}, now);
  assert.equal(r.mois.length, 12);
  assert.equal(r.mois[0].periode, '2025-11'); assert.equal(r.mois[11].periode, '2026-10');
  assert.deepEqual(r.mois[11], { periode: '2026-10', ops: 5, users: 2, revenue_eur: 1.23, cost_eur: 0.5, margin_eur: 0.73 });
  assert.equal(r.mois[0].ops, 2);
  assert.ok(r.mois.slice(1, 11).every((x) => x.ops === 0 && x.users === 0), 'mois vides a zero');
  assert.ok(!r.mois.some((x) => x.periode === '2025-10'), 'pas de 13e mois');
});

test('fin de mois longue (31) : pas de saut de mois (setUTCDate(1) avant de reculer)', () => {
  const r = _seriesMoisAnnees({}, {}, Date.UTC(2026, 2, 31, 12));   // 31/03/2026 : reculer d'un mois sans le jour 1 donnerait le 03/03
  assert.deepEqual(r.mois.slice(-3).map((x) => x.periode), ['2026-01', '2026-02', '2026-03']);
});

test('annees triees, utilisateurs distincts par annee', () => {
  const r = _seriesMoisAnnees({}, { 2026: cumul(10, ['a', 'b', 'a'], 3, 1), 2025: cumul(1, ['c'], 0, 0) }, Date.now());
  assert.deepEqual(r.annees.map((x) => [x.periode, x.ops, x.users]), [['2025', 1, 1], ['2026', 10, 2]]);
});

test('stats.json expose series_mois et series_annees ; /admin2 propose 12 mois et Annees', () => {
  const src = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
  assert.match(src, /series_mois: seriesMois,/); assert.match(src, /series_annees: seriesAnnees,/);
  const page = readFileSync(new URL('../public/admin2.html', import.meta.url), 'utf8');
  assert.match(page, /data-per="12m"/); assert.match(page, /data-per="ans"/);
  assert.match(page, /function serieDePeriode\(st\)/);
});
