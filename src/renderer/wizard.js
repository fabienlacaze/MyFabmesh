'use strict';

// ============================================================
// Wizard log forwarder — ships all console output to the main
// process so we get a single wizard.log file in %APPDATA%\fabmesh\.
// Critical because the wizard is the first-run experience: if it
// breaks for a user, this is where Sentry has not had time to
// attach yet, and the user has no app window to read logs from.
// ============================================================
(function _wizardLogShim() {
  const api = (typeof window !== 'undefined') ? window : {};
  const send = (level, args) => {
    try {
      const msg = Array.from(args).map((a) => {
        if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (_) { return String(a); }
      }).join(' ');
      if (api.electronAPI && api.electronAPI.send) {
        api.electronAPI.send('wizard-log', { level, msg });
      } else if (api.wizardAPI && api.wizardAPI.log) {
        api.wizardAPI.log({ level, msg });
      } else if (window.require) {
        try {
          window.require('electron').ipcRenderer.send('wizard-log', { level, msg });
        } catch (_) {}
      }
    } catch (_) {}
  };
  const wrap = (level, fn) => function (...args) { send(level, args); try { return fn.apply(console, args); } catch (_) {} };
  console.log   = wrap('log',   console.log);
  console.info  = wrap('info',  console.info);
  console.warn  = wrap('warn',  console.warn);
  console.error = wrap('error', console.error);
  console.debug = wrap('debug', console.debug);
  window.addEventListener('error', (e) => send('error', [`window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`, e.error && e.error.stack]));
  window.addEventListener('unhandledrejection', (e) => send('error', ['unhandledrejection:', e.reason && e.reason.stack ? e.reason.stack : String(e.reason)]));
  send('boot', ['wizard.js loaded at ' + new Date().toISOString() + ' — UA: ' + navigator.userAgent]);
})();

/* ═══════════════════════════════════════════════════════════════════
   JOURNAL DE PARCOURS

   Six refus de certification, six rapports décrivant un symptôme sans
   jamais dire QUEL ÉCRAN était affiché ni SUR QUELLE MACHINE. Ce journal
   comble ce trou : une ligne JSON par événement, versée dans le fichier
   de diagnostics que le bouton « Export logs » dépose sur le Bureau.

   Ne jamais y mettre de donnée personnelle : ni e-mail, ni jeton, ni
   chemin de projet. Uniquement matériel et navigation.
   ═══════════════════════════════════════════════════════════════════ */
const _t0 = Date.now();
// Pourcentage global au milieu de la barre de telechargement (2026-09-30) : ne recule jamais.
// ECHELLE UNIQUE (barre, pourcentage et jalons) : moteur d'IA 0-8, modeles 8-84 (images D'ABORD puis 3D, au prorata des Mo — meme ordre que le
// telechargement), moteur de rig 84-92, animation 92-100 (rien a telecharger : elle s'allume quand tout est fini).
const FIN_MOTEUR = 8, FIN_MODELES = 84, FIN_RIG = 92;
let _pctGlobal = 0;
function majGlobal(pct) {
  _pctGlobal = Math.max(_pctGlobal, Math.max(0, Math.min(100, pct)));
  const f = document.getElementById('dl-global-fill'), t = document.getElementById('dl-global-pct');
  if (f) f.style.width = _pctGlobal + '%';
  if (t) t.textContent = Math.floor(_pctGlobal) + ' %';
  majJalons();
}
// Jalons : un moteur est « fait » quand la barre a depasse sa position ; le premier non fait est « actif ».
function majJalons() {
  let actifPose = false;
  for (const j of document.querySelectorAll('.wiz-jalons:not(.wiz-jalons-test) .wiz-jalon')) {   // la page de verification a sa propre barre
    if (j.hidden) continue;
    const pos = parseFloat(j.style.left) || 0;
    const fait = _pctGlobal >= pos - 0.01;
    j.classList.toggle('fait', fait);
    j.classList.toggle('actif', !fait && !actifPose);
    if (!fait) actifPose = true;
  }
}
// Position de chaque jalon = FIN de sa phase sur l'echelle ci-dessus (3D = moteur 3D seul ; images = tous les autres modeles, analyseur d image compris).
// Ecart minimal : les pictogrammes et leurs libelles ne doivent pas se chevaucher.
function placerJalons(plan) {
  const tot = plan.total_mb || 0;
  const somme = (re) => (plan.items || []).filter((i) => re.test(i.id)).reduce((a, i) => a + i.size_mb, 0);
  // groupes : Models = modeles d'analyse et d'assistance (redacteur, analyseurs d'image, agrandisseur) ; Images = modeles de GENERATION d'image ;
  // 3D = moteur 3D seul. Positions = FIN de chaque groupe, proportionnelles aux tailles reelles (user : « garde la barre proportionnelle »).
  const gMod = somme(/^(writer|dinov3|blip1|florence2|esrgan)$/), g3d = somme(/^trellis/);
  const gImg = tot - gMod - g3d;
  const ECART = 6;
  const fin = (cumul) => (tot ? FIN_MOTEUR + (FIN_MODELES - FIN_MOTEUR) * cumul / tot : FIN_MOTEUR);
  let pos = FIN_MOTEUR;
  const poser = (cle, p, visible = true) => {
    const j = document.querySelector(`.wiz-jalons:not(.wiz-jalons-test) .wiz-jalon[data-j="${cle}"]`);
    if (!j) return;
    j.hidden = !visible;
    j.style.left = p.toFixed(1) + '%';
  };
  poser('engine', FIN_MOTEUR);
  const p1 = Math.max(pos + ECART, Math.min(FIN_MODELES - 3 * ECART, fin(gMod))); pos = p1;
  poser('models', p1, gMod > 0);
  const p2 = Math.max(pos + ECART, Math.min(FIN_MODELES - ECART, fin(gMod + gImg))); pos = p2;
  poser('img', p2, gImg > 0);
  poser('3d', FIN_MODELES, g3d > 0);
  poser('rig', FIN_RIG);
  poser('anim', 100);
  majJalons();
}
// ROUE + CHRONOMETRE (2026-09-30, user : « une circular bar qui tourne a gauche du pourcentage pour montrer que ca marche » et « un chronometre a
// droite du pourcentage, a la seconde »). La roue tourne tant que l'installation travaille ; coche verte a la fin, « ! » en cas d'arret.
let _chronoDebut = 0, _chronoMinuteur = null;
function _fmtDuree(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
}
function _chronoAfficher() {
  const el = document.getElementById('dl-chrono');
  if (el && _chronoDebut) el.textContent = _fmtDuree(Date.now() - _chronoDebut);
}
function etatProgression(etat) {   // 'marche' | 'fini' | 'avert' | 'erreur'
  const roue = document.getElementById('dl-roue');
  // BOUTON BACK VERROUILLE PENDANT L'INSTALLATION (user, 2026-09-30 : « une fois lance il faut verrouiller le bouton Back ») : revenir en arriere en
  // plein telechargement relancait une seconde chaine. Deverrouille seulement si l'installation echoue (jamais bloquer l'utilisateur).
  const retour = document.getElementById('btn-dl-back');
  if (retour) {
    if (etat === 'marche') { retour.disabled = true; retour.title = 'Installation in progress — please wait'; }
    else if (etat === 'erreur') { retour.disabled = false; retour.removeAttribute('title'); }
  }
  if (roue) roue.className = 'wiz-roue' + (etat === 'marche' ? '' : ' ' + etat);
  if (etat === 'marche') {
    if (!_chronoDebut) _chronoDebut = Date.now();
    if (!_chronoMinuteur) _chronoMinuteur = setInterval(_chronoAfficher, 1000);
  } else if (_chronoMinuteur) {
    clearInterval(_chronoMinuteur); _chronoMinuteur = null;
  }
  _chronoAfficher();
}

function journal(type, data) {
  try {
    const evt = { type, ms: Date.now() - _t0, etape: (typeof currentStep === 'string' ? currentStep : null), ...(data || {}) };
    if (window.wizardAPI && window.wizardAPI.journal) window.wizardAPI.journal(evt);
  } catch (_) { /* le journal ne doit JAMAIS casser l'assistant */ }
}

const STEPS = ['welcome', 'detect', 'mode', 'download', 'test', 'no-gpu'];
let currentStep = 'welcome';
let hwReport = null;
let chosenMode = null;

// Ouverture de session : la configuration visible depuis le renderer. Le
// matériel complet arrive plus tard, à la fin de la détection.
journal('session', {
  ecran: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
  fenetre: `${window.innerWidth}x${window.innerHeight}`,
  langue: navigator.language,
  langues: (navigator.languages || []).slice(0, 4),
  plateforme: navigator.platform,
  ua: navigator.userAgent,
  enLigne: navigator.onLine,
});
try {
  window.wizardAPI.getVersion().then((v) => journal('version', { version: v })).catch(() => {});
} catch (_) {}

// Toute erreur du renderer entre au journal : c'est elle qui expliquera un
// écran vide chez un testeur.
window.addEventListener('error', (e) => journal('erreur', {
  message: e.message, fichier: e.filename, ligne: e.lineno, pile: e.error && e.error.stack ? String(e.error.stack).slice(0, 900) : null,
}));
window.addEventListener('unhandledrejection', (e) => journal('erreur', {
  message: 'rejet non gere', detail: String(e.reason && e.reason.message ? e.reason.message : e.reason).slice(0, 500),
}));

// Tout clic sur un bouton, où qu'il soit. Le libellé est tronqué : on veut
// savoir sur quoi le testeur a appuyé, pas archiver l'interface.
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, a');
  if (!b) return;
  journal('clic', {
    id: b.id || null,
    libelle: (b.textContent || '').trim().slice(0, 40),
    inactif: b.disabled === true,
    cible: b.dataset ? (b.dataset.next || b.dataset.back || null) : null,
  });
}, true);  // capture : on journalise même si un gestionnaire arrête la propagation
// Track which steps have already been initialized so going Back/Next
// doesn't re-run detect / re-trigger a download / re-run the smoke test.
const initialized = new Set();

function goto(step) {
  if (!STEPS.includes(step)) {
    console.warn('[wizard] unknown step:', step);
    return;
  }
  console.log('[wizard] goto', currentStep, '->', step);
  journal('etape', { de: currentStep, vers: step });
  for (const s of STEPS) {
    document.getElementById(`page-${s}`).classList.toggle('active', s === step);
    const head = document.querySelector(`.wiz-step-tag[data-step="${s}"]`);
    if (head) {
      head.classList.toggle('active', s === step);
      head.classList.toggle('done', STEPS.indexOf(s) < STEPS.indexOf(step));
    }
  }
  currentStep = step;
  // Only initialize a step ONCE — back-navigation must not re-trigger
  // the detect / download / test side-effects. `initialized` n'est marqué
  // qu'en cas de SUCCÈS (voir runDetect) : un échec de détection doit pouvoir
  // être retenté, sinon le wizard devient un cul-de-sac (cert Store 10.1.2.10).
  if (step === 'detect' && !initialized.has('detect')) {
    runDetect();
  }
  if (step === 'mode' && hwReport) {
    // Safe to call every time — just re-renders the card states.
    renderModeCards();
    renderDataLocation();
  }
  if (step === 'no-gpu') {
    renderNoGpuPage();
    // Les étapes « Download » / « Test » ne concernent pas le parcours Cloud :
    // les afficher laisse croire qu'un téléchargement de plusieurs Go reste à
    // venir.
    for (const s of ['download', 'test']) {
      const tag = document.querySelector(`.wiz-step-tag[data-step="${s}"]`);
      if (tag) tag.classList.add('hidden');
    }
  }
  if (step === 'download' && !initialized.has('download')) {
    initialized.add('download'); startDownload();
  }
  if (step === 'test' && !initialized.has('test')) {
    initialized.add('test'); runFinalTest();
  }
}

// Une machine ne peut faire tourner les moteurs locaux QUE si elle a un GPU
// NVIDIA avec assez de VRAM. Test tolérant (JSON partiel, casse, futur
// changement de hw_detect) : tout ce qui n'est pas explicitement un GPU NVIDIA
// exploitable part sur le parcours Cloud.
function needsCloudPath() {
  if (!hwReport) return true;
  const reco = String(hwReport.recommended_mode || '').toLowerCase();
  if (reco === 'cloud') return true;
  const gpu = hwReport.gpu;
  if (!gpu || String(gpu.vendor || '').toUpperCase() !== 'NVIDIA') return true;
  return false;
}

// Use closest() so clicks land even on inner elements (icons, spans).
// Also: ignore clicks on disabled buttons (browsers already prevent
// activation, but closest would otherwise still match and trigger goto).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-back], [data-next]');
  if (!btn || btn.disabled) return;
  let target = btn.dataset.next || btn.dataset.back;
  // If user is leaving Detect to go to Mode but hardware is incompatible,
  // detour to the dedicated no-gpu page instead.
  if (target === 'mode' && needsCloudPath()) {
    target = 'no-gpu';
  }
  // Mode « Cloud » choisi explicitement sur la page Mode : pas de download.
  if (target === 'download' && chosenMode === 'cloud') {
    target = 'no-gpu';
  }
  goto(target);
});

// SIGNUP_URL a été retiré avec le bouton « Create a free account » : plus
// aucun code de l'assistant n'ouvre le navigateur. L'inscription se fait
// depuis la modale de connexion de l'application, au moment où elle sert.

// « credits / image » : prix d'une image a la qualite par defaut (30 pas), LU
// dans la grille publique (/api/pricing, via cloudPricing) — le « 3 » etait
// ecrit en dur dans wizard.html (2026-09-30). Grille injoignable : la case
// reste masquee, pas de chiffre invente.
function _majPrixImageAssistant() {
  const bloc = document.getElementById('wiz-fact-prix-image');
  const val = document.getElementById('wiz-fact-prix-image-val');
  const api = window.meshyAPI;
  if (!bloc || !val || !api || typeof api.cloudPricing !== 'function') return;
  api.cloudPricing({}).then((r) => {
    const t = r && r.success && r.prices ? r.prices.text2image : null;
    if (typeof t !== 'number') return;
    // formule du worker a 30 pas (_prixImageSelonPas) : jamais moins d'1 credit
    val.textContent = String(Math.max(1, Math.round(t)));
    bloc.hidden = false;
  }).catch(() => {});
}

// Titre/texte de la page no-gpu adaptés au matériel réel : la page s'affiche
// AUSSI pour un GPU NVIDIA à VRAM insuffisante (< 12 Go), où « No NVIDIA GPU
// detected » serait faux.
function renderNoGpuPage() {
  _majPrixImageAssistant();
  const title = document.getElementById('nogpu-title');
  const lead = document.getElementById('nogpu-lead');
  if (!title || !lead) return;
  const gpu = hwReport && hwReport.gpu;
  const isNvidia = !!(gpu && String(gpu.vendor || '').toUpperCase() === 'NVIDIA');

  // CHOIX VOLONTAIRE — cette page s'affiche AUSSI quand l'utilisateur retient
  // « Cloud » sur la page Mode alors que sa machine peut tout faire en local
  // (goto() reroute 'download' vers 'no-gpu' dans ce cas). On lui disait alors
  // que son GPU etait insuffisant : constate le 2026-08-18 sur une RTX 5080 de
  // 16 Go, a qui la page reprochait d'etre « below the 12 GB ». C'est faux, et
  // c'est le genre d'incoherence qu'un testeur releve.
  if (!needsCloudPath()) {
    title.textContent = 'Cloud mode selected';
    lead.innerHTML = 'You chose to generate in the MyFabmesh cloud'
      + (gpu && gpu.model ? ` rather than on your <b>${gpu.model}</b>` : '')
      + '. <b>Everything works the same</b> — images, 3D meshes, rigs and animations are '
      + 'generated on our servers and downloaded straight into your projects. You can switch '
      + 'back to local mode at any time from the settings.';
    return;
  }

  if (isNvidia) {
    const gb = Math.round((gpu.vram_mb || 0) / 1024);
    title.textContent = 'Cloud mode will be used on this PC';
    lead.innerHTML = `Your GPU (<b>${gpu.model}</b>${gb ? `, ${gb} GB VRAM` : ''}) is below the 12 GB `
      + 'the local 3D engine needs, so it would run out of memory. <b>The app will run in Cloud mode '
      + 'instead: everything still works</b> — images, 3D meshes, rigs and animations are generated on '
      + 'the MyFabmesh cloud and downloaded straight into your projects.';
  } else if (gpu) {
    title.textContent = 'Cloud mode will be used on this PC';
    lead.innerHTML = `This device uses <b>${gpu.model}</b> graphics. The local AI models need an NVIDIA `
      + 'GPU, so <b>the app will run in Cloud mode instead: everything still works</b> — images, 3D '
      + 'meshes, rigs and animations are generated on the MyFabmesh cloud and downloaded straight into '
      + 'your projects.';
  }
  // Sinon : le texte par défaut du HTML (aucun GPU rapporté) est correct.
}

// La page « no-gpu » n'a plus qu'UNE action primaire, « Continue in Cloud
// mode », et la navigation « Back ». Les deux boutons qui ouvraient le
// navigateur ont été retirés de wizard.html, leurs gestionnaires avec eux :
//
//   - « Use the website instead » (btn-open-cloud) proposait au testeur de
//     quitter l'application au moment précis où elle venait de lui annoncer
//     qu'elle savait se débrouiller sans GPU ;
//   - « Create a free account » (btn-create-account) ouvrait lui aussi le
//     navigateur. L'inscription reste accessible là où elle sert : l'app
//     présente sa modale de connexion, lien d'inscription compris, dès qu'une
//     action cloud le demande (`needsCloudLogin`).
//
// Cette page est vue par TOUT testeur de certification — ils sont toujours sur
// une machine sans GPU NVIDIA. Elle doit poser une décision, pas un menu.

// ---------- STEP 2: detect ----------
async function runDetect() {
  const status = document.getElementById('detect-status');
  const retryBtn = document.getElementById('btn-detect-retry');
  status.classList.remove('hidden', 'error');
  status.textContent = 'Checking your system (this takes a few seconds)...';
  if (retryBtn) retryBtn.classList.add('hidden');
  try {
    hwReport = await window.wizardAPI.detectHardware();
    if (!hwReport || typeof hwReport !== 'object') throw new Error('empty report');
    initialized.add('detect');
    // LA CONFIG de la machine. C'est ce qui manquait a chaque rapport de
    // certification : « observed on devices running OS build X » ne dit rien
    // du GPU, de la VRAM ni de la RAM de la machine de test.
    journal('config', {
      gpu: hwReport.gpu ? { vendeur: hwReport.gpu.vendor, modele: hwReport.gpu.model, vram_mo: hwReport.gpu.vram_mb, pilote: hwReport.gpu.driver } : null,
      ram_mo: hwReport.ram_mb,
      disque_libre_go: hwReport.disk_free_gb,
      mode_recommande: hwReport.recommended_mode,
      pilote_ok: hwReport.driver_ok,
      avertissements: hwReport.warnings || [],
      parcours_cloud: needsCloudPath(),
    });
  } catch (e) {
    // DÉGRADATION SÛRE : la détection ne doit jamais empêcher d'entrer dans
    // l'application. Sans rapport matériel exploitable on suppose « pas de GPU
    // NVIDIA » → parcours Cloud, qui ne télécharge rien et fonctionne partout.
    console.warn('[wizard] detect failed, falling back to Cloud mode:', (e && e.message) || e);
    hwReport = {
      gpu: null, ram_mb: 0, disk_free_gb: 0,
      recommended_mode: 'cloud', driver_ok: false,
      warnings: ['Hardware check unavailable on this PC — Cloud mode will be used (nothing to download).'],
    };
    status.classList.remove('hidden');
    status.textContent = 'Hardware check unavailable — MyFabmesh.AI will use Cloud mode. Click Continue.';
    if (retryBtn) retryBtn.classList.remove('hidden');
    document.getElementById('btn-detect-next').disabled = false;
    journal('config', { detection: 'ECHEC', raison: String((e && e.message) || e).slice(0, 200), repli: 'cloud' });
    return;
  }
  status.classList.add('hidden');
  document.getElementById('detect-results').classList.remove('hidden');

  const fmtGB = (mb) => (mb / 1024).toFixed(1) + ' GB';
  const gpu = hwReport.gpu;
  const setRow = (id, text, cls) => {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'wiz-val ' + (cls || '');
    // Chaque critère au journal avec son verdict : c'est exactement ce que le
    // testeur a sous les yeux sur la page « Checking your system ».
    journal('verdict', {
      critere: id.replace(/^r-/, ''),
      valeur: String(text).slice(0, 60),
      statut: cls === 'ok' ? 'PASS' : (cls === 'warn' ? 'AVERTISSEMENT' : (cls === 'bad' ? 'REJETE' : 'INCONNU')),
    });
  };

  if (gpu && String(gpu.vendor || '').toUpperCase() === 'NVIDIA') {
    setRow('r-gpu', `${gpu.model}`, 'ok');
    setRow('r-vram', gpu.vram_mb ? fmtGB(gpu.vram_mb) : 'unknown',
      gpu.vram_mb >= 12 * 1024 ? 'ok' : (gpu.vram_mb >= 6 * 1024 ? 'warn' : 'bad'));
    setRow('r-driver', gpu.driver || '–',
      hwReport.driver_ok ? 'ok' : 'warn');
  } else if (gpu) {
    // GPU Intel/AMD : ce n'est PAS une panne, c'est un choix de mode. Affichage
    // informatif (warn) et non « bad » — sinon le tableau matériel se lit comme
    // un diagnostic d'échec (retour de certification Store).
    setRow('r-gpu', `${gpu.model} — Cloud mode`, 'warn');
    setRow('r-vram', gpu.vram_mb ? fmtGB(gpu.vram_mb) : 'n/a', 'warn');
    setRow('r-driver', gpu.driver || 'n/a', 'warn');
  } else {
    setRow('r-gpu', 'No NVIDIA GPU — Cloud mode', 'warn');
    setRow('r-vram', 'n/a', 'warn');
    setRow('r-driver', 'n/a', 'warn');
  }
  const ramMb = hwReport.ram_mb || 0;
  setRow('r-ram', ramMb ? fmtGB(ramMb) : 'n/a',
    ramMb >= 16 * 1024 ? 'ok' : (ramMb >= 8 * 1024 ? 'warn' : 'bad'));
  const diskGb = hwReport.disk_free_gb || 0;
  // En parcours Cloud rien n'est téléchargé : l'espace disque n'est pas un
  // critère bloquant, on ne l'affiche donc pas en rouge.
  const diskCls = needsCloudPath() ? (diskGb >= 2 ? 'ok' : 'warn')
    : (diskGb >= 25 ? 'ok' : (diskGb >= 15 ? 'warn' : 'bad'));
  setRow('r-disk', diskGb + ' GB', diskCls);

  if (hwReport.warnings && hwReport.warnings.length) {
    const wbox = document.getElementById('detect-warnings');
    wbox.innerHTML = hwReport.warnings.map(w => `<div class="w">${w}</div>`).join('');
    wbox.classList.remove('hidden');
  }
  document.getElementById('btn-detect-next').disabled = false;
}

// Retry manuel de la détection (affiché uniquement après un échec).
document.getElementById('btn-detect-retry')?.addEventListener('click', () => {
  initialized.delete('detect');
  runDetect();
});

// ---------- STEP 3: mode ----------
// VRAM thresholds in MB. 16 GB cards (RTX 4080/5080) report ~16300 MB
// after driver overhead, so we use 15 GB as the Full threshold rather
// than a strict 16384 that would lock them out for ~80 MB of fluff.
// La carte « cloud » n'a AUCUNE exigence VRAM : elle reste toujours activable,
// pour qu'aucune machine ne puisse se retrouver avec toutes les cartes grisées.
const MODE_VRAM_REQ = { full: 15 * 1024, standard: 11 * 1024, lite: 11 * 1024, cloud: 0 };   // le moteur 3D fait OOM sous 12 Go : meme plancher que _recommendMode

function renderModeCards() {
  const reco = hwReport.recommended_mode;
  const vram = (hwReport.gpu && hwReport.gpu.vram_mb) || 0;
  const isNvidia = !!(hwReport.gpu && String(hwReport.gpu.vendor || '').toUpperCase() === 'NVIDIA');
  for (const card of document.querySelectorAll('.wiz-mode-card')) {
    const m = card.dataset.mode;
    card.classList.toggle('recommended', m === reco);
    // Les modes locaux exigent un GPU NVIDIA ET assez de VRAM ; 'cloud' jamais.
    const req = MODE_VRAM_REQ[m];
    const unavailable = (m !== 'cloud') && (!isNvidia || vram < (req || 0));
    card.classList.toggle('disabled', unavailable);
    const input = card.querySelector('input');
    if (input) input.disabled = unavailable;
  }
  // Auto-select reco if it's not disabled, otherwise the highest
  // available mode (full > standard > lite), Cloud en dernier recours.
  let target = reco;
  const cardFor = (m) => document.querySelector(`.wiz-mode-card[data-mode="${m}"]`);
  if (!cardFor(target) || cardFor(target).classList.contains('disabled')) {
    target = null;
    for (const m of ['full', 'standard', 'lite', 'cloud']) {
      const c = cardFor(m);
      if (c && !c.classList.contains('disabled')) { target = m; break; }
    }
  }
  // Aucune carte disponible (ne devrait plus arriver grâce à la carte Cloud) :
  // on ne laisse SURTOUT pas l'utilisateur bloqué avec Continue grisé.
  if (!target) { goto('no-gpu'); return; }
  const recoCard = cardFor(target);
  if (recoCard) {
    for (const c of document.querySelectorAll('.wiz-mode-card')) c.classList.remove('selected');
    recoCard.querySelector('input').checked = true;
    recoCard.classList.add('selected');
    chosenMode = target;
    journal('mode', { choisi: chosenMode, par: 'recommandation' });
    document.getElementById('btn-mode-next').disabled = false;
  }
  syncModeUI();
}

// Carte mise en avant + menu deroulant (2026-09-30) : reflet des 4 cartes d'origine, qui restent la source de verite.
const MODE_NOMS = { full: 'Full', standard: 'Standard', lite: 'Lite', cloud: 'Cloud' };
function syncModeUI() {
  const sel = document.getElementById('wiz-mode-select');
  const carte = document.querySelector('.wiz-mode-card.selected');
  if (!sel || !carte) return;
  const m = carte.dataset.mode, reco = hwReport && hwReport.recommended_mode;
  document.getElementById('wiz-mode-f-titre').textContent = MODE_NOMS[m] || m;
  document.getElementById('wiz-mode-f-taille').textContent = (carte.querySelector('.wiz-mode-size') || {}).textContent || '';
  document.getElementById('wiz-mode-f-desc').textContent = (carte.querySelector('.wiz-mode-desc') || {}).textContent || '';
  document.getElementById('wiz-mode-f-badge').hidden = (m !== reco);
  sel.innerHTML = '';
  for (const c of document.querySelectorAll('.wiz-mode-card')) {
    const mm = c.dataset.mode, nb = c.classList.contains('disabled');
    const o = document.createElement('option');
    o.value = mm;
    o.textContent = `${MODE_NOMS[mm] || mm} — ${(c.querySelector('.wiz-mode-size') || {}).textContent || ''}${mm === reco ? ' (recommended)' : ''}${nb ? ' — not available on this PC' : ''}`;
    o.disabled = nb;
    o.selected = (mm === m);
    sel.appendChild(o);
  }
}
document.getElementById('wiz-mode-select')?.addEventListener('change', (e) => {
  const c = document.querySelector(`.wiz-mode-card[data-mode="${e.target.value}"]`);
  if (c) c.click();
});

document.querySelectorAll('.wiz-mode-card').forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('disabled')) return;
    document.querySelectorAll('.wiz-mode-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    card.querySelector('input').checked = true;
    chosenMode = card.dataset.mode;
    journal('mode', { choisi: chosenMode, par: 'utilisateur' });
    document.getElementById('btn-mode-next').disabled = false;
    syncModeUI();
  });
});

// ---------- Data location (shown on the Mode step) ----------
async function renderDataLocation() {
  try {
    const loc = await window.wizardAPI.getDataLocation();
    const pathEl = document.getElementById('wiz-data-path');
    const freeEl = document.getElementById('wiz-data-free');
    if (pathEl) {
      pathEl.textContent = loc.isDefault ? 'Default (your user folder, on C:)' : loc.path;
      pathEl.title = loc.path;
    }
    if (freeEl) {
      freeEl.style.color = '';
      freeEl.textContent = loc.freeBytes ? '· ' + (loc.freeBytes / 1073741824).toFixed(0) + ' GB free' : '';
    }
  } catch (_) {}
}
(() => {
  const btn = document.getElementById('wiz-data-change');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await window.wizardAPI.pickDataFolder();
      if (r && r.ok) {
        await renderDataLocation();
        if (r.restartNeeded) {
          const ok = await wizConfirm({
            title: 'Restart to apply',
            body: 'MyFabmesh.AI will restart to use the new location:\n' + r.path + '\n\nNothing is downloaded yet, so this is instant.',
            okLabel: 'Restart now', cancelLabel: 'Later',
          });
          if (ok) { await window.wizardAPI.restartApp(); }
        }
      } else if (r && r.error) {
        const freeEl = document.getElementById('wiz-data-free');
        if (freeEl) { freeEl.style.color = 'var(--error)'; freeEl.textContent = '· ' + r.error; }
      }
    } catch (_) {}
    btn.disabled = false;
  });
})();

// ---------- STEP 4: download ----------
/* VERROU DE RE-ENTRANCE.
 *
 * `startDownload()` enchaine trois phases longues (pip, poids HuggingFace,
 * moteur de rig). Les liens « Retry » la rappelaient depuis le debut sans
 * annuler ce qui courait, sans verrou et sans se desactiver : deux chaines pip
 * pouvaient ecrire dans le meme environnement en meme temps. */
let _telechargementEnCours = false;
async function startDownload() {
  if (_telechargementEnCours) {
    console.warn('[wizard] startDownload deja en cours — appel ignore');
    try { journal('dl_reentrance', {}); } catch (_) {}
    return;
  }
  _telechargementEnCours = true;
  try { return await _startDownloadInterne(); }
  finally { _telechargementEnCours = false; }
}
// CATEGORIES DE LA LISTE DETAILLEE (user, 2026-09-30 : « mets des categories avec la bonne couleur et les icones ») : memes couleurs et memes pictogrammes
// que les jalons de la barre (l'icone est lue dans le jalon correspondant : une seule source).
const GROUPES = {
  engine: { titre: 'AI engine', couleur: '#e84d7a' }, models: { titre: 'Models', couleur: '#14b8a6' }, img: { titre: 'Images', couleur: '#4a90e2' },
  '3d': { titre: '3D', couleur: '#c35ce0' }, rig: { titre: 'Rig', couleur: '#f08a24' }, anim: { titre: 'Animation', couleur: '#22c55e' },
};
function groupeDeModele(id) {
  if (/^(writer|dinov3|blip1|florence2|esrgan)$/.test(id)) return 'models';
  if (/^trellis/.test(id)) return '3d';
  return 'img';
}
function enteteGroupe(cle) {
  const g = GROUPES[cle];
  const svg = document.querySelector(`.wiz-jalons:not(.wiz-jalons-test) .wiz-jalon[data-j="${cle}"] svg`);
  return `<div class="wiz-dl-groupe" data-groupe="${cle}" style="--cat:${g.couleur}">${svg ? svg.outerHTML : ''}<span>${g.titre}</span></div>`;
}
// LIGNES DU MOTEUR DE RIG (module : la liste COMPLETE est dessinee des le debut).
const RIG_LIGNES = [
  { id: '__rig_py', etapes: ['rig-copy-python', 'rig-pip-bootstrap'], nom: 'Rig engine — Python environment', taille: '', mo: 0, poids: 2 },
  { id: '__rig_torch', etapes: ['rig-torch'], nom: 'Rig engine — PyTorch', taille: '3338 MB', mo: 3338, poids: 60 },
  { id: '__rig_libs', etapes: ['rig-deps'], nom: 'Rig engine — libraries', taille: '~476 MB', mo: 476, poids: 9 },
  { id: '__rig_code', etapes: ['rig-code', 'rig-patch'], nom: 'Rig engine — open-source code', taille: '', mo: 0, poids: 3 },
  { id: '__rig_model', etapes: ['rig-weights'], nom: 'Rig engine — model', taille: '1619 MB', mo: 1619, poids: 26 },
];

async function _startDownloadInterne() {
  // Only block "Continue" until the download is done — Back stays
  // enabled so the user can never get stuck on this step. If they
  // navigate away mid-download, the next time they hit Continue the
  // huggingface_hub resume kicks in from where it left off.
  document.getElementById('btn-dl-next').disabled = true;
  document.getElementById('dl-fini')?.remove(); document.getElementById('btn-dl-next').classList.remove('wiz-attire');
  const list = document.getElementById('dl-list');
  list.innerHTML = '<div class="wiz-dl-row"><span class="name">Preparing model list...</span></div>';

  if (chosenMode === 'cloud') {
    list.innerHTML = '<div class="wiz-dl-row"><span class="name">Cloud mode: no download needed.</span></div>';
    document.getElementById('btn-dl-next').disabled = false;
    return;
  }
  etatProgression('marche');

  // ---- Preflight: is there enough free disk on the data drive? A multi-GB
  // install that dies half-way on a full disk leaves a permanently-broken
  // setup, so warn UP FRONT. Needed ≈ models (from the plan) + ~7 GB for the
  // torch/diffusers env. Non-fatal if the probe itself fails (fall through).
  try {
    const _plan0 = await window.wizardAPI.getDownloadPlan(chosenMode);
    const _fs0 = await window.wizardAPI.freeSpace();
    if (_fs0 && _fs0.ok && typeof _fs0.freeBytes === 'number') {
      // models (plan) + ~7 GB AI env + ~14 GB rig engine (torch 2.7 env
      // 4 GB + Puppeteer checkpoints ~10 GB, Phase 3)
      const neededGb = ((_plan0.total_mb || 0) / 1024) + 7 + 14;
      const freeGb = _fs0.freeBytes / (1024 ** 3);
      if (freeGb < neededGb) {
        list.innerHTML = `<div class="wiz-dl-row"><span class="name" style="color:var(--error)">Not enough free space on ${_fs0.drive || 'your data drive'}: about <b>${neededGb.toFixed(0)} GB</b> is needed but only <b>${freeGb.toFixed(1)} GB</b> is free.<br>Free up space (or change the data folder to a bigger drive), then <a href="#" id="retry-dl">Retry</a>.</span></div>`;
        document.getElementById('retry-dl')?.addEventListener('click', () => {
          // Meme raison que les trois autres boutons de reprise : ne pas
          // desarmer la garde, sinon `goto()` autorise une seconde chaine.
          startDownload();
        });
        etatProgression('erreur');
        return;  // btn-dl-next stays disabled — can't proceed until space is freed
      }
    }
  } catch (_) { /* probe failed — don't block, let the install try */ }

  // ---- Phase 1: provision the AI engine (torch/diffusers) into a
  // writable per-user Python env. REQUIRED before the model download.
  // This is a big (~5 GB) one-time install — show CLEAR, PATIENT progress
  // with named steps so users don't think it froze (it can take 10-20 min
  // on a slow connection; the pip phase reports by step, not by bytes).
  const _AIENV_STEPS = {
    'copy-python': 'Preparing the Python environment…',
    'pip-bootstrap': 'Setting up the installer…',
    'torch': 'Downloading PyTorch…',
    'pypi': 'Installing libraries (diffusers, transformers…)…',
    'translation': 'Installing the prompt translator…',
    'xformers-optional': 'Installing xformers (speed boost)…',
    'flash-attn-optional': 'Finishing up…',
    'done': 'AI engine ready ✓',
  };
  list.innerHTML = enteteGroupe('engine') + `
    <div class="wiz-dl-row in-progress" data-groupe="engine" style="--cat:${GROUPES.engine.couleur}" data-id="__aienv">
      <span class="name" id="aienv-name">Installing the AI engine…</span>
      <span class="timer" id="aienv-pct">0 %</span>
      <span class="size">~8.5 GB</span>
      <div class="bar"><div class="bar-fill"></div></div>
    </div>
    <div class="wiz-dl-row"><span class="name" style="opacity:.65" id="aienv-note">One-time setup: about 4.3 GB to download for the AI engine (8.5 GB on disk once installed), then the models download. Your PC may feel slow while it downloads. You can leave it running; just keep this window open.</span></div>`;
  // LISTE COMPLETE DES LE DEBUT (user, 2026-09-30 : « mets la liste complete des le debut ») : moteur d'IA, tous les modeles du mode, les 5
  // lignes du moteur de rig et l'animation, toutes en attente ; chaque ligne s'allume a son tour.
  const planComplet = await window.wizardAPI.getDownloadPlan(chosenMode);
  const ligneModele = (item, g) => `<div class="wiz-dl-row" data-groupe="${g}" style="--cat:${GROUPES[g].couleur}" data-id="${item.id}"><span class="name">${item.label}</span>`
    + `<span class="timer"></span><span class="size">${item.size_mb} MB</span><div class="bar"><div class="bar-fill"></div></div></div>`;
  const parGroupe = { models: [], img: [], '3d': [] };
  for (const item of (planComplet.items || [])) parGroupe[groupeDeModele(item.id)].push(item);
  let html = '';
  for (const g of ['models', 'img', '3d']) if (parGroupe[g].length) html += enteteGroupe(g) + parGroupe[g].map((i) => ligneModele(i, g)).join('');
  html += enteteGroupe('rig') + RIG_LIGNES.map((l) => `<div class="wiz-dl-row" data-groupe="rig" style="--cat:${GROUPES.rig.couleur}" data-id="${l.id}"><span class="name">${l.nom}</span>`
    + `<span class="timer"></span><span class="size">${l.taille}</span><div class="bar"><div class="bar-fill"></div></div></div>`).join('');
  html += enteteGroupe('anim') + `<div class="wiz-dl-row" data-groupe="anim" style="--cat:${GROUPES.anim.couleur}" data-id="__anim"><span class="name">Animation engine — built in, nothing to download</span>`
    + '<span class="size">0 MB</span><div class="bar"><div class="bar-fill"></div></div></div>';
  list.insertAdjacentHTML('beforeend', html);
  // The byte/speed/ETA counters are for the MODEL download, not this pip
  // install (which reports by step, not by bytes) — show "—" meanwhile so
  // they don't read as "frozen at 0".
  for (const id of ['dl-done', 'dl-total', 'dl-speed', 'dl-eta']) {
    const el = document.getElementById(id); if (el) el.textContent = '—';
  }
  // PROGRESSION EN OCTETS (2026-09-30) : le script d'installation mesure ce que pip telecharge (bytes_done, speed_mbps) ; la barre et le
  // compteur du bas (Mo, Mo/s, temps restant) les utilisent. Le total (~5 Go) est une ESTIMATION affichee comme telle.
  const AIENV_TOTAL_MO = 4300;   // taille TELECHARGEE (roues : torch ~2,9 Go + torchvision + bibliotheques) ; ~8,5 Go une fois installe sur le disque
  let barreMax = 3;
  // AVANCEMENT PAR ETAPE (2026-09-30, user : « pas de % pour cette etape, la barre reste longtemps chargee a fond ») : avant, la barre prenait le plus
  // grand de « octets telecharges » et « avancement de l'etape » et se collait vers 92 % pendant l'installation des bibliotheques. Maintenant
  // chaque etape a un POIDS (part du temps total) et une fraction propre ; la barre ne recule jamais et le pourcentage est ecrit sur la ligne.
  const ETAPES_MOTEUR = [['copy-python', 1], ['pip-bootstrap', 2], ['torch', 40], ['kaolin', 6], ['pypi', 26], ['translation', 4],
    ['trellis2-wheels-local', 6], ['trellis2-wheels-github', 0], ['trellis2-deps', 9], ['trellis2-nvrtc', 3], ['xformers-optional', 1], ['flash-attn-optional', 2]];
  const TOTAL_POIDS = ETAPES_MOTEUR.reduce((t, e) => t + e[1], 0);
  let fractionEtape = 0, etapeCourante = null;
  const pctMoteur = (etape, frac) => {
    let base = 0;
    for (const [k, w] of ETAPES_MOTEUR) { if (k === etape) return (base + w * Math.max(0, Math.min(1, frac))) * 100 / TOTAL_POIDS; base += w; }
    return null;
  };
  window.wizardAPI.onInstallProgress((p) => {
    const fill = document.querySelector('.wiz-dl-row[data-id="__aienv"] .bar-fill');
    if (typeof p.bytes_done === 'number') {
      const mo = p.bytes_done / 1e6, vit = Number(p.speed_mbps) || 0;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('dl-done', Math.round(mo).toLocaleString('en-US'));
      majGlobal(Math.min(FIN_MOTEUR, (mo / AIENV_TOTAL_MO) * FIN_MOTEUR));
      set('dl-total', '~' + AIENV_TOTAL_MO.toLocaleString('en-US'));
      set('dl-speed', vit.toFixed(1));
      // Debit tombe a ~0 (mesure du 2026-09-30 : « 0.1 MB/s · ETA 1191 min ») : le telechargement est fini, pip DECOMPRESSE et installe (plusieurs minutes
      // sans octets nouveaux). On l'affiche tel quel au lieu d'un temps restant absurde.
      const rest = Math.max(0, AIENV_TOTAL_MO - mo);
      const installe = vit < 0.5 && mo > 50;
      const sec = (!installe && vit > 0.05) ? rest / vit : null;
      const nom = document.getElementById('aienv-name');
      if (installe && nom && p.step === 'torch') nom.textContent = 'Installing PyTorch (unpacking files, a few minutes)…';
      set('dl-eta', installe ? 'installing…' : (sec == null ? '–' : (sec < 90 ? Math.round(sec) + ' s' : Math.round(sec / 60) + ' min')));
    }
    if (p.step && p.step !== etapeCourante && ETAPES_MOTEUR.some((e) => e[0] === p.step)) { etapeCourante = p.step; fractionEtape = 0; }
    if (p.step === 'torch' && typeof p.bytes_done === 'number') fractionEtape = Math.max(fractionEtape, Math.min(1, p.bytes_done / 1e6 / 2900));
    else if (typeof p.pct === 'number' && p.step === etapeCourante) fractionEtape = Math.max(fractionEtape, p.pct / 100);
    const pm = pctMoteur(etapeCourante, fractionEtape);
    if (pm != null) barreMax = Math.max(barreMax, Math.min(99, pm));
    if (p.done) barreMax = 100;
    if (fill) fill.style.width = Math.max(3, barreMax) + '%';
    const lp = document.getElementById('aienv-pct'); if (lp) lp.textContent = Math.floor(barreMax) + ' %';
    const name = document.getElementById('aienv-name');
    if (name && p.step && _AIENV_STEPS[p.step]) name.textContent = _AIENV_STEPS[p.step];
    if (p.done) {
      const row = document.querySelector('.wiz-dl-row[data-id="__aienv"]');
      if (row) { row.classList.add('done'); row.classList.remove('in-progress'); }
    }
  });
  console.log('[wizard] Phase 1: installing AI engine (torch/diffusers)…');
  try {
    /* LIRE CE QUE LA POIGNEE REND, pas seulement attraper ce qu'elle jette.
     *
     * `wizard:install-deps` signale ses deux echecs les plus probables par une
     * promesse RESOLUE : la copie de l'interpreteur qui echoue rend
     * { ok:false, error:'copy failed…' }, et surtout le controle qui suit pip
     * rend { ok:false, error:'The installer finished but the AI engine is
     * still missing (torch was not installed)…' }. Ce dernier a ete ajoute
     * expres, avec quatorze lignes de commentaire expliquant qu'il corrige le
     * refus du 2026-08-08 — mais personne ne regardait sa valeur. L'assistant
     * affichait donc « AI engine ready ✓ » sur une installation ratee, et
     * l'utilisateur ne decouvrait le probleme qu'a la premiere generation. */
    const r = await window.wizardAPI.installDeps();
    if (!r || r.ok !== true) {
      throw new Error((r && r.error) || 'The AI engine installation did not complete.');
    }
    console.log('[wizard] Phase 1: AI engine install OK');
  } catch (e) {
    console.error('[wizard] AI engine install FAILED:', (e && e.message) || e);
    /* La coche « AI engine ready ✓ » est posee par le flux de progression
     * AVANT ce catch, et le bloc ci-dessous fait `+=` et non `=` : sans ce
     * retrait, l'erreur s'affiche SOUS une ligne verte qui affirme le
     * contraire. */
    try {
      const ligne = document.querySelector('.wiz-dl-row[data-id="__aienv"]');
      if (ligne) {
        ligne.classList.remove('done', 'in-progress');
        ligne.classList.add('failed');
        const nom = ligne.querySelector('.name');
        if (nom) nom.style.color = 'var(--error)';
      }
    } catch (_) {}
    // message lisible (2026-09-30) : la ligne brute (« Error invoking remote method … Command failed: <chemins> ») debordait sur une seule ligne, sans le lien Retry visible
    let brut = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '');
    const lignes = brut.split('\n').map((x) => x.trim()).filter(Boolean);
    const cause = lignes.find((x) => /^(ERROR|Could not|Not enough|pip exited|Last error)/i.test(x)) || lignes[0] || 'unknown error';
    const court = /^Command failed:/i.test(cause) ? 'the installer stopped unexpectedly' : cause.slice(0, 220);
    // Bloc d'echec (2026-09-30, user : « un bouton plus joli et bien plus visible pour Retry, et un bouton pour m'envoyer les logs »)
    etatProgression('erreur');
    list.innerHTML += `<div class="wiz-erreur">
      <div class="wiz-erreur-titre">The AI engine installation stopped</div>
      <div class="wiz-erreur-msg">${court.replace(/</g, '&lt;')}</div>
      <div class="wiz-erreur-actions">
        <button type="button" class="primary-btn wiz-erreur-retry" id="retry-dl">&#8635;&nbsp; Retry</button>
        <button type="button" class="ghost-btn" id="send-logs">&#9993;&nbsp; Send the logs to the MyFabmesh team</button>
        <button type="button" class="ghost-btn" id="save-logs">Save the logs on my Desktop</button>
      </div>
      <div class="wiz-erreur-etat" id="send-logs-etat" role="status"></div>
    </div>`;
    document.getElementById('send-logs')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget, etat = document.getElementById('send-logs-etat');
      b.disabled = true; etat.className = 'wiz-erreur-etat'; etat.textContent = 'Sending…';
      try {
        const r = await window.wizardAPI.sendDiagnostics();
        if (r && r.ok) { etat.classList.add('ok'); etat.textContent = 'Sent — thank you! Reference: ' + r.id; journal('logs-envoyes', { id: r.id }); }
        else { etat.classList.add('ko'); etat.textContent = 'Could not send the logs (' + ((r && r.error) || 'unknown error') + '). Use “Save the logs on my Desktop” and send us the file.'; b.disabled = false; }
      } catch (err) { etat.classList.add('ko'); etat.textContent = 'Could not send the logs. Use “Save the logs on my Desktop” and send us the file.'; b.disabled = false; }
    });
    document.getElementById('save-logs')?.addEventListener('click', async () => {
      const etat = document.getElementById('send-logs-etat');
      try { const r = await window.wizardAPI.exportDiagnostics(); etat.className = 'wiz-erreur-etat ' + (r && r.ok ? 'ok' : 'ko'); etat.textContent = r && r.ok ? 'Saved on your Desktop.' : 'Could not save the logs.'; } catch (_) { etat.className = 'wiz-erreur-etat ko'; etat.textContent = 'Could not save the logs.'; }
    });
    document.getElementById('retry-dl')?.addEventListener('click', () => {
      // NE PAS faire `initialized.delete('download')` : cela re-arme aussi
      // `goto()` pour le reste de la session, si bien que revenir en arriere
      // puis cliquer Continue lancait une DEUXIEME chaine complete par-dessus
      // la premiere, encore en attente. `startDownload()` suffit.
      startDownload();
    });
    return;
  }

  // ---- Phase 2: download the model weights.
  const plan = planComplet;
  { const ligneMoteur = list.querySelector('.wiz-dl-row[data-id="__aienv"]');
    if (ligneMoteur) { ligneMoteur.classList.remove('in-progress'); ligneMoteur.classList.add('done'); const n = document.getElementById('aienv-name'); if (n) n.textContent = 'AI engine ready ✓'; } }
  document.getElementById('dl-total').textContent = plan.total_mb;
  placerJalons(plan);

  window.wizardAPI.onDownloadProgress((p) => {
    // A per-model error: essential-model failures also reject the whole
    // promise (Retry path below), but OPTIONAL models (upscaler / extra
    // captioner) only warn and keep going — surface which one failed inline
    // so a "complete"-looking list isn't silently missing a model.
    if (p.error && p.id && p.id !== '__all__') {
      const erow = document.querySelector(`.wiz-dl-row[data-id="${p.id}"]`);
      if (erow && !erow.dataset.errShown) {
        erow.dataset.errShown = '1';
        erow.classList.remove('in-progress');
        const nm = erow.querySelector('.name');
        if (nm) nm.insertAdjacentHTML('beforeend', ` <span style="color:var(--error)">— failed</span>`);
      }
      return;
    }
    const row = document.querySelector(`.wiz-dl-row[data-id="${p.id}"]`);
    if (row) {
      row.querySelector('.bar-fill').style.width = p.pct + '%';
      const timer = row.querySelector('.timer');
      if (p.done) {
        row.classList.add('done');
        row.classList.remove('in-progress');
        if (timer) timer.textContent = '';
      } else if (p.in_progress) {
        row.classList.add('in-progress');
        if (timer) timer.textContent = (p.elapsed_s || 0).toFixed(0) + 's';
        if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });   // la liste suit le modele en cours
      }
    }
    document.getElementById('dl-done').textContent = p.total_done_mb || 0;
    if (plan.total_mb) majGlobal(FIN_MOTEUR + Math.min(FIN_MODELES - FIN_MOTEUR, (p.total_done_mb || 0) * (FIN_MODELES - FIN_MOTEUR) / plan.total_mb));
    document.getElementById('dl-speed').textContent = (p.speed_mbps || 0).toFixed(1);
    document.getElementById('dl-eta').textContent = p.eta || '–';
  });

  console.log(`[wizard] Phase 2: downloading models (mode=${chosenMode}, ${plan.total_mb} MB)…`);
  try {
    await window.wizardAPI.startDownload(chosenMode);
    console.log('[wizard] Phase 2: model download OK');
  } catch (e) {
    console.error('[wizard] Model download FAILED:', (e && e.message) || e);
    etatProgression('erreur');
    list.innerHTML += `<div class="wiz-dl-row"><span class="name" style="color:var(--error)">Download failed: ${e.message}. <a href="#" id="retry-dl">Retry</a></span></div>`;
    document.getElementById('retry-dl')?.addEventListener('click', () => {
      // NE PAS faire `initialized.delete('download')` : cela re-arme aussi
      // `goto()` pour le reste de la session, si bien que revenir en arriere
      // puis cliquer Continue lancait une DEUXIEME chaine complete par-dessus
      // la premiere, encore en attente. `startDownload()` suffit.
      startDownload();
    });
    return;
  }

  // ---- Phase 3: rig engine (Puppeteer auto-rig). SEPARATE Python env
  // (torch 2.7 — incompatible with the AI env's 2.8) + code tree + 3
  // checkpoints (~9.6 GB, resumable). A failure here does NOT block the
  // wizard: mesh generation works without rigging, so Continue stays
  // available with a clear warning.
  // Moteur de rig local = SkinTokens (2026-09-26) : code telecharge chez son
  // auteur (open source, en partie GPL-3.0 — voir Licenses), poids Hugging Face.
  // MOTEUR DE RIG : UNE LIGNE PAR ETAPE (2026-09-30, user : « la ligne change plusieurs fois de terme et d'avancement, fais des lignes
  // separees »). Tailles mesurees : PyTorch 2.7 cu128 3 338 Mo, bibliotheques ~476 Mo (PyPI, sans leurs dependances), modele 1 619 Mo.
  // Chaque ligne avance avec les octets mesures pendant SON etape ; la verification du moteur est faite sur la page de verification.
  const RIG_TOTAL_MO = RIG_LIGNES.reduce((t, l) => t + l.mo, 0);
  // Les modeles sont finis : sans ceci l'ecran restait fige (« 48650 / 48650 MB · 0.0 MB/s ») pendant que le moteur de rig, en bas de
  // la liste, travaillait hors champ (constate le 2026-09-30).
  list.scrollTop = list.scrollHeight;
  { const sp = document.getElementById('dl-speed'), et = document.getElementById('dl-eta');
    if (sp) sp.textContent = '–'; if (et) et.textContent = 'installing the rig engine…'; }
  let rigActive = null, rigOctets = 0, rigOctetsDebut = 0, rigFraction = 0;
  const rigLigne = (id) => list.querySelector(`.wiz-dl-row[data-id="${id}"]`);
  const rigMarquer = (l, etat) => {
    const row = rigLigne(l.id);
    if (!row) return;
    row.classList.toggle('in-progress', etat === 'in-progress');
    row.classList.toggle('done', etat === 'done');
    if (etat === 'done') { row.querySelector('.bar-fill').style.width = '100%'; }
  };
  const rigBarre = (l, frac) => {
    rigFraction = Math.max(0, Math.min(0.99, frac));
    const f = rigLigne(l.id)?.querySelector('.bar-fill');
    if (f) f.style.width = Math.max(3, rigFraction * 100) + '%';
    // pourcentage global : lignes finies + part de la ligne en cours, sur 84 -> 92
    let fait = 0;
    for (const x of RIG_LIGNES) { if (x === l) break; fait += x.poids; }
    majGlobal(FIN_MODELES + (FIN_RIG - FIN_MODELES) * Math.min(1, (fait + l.poids * rigFraction) / 100));
  };
  const rigActiver = (l) => {
    if (rigActive === l) return;
    for (const x of RIG_LIGNES) { if (x === l) break; rigMarquer(x, 'done'); }
    rigActive = l; rigOctetsDebut = rigOctets;
    rigMarquer(l, 'in-progress');
    rigBarre(l, l.mo ? 0 : 0.5);
    list.scrollTop = list.scrollHeight;
  };
  window.wizardAPI.onRigProgress((p) => {
    if (p.step === 'rig-octets') {
      // Octets mesures par le script (pip + poids) : debit reel, temps restant, et barre de la ligne en cours.
      rigOctets = (p.bytes_done || 0) / 1e6;
      const vit = Number(p.speed_mbps) || 0;
      const sp = document.getElementById('dl-speed'), et = document.getElementById('dl-eta');
      if (sp) sp.textContent = vit.toFixed(1);
      if (et) {
        const sec = vit > 0.5 ? Math.max(0, RIG_TOTAL_MO - rigOctets) / vit : null;
        et.textContent = sec == null ? 'installing…' : (sec < 90 ? Math.round(sec) + ' s' : Math.round(sec / 60) + ' min');
      }
      if (rigActive && rigActive.mo) rigBarre(rigActive, (rigOctets - rigOctetsDebut) / rigActive.mo);
      return;
    }
    const l = RIG_LIGNES.find((x) => x.etapes.includes(p.step)) || (String(p.step || '').startsWith('rig-ckpt-') ? RIG_LIGNES[4] : null);
    if (l) rigActiver(l);
    if (p.done && !p.error) {
      for (const x of RIG_LIGNES) rigMarquer(x, 'done');
      majGlobal(FIN_RIG);
    }
  });
  console.log('[wizard] Phase 3: installing rig engine (Puppeteer)…');
  try {
    const r = await window.wizardAPI.installRig();
    /* Le moteur de rig n'est PAS embarque dans le paquet (licence GPL-3.0 +
     * NVIDIA-NC) : le processus principal rend alors { skipped:true } sans
     * rien telecharger. Il faut le DIRE, au lieu d'afficher « Rig engine
     * ready ✓ » sur une etape qui n'a pas eu lieu — l'utilisateur croirait
     * disposer de l'auto-rig et ne comprendrait pas son absence ensuite. */
    if (r && r.skipped) {
      for (const x of RIG_LIGNES) rigLigne(x.id)?.remove();
      list.querySelector('.wiz-dl-groupe[data-groupe="rig"]')?.remove();
      const texte = (r.reason === 'no-nvidia-gpu')
        ? 'No NVIDIA graphics card: auto-rigging will run in the cloud — nothing to download.'
        : 'Auto-rigging is not included in this edition — skipped.';
      list.insertAdjacentHTML('beforeend', `<div class="wiz-dl-row" data-id="__rig_skip"><span class="name" style="color:var(--text-2)">${texte}</span>`
        + '<span class="size">0 MB</span></div>');
      majGlobal(FIN_RIG);
      console.log('[wizard] Phase 3: rig engine not bundled — skipped');
    } else {
      console.log('[wizard] Phase 3: rig engine install OK');
    }
  } catch (e) {
    console.error('[wizard] Rig engine install FAILED:', (e && e.message) || e);
    if (rigActive) { const row = rigLigne(rigActive.id); if (row) row.classList.remove('in-progress'); }
    list.innerHTML += `<div class="wiz-dl-row"><span class="name" style="color:var(--error)">Rig engine install failed: ${e.message}.<br>You can continue — 3D generation works without it, but auto-rigging will be unavailable until you re-run setup (Settings → Reconfigure). <a href="#" id="retry-rig">Retry now</a></span></div>`;
    document.getElementById('retry-rig')?.addEventListener('click', () => {
      // NE PAS faire `initialized.delete('download')` : cela re-arme aussi
      // `goto()` pour le reste de la session, si bien que revenir en arriere
      // puis cliquer Continue lancait une DEUXIEME chaine complete par-dessus
      // la premiere, encore en attente. `startDownload()` suffit.
      startDownload();
    });
  }
  // ANIMATION (2026-09-30, user : « il manque l'icone d'animation », ordre image > 3D > rig > anim) : rien a telecharger — les cycles de marche
  // sont integres au logiciel et les animations IA sont calculees en ligne. Ligne affichee pour que la chaine complete soit visible.
  { const la = list.querySelector('.wiz-dl-row[data-id="__anim"]');
    if (la) { la.classList.add('done'); const n = la.querySelector('.name'); if (n) n.textContent = 'Animation engine ready — built in, nothing to download'; } }
  list.scrollTop = list.scrollHeight;
  document.getElementById('btn-dl-next').disabled = false;
  annoncerFin(!document.getElementById('retry-rig'));
}

// Message de fin (2026-09-30, user : « il faut un message quand c'est telecharge car on ne le sait pas ») : sans lui, seul le bouton Continue
// change d'etat, ce qui passe inapercu. Bandeau vert (ou orange si le moteur de rig a echoue) + pourcentage a 100 %.
function annoncerFin(toutOk) {
  document.getElementById('dl-fini')?.remove();
  if (toutOk) majGlobal(100);
  etatProgression(toutOk ? 'fini' : 'avert');
  const sp = document.getElementById('dl-speed'), et = document.getElementById('dl-eta');
  if (sp) sp.textContent = '0.0'; if (et) et.textContent = '–';
  const div = document.createElement('div');
  div.id = 'dl-fini';
  div.className = 'wiz-fini' + (toutOk ? '' : ' avert');
  div.innerHTML = toutOk
    ? '<b>✓ Download complete.</b> Everything is installed — click <b>Continue</b> to run a quick test.'
    : '<b>Download finished, with a warning.</b> The rig engine could not be installed (see above). You can click <b>Continue</b> anyway.';
  const resume = document.querySelector('.wiz-dl-summary');
  if (resume) resume.insertAdjacentElement('afterend', div);
  const b = document.getElementById('btn-dl-next');
  if (b) { b.classList.add('wiz-attire'); if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); }
}

// ---------- STEP 5: final test ----------
// PAGE DE VERIFICATION (2026-09-30, user : « le check de chaque engine doit etre fait apres les installations, dans une page specifique
// ou on fait une animation de zoom pour focaliser sur cette barre, et on la vide pour checker un par un les moteurs »). La barre a
// jalons de la page de telechargement revient PLEINE, zoom sur elle, elle se VIDE, puis chaque moteur est verifie dans l'ordre du
// logiciel (moteur d'IA, images, 3D, rig, animation) : la barre avance jusqu'a son jalon, qui passe au vert, ou au rouge.
// [motif de la ligne « [smoke] checking X... », libelle, description, jalon] — le premier motif reconnu gagne.
const T_LIBELLES = [
  [/native cuda wheels/i, '3D acceleration libraries', 'Speeds up mesh building', '3d'],
  [/pytorch|cuda/i, 'Graphics card', 'Your GPU is ready for AI', 'engine'],
  [/background remover/i, 'Background remover', 'Cuts your subject out of the picture', 'img'],
  [/writing assistant/i, 'Writing assistant', 'Writes your project descriptions', 'models'],
  [/vision/i, 'Vision module', 'Checks the shapes and colors', 'models'],
  [/mesh tools/i, 'Mesh tools', 'Simplifies and unwraps 3D models', '3d'],
  [/texture upscaler/i, 'Texture enhancer', 'Sharpens textures (Enhance texture, Ultra 8K)', '3d'],
  [/3d core|trellis/i, '3D generation engine', 'Turns an image into a 3D model', '3d'],
  [/dino/i, 'Image analyzer', 'Understands your reference image', 'models'],
];
const T_POS = { engine: 17, models: 34, img: 50, '3d': 67, rig: 83, anim: 100 };
const T_COULEUR = { engine: '#e84d7a', models: '#14b8a6', img: '#4a90e2', '3d': '#c35ce0', rig: '#f08a24', anim: '#22c55e' };
const _attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let _tPct = 100, _tChronoDebut = 0, _tChronoMinuteur = null;
function tBarre(v, sansAnim) {
  const f = document.getElementById('t-fill'), t = document.getElementById('t-pct');
  _tPct = Math.max(0, Math.min(100, v));
  if (f) {
    if (sansAnim) f.style.transition = 'none';
    f.style.width = _tPct + '%';
    if (sansAnim) { void f.offsetWidth; f.style.transition = ''; }
  }
  if (t) t.textContent = Math.floor(_tPct) + ' %';
}
function tJalon(cle, etat) {
  const j = document.querySelector(`#t-jalons .wiz-jalon[data-j="${cle}"]`);
  if (!j) return;
  j.classList.toggle('actif', etat === 'actif');
  j.classList.toggle('fait', etat === 'fait');
  j.classList.toggle('echec', etat === 'echec');
}
function tEtat(etat) {   // 'marche' | 'fini' | 'avert' | 'erreur'
  const roue = document.getElementById('t-roue');
  if (roue) roue.className = 'wiz-roue' + (etat === 'marche' ? '' : ' ' + etat);
  const afficher = () => { const el = document.getElementById('t-chrono'); if (el && _tChronoDebut) el.textContent = _fmtDuree(Date.now() - _tChronoDebut); };
  if (etat === 'marche') {
    if (!_tChronoDebut) _tChronoDebut = Date.now();
    if (!_tChronoMinuteur) _tChronoMinuteur = setInterval(afficher, 1000);
  } else if (_tChronoMinuteur) { clearInterval(_tChronoMinuteur); _tChronoMinuteur = null; }
  afficher();
}
async function runFinalTest() {
  const status = document.getElementById('test-status');
  const log = document.getElementById('test-log');
  const liste = document.getElementById('test-list');
  status.classList.remove('error');
  status.textContent = 'Checking each engine, one by one…';
  log.textContent = '';
  liste.innerHTML = '';
  const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ORDRE = ['engine', 'models', 'img', '3d', 'rig', 'anim'];
  // 1. la barre revient pleine, zoom, puis elle se vide ; jalons regulierement espaces (un par moteur verifie)
  const bloc = document.getElementById('t-jalons');
  for (const k of ORDRE) { const j = document.querySelector(`#t-jalons .wiz-jalon[data-j="${k}"]`); if (j) { j.hidden = false; j.style.left = T_POS[k] + '%'; } }
  tBarre(100, true);
  ORDRE.forEach((k) => tJalon(k, 'fait'));
  if (bloc) { bloc.classList.remove('zoom'); void bloc.offsetWidth; bloc.classList.add('zoom'); }
  await _attendre(reduit ? 0 : 1100);
  ORDRE.forEach((k) => tJalon(k, ''));
  tBarre(0);
  await _attendre(reduit ? 0 : 950);
  tEtat('marche');

  // 2. moteur d'IA, images, 3D : le test de fumee (ses lignes arrivent dans l'ordre du logiciel)
  const attendus = {};
  for (const x of T_LIBELLES) attendus[x[3]] = (attendus[x[3]] || 0) + 1;
  let groupe = null, faits = 0, depart = 0, courante = null;
  const ligne = (nom, desc, g) => {
    const li = document.createElement('li');
    li.className = 'en-cours';
    li.style.setProperty('--cat', T_COULEUR[g] || '');
    li.innerHTML = '<span class="ico"></span><span class="nom"></span><span class="desc"></span>';
    li.querySelector('.nom').textContent = nom;
    li.querySelector('.desc').textContent = desc || '';
    liste.appendChild(li);
    return li;
  };
  const finir = (li, ok, desc) => {
    if (!li) return;
    li.classList.remove('en-cours'); li.classList.add(ok ? 'ok' : 'ko');
    li.querySelector('.ico').textContent = ok ? '✓' : '!';
    if (desc) li.querySelector('.desc').textContent = desc;
  };
  const fermer = (g, ok) => { if (!g) return; tJalon(g, ok ? 'fait' : 'echec'); if (ok) tBarre(T_POS[g]); };
  const ouvrir = (g) => {
    if (groupe === g) return;
    if (groupe) fermer(groupe, true);
    groupe = g; faits = 0; depart = _tPct;
    tJalon(g, 'actif');
  };
  const avancer = () => {
    faits++;
    if (groupe) tBarre(depart + (T_POS[groupe] - depart) * Math.min(1, faits / (attendus[groupe] || 1)));
  };
  window.wizardAPI.onTestLog((line) => {
    log.textContent += line + '\n';
    log.scrollTop = log.scrollHeight;
    const m = /checking (.+?)(?:\.\.\.|…)\s*$/i.exec(line);
    if (m) {
      if (courante) { finir(courante, true); avancer(); }
      const brut = m[1].trim();
      const f = T_LIBELLES.find((x) => x[0].test(brut));
      const g = f ? f[3] : (groupe || '3d');
      ouvrir(g);
      courante = ligne(f ? f[1] : brut.charAt(0).toUpperCase() + brut.slice(1), f ? f[2] : '', g);
    } else if (/FAILED/.test(line)) {
      finir(courante, false); courante = null;
      fermer(groupe, false);
      document.getElementById('test-tech').open = true;
    } else if (/all checks passed/i.test(line)) {
      if (courante) { finir(courante, true); avancer(); courante = null; }
      fermer(groupe, true);
    }
  });

  let result;
  try {
    result = await window.wizardAPI.runFinalTest(chosenMode);
  } catch (e) {
    tEtat('erreur');
    status.textContent = '⚠ Test crashed: ' + e.message;
    status.classList.add('error');
    journal('test_final', { statut: 'PLANTE', mode: chosenMode, erreur: String(e && e.message).slice(0, 300) });
    return;
  }
  if (!result || !result.success) {
    tEtat('erreur');
    journal('test_final', { statut: 'REJETE', mode: chosenMode, duree_s: result ? result.duration_s : null,
      erreur: String((result && result.error) || '').slice(0, 300) });
    status.textContent = '⚠ One check did not pass: ' + ((result && result.error) || 'unknown error') + ' — use “Export logs” (top right) and send us the file, or try again.';
    status.classList.add('error');
    document.getElementById('test-tech').open = true;
    document.getElementById('btn-launch').disabled = true;
    return;
  }
  if (courante) { finir(courante, true); courante = null; }
  fermer(groupe, true);
  tBarre(T_POS['3d']);

  // 3. moteur de rig (verification deplacee ici depuis la page de telechargement)
  tJalon('rig', 'actif');
  const liRig = ligne('Rig engine', 'Adds a skeleton to your models', 'rig');
  let rig = null;
  try { rig = await window.wizardAPI.checkRig?.(); } catch (e) { rig = { ok: false, error: e && e.message }; }
  const rigOk = !rig || rig.ok;
  if (rig && rig.skipped) finir(liRig, true, 'Auto-rigging runs online');
  else if (rigOk) finir(liRig, true);
  else {
    finir(liRig, false, 'Auto-rigging will run online instead');
    log.textContent += '[rig] ' + String((rig && rig.error) || '').slice(-600) + '\n';
  }
  tJalon('rig', rigOk ? 'fait' : 'echec');
  tBarre(T_POS.rig);

  // 4. animation : integree au logiciel (cycles de marche), animations IA en ligne — rien a installer
  tJalon('anim', 'actif');
  const liAnim = ligne('Animation engine', 'Walk and run cycles are built in; AI animations run online', 'anim');
  await _attendre(reduit ? 0 : 450);
  finir(liAnim, true);
  tJalon('anim', 'fait');
  tBarre(100);
  tEtat(rigOk ? 'fini' : 'avert');

  const duree = Math.round((Date.now() - (_tChronoDebut || Date.now())) / 1000);
  journal('test_final', { statut: 'PASS', mode: chosenMode, duree_s: duree, rig: rig && rig.skipped ? 'saute' : (rigOk ? 'ok' : 'echec') });
  const intro = document.querySelector('#page-test .wiz-lead');
  if (intro) intro.textContent = 'Installation complete. Your PC is ready to create 3D models.';
  status.innerHTML = `
    <div class="wiz-test-success">
      <svg class="wiz-check" viewBox="0 0 52 52" aria-hidden="true">
        <circle class="wiz-check-circle" cx="26" cy="26" r="24" fill="none"/>
        <path class="wiz-check-path" fill="none" d="M14 27 l8 8 l16 -18"/>
      </svg>
      <div class="wiz-test-success-text">
        <div class="wiz-test-success-title">You are all set!</div>
        <div class="wiz-test-success-sub">Every engine works (checked in ${duree}s). Click <b>Launch MyFabmesh.AI</b> to start creating.</div>
      </div>
    </div>`;
  const launch = document.getElementById('btn-launch');
  launch.disabled = false;
  launch.classList.add('wiz-launch-ready');
}

document.getElementById('btn-launch').addEventListener('click', async () => {
  journal('fin', { sortie: 'lancement', mode: chosenMode });
  await window.wizardAPI.completeSetup({ mode: chosenMode, hw: hwReport });
});

// Page « no-gpu » : lancer l'app EN MODE CLOUD (et non le site web). Sans ce
// bouton, une machine sans GPU NVIDIA (Surface des testeurs Store, laptops)
// n'avait AUCUN moyen d'ouvrir l'application — le wizard renvoyait vers le
// navigateur. Le mode Cloud route désormais tout le pipeline vers le worker.
document.getElementById('btn-launch-cloud')?.addEventListener('click', async () => {
  const b = document.getElementById('btn-launch-cloud');
  if (b) { b.disabled = true; b.textContent = 'Starting…'; }
  try { localStorage.setItem('fab-compute-mode', 'cloud'); } catch (_) {}
  journal('fin', { sortie: 'lancement_cloud', mode: 'cloud' });
  await window.wizardAPI.completeSetup({ mode: 'cloud', hw: hwReport });
});

// Export logs button — one click → diagnostics .txt on the Desktop,
// so a user (or a friend testing the app) can send it to support
// instead of hunting through %APPDATA%.
(() => {
  const btn = document.getElementById('wiz-export-logs');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Exporting…';
    let label = 'Export failed';
    try {
      const r = await window.wizardAPI.exportDiagnostics();
      if (r && r.ok) label = 'Saved to Desktop ✓';
    } catch (_) {}
    btn.textContent = label;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3500);
  });
})();

// Brand in the topbar = link to the public website.
(() => {
  const brand = document.querySelector('#topbar .brand');
  if (!brand) return;
  brand.style.cursor = 'pointer';
  brand.title = 'Open the MyFabmesh.AI website';  // matches the github.io destination (myfabmesh.ai is not live)
  brand.addEventListener('click', () => {
    if (window.wizardAPI?.openExternal) {
      window.wizardAPI.openExternal('https://fabienlacaze.github.io/MyFabmesh/');
    }
  });
})();

// Show app version in the bottom-right corner.
(async () => {
  try {
    const v = await window.wizardAPI.getVersion();
    const el = document.getElementById('wiz-version');
    if (el && v) el.textContent = 'MyFabmesh.AI v' + v;
  } catch (_) {}
})();

// Branded confirm modal. Replaces window.confirm (native dialog is
// styled by the OS — ugly title bar showing the package name).
function wizConfirm({ title, body, okLabel = 'Confirm', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const modal  = document.getElementById('wiz-confirm');
    const titleE = document.getElementById('wiz-confirm-title');
    const bodyE  = document.getElementById('wiz-confirm-body');
    const okE    = document.getElementById('wiz-confirm-ok');
    const cancE  = document.getElementById('wiz-confirm-cancel');
    if (!modal) return resolve(window.confirm(body));
    titleE.textContent = title || 'Are you sure?';
    bodyE.textContent  = body;
    okE.textContent    = okLabel;
    cancE.textContent  = cancelLabel;
    modal.classList.remove('hidden');
    let cleanup = null;
    const close = (val) => {
      modal.classList.add('hidden');
      okE.onclick = cancE.onclick = null;
      modal.querySelector('.wiz-modal-backdrop').onclick = null;
      if (cleanup) document.removeEventListener('keydown', cleanup);
      resolve(val);
    };
    okE.onclick   = () => close(true);
    cancE.onclick = () => close(false);
    modal.querySelector('.wiz-modal-backdrop').onclick = () => close(false);
    cleanup = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };
    document.addEventListener('keydown', cleanup);
  });
}

// Cancel button: label depends on whether this is a first-run or a
// reconfigure (user clicked "Reconfigure MyFabmesh.AI" from Settings).
(async () => {
  const btn = document.getElementById('wiz-cancel-btn');
  if (!btn) return;
  let wizMode = 'first-run';
  try {
    const r = await window.wizardAPI.getMode();
    wizMode = r?.mode || 'first-run';
  } catch (_) {}
  btn.textContent = (wizMode === 'reconfigure') ? 'Cancel' : 'Quit';
  btn.addEventListener('click', async () => {
    const isReco = wizMode === 'reconfigure';
    // EN PLEIN TELECHARGEMENT (user, 2026-09-30 : « en pleine installation il faut dire que ca va tout supprimer, sauf si on sait reprendre »).
    // Verifie dans le code : rien n'est SUPPRIME. Les modeles deja telecharges restent et la reprise continue les fichiers partiels
    // (huggingface_hub) ; l'installation du moteur d'IA, elle, recommence depuis son debut (pip reutilise ce qu'il a deja telecharge).
    const enCours = !!_telechargementEnCours;
    const ok = await wizConfirm({
      title: enCours ? 'Installation in progress' : (isReco ? 'Cancel reconfiguration?' : 'Quit setup?'),
      body: enCours
        ? 'The installation is still running. If you quit now it stops and MyFabmesh.AI is NOT ready to use. Nothing is deleted: the models already downloaded are kept and continue where they stopped the next time you launch MyFabmesh.AI, but the AI engine setup starts again from its beginning.'
        : (isReco
          ? 'Your previous install mode will be restored and you will return to MyFabmesh.AI.'
          : 'MyFabmesh.AI will close. You can re-run the setup wizard at any time by launching MyFabmesh.AI again.'),
      okLabel: isReco ? 'Cancel reconfiguration' : 'Quit MyFabmesh.AI',
      cancelLabel: enCours ? 'Keep installing' : 'Keep setting up',
    });
    if (!ok) return;
    // Un testeur qui QUITTE l'assistant, et a quelle etape, est l'information
    // la plus precieuse d'un refus : elle dit ou il a renonce.
    journal('fin', { sortie: isReco ? 'reconfiguration_annulee' : 'abandon', mode: chosenMode });
    try { await window.wizardAPI.cancel(); } catch (_) {}
  });
})();

// Start fresh on welcome
goto('welcome');
