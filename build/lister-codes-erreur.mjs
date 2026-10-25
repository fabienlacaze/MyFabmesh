#!/usr/bin/env node
/**
 * Genere docs/codes_erreur.md : le DICTIONNAIRE des codes d'erreur de MyFabmesh et comment les corriger (25/10, demande du user : « un dictionnaire de tous les
 * codes erreurs que l'on a et comment les corriger »).
 *   1. familles (build/codes_erreur_familles.json) : symptome, cause, correction, remboursement ; memes identifiants (E01...) que la fenetre « Error » de l'interface ;
 *   2. INVENTAIRE COMPLET extrait du code : chaque `err(<statut>, '<message>')` du worker (cloud/src/worker.ts) avec la fonction qui le leve, et chaque
 *      `HTTPException(status_code=..., detail=...)` de Modal (modal_app/app.py), classes dans une famille.
 *
 *   node build/lister-codes-erreur.mjs           ecrit docs/codes_erreur.md
 *   node build/lister-codes-erreur.mjs --verifier  echoue si le fichier n'est pas a jour (garde)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (r) => readFileSync(join(RACINE, r), 'utf-8').replace(/\r\n/g, '\n');
const familles = JSON.parse(lire('build/codes_erreur_familles.json')).familles;

function famille(message, statut) {
  for (const f of familles) {
    if (!f.motifs.length) continue;
    if (f.http && f.http !== '5xx' && statut && f.http !== String(statut) && !['E09', 'E12'].includes(f.ref) && !f.motifs.some(() => false)) {
      // le statut ne bloque pas un motif de texte precis ; il sert seulement a departager
    }
    if (f.motifs.some((m) => new RegExp(m, 'i').test(message))) return f;
  }
  const st = String(statut || '');
  const parStatut = { 400: 'E12', 401: 'E05', 402: 'E03', 403: 'E13', 404: 'E14', 422: 'E07', 429: 'E04', 503: 'E11' };
  const ref = parStatut[st] || (/^5/.test(st) ? 'E10' : 'E99');
  return familles.find((f) => f.ref === ref);
}

/** err(<statut>, '<message>') / err(<statut>, `<message>`) et leur fonction. */
function inventaireWorker() {
  const lignes = lire('cloud/src/worker.ts').split('\n');
  let courante = '(module)';
  const vus = new Map();
  lignes.forEach((l, i) => {
    const f = l.match(/^(?:export )?(?:async )?function (\w+)/);
    if (f) courante = f[1];
    for (const m of l.matchAll(/err\((\d{3}),\s*(['`])((?:\\.|(?!\2).)*)\2/g)) {
      const msg = m[3].replace(/\\'/g, "'").replace(/\$\{[^}]*\}/g, '{…}');
      const cle = m[1] + '|' + msg + '|' + courante;
      if (!vus.has(cle)) vus.set(cle, { statut: m[1], message: msg, fonction: courante, ligne: i + 1 });
    }
  });
  return [...vus.values()];
}
function inventaireModal() {
  const lignes = lire('modal_app/app.py').split('\n');
  const vus = new Map();
  lignes.forEach((l, i) => {
    const m = l.match(/status_code=(\d{3})/);
    if (!m) return;
    const bloc = lignes.slice(i, i + 3).join(' ');
    const d = bloc.match(/detail=(?:f)?(['"])((?:\\.|(?!\1).)*)\1/);
    const msg = d ? d[2].replace(/\{[^}]*\}/g, '{…}') : '(detail dynamique)';
    const cle = m[1] + '|' + msg;
    if (!vus.has(cle)) vus.set(cle, { statut: m[1], message: msg, ligne: i + 1 });
  });
  return [...vus.values()];
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const worker = inventaireWorker();
const modal = inventaireModal();
let md = '';
md += '# Dictionnaire des codes d\'erreur MyFabmesh\n\n';
md += '> GENERE par `node build/lister-codes-erreur.mjs` (source des familles : `build/codes_erreur_familles.json`). Ne pas editer a la main.\n\n';
md += 'Quand une etape echoue, la liste des travaux affiche **Error** (au lieu de « Aller a ») : la fenetre donne l\'image, les parametres, le **code** (ref `E..`, HTTP, cf-ray), son explication et le **message exact**. ';
md += 'Retrouver ce message ci-dessous, ou la famille (`E01`...), donne la cause probable et la correction.\n\n';
md += '## Comment diagnostiquer\n\n';
md += '1. Copier l\'erreur (bouton de la fenetre) : nom du travail, projet, heure, code, parametres.\n';
md += '2. Identifier la famille ci-dessous (`ref`).\n';
md += '3. Lire les journaux : `PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m modal app logs myfabmesh-cloud --since 30m --search "<mot>"` (Modal), `node build/fab-web.mjs travaux` (compte), R2 / Supabase (CLAUDE.md, section 2).\n';
md += '4. Un echec ne coute rien : les routes remboursent (colonne « Rembourse »).\n\n';
md += '## Familles\n\n';
md += '| Ref | HTTP | Titre | Rembourse |\n|---|---|---|---|\n';
for (const f of familles) md += `| ${f.ref} | ${f.http || '—'} | ${esc(f.titre)} | ${f.rembourse ? 'oui' : 'non'} |\n`;
md += '\n';
for (const f of familles) {
  md += `### ${f.ref} — ${f.titre}\n\n`;
  md += `- **Symptome** : ${f.symptome}\n- **Cause** : ${f.cause}\n- **Correction** : ${f.correction}\n- **Rembourse** : ${f.rembourse ? 'oui' : 'non'}\n\n`;
}
md += '## Inventaire complet — worker (`cloud/src/worker.ts`)\n\n';
md += `${worker.length} messages distincts. Colonnes : statut HTTP, message (les valeurs dynamiques sont notees \`{…}\`), fonction qui le leve (ligne), famille.\n\n`;
md += '| HTTP | Message | Fonction (ligne) | Famille |\n|---|---|---|---|\n';
for (const e of worker.sort((a, b) => a.statut.localeCompare(b.statut) || a.message.localeCompare(b.message))) {
  const f = famille(e.message, e.statut);
  md += `| ${e.statut} | ${esc(e.message)} | ${e.fonction} (${e.ligne}) | ${f ? f.ref : 'E99'} |\n`;
}
md += '\n## Inventaire complet — Modal (`modal_app/app.py`)\n\n';
md += `${modal.length} messages distincts.\n\n| HTTP | Message | Ligne | Famille |\n|---|---|---|---|\n`;
for (const e of modal.sort((a, b) => a.statut.localeCompare(b.statut) || a.message.localeCompare(b.message))) {
  const f = famille(e.message, e.statut);
  md += `| ${e.statut} | ${esc(e.message)} | ${e.ligne} | ${f ? f.ref : 'E99'} |\n`;
}
md += '\n## Cote client (navigateur)\n\n';
md += 'Les messages `<champ> required` / `mask required` du shim (`cloud/public/app/meshyAPI-cloud.js`) sont des garde-fous avant l\'envoi : famille E12 (ou E02 pour `prompt required`). ';
md += '`_expliquerErreur()` (index2.js) classe le message recu avec les memes familles.\n';

const chemin = join(RACINE, 'docs', 'codes_erreur.md');
if (process.argv.includes('--verifier')) {
  if (!existsSync(chemin) || readFileSync(chemin, 'utf-8').replace(/\r\n/g, '\n') !== md) {
    console.error('docs/codes_erreur.md n\'est pas a jour : node build/lister-codes-erreur.mjs');
    process.exit(1);
  }
  console.log(`[erreurs] dictionnaire a jour (${worker.length} messages worker, ${modal.length} Modal)`);
} else {
  writeFileSync(chemin, md);
  console.log(`[erreurs] docs/codes_erreur.md ecrit : ${familles.length} familles, ${worker.length} messages worker, ${modal.length} messages Modal`);
}
