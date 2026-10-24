// GARDE « PHRASES LEGITIMES MULTILINGUES » (24/10). Lit corpus_legitime_langues.txt et corpus_legitime_relecteurs.txt (phrases ordinaires, ~35 langues) et
// echoue si la copie de travail du filtre REFUSE une phrase que la version de reference (--avant, defaut la production f86208c0) ACCEPTAIT : un nouveau
// faux refus. Les phrases deja refusees par la reference sont listees a part (anciens faux refus : politique du proprietaire), sans faire echouer.
// Usage : node build/bancs/moderation/corpus_legitime_langues.mjs [--avant f86208c0]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, charger, source, sourceApres, verdict } from './lib_bancs.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
// Reference : la production f86208c0 copiee dans reference/ (pas d historique git en integration continue) ; --avant <revision> pour une autre.
const PROD = charger(arg('--avant') ? source(arg('--avant')) : readFileSync(join(ICI, 'reference', 'nsfw_filter_prod_f86208c0.ts'), 'utf8'));
const APRES = charger(sourceApres());
const sansAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[øØ]/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd');
const lignes = [];
for (const f of ['corpus_legitime_langues.txt', 'corpus_legitime_relecteurs.txt']) {
  for (const l of readFileSync(join(ICI, f), 'utf8').replace(/\r/g, '').split('\n')) {
    const t = l.trim();
    if (t && !t.startsWith('#')) lignes.push(t);
  }
}
const nouveaux = [], anciens = [];
for (const t0 of lignes) {
  for (const t of new Set([t0, sansAccents(t0)])) {
    const a = verdict(APRES, t);
    if (a === '.') continue;
    (verdict(PROD, t) === '.' ? nouveaux : anciens).push(`${t}  [${a}]`);
  }
}
console.log(`${lignes.length} phrases legitimes ; nouveaux faux refus : ${nouveaux.length} ; deja refusees par la reference : ${anciens.length}`);
for (const x of nouveaux) console.log('  NOUVEAU  ' + x);
for (const x of anciens) console.log('  ancien   ' + x);
if (nouveaux.length) process.exit(1);
