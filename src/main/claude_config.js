'use strict';
/* CONFIGURATION DE CLAUDE DESKTOP (liaison MCP « fabmesh ») — 2026-10-01.
 *
 * LE PIEGE DECOUVERT CE JOUR : Claude Desktop installe par le STORE (paquet MSIX) ne lit PAS %APPDATA%\Claude. Windows lui sert une copie
 * privee dans %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json. L'ancien bouton « Connect » ecrivait
 * seulement %APPDATA%\Claude : l'appli affichait « Connected » et Claude ne voyait rien. Verifie sur ce PC : la copie privee existe (1,6 Ko, sans
 * l'entree fabmesh) a cote de la copie « reelle » (300 octets, avec l'entree).
 *
 * Regles reprises de l'ancien code, a ne pas relacher :
 *   - un fichier illisible n'est JAMAIS ecrase (il porte peut-etre les autres serveurs du user) ;
 *   - les autres serveurs sont conserves tels quels ;
 *   - on n'ecrit que dans une installation de Claude Desktop qui EXISTE (jamais de dossier cree pour une appli absente). */
const fs = require('fs');
const path = require('path');
const os = require('os');

const NOM_FICHIER = 'claude_desktop_config.json';

const _norm = (s) => String(s || '').replace(/[\\/]+/g, '\\').toLowerCase();

/** Fichiers de configuration a traiter, par ordre de preference (paquet Store d'abord). `env` surchargeable pour les essais. */
function cheminsConfig(env = process.env) {
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cibles = [];
  // paquets Store : %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude (existe des que l'appli a ete lancee une fois)
  try {
    const paquets = path.join(local, 'Packages');
    for (const d of fs.readdirSync(paquets)) {
      if (!/^Claude_[0-9a-z]+$/i.test(d)) continue;
      const dossier = path.join(paquets, d, 'LocalCache', 'Roaming', 'Claude');
      if (fs.existsSync(dossier)) cibles.push({ type: 'store', dossier, fichier: path.join(dossier, NOM_FICHIER) });
    }
  } catch (_) { /* pas de dossier Packages */ }
  // installation classique
  const classique = path.join(appData, 'Claude');
  if (fs.existsSync(classique) || cibles.length === 0) {
    cibles.push({ type: 'classique', dossier: classique, fichier: path.join(classique, NOM_FICHIER) });
  }
  return cibles;
}

/** Lit un fichier de config. { existe, illisible, config } — « illisible » = present mais pas du JSON objet. */
function lire(fichier) {
  if (!fs.existsSync(fichier)) return { existe: false, illisible: false, config: {} };
  try {
    const brut = fs.readFileSync(fichier, 'utf-8').replace(/^\uFEFF/, '');
    if (!brut.trim()) return { existe: true, illisible: false, config: {} };
    const config = JSON.parse(brut);
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { existe: true, illisible: true, config: {} };
    return { existe: true, illisible: false, config };
  } catch (_) { return { existe: true, illisible: true, config: {} }; }
}

function _ecrire(fichier, config) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, JSON.stringify(config, null, 2), 'utf-8');
}

/** Ecrit (ou corrige) l'entree fabmesh dans UN fichier. { ok, change, erreur? }. */
function ecrireEntree(cible, entree) {
  const l = lire(cible.fichier);
  if (l.illisible) return { ok: false, erreur: 'unreadable' };
  const config = l.config;
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) config.mcpServers = {};
  const actuelle = config.mcpServers.fabmesh;
  if (actuelle && actuelle.command === entree.command && JSON.stringify(actuelle.args) === JSON.stringify(entree.args)) return { ok: true, change: false };
  config.mcpServers.fabmesh = entree;
  try { _ecrire(cible.fichier, config); } catch (e) { return { ok: false, erreur: String((e && e.message) || e) }; }
  return { ok: true, change: true };
}

/** Retire l'entree fabmesh d'UN fichier (le reste est conserve). { ok, change } */
function retirerEntree(cible) {
  const l = lire(cible.fichier);
  if (!l.existe || l.illisible) return { ok: !l.illisible, change: false };
  if (!l.config.mcpServers || !l.config.mcpServers.fabmesh) return { ok: true, change: false };
  delete l.config.mcpServers.fabmesh;
  try { _ecrire(cible.fichier, l.config); } catch (e) { return { ok: false, change: false, erreur: String((e && e.message) || e) }; }
  return { ok: true, change: true };
}

/** Script MCP designe par l'entree d'un fichier, ou null. */
function scriptDeEntree(cible) {
  const e = lire(cible.fichier).config.mcpServers;
  const f = e && e.fabmesh;
  if (!f) return null;
  const s = Array.isArray(f.args) ? f.args.find((a) => /mcp_server\.py$/i.test(String(a))) : null;
  return s || '';
}

/** Etat global : { connecte, ici }.
 *  - ici : TOUTES les installations de Claude Desktop trouvees ont une entree qui vise CETTE installation ;
 *  - connecte : une entree existe ET (une vise ailleurs OU toutes sont presentes). Une installation qui n'a PAS l'entree (cas du paquet Store
 *    avant ce correctif) ne compte pas comme reliee : Claude n'y verrait rien, l'appli doit proposer « Connect ». */
function etat(entreeVoulue, env) {
  const voulu = _norm(entreeVoulue.args[0]);
  let ici = 0, ailleurs = 0, absentes = 0;
  for (const c of cheminsConfig(env)) {
    const s = scriptDeEntree(c);
    if (s === null) { absentes++; continue; }
    if (s && _norm(s) === voulu) ici++; else ailleurs++;
  }
  const connecte = ailleurs > 0 || (ici > 0 && absentes === 0);
  return { connecte, ici: ailleurs === 0 && absentes === 0 && ici > 0 };
}

/** Ecrit l'entree dans TOUTES les installations de Claude Desktop trouvees. { ok, ecrits, echecs, fichiers } */
function relier(entree, env) {
  const cibles = cheminsConfig(env);
  const res = cibles.map((c) => Object.assign({ cible: c }, ecrireEntree(c, entree)));
  const ecrits = res.filter((r) => r.ok);
  return { ok: ecrits.length > 0, ecrits: ecrits.length, echecs: res.filter((r) => !r.ok).map((r) => r.erreur), fichiers: res.map((r) => r.cible.fichier), detail: res };
}

function delier(env) {
  const res = cheminsConfig(env).map((c) => retirerEntree(c));
  return { ok: res.every((r) => r.ok) };
}

/** Pour l'automatique au demarrage : ne cree RIEN si Claude Desktop est absent. Renvoie le nombre de fichiers corriges. */
function assurerSiPresent(entree, env) {
  let n = 0;
  for (const c of cheminsConfig(env)) {
    if (!fs.existsSync(c.dossier)) continue;                 // appli absente : on ne cree pas son dossier
    const r = ecrireEntree(c, entree);
    if (r.ok && r.change) n++;
  }
  return n;
}

module.exports = { cheminsConfig, lire, ecrireEntree, retirerEntree, scriptDeEntree, etat, relier, delier, assurerSiPresent };
