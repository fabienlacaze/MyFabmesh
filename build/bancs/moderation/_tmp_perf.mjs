import { versions } from './lib_bancs.mjs';
const { AVANT, APRES } = versions({ avant: 'origin/prompts-2410' });
const textes = ['a medieval knight in shining armor standing in a dark forest at sunset, highly detailed, cinematic lighting, full body, 8k',
  'un guerrier orc avec une grande hache, foret sombre, brouillard, eclairage dramatique', 'ein alter Ritter mit Schwert und Schild, rostige Ruestung',
  'naga kobieta w lesie', 'a child with a red balloon in a park, smiling, sunny day, cartoon style'];
for (const [nom, m] of [['AVANT', AVANT], ['APRES', APRES]]) {
  for (const t of textes) { m.checkPromptSafety(t, false); m.checkHardFloor(t); }
  const t0 = performance.now();
  for (let i = 0; i < 400; i++) for (const t of textes) { m.checkPromptSafety(t, false); }
  console.log(nom, ((performance.now() - t0) / (400 * textes.length)).toFixed(3), 'ms par texte');
}
