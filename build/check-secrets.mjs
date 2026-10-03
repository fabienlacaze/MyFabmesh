// Garde contre les secrets dans le depot PUBLIC (constat DEP-11, 2026-10-03).
//
// POURQUOI : le depot est public ; une cle collee par megarde dans un fichier
// suivi est lisible par tous des le push. Cette garde lit `git ls-files` et
// REFUSE (code de sortie 1) tout fichier suivi contenant un motif de secret reel.
//
// Elle s'ouvre en ECHEC : une erreur de lecture, une erreur git ou un fichier
// illisible font echouer la garde, elles ne passent jamais en silence.
// Ignores : binaires (octet nul), dossiers node_modules / dist / out, fichiers
// supprimes de l'arbre de travail mais encore dans l'index (deja signales par git).
//
// Usage : node build/check-secrets.mjs            (tous les fichiers suivis)
//         node build/check-secrets.mjs --files a b (test : fichiers explicites)
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Chaque motif est construit par morceaux pour ne pas se declencher lui-meme.
const MOTIFS = [
  ['cle Stripe live', new RegExp('sk_' + 'live_[A-Za-z0-9]{20,}')],
  ['secret webhook Stripe', new RegExp('whsec' + '_[A-Za-z0-9]{20,}')],
  ['cle AWS', new RegExp('AK' + 'IA[0-9A-Z]{16}')],
  ['jeton HuggingFace', new RegExp('hf' + '_[A-Za-z0-9]{30,}')],
  ['jeton Replicate', new RegExp('r8' + '_[A-Za-z0-9]{30,}')],
  ['cle privee PEM', new RegExp('-----BEGIN (?:[A-Z]+ )*PRIVATE ' + 'KEY-----')],
  ['jeton mfm', new RegExp('mfm' + '_[A-Za-z0-9]{40}')],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function ligneDe(texte, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (texte.charCodeAt(i) === 10) n++;
  return n;
}

// Retourne [{type, ligne}] pour un contenu texte (latin1 : conserve les octets).
export function scanContent(texte) {
  const trouves = [];
  for (const [nom, re] of MOTIFS) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(texte))) {
      // Exception justifiee : un gabarit de documentation (« hf_xxxxxxxx... ») n'a
      // que 1-2 caracteres distincts apres le prefixe ; un vrai secret en a bien plus.
      const corps = m[0].replace(/^[A-Za-z0-9]+?_/, '');
      if (nom !== 'cle privee PEM' && new Set(corps).size <= 2) continue;
      trouves.push({ type: nom, ligne: ligneDe(texte, m.index) });
    }
  }
  let m;
  JWT.lastIndex = 0;
  while ((m = JWT.exec(texte))) {
    if (m[0].length <= 100) continue;
    try {
      const charge = m[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const decode = Buffer.from(charge, 'base64').toString('utf8');
      if (decode.includes('service_role')) trouves.push({ type: 'JWT Supabase service_role', ligne: ligneDe(texte, m.index) });
    } catch { /* JWT mal forme : pas un secret exploitable */ }
  }
  return trouves;
}

function ignore(chemin) {
  return chemin.split(/[\/]/).some((p) => p === 'node_modules' || p === 'dist' || p === 'out');
}

function fichiersSuivis() {
  const sortie = execFileSync('git', ['ls-files', '-z'], { cwd: RACINE, maxBuffer: 256 * 1024 * 1024 });
  const liste = sortie.toString('utf8').split('\0').filter(Boolean);
  const suppr = new Set(
    execFileSync('git', ['ls-files', '-z', '--deleted'], { cwd: RACINE, maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8').split('\0').filter(Boolean));
  return liste.filter((f) => !suppr.has(f));
}

export function main(argv) {
  let fichiers;
  try {
    const i = argv.indexOf('--files');
    fichiers = i >= 0 ? argv.slice(i + 1) : fichiersSuivis();
  } catch (e) {
    console.error('check-secrets : impossible de lister les fichiers suivis (' + e.message + ') -> ECHEC');
    return 1;
  }
  let echecs = 0;
  let lus = 0;
  for (const f of fichiers) {
    if (ignore(f)) continue;
    const abs = resolve(RACINE, f);
    let tampon;
    try {
      if (statSync(abs).isDirectory()) continue; // sous-module
      tampon = readFileSync(abs);
    } catch (e) {
      console.error('check-secrets : lecture impossible de ' + f + ' (' + e.message + ') -> ECHEC');
      echecs++;
      continue;
    }
    if (tampon.subarray(0, 8000).includes(0)) continue; // binaire
    lus++;
    for (const t of scanContent(tampon.toString('latin1'))) {
      console.error('check-secrets : ' + t.type + ' dans ' + f + ':' + t.ligne);
      echecs++;
    }
  }
  if (echecs) {
    console.error('check-secrets : ' + echecs + ' probleme(s) -> ECHEC. Retirer le secret, le REVOQUER chez le fournisseur, puis recommencer.');
    return 1;
  }
  console.log('check-secrets : ' + lus + ' fichiers texte verifies, aucun secret detecte.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
