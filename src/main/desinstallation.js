'use strict';
/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * SUPPRESSION COMPLETE DES DONNEES DE MYFABMESH.AI (2026-09-30)
 *
 * Demande du user : « comment les utilisateurs peuvent desinstaller l'appli proprement, vraiment
 * desinstaller tout MyFabmesh (modeles, appli, ...) ». Constat : une desinstallation normale laissait
 * ~65 Go derriere elle — moteur d'IA (python, ~9 Go), modeles (hf_cache, ~49 Go), caches — et un
 * dossier de donnees DEPLACE sur un autre disque (Reglages > emplacement des donnees) n'etait jamais
 * touche. Le paquet du Store ne peut lancer aucun script de desinstallation : sans suppression depuis
 * l'appli, ce qui vit hors du conteneur restait pour toujours.
 *
 * Ce module, SANS Electron (tout passe par un contexte de dossiers explicite, donc testable sur un faux
 * arbre : build/test-desinstallation.mjs) :
 *   - dresse l'INVENTAIRE de ce que l'appli ecrit sur le PC, par categorie, avec les tailles ;
 *   - le SUPPRIME, avec progression ;
 *   - memorise les dossiers de donnees deplaces (temoin + registre) pour le desinstalleur NSIS
 *     (build/uninstaller.nsh), qui applique les MEMES listes (verifie par le test).
 *
 * REGLES DE SURETE — jamais une racine de disque, jamais un dossier que l'appli n'a pas cree :
 *   - dossier de l'appli : exactement %APPDATA%\myfabmesh-ai (et l'ancien %APPDATA%\fabmesh) ;
 *   - dossier deplace : son nom est « MyFabmesh-data » (impose par le selecteur de l'appli) ET il porte
 *     le temoin « .myfabmesh-data » pose par l'appli ; on n'y supprime QUE les sous-dossiers du moteur,
 *     puis le dossier lui-meme s'il est vide ;
 *   - dossier personnel, %TEMP%, Documents : uniquement des chemins ou prefixes exacts ;
 *   - on ne supprime que des chemins que le PLANIFICATEUR produit a partir du contexte (reverifie juste
 *     avant chaque suppression) ; un lien ou une jonction est supprime sans jamais suivre sa cible.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

/** Nom impose par le selecteur « emplacement des donnees » (main.js, pick-data-folder). */
const NOM_DOSSIER_DEPLACE = 'MyFabmesh-data';
/** Temoin pose par l'appli dans un dossier deplace : sans lui, le desinstalleur n'y touche pas. */
const TEMOIN = '.myfabmesh-data';
const CONTENU_TEMOIN = 'MyFabmesh.AI data folder (AI engine, models and caches).\r\n'
  + 'Created by MyFabmesh.AI. Removed when you uninstall it (or Settings > Remove all MyFabmesh data).\r\n';
/** Cle ou l'appli liste ses dossiers deplaces, relue par le desinstalleur (EnumRegValue). */
const CLE_REGISTRE = 'HKCU\\Software\\MyFabmesh.AI';
const CLE_REGISTRE_DOSSIERS = CLE_REGISTRE + '\\DataDirs';

/** Sous-dossiers du dossier de donnees LOURDES (HEAVY_DIR, main.js) : moteur d'IA, modeles, caches.
 *  Liste FERMEE : rien d'autre n'est supprime dans un dossier deplace. MEME liste dans
 *  build/uninstaller.nsh (MfmSupprimerMoteur). « ai-cache » et non « cache » : par defaut HEAVY_DIR
 *  est le dossier de l'appli, ou Chromium a deja son « Cache » (meme nom sous Windows). */
const DOSSIERS_MOTEUR = [
  'python', 'python-rig', 'python-segment', 'puppeteer', 'SkinTokens', 'SAMPart3D', 'PartSAM',
  'hf_cache', 'ai-cache', 'ai-tmp',
];
/** Creations du user dans le dossier de l'appli : gardees sauf demande explicite. */
const DOSSIERS_PROJETS = ['images', 'meshes', 'previews', 'history', 'projets_vides'];
/** Gardes AVEC les projets : noms d'affichage des projets, code du controle parental... */
const FICHIERS_CONFIG = ['config.json', 'config.json.bak'];
/** Fichiers de l'appli dans son dossier (hors moteur et projets) : etats, journaux, jetons, certificats. */
const FICHIERS_APPLI = [
  'logs', 'paused_jobs', 'config.json.tmp', 'setup_state.json', 'setup_state.json.backup',
  'certificats-systeme.pem', 'certificats-systeme.pem.tmp', 'cloud_session.json', '.mcp_bridge_token',
  'renderer.log', 'wizard.log', 'wizard.prev.log',
];
/** Laisses dans le dossier personnel par d'anciennes versions (les nouvelles ecrivent dans HEAVY_DIR\cache). */
const RESIDUS_PERSO = [
  { rel: ['.u2net', 'u2net.onnx'], parentSiVide: true },
  { rel: ['.u2net', 'u2net.onnx.part'], parentSiVide: true },
  { rel: ['.cache', 'realesrgan_weights'], parentSiVide: false },
  { rel: ['.flex_gemm', 'autotune_cache.json'], parentSiVide: true },
  { rel: ['.fabmesh', 'test_api_token.txt'], parentSiVide: true },
];
/** Modeles que l'appli installee telecharge. D'anciennes versions (serveur d'images lance sans HF_HOME)
 *  en ont mis dans le cache Hugging Face PARTAGE (~/.cache/huggingface/hub), que d'autres logiciels d'IA
 *  peuvent aussi utiliser : proposes a part, decoches par defaut, jamais supprimes par le desinstalleur. */
const MODELES_HF_PARTAGES = [
  'microsoft/TRELLIS.2-4B', 'facebook/dinov3-vitl16-pretrain-lvd1689m', 'camenduru/dinov3-vitl16-pretrain-lvd1689m',
  'SG161222/RealVisXL_V4.0', 'ByteDance/SDXL-Lightning', 'diffusers/stable-diffusion-xl-1.0-inpainting-0.1',
  'xinsir/controlnet-openpose-sdxl-1.0', 'xinsir/controlnet-tile-sdxl-1.0', 'xinsir/controlnet-union-sdxl-1.0',
  'h94/IP-Adapter', 'microsoft/Florence-2-large', 'Salesforce/blip-image-captioning-large',
  'CIDAS/clipseg-rd64-refined', 'madebyollin/sdxl-vae-fp16-fix', 'egeorcun/lucida',
  'Falconsai/nsfw_image_detection', 'michellejieli/NSFW_text_classifier', 'facebook/opt-350m',
];
/** Entrees de %TEMP% creees par l'appli et ses scripts (anciennes versions : TMPDIR n'etait pas redirige). */
const PREFIXES_TEMP = [
  'fabmesh_', 'myfabmesh', 'rig_complet_', 'skintokens_code_', 'detail_synth_', 'fbxmotion_',
  'puppeteer_', 'unirig_', 'anytop_', 'kimodo_', '_pup_fbx2glb.py',
];
/** Profondeur jusqu'a laquelle on retient les tailles (progression de la suppression). */
const PROFONDEUR_CARTE = 3;

const _estWin = process.platform === 'win32';
function _cle(p) {
  const r = path.resolve(String(p)).replace(/[\\/]+$/, '');
  return _estWin ? r.toLowerCase() : r;
}
function memeChemin(a, b) { return !!a && !!b && _cle(a) === _cle(b); }
function estAbsolu(p) { return typeof p === 'string' && p.trim().length > 0 && path.isAbsolute(p); }
function estRacine(p) {
  const abs = path.resolve(String(p));
  return _cle(abs) === _cle(path.parse(abs).root);
}
function _existe(p) { try { fs.lstatSync(p); return true; } catch (_) { return false; } }
function _estFichier(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }

/** Dossiers qui ne sont JAMAIS une cible ni une base (defense en profondeur). */
function _interdits(ctx) {
  const l = [ctx.home, ctx.documents, ctx.desktop, ctx.downloads, ctx.appData, ctx.localAppData, ctx.temp,
    ctx.installDir, process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
    process.env.ProgramData, process.env.PUBLIC];
  if (ctx.home) l.push(path.dirname(ctx.home));
  return new Set(l.filter((x) => estAbsolu(x)).map(_cle));
}

/** Dossier de l'appli : exactement %APPDATA%\myfabmesh-ai (ou l'ancien %APPDATA%\fabmesh). */
function dossierAppliValide(d, ctx) {
  if (!estAbsolu(d) || !estAbsolu(ctx.appData)) return false;
  const abs = path.resolve(d);
  return memeChemin(path.dirname(abs), ctx.appData)
    && ['myfabmesh-ai', 'fabmesh'].includes(path.basename(abs).toLowerCase());
}

/** Dossier de donnees deplace sur lequel on peut agir. Le temoin n'est pas exige pour le dossier
 *  ACTUELLEMENT utilise par l'appli (elle l'y pose au demarrage ; un echec d'ecriture ne doit pas
 *  empecher de le vider depuis l'appli). Le desinstalleur, lui, l'exige toujours. */
function dossierDeplaceValide(d, ctx, opts = {}) {
  if (!estAbsolu(d)) return { ok: false, raison: 'relative path' };
  const abs = path.resolve(d);
  if (estRacine(abs)) return { ok: false, raison: 'drive root' };
  if (path.basename(abs).toLowerCase() !== NOM_DOSSIER_DEPLACE.toLowerCase()) return { ok: false, raison: 'unexpected folder name' };
  if (_interdits(ctx).has(_cle(abs))) return { ok: false, raison: 'system folder' };
  if (!_estFichier(path.join(abs, TEMOIN)) && !opts.estActuel) return { ok: false, raison: 'no MyFabmesh marker' };
  return { ok: true, chemin: abs };
}

/* ───────────────────────────── PLANIFICATION ─────────────────────────────
 * Contexte : { userData, appData, localAppData, temp, home, documents, desktop, downloads, installDir,
 *              dossierActuel (HEAVY_DIR), dossiersDonnees: [..] (actuel + anciens dossiers deplaces),
 *              hubHfPartage (cache Hugging Face partage du user, facultatif) }
 * Categories : moteur (moteur d'IA, modeles, caches), reglages (etats, journaux, temporaires),
 *              config (gardee avec les projets), projets (creations du user, supprimees sur demande),
 *              partage (nos modeles dans le cache partage, supprimes sur demande). */
function planifier(ctx) {
  const elements = [];
  const refus = [];
  const vus = new Set();
  const ajouter = (categorie, chemin, extra = {}) => {
    const abs = path.resolve(chemin);
    const k = _cle(abs);
    if (vus.has(k)) return;
    vus.add(k);
    elements.push({ categorie, chemin: abs, ...extra });
  };

  // 1. Dossier de l'appli. Son profil Electron (caches du navigateur, stockage local) n'est PAS liste :
  //    verrouille tant que l'appli tourne, il part avec la desinstallation (ou le conteneur du Store).
  if (ctx.userData && dossierAppliValide(ctx.userData, ctx)) {
    for (const n of DOSSIERS_MOTEUR) ajouter('moteur', path.join(ctx.userData, n));
    for (const n of FICHIERS_APPLI) ajouter('reglages', path.join(ctx.userData, n));
    for (const n of FICHIERS_CONFIG) ajouter('config', path.join(ctx.userData, n));
    for (const n of DOSSIERS_PROJETS) ajouter('projets', path.join(ctx.userData, n));
  } else if (ctx.userData) {
    refus.push({ chemin: ctx.userData, raison: 'unexpected app folder' });
  }

  // 2. Ancien dossier (%APPDATA%\fabmesh : nom de l'appli avant 2026, journal de demarrage, vignettes
  //    de mouvements). Entierement a nous ; ses anciens projets suivent le choix du user.
  if (estAbsolu(ctx.appData)) {
    const ancien = path.join(ctx.appData, 'fabmesh');
    let noms = [];
    try { noms = fs.readdirSync(ancien); } catch (_) {}
    for (const n of noms) {
      const cat = DOSSIERS_PROJETS.includes(n) ? 'projets' : (FICHIERS_CONFIG.includes(n) ? 'config' : 'reglages');
      ajouter(cat, path.join(ancien, n));
    }
    if (noms.length) ajouter('reglages', ancien, { dossierSiVide: true });
  }

  // 3. Dossiers de donnees deplaces (actuel + anciens) : uniquement les sous-dossiers du moteur.
  for (const d of (ctx.dossiersDonnees || [])) {
    if (!d || memeChemin(d, ctx.userData)) continue;
    const v = dossierDeplaceValide(d, ctx, { estActuel: memeChemin(d, ctx.dossierActuel) });
    if (!v.ok) { if (_existe(d)) refus.push({ chemin: path.resolve(d), raison: v.raison }); continue; }
    for (const n of DOSSIERS_MOTEUR) ajouter('moteur', path.join(v.chemin, n), { base: v.chemin });
    ajouter('moteur', path.join(v.chemin, TEMOIN), { base: v.chemin, temoin: true });
    ajouter('moteur', v.chemin, { dossierSiVide: true, base: v.chemin });
  }

  // 4. Cache de mise a jour (electron-updater : %LOCALAPPDATA%\myfabmesh-ai-updater).
  if (estAbsolu(ctx.localAppData)) ajouter('reglages', path.join(ctx.localAppData, 'myfabmesh-ai-updater'));

  // 5. %TEMP% : entrees aux prefixes de l'appli et de ses scripts.
  if (estAbsolu(ctx.temp) && !estRacine(ctx.temp)) {
    let noms = [];
    try { noms = fs.readdirSync(ctx.temp); } catch (_) {}
    for (const n of noms) {
      const bas = n.toLowerCase();
      if (PREFIXES_TEMP.some((p) => bas.startsWith(p.toLowerCase()))) ajouter('reglages', path.join(ctx.temp, n));
    }
  }

  // 6. Dossier personnel : fichiers exacts laisses par d'anciennes versions (modeles de detourage et
  //    d'agrandissement, reglage des noyaux 3D, jeton de l'API de pilotage).
  if (estAbsolu(ctx.home) && !estRacine(ctx.home)) {
    for (const r of RESIDUS_PERSO) {
      const p = path.join(ctx.home, ...r.rel);
      ajouter('moteur', p, r.parentSiVide ? { parentSiVide: path.dirname(p) } : {});
    }
  }

  // 7. Exports d'animation (Documents\MyFabmesh\exports) : des creations, supprimees avec les projets.
  if (estAbsolu(ctx.documents) && !estRacine(ctx.documents)) {
    const racine = path.join(ctx.documents, 'MyFabmesh');
    ajouter('projets', path.join(racine, 'exports'), { parentSiVide: racine });
  }

  // 8. Nos modeles dans le cache Hugging Face PARTAGE (categorie a part, jamais cochee d'office). Le
  //    cache de l'appli elle-meme (hf_cache) n'est jamais pris pour le cache partage.
  const hubPartage = estAbsolu(ctx.hubHfPartage) ? ctx.hubHfPartage
    : (estAbsolu(ctx.home) ? path.join(ctx.home, '.cache', 'huggingface', 'hub') : null);
  const hubsAppli = [ctx.userData, ...(ctx.dossiersDonnees || [])].filter(estAbsolu).map((d) => path.join(d, 'hf_cache', 'hub'));
  if (hubPartage && !estRacine(hubPartage) && !hubsAppli.some((h) => memeChemin(h, hubPartage))) {
    for (const depot of MODELES_HF_PARTAGES) {
      ajouter('partage', path.join(hubPartage, 'models--' + depot.replace('/', '--')));
    }
  }

  // Filet final : aucune cible interdite (racine, dossier personnel, Windows...).
  const interdits = _interdits(ctx);
  const surs = elements.filter((e) => {
    if (estRacine(e.chemin) || interdits.has(_cle(e.chemin))) { refus.push({ chemin: e.chemin, raison: 'protected folder' }); return false; }
    return true;
  });
  return { elements: surs, refus };
}

/* ───────────────────────────── TAILLES ───────────────────────────── */
function _limiteur(n) {
  let actifs = 0;
  const file = [];
  const suivant = () => {
    if (actifs >= n || !file.length) return;
    actifs++;
    const { f, ok, ko } = file.shift();
    Promise.resolve().then(f).then(ok, ko).finally(() => { actifs--; suivant(); });
  };
  return (f) => new Promise((ok, ko) => { file.push({ f, ok, ko }); suivant(); });
}

async function _taille(p, prof, carte, lim) {
  let st;
  try { st = await lim(() => fsp.lstat(p)); } catch (_) { return 0; }
  if (st.isSymbolicLink()) return 0;                     // un lien ne libere rien (on ne suit jamais sa cible)
  if (!st.isDirectory()) return st.size;
  let noms = [];
  try { noms = await lim(() => fsp.readdir(p)); } catch (_) { return 0; }
  const tailles = await Promise.all(noms.map((n) => _taille(path.join(p, n), prof + 1, carte, lim)));
  const t = tailles.reduce((a, b) => a + b, 0);
  if (carte && prof <= PROFONDEUR_CARTE) carte.set(_cle(p), t);
  return t;
}

/** Mesure chaque element (existe / octets) et retient les tailles des premiers niveaux (progression). */
async function mesurer(plan) {
  const lim = _limiteur(32);
  const carte = new Map();
  await Promise.all(plan.elements.map(async (e) => {
    e.existe = _existe(e.chemin);
    e.octets = (e.existe && !e.dossierSiVide) ? await _taille(e.chemin, 0, carte, lim) : 0;
  }));
  plan.carte = carte;
  return plan;
}

/** Totaux par categorie (seulement ce qui existe). */
function resumer(plan) {
  const r = {};
  for (const c of ['moteur', 'reglages', 'config', 'projets', 'partage']) r[c] = { octets: 0, nombre: 0 };
  for (const e of plan.elements) {
    if (!e.existe || e.dossierSiVide) continue;
    r[e.categorie].octets += e.octets || 0;
    r[e.categorie].nombre += 1;
  }
  return r;
}

/* ───────────────────────────── SUPPRESSION ───────────────────────────── */
async function _supprimerChemin(p, prof, carte, surOctets, echecs) {
  let st;
  try { st = await fsp.lstat(p); } catch (e) {
    if (e && e.code !== 'ENOENT') echecs.push({ chemin: p, code: e.code || 'ERR' });
    return;
  }
  if (st.isSymbolicLink()) {                           // lien / jonction : le lien seul, jamais sa cible
    try { await fsp.unlink(p); } catch (e) {
      try { await fsp.rmdir(p); } catch (e2) { echecs.push({ chemin: p, code: (e2 && e2.code) || 'ERR' }); }
    }
    return;
  }
  if (st.isDirectory() && prof < PROFONDEUR_CARTE) {  // on descend pour faire avancer la progression
    let noms = [];
    try { noms = await fsp.readdir(p); } catch (e) { echecs.push({ chemin: p, code: (e && e.code) || 'ERR' }); return; }
    for (const n of noms) await _supprimerChemin(path.join(p, n), prof + 1, carte, surOctets, echecs);
    try { await fsp.rmdir(p); } catch (e) {
      if (e && e.code !== 'ENOENT' && e.code !== 'ENOTEMPTY') echecs.push({ chemin: p, code: e.code || 'ERR' });
    }
    return;
  }
  const taille = st.isDirectory() ? ((carte && carte.get(_cle(p))) || 0) : st.size;
  try {
    await fsp.rm(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
    surOctets(taille);
  } catch (e) {
    echecs.push({ chemin: p, code: (e && e.code) || 'ERR' });
  }
}

/**
 * Supprime le plan. N'agit que sur des chemins que planifier(ctx) produit ENCORE au moment de la
 * suppression. Options : supprimerProjets (projets + config), supprimerPartages (nos modeles dans le
 * cache partage), surProgression({ octets }).
 * Rend { liberes, echecs: [{ chemin, code }], dossiersRetires: [dossiers deplaces supprimes] }.
 */
async function supprimer(plan, ctx, opts = {}) {
  const autorises = new Set(planifier(ctx).elements.map((e) => _cle(e.chemin)));
  const garder = (e) => (!opts.supprimerProjets && (e.categorie === 'projets' || e.categorie === 'config'))
    || (!opts.supprimerPartages && e.categorie === 'partage');
  const echecs = [];
  let liberes = 0;
  const surOctets = (n) => {
    liberes += n || 0;
    if (typeof opts.surProgression === 'function') { try { opts.surProgression({ octets: liberes }); } catch (_) {} }
  };
  const carte = plan.carte || new Map();
  const echecsParBase = new Map();

  // Ordre : contenus d'abord, temoins ensuite (seulement si leur dossier a ete vide), dossiers vides a la fin.
  const contenus = plan.elements.filter((e) => !e.temoin && !e.dossierSiVide && !garder(e));
  for (const e of contenus) {
    if (!autorises.has(_cle(e.chemin))) { echecs.push({ chemin: e.chemin, code: 'REFUSED' }); continue; }
    const avant = echecs.length;
    await _supprimerChemin(e.chemin, 0, carte, surOctets, echecs);
    if (e.base && echecs.length > avant) echecsParBase.set(_cle(e.base), true);
    if (e.parentSiVide) { try { fs.rmdirSync(e.parentSiVide); } catch (_) {} }
  }
  // Temoin d'un dossier deplace : retire seulement si TOUT son moteur est parti (sinon le desinstalleur
  // doit pouvoir y revenir). Le dossier lui-meme n'est retire que s'il est vide (fichiers du user gardes).
  for (const e of plan.elements.filter((x) => x.temoin && !garder(x))) {
    if (!autorises.has(_cle(e.chemin)) || echecsParBase.get(_cle(e.base))) continue;
    try { fs.unlinkSync(e.chemin); surOctets(e.octets || 0); } catch (_) {}
  }
  const dossiersRetires = [];
  for (const e of plan.elements.filter((x) => x.dossierSiVide && !garder(x))) {
    if (!autorises.has(_cle(e.chemin))) continue;
    try { fs.rmdirSync(e.chemin); } catch (_) {}      // non recursif : seulement s'il est vide
    if (e.base && !echecsParBase.get(_cle(e.base))) dossiersRetires.push(e.chemin);
  }
  return { liberes, echecs, dossiersRetires };
}

/* ───────────────────────── DOSSIERS DEPLACES : MEMOIRE ─────────────────────────
 * L'appli pose le temoin dans chaque dossier deplace qu'elle utilise et l'inscrit dans le registre
 * (HKCU\Software\MyFabmesh.AI\DataDirs), ou le desinstalleur NSIS le retrouve. */
function nomValeurRegistre(d) {
  return 'd' + crypto.createHash('sha1').update(_cle(d)).digest('hex').slice(0, 12);
}
/** Pose le temoin si le dossier est bien un dossier de donnees deplace (nom attendu, pas une racine). */
function poserTemoin(d) {
  if (!estAbsolu(d) || estRacine(d)) return false;
  if (path.basename(path.resolve(d)).toLowerCase() !== NOM_DOSSIER_DEPLACE.toLowerCase()) return false;
  try {
    if (!fs.statSync(d).isDirectory()) return false;
    const t = path.join(d, TEMOIN);
    if (!_estFichier(t)) fs.writeFileSync(t, CONTENU_TEMOIN);
    return true;
  } catch (_) { return false; }
}
/** Arguments de `reg.exe` pour inscrire / retirer un dossier (execFile, sans shell). */
function argsRegistreAjout(d) {
  return ['add', CLE_REGISTRE_DOSSIERS, '/v', nomValeurRegistre(d), '/t', 'REG_SZ', '/d', path.resolve(d), '/f'];
}
function argsRegistreRetrait(d) {
  return ['delete', CLE_REGISTRE_DOSSIERS, '/v', nomValeurRegistre(d), '/f'];
}

/* ───────────────────────── ARRET DES PROCESSUS ─────────────────────────
 * Script PowerShell (meme logique que MfmArreterProcessus dans build/uninstaller.nsh) : arrete les
 * processus dont l'executable est dans un de nos dossiers (python du moteur, jobs mis en pause d'une
 * session precedente) ou dont la ligne de commande execute un de nos scripts. Les chemins passent par
 * des variables d'environnement (aucune injection possible). Le processus de l'appli et ses
 * processus Electron (meme executable) sont exclus. */
const SCRIPT_ARRET = [
  "$d=@($env:MFM_DOSSIERS -split '\\|'|?{$_.Length -gt 6}|%{$_.TrimEnd('\\')+'\\'})",
  "$s=[string]$env:MFM_SCRIPTS; if($s.Length -gt 6){$s=$s.TrimEnd('\\')+'\\'}else{$s=$null}",
  "$x=[string]$env:MFM_EXE_APPLI; $q=0; [void][int]::TryParse([string]$env:MFM_PID_APPLI,[ref]$q)",
  "Get-CimInstance Win32_Process | ?{ $p=$_.ExecutablePath; $c=$_.CommandLine;"
    + " ($_.ProcessId -ne $PID) -and ($_.ProcessId -ne $q) -and (-not $x -or -not $p -or $p -ne $x) -and"
    + " ((($p) -and (@($d|?{$p.StartsWith($_,[StringComparison]::OrdinalIgnoreCase)}).Count -gt 0))"
    + " -or ($s -and $c -and $c.IndexOf($s,[StringComparison]::OrdinalIgnoreCase) -ge 0)) }"
    + " | %{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
].join('; ');

function environnementArret({ dossiers, scripts, exeAppli, pidAppli }) {
  const liste = (dossiers || []).filter((d) => estAbsolu(d) && !estRacine(d)).map((d) => path.resolve(d));
  return {
    MFM_DOSSIERS: liste.join('|'),
    MFM_SCRIPTS: (estAbsolu(scripts) && !estRacine(scripts)) ? path.resolve(scripts) : '',
    MFM_EXE_APPLI: exeAppli || '',
    MFM_PID_APPLI: String(pidAppli || 0),
  };
}

module.exports = {
  NOM_DOSSIER_DEPLACE, TEMOIN, CLE_REGISTRE, CLE_REGISTRE_DOSSIERS,
  DOSSIERS_MOTEUR, DOSSIERS_PROJETS, FICHIERS_CONFIG, FICHIERS_APPLI, RESIDUS_PERSO, PREFIXES_TEMP,
  MODELES_HF_PARTAGES,
  estRacine, memeChemin, dossierAppliValide, dossierDeplaceValide,
  planifier, mesurer, resumer, supprimer,
  nomValeurRegistre, poserTemoin, argsRegistreAjout, argsRegistreRetrait,
  SCRIPT_ARRET, environnementArret,
};
