#!/usr/bin/env node
/**
 * GARDE DES TRADUCTIONS DE L'INTERFACE (lot « interface multilingue », 2026-10-13 ;
 * constats INTERFACE-02, -03, -07, -15, M01 et M06 de l'audit du 11/10/2026).
 *
 * POURQUOI. L'interface est ecrite en anglais et chaque langue est un dictionnaire
 * « texte anglais EXACT -> traduction ». Un texte sans entree reste en anglais SANS
 * erreur, et retoucher un texte anglais retire sa traduction en silence. Mesure du
 * 11/10 : 76 % des textes visibles traduits en francais, 58,5 % en espagnol, chinois,
 * hindi et arabe ; le formulaire de signalement de contenu (exige par le Store) n'etait
 * traduit qu'en francais ; la boite « plus assez de credits » etait en anglais partout ;
 * les dictionnaires du web et du bureau avaient derive (un libelle traduit d'un cote
 * seulement). Rien ne le signalait : build/couverture-traductions.mjs mesurait, mais
 * personne ne le lancait.
 *
 * CE QUI EST REFUSE (code 1) :
 *  1. COUVERTURE : la part de libelles traduits d'une langue (bureau, web, coque Next)
 *     passe SOUS le seuil enregistre dans build/traductions-seuils.json. Cliquet :
 *     `--ecrire` enregistre la couverture atteinte et refuse de la baisser (sauf
 *     `--baisser`, a justifier dans AGENT_LOG.md).
 *  2. DERIVE web / bureau : un libelle present dans les DEUX interfaces, traduit dans
 *     une langue d'un cote et pas de l'autre.
 *  3. ECRANS PRIORITAIRES incomplets : signalement de contenu IA, credits insuffisants,
 *     suppression du compte, refus du serveur (lib/textes-serveur.js), choix de la
 *     langue : 100 % exiges dans les 5 langues.
 *  4. GABARIT CASSE : une traduction qui perd ou ajoute un {x} / {y} (la valeur
 *     inseree disparaitrait, ou une autre prendrait sa place).
 *  5. DOUBLONS CONTRADICTOIRES : une meme cle traduite de deux facons dans une langue
 *     (le dernier fichier charge gagne en silence) — le nombre ne peut que baisser.
 *  6. SELECTEUR DE LANGUE TRADUIT : les noms de langue doivent rester ecrits dans leur
 *     propre langue (attribut translate="no" sur #lang-select).
 *  7. COQUE NEXT : un texte <T> / tr() / texte() de cloud/src sans ses six langues, une
 *     version qui perd une valeur {x}/{y}, un lien ou du gras, ou un meme texte anglais
 *     ecrit avec deux francais differents.
 *
 * Usage : node build/check-traductions.mjs [--ecrire] [--baisser] [--json] [--racine <dossier>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CIBLES, fichiersCible, libellesCible, libellesHtml, libellesJs, chargerDictionnaires, estNeutre, valeurDe,
} from './couverture-traductions.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const LANGUES = ['fr', 'es', 'zh', 'hi', 'ar'];
const NOM_SEUILS = 'build/traductions-seuils.json';

let acorn = null;
try { acorn = createRequire(import.meta.url)('acorn'); } catch (_) { acorn = null; }

/* ── 3. ecrans prioritaires ─────────────────────────────────────────────────
 * Zones HTML (par id, dans la page de chaque cible ou elle existe) et textes
 * construits en JS (listes explicites). Une cle de liste introuvable dans les
 * sources est une ERREUR : le texte anglais a change sans que la liste suive. */
export const ZONES_PRIORITAIRES = [
  { nom: 'signalement de contenu IA (Store 11.16)', id: 'modal-report' },
];
export const CLES_PRIORITAIRES = {
  'credits insuffisants': ['Not enough credits', 'Buy credits', 'You are out of credits.'],
  'suppression du compte': [
    'Delete my account', 'Delete forever', 'Download my data (JSON)', 'Privacy & data',
    'This erases your account, every project, image and 3D model, and your payment history. It cannot be undone. Type DELETE to confirm.',
    'Download every piece of data we hold about you, or permanently delete your account and all of its data.',
  ],
  'choix de la langue': ['Language', 'Interface language', 'Change language'],
};
// Fichiers dont TOUS les textes sont prioritaires (refus du serveur).
export const FICHIERS_PRIORITAIRES = ['lib/textes-serveur.js'];

/* ── utilitaires ──────────────────────────────────────────────────────────── */
function lire(p) { return fs.readFileSync(p, 'utf8'); }

/** Sous-arbre HTML de l'element portant cet id (balises equilibrees). */
export function zoneHtml(src, id) {
  const re = new RegExp('<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\bid\\s*=\\s*["\']' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'g');
  const m = re.exec(src);
  if (!m) return null;
  const balise = m[1].toLowerCase();
  const reB = new RegExp('<(/?)' + balise + '\\b[^>]*?(/?)>', 'gi');
  reB.lastIndex = m.index;
  let prof = 0;
  let b;
  while ((b = reB.exec(src))) {
    if (b[1] === '/') prof--; else if (b[2] !== '/') prof++;
    if (prof === 0) return src.slice(m.index, reB.lastIndex);
  }
  return src.slice(m.index);
}

const marques = (s) => (String(s).match(/\{[xy]\}/g) || []);
/** Un gabarit dont chaque marque est unique ({x} une fois, {y} une fois) : sa traduction doit porter les memes,
 *  DANS LE MEME ORDRE — tf() remplit les marques dans l'ordre d'apparition, pas par leur nom : une traduction
 *  qui ecrit {y} avant {x} intervertit les valeurs (« 3 sur 12 » devient « 12 sur 3 »). */
export function gabaritCasse(cle, valeur) {
  const k = marques(cle);
  if (!k.length) return false;
  if (new Set(k).size !== k.length) return false; // marques repetees = astuce de pluriel, non verifiable
  const v = marques(valeur);
  return k.join() !== v.join();
}

/** Entrees de dictionnaire d'un fichier (analyse acorn) : [{ langue, cle, valeur }]. */
export function entreesDictionnaire(src, nomFichier) {
  if (!acorn) return [];
  let ast = null;
  for (const sourceType of ['script', 'module']) {
    try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType }); break; } catch (_) { /* suivant */ }
  }
  if (!ast) return [];
  const sortie = [];
  const langueFichier = (nomFichier.match(/^(fr|es|zh|hi|ar)\.js$/) || [])[1] || null;
  const cleDe = (p) => (p.key.type === 'Literal' ? String(p.key.value) : (p.key.type === 'Identifier' && !p.computed ? p.key.name : null));
  const valeurDeNoeud = (n) => (n.type === 'Literal' && typeof n.value === 'string' ? n.value
    : (n.type === 'TemplateLiteral' && !n.expressions.length ? n.quasis.map((q) => q.value.cooked).join('') : null));
  const verser = (langue, objet) => {
    for (const p of objet.properties || []) {
      if (p.type !== 'Property') continue;
      const cle = cleDe(p);
      const v = valeurDeNoeud(p.value);
      if (cle != null && v != null) sortie.push({ langue, cle, valeur: v });
    }
  };
  const pile = [ast];
  while (pile.length) {
    const n = pile.pop();
    if (!n || typeof n.type !== 'string') continue;
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'register'
        && n.arguments.length >= 2 && n.arguments[0].type === 'Literal' && n.arguments[1].type === 'ObjectExpression') {
      verser(String(n.arguments[0].value), n.arguments[1]);
    } else if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && n.init.type === 'ObjectExpression') {
      if (n.id.name === 'I18N') {
        for (const p of n.init.properties) if (p.type === 'Property' && p.value.type === 'ObjectExpression') verser(cleDe(p), p.value);
      } else if (langueFichier && n.id.name === 'dict') verser(langueFichier, n.init);
      else if (n.id.name === 'T') {
        // Table du lot interface (lang/_additions6.js) : « cle »: [fr, es, zh, hi, ar]
        for (const p of n.init.properties) {
          if (p.type !== 'Property' || p.value.type !== 'ArrayExpression') continue;
          const cle = cleDe(p);
          p.value.elements.forEach((el, i) => { const v = el && valeurDeNoeud(el); if (cle != null && v != null && LANGUES[i]) sortie.push({ langue: LANGUES[i], cle, valeur: v }); });
        }
      }
    }
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) for (const x of v) { if (x && typeof x.type === 'string') pile.push(x); }
      else if (v && typeof v.type === 'string') pile.push(v);
    }
  }
  return sortie;
}

/** Cles traduites de deux facons differentes dans une meme langue (tous fichiers d'une cible confondus). */
export function doublonsContradictoires(fichiersDico) {
  const parLangue = {};
  for (const f of fichiersDico) {
    if (!fs.existsSync(f)) continue;
    for (const e of entreesDictionnaire(lire(f), path.basename(f))) {
      const l = (parLangue[e.langue] = parLangue[e.langue] || new Map());
      const vals = l.get(e.cle) || new Set();
      vals.add(e.valeur);
      l.set(e.cle, vals);
    }
  }
  const res = {};
  for (const [langue, m] of Object.entries(parLangue)) {
    if (!LANGUES.includes(langue)) continue;
    res[langue] = [...m.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);
  }
  return res;
}

/* ── 7. coque Next (cloud/src) ────────────────────────────────────────────── */
export const COQUE = { dossier: 'cloud/src', dico: 'cloud/src/lib/coque-traductions.json' };

// Litteral de chaine JS / JSX : "…", '…' ou `…` sans ${}.
const LIT = String.raw`(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|` + '`' + String.raw`((?:\\.|[^` + '`' + String.raw`\\$])*)` + '`' + ')';
const deLit = (m, i) => { const v = m[i] ?? m[i + 1] ?? m[i + 2]; return v === undefined ? null : v.replace(/\\(["'`\\])/g, '$1').replace(/\\n/g, '\n'); };
const ATTR_T = (nom) => new RegExp('\\b' + nom + '=(?:"([^"]*)"|\'([^\']*)\'|\\{\\s*' + LIT + '\\s*\\})');

/** Textes de la coque : <T fr="…" en="…" />, tr('en', 'fr', …), texte('en', 'fr', …).
 *  Rend Map(texte anglais -> { fichiers: [...], fr: [versions francaises ecrites en ligne] }).
 *  Les pages juridiques sont lues aussi : leurs <T> sont des titres d'interface ; leurs textes de loi
 *  ne passent jamais par <T> (classes .juridique-fr / .juridique-en, francais et anglais seulement). */
export function textesCoque(racine) {
  const base = path.join(racine, COQUE.dossier);
  if (!fs.existsSync(base)) return new Map();
  const sortie = new Map();
  const pile = [base];
  while (pile.length) {
    const d = pile.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { pile.push(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const src = lire(p);
      const rel = path.relative(racine, p).split(path.sep).join('/');
      const ajouter = (en, fr) => {
        if (en == null) return;
        const k = en.trim();
        if (!k || !/[A-Za-z]/.test(k)) return;
        const x = sortie.get(k) || { fichiers: [], fr: [] };
        x.fichiers.push(rel);
        if (fr != null) x.fr.push(fr.trim());
        sortie.set(k, x);
      };
      // <T … /> : attributs dans n'importe quel ordre (balise auto-fermante, sans « > » dans les textes)
      for (const b of src.matchAll(/<T\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*?)\/>/g)) {
        const en = b[1].match(ATTR_T('en'));
        const fr = b[1].match(ATTR_T('fr'));
        if (en) ajouter(en[1] ?? en[2] ?? deLit(en, 3), fr ? (fr[1] ?? fr[2] ?? deLit(fr, 3)) : null);
      }
      for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$.])(?:tr|texte)\(\s*` + LIT + String.raw`(?:\s*,\s*` + LIT + ')?', 'g'))) {
        ajouter(deLit(m, 1), deLit(m, 4));
      }
    }
  }
  return sortie;
}

/** Mise en forme d'un texte de la coque (lib/langue.tsx) : valeurs, liens, gras. */
const formeCoque = (s) => ({
  valeurs: (String(s).match(/\{[xy]\}/g) || []).sort().join(),
  liens: (String(s).match(/\]\(([^)\s]+)\)/g) || []).sort().join(),
  gras: (String(s).match(/\*\*/g) || []).length,
});
/** Une version (francaise en ligne ou du dictionnaire) qui perd ou ajoute une valeur, un lien ou du gras.
 *  Les valeurs sont remplies PAR NOM ({x} = la premiere, {y} = la seconde) : l'ordre peut changer. */
export function formeCoqueCassee(en, version) {
  const a = formeCoque(en);
  const b = formeCoque(version);
  return a.valeurs !== b.valeurs || a.liens !== b.liens || a.gras !== b.gras;
}

export function mesurerCoque(racine) {
  const textes = textesCoque(racine);
  const fichier = path.join(racine, COQUE.dico);
  let dico = {};
  if (fs.existsSync(fichier)) { try { dico = JSON.parse(lire(fichier)); } catch (e) { return { erreur: 'dictionnaire illisible : ' + e.message }; } }
  const langues = {};
  const manquants = {};
  for (const l of LANGUES) {
    manquants[l] = [];
    // fr est porte EN LIGNE (<T fr="…" en="…" />, tr('en', 'fr') : prop obligatoire, verifiee par TypeScript).
    let ok = 0;
    for (const k of textes.keys()) {
      if (l === 'fr' || (dico[k] && dico[k][l])) ok++; else manquants[l].push(k);
    }
    langues[l] = { connus: textes.size, traduits: ok, pourcent: textes.size ? Math.round((ok / textes.size) * 1000) / 10 : 100 };
  }
  // Formes cassees : la version francaise ecrite en ligne, puis chaque langue du dictionnaire.
  const cassees = [];
  for (const [k, x] of textes) {
    for (const fr of new Set(x.fr)) if (formeCoqueCassee(k, fr)) cassees.push(`fr : ${JSON.stringify(k)} -> ${JSON.stringify(fr)}`);
    for (const l of LANGUES) {
      const v = dico[k] && dico[k][l];
      if (typeof v === 'string' && formeCoqueCassee(k, v)) cassees.push(`${l} : ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    }
  }
  // Un meme texte anglais ecrit avec deux francais differents : un seul gagnerait a l'ecran selon la page.
  const francaisDivergents = [...textes].filter(([, x]) => new Set(x.fr).size > 1).map(([k, x]) => `${JSON.stringify(k)} : ${[...new Set(x.fr)].map((f) => JSON.stringify(f)).join(' / ')}`);
  return { libelles: textes.size, langues, manquants, cassees, francaisDivergents };
}

/* ── mesure complete ───────────────────────────────────────────────────────── */
export function mesurer(racine) {
  const cibles = {};
  for (const c of CIBLES) {
    const f = fichiersCible(racine, c);
    const tous = libellesCible(f);
    const libelles = new Map([...tous].filter(([k]) => !estNeutre(k)));
    const dicts = chargerDictionnaires({ i18n: f.i18n, dossierLang: f.dossierLang });
    const couverture = {};
    for (const l of LANGUES) {
      let ok = 0;
      for (const k of libelles.keys()) if (valeurDe(dicts[l], k)) ok++;
      couverture[l] = libelles.size ? Math.round((ok / libelles.size) * 1000) / 10 : 100;
    }
    const fichiersDico = [f.i18n].concat(fs.existsSync(f.dossierLang)
      ? fs.readdirSync(f.dossierLang).filter((x) => x.endsWith('.js')).sort().map((x) => path.join(f.dossierLang, x)) : []);
    cibles[c.nom] = { c, f, libelles, dicts, couverture, doublons: doublonsContradictoires(fichiersDico), fichiersDico };
  }
  return { cibles, coque: mesurerCoque(racine) };
}

export function verifier(racine, { seuils = null } = {}) {
  const m = mesurer(racine);
  const erreurs = [];
  const infos = [];
  const { web, bureau } = m.cibles;

  // 1. couverture
  for (const [nom, cb] of Object.entries(m.cibles)) {
    infos.push(nom.padEnd(7) + ' ' + String(cb.libelles.size).padStart(5) + ' libelles : ' + LANGUES.map((l) => l + ' ' + cb.couverture[l].toFixed(1) + ' %').join(', '));
    for (const l of LANGUES) {
      const s = seuils && seuils[nom] && seuils[nom][l];
      if (typeof s === 'number' && cb.couverture[l] < s) erreurs.push(`couverture ${nom}/${l} : ${cb.couverture[l].toFixed(1)} % < seuil ${s} % (${NOM_SEUILS})`);
    }
  }
  if (!m.coque.erreur) {
    infos.push('coque   ' + String(m.coque.libelles).padStart(5) + ' textes   : ' + LANGUES.map((l) => l + ' ' + m.coque.langues[l].pourcent.toFixed(1) + ' %').join(', '));
    for (const l of LANGUES) {
      const s = seuils && seuils.coque && seuils.coque[l];
      if (typeof s === 'number' && m.coque.langues[l].pourcent < s) erreurs.push(`couverture coque/${l} : ${m.coque.langues[l].pourcent.toFixed(1)} % < seuil ${s} %`);
    }
  } else erreurs.push('coque Next : ' + m.coque.erreur);

  // 2. derive web / bureau
  if (web && bureau) {
    for (const l of LANGUES) {
      const derive = [];
      for (const k of web.libelles.keys()) {
        if (!bureau.libelles.has(k)) continue;
        const a = !!valeurDe(web.dicts[l], k);
        const b = !!valeurDe(bureau.dicts[l], k);
        if (a !== b) derive.push((a ? 'web seulement' : 'bureau seulement') + ' : ' + JSON.stringify(k));
      }
      if (derive.length) erreurs.push(`derive web/bureau (${l}) : ${derive.length} libelle(s) traduit(s) d'un seul cote\n      ` + derive.slice(0, 12).join('\n      ') + (derive.length > 12 ? '\n      …' : ''));
    }
  }

  // 3. ecrans prioritaires
  for (const [nom, cb] of Object.entries(m.cibles)) {
    const html = cb.f.html.filter((p) => fs.existsSync(p)).map(lire).join('\n');
    const cles = new Map(); // cle -> zone
    for (const z of ZONES_PRIORITAIRES) {
      const bloc = zoneHtml(html, z.id);
      if (!bloc) continue;
      for (const k of libellesHtml(bloc).keys()) if (!estNeutre(k)) cles.set(k, z.nom);
    }
    for (const f of FICHIERS_PRIORITAIRES) {
      const p = path.join(racine, cb.c.dossier, f);
      if (!fs.existsSync(p)) continue;
      for (const k of libellesJs(lire(p)).keys()) if (!estNeutre(k)) cles.set(k, 'refus du serveur (' + f + ')');
    }
    // Texte des sources de la cible : une cle prioritaire peut etre affichee sans etre un litteral mesurable
    // (String(message || 'You are out of credits.')) ; elle compte des qu'elle figure dans le code.
    const brut = cb.f.html.concat(cb.f.js).filter((p) => fs.existsSync(p)).map(lire).join('\n');
    cb.sourcesBrutes = brut;
    for (const [zone, liste] of Object.entries(CLES_PRIORITAIRES)) {
      for (const k of liste) if (cb.libelles.has(k) || brut.includes(k)) cles.set(k, zone);
    }
    for (const [k, zone] of cles) {
      const manque = LANGUES.filter((l) => !valeurDe(cb.dicts[l], k));
      if (manque.length) erreurs.push(`ecran prioritaire « ${zone} » (${nom}) : ${JSON.stringify(k)} non traduit en ${manque.join(', ')}`);
    }
  }
  for (const [zone, liste] of Object.entries(CLES_PRIORITAIRES)) {
    for (const k of liste) {
      if (!Object.values(m.cibles).some((cb) => cb.libelles.has(k) || (cb.sourcesBrutes || '').includes(k))) erreurs.push(`ecran prioritaire « ${zone} » : ${JSON.stringify(k)} n'existe plus dans les sources (texte anglais modifie ? mettre a jour CLES_PRIORITAIRES)`);
    }
  }

  // 4. gabarits
  for (const [nom, cb] of Object.entries(m.cibles)) {
    for (const l of LANGUES) {
      for (const [k, v] of Object.entries(cb.dicts[l] || {})) {
        if (typeof v === 'string' && gabaritCasse(k, v)) erreurs.push(`gabarit casse (${nom}/${l}) : ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
      }
    }
  }

  // 5. doublons contradictoires (cliquet)
  for (const [nom, cb] of Object.entries(m.cibles)) {
    for (const l of LANGUES) {
      const n = (cb.doublons[l] || []).length;
      const s = seuils && seuils.doublons && seuils.doublons[nom] && seuils.doublons[nom][l];
      if (typeof s === 'number' && n > s) erreurs.push(`doublons contradictoires ${nom}/${l} : ${n} > ${s} (une cle traduite deux fois differemment ; garder une seule valeur)`);
    }
  }

  // 6. selecteur de langue autonyme
  for (const [nom, cb] of Object.entries(m.cibles)) {
    const html = cb.f.html.filter((p) => fs.existsSync(p)).map(lire).join('\n');
    const sel = (html.match(/<select\b[^>]*\bid\s*=\s*["']lang-select["'][^>]*>/) || [])[0];
    if (sel && !/\btranslate\s*=\s*["']no["']/.test(sel)) erreurs.push(`selecteur de langue (${nom}) : #lang-select doit porter translate="no" (les noms de langue restent ecrits dans leur langue)`);
  }

  // 7. coque Next : textes sans leurs six langues
  if (!m.coque.erreur) {
    for (const l of LANGUES) {
      const s = seuils && seuils.coque && seuils.coque[l];
      if (s === 100 && m.coque.manquants[l].length) erreurs.push(`coque Next (${l}) : ${m.coque.manquants[l].length} texte(s) sans traduction dans ${COQUE.dico}\n      ` + m.coque.manquants[l].slice(0, 8).map((x) => JSON.stringify(x)).join('\n      '));
    }
    if (m.coque.cassees.length) erreurs.push(`coque Next : ${m.coque.cassees.length} version(s) qui perdent ou ajoutent une valeur {x}/{y}, un lien [..](..) ou du **gras**\n      ` + m.coque.cassees.slice(0, 12).join('\n      '));
    if (m.coque.francaisDivergents.length) erreurs.push(`coque Next : ${m.coque.francaisDivergents.length} texte(s) anglais ecrits avec deux francais differents\n      ` + m.coque.francaisDivergents.slice(0, 8).join('\n      '));
  }

  return { m, erreurs, infos };
}

export function seuilsAtteints(m) {
  const s = { doublons: {} };
  for (const [nom, cb] of Object.entries(m.cibles)) {
    s[nom] = {};
    s.doublons[nom] = {};
    for (const l of LANGUES) { s[nom][l] = cb.couverture[l]; s.doublons[nom][l] = (cb.doublons[l] || []).length; }
  }
  if (!m.coque.erreur) { s.coque = {}; for (const l of LANGUES) s.coque[l] = m.coque.langues[l].pourcent; }
  return s;
}

function principal() {
  const args = process.argv.slice(2);
  let racine = path.resolve(ICI, '..');
  for (let i = 0; i < args.length; i++) if (args[i] === '--racine') racine = path.resolve(args[++i]);
  const fichierSeuils = path.join(racine, NOM_SEUILS);
  let seuils = null;
  if (fs.existsSync(fichierSeuils)) seuils = JSON.parse(lire(fichierSeuils));

  if (args.includes('--ecrire')) {
    const { m } = verifier(racine, { seuils: null });
    const nouveaux = seuilsAtteints(m);
    const baisses = [];
    if (seuils) {
      for (const nom of Object.keys(nouveaux)) {
        if (nom === 'doublons') continue;
        for (const l of LANGUES) if (seuils[nom] && typeof seuils[nom][l] === 'number' && nouveaux[nom][l] < seuils[nom][l]) baisses.push(`${nom}/${l} ${seuils[nom][l]} -> ${nouveaux[nom][l]}`);
      }
      for (const nom of Object.keys(nouveaux.doublons)) for (const l of LANGUES) {
        const a = seuils.doublons && seuils.doublons[nom] && seuils.doublons[nom][l];
        if (typeof a === 'number' && nouveaux.doublons[nom][l] > a) baisses.push(`doublons ${nom}/${l} ${a} -> ${nouveaux.doublons[nom][l]}`);
      }
    }
    if (baisses.length && !args.includes('--baisser')) {
      console.error('[traductions] refuse d\'abaisser les seuils : ' + baisses.join(', ') + '\n  (--baisser pour forcer, a justifier dans AGENT_LOG.md)');
      process.exit(1);
    }
    nouveaux.note = 'Seuils du garde build/check-traductions.mjs : couverture minimale (%) par cible et par langue, nombre maximal de doublons contradictoires. Reecrire avec node build/check-traductions.mjs --ecrire (jamais a la baisse sans --baisser).';
    fs.writeFileSync(fichierSeuils, JSON.stringify(nouveaux, null, 2) + '\n');
    console.log('[traductions] seuils enregistres dans ' + NOM_SEUILS);
    return;
  }

  const { m, erreurs, infos } = verifier(racine, { seuils });
  if (args.includes('--json')) { console.log(JSON.stringify({ seuils: seuilsAtteints(m), erreurs }, null, 2)); process.exit(erreurs.length ? 1 : 0); }
  for (const i of infos) console.log('[traductions] ' + i);
  if (!seuils) erreurs.push(`fichier de seuils absent (${NOM_SEUILS}) : node build/check-traductions.mjs --ecrire`);
  if (erreurs.length) {
    console.error('\n[traductions] ' + erreurs.length + ' probleme(s) :');
    for (const e of erreurs) console.error('  - ' + e);
    console.error('\n  Ajouter les traductions manquantes (lang/_additions6.js, fichier commun bureau / web : node build/check-noyaux-partages.mjs),\n  ou cloud/src/lib/coque-traductions.json pour la coque Next.');
    process.exit(1);
  }
  console.log('[traductions] couverture, derive web/bureau, ecrans prioritaires, gabarits, doublons, selecteur, coque : OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) principal();
