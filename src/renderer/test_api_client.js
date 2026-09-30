// ============================================================
// FabMesh Test/Control API - renderer client
// ============================================================
// Loaded as a classic <script> BEFORE index2.js so it can
// monkey-patch console.log/warn/error and capture everything.
// Listens for test:command IPC events from main and executes
// them in the renderer context, sending results back via
// ipcRenderer.send('test:result', ...).
// ============================================================

(function () {
  // Only run inside Electron renderer where ipcRenderer is reachable via
  // the preload bridge. We can't use the contextBridge API here because
  // we need low-level ipcRenderer access. Instead we use a tiny hack:
  // electron exposes require() only if nodeIntegration is on, so we
  // rely on a small additional bridge exposed by preload. If it's not
  // there, we silently no-op (prod mode).
  if (!window.__fabmeshTest || !window.__fabmeshTest.on || !window.__fabmeshTest.send) {
    // Fall back to a marker object so the rest of the code can still run
    // without crashing. Main's rendererCall will just time out, which is
    // fine - the test API is opt-in.
    console.log('[test_api_client] IPC bridge missing (preload did not expose __fabmeshTest). Disabled.');
    return;
  }

  // ----------------------------------------------------------
  // 1. Console capture (circular buffer + forward to main)
  // ----------------------------------------------------------
  const origLog   = console.log.bind(console);
  const origWarn  = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origInfo  = console.info ? console.info.bind(console) : origLog;

  function capture(level, args) {
    try {
      const parts = [];
      for (const a of args) {
        if (a instanceof Error) {
          parts.push(a.stack || (a.name + ': ' + a.message));
        } else if (typeof a === 'object') {
          try { parts.push(JSON.stringify(a)); }
          catch (_) { parts.push(String(a)); }
        } else {
          parts.push(String(a));
        }
      }
      const entry = { ts: Date.now(), level, msg: parts.join(' ') };
      window.__fabmeshTest.send('test:console', entry);
    } catch (_) { /* ignore */ }
  }

  console.log   = function (...a) { capture('log',   a); origLog(...a); };
  console.info  = function (...a) { capture('info',  a); origInfo(...a); };
  console.warn  = function (...a) { capture('warn',  a); origWarn(...a); };
  console.error = function (...a) { capture('error', a); origError(...a); };

  // Catch uncaught errors in the page
  window.addEventListener('error', (e) => {
    capture('error', ['[uncaught]', e.message, 'at', e.filename + ':' + e.lineno + ':' + e.colno]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    capture('error', ['[unhandledrejection]', (e.reason && e.reason.stack) || String(e.reason)]);
  });

  // ----------------------------------------------------------
  // 2. Helper functions
  // ----------------------------------------------------------
  function clickSelector(sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error('element not found: ' + sel);
    el.scrollIntoView({ block: 'center' });
    // Fire a real click so anchor handlers run
    el.click();
    return { clicked: true, selector: sel, tag: el.tagName, text: (el.textContent || '').slice(0, 80) };
  }

  function setInputValue(sel, val) {
    const el = document.querySelector(sel);
    if (!el) throw new Error('element not found: ' + sel);
    if (el.tagName === 'SELECT') {
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = !!val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = String(val == null ? '' : val);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { selector: sel, value: el.value };
  }

  function evalCode(code) {
    // eslint-disable-next-line no-new-func
    const fn = new Function('return (async()=>{ ' + code + ' })();');
    return fn();
  }

  function snapshotState() {
    const st = (window.state || {});
    const current = st.currentProject || null;
    const jobs = Array.isArray(st.jobs) ? st.jobs.map(j => ({
      id: j.id, name: j.name, status: j.status, progress: j.progress
    })) : [];
    const page = st.page || null;

    // Snapshot common workspace inputs if present
    function val(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      if (el.type === 'checkbox') return el.checked;
      return el.value;
    }
    const inputs = {
      'ws-prompt':         val('ws-prompt'),
      'ws-engine':         val('ws-engine'),
      'ws-count':          val('ws-count'),
      'ws-steps':          val('ws-steps'),
      'ws-3d-engine':      val('ws-3d-engine'),
      'ws-rig-template':   val('ws-rig-template')
    };

    return {
      page,
      currentProject: current ? {
        name: current.name,
        imagesCount: (current.images || []).length,
        meshesCount: (current.meshes || []).length,
        rigsCount:   (current.rigs   || []).length,
        images: (current.images || []).map(i => (typeof i === 'string' ? i : (i && i.path || i && i.file))),
        meshes: (current.meshes || []).map(m => (typeof m === 'string' ? m : (m && m.path || m && m.file))),
        rigs:   (current.rigs   || []).map(r => (typeof r === 'string' ? r : (r && r.path || r && r.file)))
      } : null,
      projects: (st.projects || []).map(p => p && p.name).filter(Boolean),
      jobs,
      inputs,
      url: location.href
    };
  }

  function getJobs()  { const st = window.state || {}; return Array.isArray(st.jobs) ? st.jobs : []; }
  function getJob(id) { return getJobs().find(j => String(j.id) === String(id)) || null; }

  function selectProjectByName(name) {
    const st = window.state || {};
    const projects = st.projects || [];
    const p = projects.find(x => x && x.name === name);
    if (!p) throw new Error('project not found: ' + name);
    if (typeof window.openProject === 'function') {
      window.openProject(p);
    } else {
      // Fallback: click the project card
      const cards = document.querySelectorAll('[data-project-name]');
      for (const c of cards) {
        if (c.getAttribute('data-project-name') === name) { c.click(); break; }
      }
    }
    return { selected: name };
  }

  async function generateImage(payload) {
    const p = payload || {};
    if (p.prompt != null)    setInputValue('#ws-prompt', p.prompt);
    if (p.engine != null)    { try { setInputValue('#ws-engine', p.engine); } catch (_) {} }
    if (p.count  != null)    { try { setInputValue('#ws-count',  p.count);  } catch (_) {} }
    if (p.steps  != null)    { try { setInputValue('#ws-steps',  p.steps);  } catch (_) {} }
    if (p.assetType != null) { try { setInputValue('#ws-asset-type',  p.assetType);  } catch (_) {} }
    if (p.assetStyle != null){ try { setInputValue('#ws-asset-style', p.assetStyle); } catch (_) {} }
    // Set checkboxes through their native .checked prop so the click handler
    // reads the value we asked for (e.g. auto multi-view).
    if (p.multiView != null) {
      const cb = document.querySelector('#ws-auto-multiview');
      if (cb) { cb.checked = !!p.multiView; cb.dispatchEvent(new Event('change', {bubbles:true})); }
    }
    if (p.buildStages != null) {
      const cb = document.querySelector('#ws-img-buildstages');
      if (cb) { cb.checked = !!p.buildStages; cb.dispatchEvent(new Event('change', {bubbles:true})); }
    }
    const before = getJobs().length;
    clickSelector('#ws-generate-image');
    // Return the id of the newly-pushed job (if any) so caller can wait on it.
    await new Promise(r => setTimeout(r, 150));
    const jobs = getJobs();
    const newJob = jobs.length > before ? jobs[jobs.length - 1] : null;
    return { triggered: true, jobId: newJob ? newJob.id : null };
  }

  async function generate3d(payload) {
    const p = payload || {};
    if (p.engine != null) { try { setInputValue('#ws-3d-engine', p.engine); } catch (_) {} }
    // Select image if requested, then promote it to the 3D source.
    if (p.imageIndex != null) {
      const cards = document.querySelectorAll('[data-image-index]');
      const target = Array.from(cards).find(c => String(c.getAttribute('data-image-index')) === String(p.imageIndex));
      if (target) target.click();
      // Wait a tick for the "Use for 3D" bar to appear, then click it.
      await new Promise(r => setTimeout(r, 150));
      const useBtn = document.querySelector('#ws-use-for-3d-btn');
      if (useBtn && useBtn.offsetParent !== null) useBtn.click();
    }
    const before = getJobs().length;
    // Real button id is ws-generate-mesh (not ws-generate-3d). It's disabled
    // until an image is selected as the 3D source — hence the two-step above.
    const btn = document.querySelector('#ws-generate-mesh')
             || document.querySelector('#ws-generate-3d');
    if (!btn) throw new Error('3D generate button not found');
    if (btn.disabled) throw new Error('3D generate button disabled — select an image first');
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const jobs = getJobs();
    const newJob = jobs.length > before ? jobs[jobs.length - 1] : null;
    return { triggered: true, jobId: newJob ? newJob.id : null };
  }

  // Scan all visible modal overlays and return their text content + any
  // action buttons so the test API can see popups raised by the UI
  // (customError, confirm dialogs, settings, etc).
  function getPopups() {
    const overlays = document.querySelectorAll('.modal-overlay');
    const visible = [];
    overlays.forEach((el) => {
      if (el.classList.contains('hidden')) return;
      // Also skip if display:none via inline style
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const text = (el.innerText || el.textContent || '').trim().slice(0, 4000);
      const buttons = [];
      el.querySelectorAll('button').forEach((b) => {
        const label = (b.innerText || b.textContent || '').trim().slice(0, 60);
        if (label) buttons.push({ id: b.id || null, label });
      });
      visible.push({
        id: el.id || null,
        title: (el.querySelector('h2, h3, .modal-title')?.innerText || '').trim().slice(0, 200),
        text,
        buttons
      });
    });
    return visible;
  }

  function dismissPopup(payload) {
    const p = payload || {};
    const overlays = Array.from(document.querySelectorAll('.modal-overlay'))
      .filter((el) => !el.classList.contains('hidden'));
    if (!overlays.length) return { dismissed: 0 };
    let target;
    if (p.id) {
      target = overlays.find((el) => el.id === p.id);
      if (!target) throw new Error('no visible modal with id: ' + p.id);
    } else {
      target = overlays[overlays.length - 1]; // topmost
    }
    // Find a safe "close/cancel/ok" button — NEVER click a random button as
    // it might trigger native file dialogs or destructive actions.
    // A button is only safe if it is VISIBLE (ignore display:none / hidden).
    const isVisible = (el) => {
      if (!el) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      return true;
    };
    const allButtons = Array.from(target.querySelectorAll('button')).filter(isVisible);
    const scoreBtn = (b) => {
      const id = (b.id || '').toLowerCase();
      const label = (b.innerText || b.textContent || '').trim().toLowerCase();
      // Highest score = best match (safe dismiss action)
      if (id.endsWith('-close') || label === 'close' || label === 'fermer') return 100;
      if (id.endsWith('-cancel') || label === 'cancel' || label === 'annuler') return 90;
      if (id === 'confirm-ok' || label === 'ok' || label === 'dismiss') return 80;
      if (label === '\u00d7' || label === 'x') return 70;
      return 0;
    };
    const candidates = allButtons
      .map((b) => ({ b, s: scoreBtn(b) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    let method;
    if (candidates.length > 0) {
      const best = candidates[0].b;
      best.click();
      method = 'button:' + (best.id || best.textContent.trim().slice(0, 20));
    } else if (target.querySelector('[data-dismiss]')) {
      target.querySelector('[data-dismiss]').click();
      method = 'data-dismiss';
    } else if (target.querySelector('.modal-close')) {
      target.querySelector('.modal-close').click();
      method = 'modal-close';
    } else {
      // Last resort: just hide it without clicking anything
      target.classList.add('hidden');
      method = 'hidden';
    }
    return { dismissed: 1, id: target.id || null, method };
  }

  async function autoRig(_payload) {
    const before = getJobs().length;
    // Prefer the workspace rig button, fall back to the AI-rig button if present.
    let btn = document.querySelector('#ws-auto-rig')
           || document.querySelector('#ws-rig-ai')
           || document.querySelector('#ws-rig-generate');
    if (!btn) throw new Error('auto-rig button not found');
    btn.click();
    await new Promise(r => setTimeout(r, 150));
    const jobs = getJobs();
    const newJob = jobs.length > before ? jobs[jobs.length - 1] : null;
    return { triggered: true, jobId: newJob ? newJob.id : null };
  }

  // ----------------------------------------------------------
  // 2b. PILOTAGE COMPLET (2026-09-28) — tout ce qu'un utilisateur fait a la
  //     souris doit pouvoir se faire depuis une session : catalogue de
  //     l'interface, clic / saisie par id, reference (@r12) ou texte,
  //     modales, notifications, attente, rectangle d'un element (la souris
  //     et le clavier REELS sont envoyes par main, control_api.js).
  //     Listing complet : docs/pilotage_bureau.md.
  // ----------------------------------------------------------
  let _refN = 0;
  const _toasts = [];
  (function suivreToasts() {
    const brancher = (c) => new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const bg = String(n.style && n.style.background || '');
        _toasts.push({ ts: Date.now(), type: bg.includes('220,38,38') ? 'error' : bg.includes('22,163,74') ? 'success' : 'info',
                       text: (n.textContent || '').trim().slice(0, 500) });
        while (_toasts.length > 60) _toasts.shift();
      }
    }).observe(c, { childList: true });
    const guetter = () => {
      const c = document.getElementById('toast-container');
      if (c) { brancher(c); return; }
      const obs = new MutationObserver(() => {
        const c2 = document.getElementById('toast-container');
        if (c2) { obs.disconnect(); brancher(c2); }
      });
      obs.observe(document.body, { childList: true });
    };
    if (document.body) guetter(); else document.addEventListener('DOMContentLoaded', guetter);
  })();

  function _visible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkVisibilityCSS: true });
    return !!(el.offsetParent || el.getClientRects().length);
  }
  function _libelle(el) {
    let lab = null;
    try { lab = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null; } catch (_) {}
    const wrap = el.closest('label');
    const texte = ['BUTTON', 'SUMMARY', 'A', 'LABEL'].includes(el.tagName) || el.getAttribute('role') === 'button' || el.classList.contains('version-thumb') || el.classList.contains('project-card');
    const t = el.getAttribute('aria-label') || (texte ? el.innerText : '') || (lab && lab.innerText)
      || (wrap && wrap.innerText) || el.getAttribute('placeholder') || el.title || '';
    return String(t).replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  // Fenetres de l'appli : toutes n'ont pas la classe .modal-overlay (peinture, masque, edition de
  // mesh, visionneuses plein ecran…). On les reconnait a leur id, conteneur le plus EXTERIEUR.
  const _SEL_FENETRE = '.modal-overlay, [id*="modal"], [id^="lightbox"], [id$="fullscreen"]';
  const _RE_BLOC = /modal|lightbox|fullscreen|popup|toast|topbar|panel|history|about/i;
  const _CONTENEUR = (el) => el && !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'OPTION', 'CANVAS', 'SPAN', 'A'].includes(el.tagName);
  function _bloc(el) {
    let out = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (a.id && _CONTENEUR(a) && _RE_BLOC.test(a.id)) out = a;
    return out;
  }
  function _zone(el) {
    const m = el.closest('.modal-overlay'); if (m) return 'modal:' + (m.id || '?');
    const c = el.closest('.step-card'); if (c) return 'etape:' + (c.id || '?');
    const b = _bloc(el); if (b) return (/modal|lightbox|fullscreen|popup/i.test(b.id) ? 'modal:' : 'bloc:') + b.id;
    const pg = el.closest('.page, [id^="page-"]'); if (pg) return 'page:' + (pg.id || '?');
    return 'global';
  }
  /** Fenetres ouvertes (modales, visionneuses, outils plein ecran), de la plus ancienne a la plus haute. */
  function _fenetresOuvertes() {
    const out = [];
    for (const el of document.querySelectorAll(_SEL_FENETRE)) {
      if (!el.id || !_CONTENEUR(el) || !_visible(el)) continue;
      if (el.parentElement && el.parentElement.closest(_SEL_FENETRE)) continue;      // imbriquee : la parente suffit
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) continue;
      out.push(el);
    }
    return out;
  }
  const _idsFenetres = () => _fenetresOuvertes().map((e) => e.id);
  function _ref(el) {
    if (el.id) return '#' + el.id;
    if (!el.dataset.fabref) el.dataset.fabref = 'r' + (++_refN);
    return '@' + el.dataset.fabref;
  }
  /** Cible : 'id' | '#id' | '@r12' (reference du catalogue) | 'selecteur CSS' | {id|selector|ref|text, within?} */
  function _trouver(t) {
    if (t && typeof t === 'object') {
      if (t.ref) return _trouver(t.ref);
      if (t.id) return document.getElementById(t.id);
      if (t.selector) return document.querySelector(t.selector);
      if (t.text) {
        const racine = t.within ? _trouver(t.within) : document;
        if (!racine) return null;
        const cands = [...racine.querySelectorAll('button, a, summary, [role="button"], label, option, .version-thumb, .project-card, [data-fabref], li, span')];
        const txt = String(t.text).toLowerCase().trim();
        const lib = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return cands.find((e) => _visible(e) && lib(e) === txt) || cands.find((e) => _visible(e) && lib(e).includes(txt)) || null;
      }
      return null;
    }
    const s_ = String(t == null ? '' : t).trim();
    if (!s_) return null;
    if (s_.startsWith('@')) return document.querySelector('[data-fabref="' + CSS.escape(s_.slice(1)) + '"]');
    if (s_.startsWith('#') && /^#[\w-]+$/.test(s_)) return document.getElementById(s_.slice(1));
    const parId = document.getElementById(s_);
    if (parId) return parId;
    try { return document.querySelector(s_); } catch (_) { return null; }
  }
  function _exiger(t) {
    const el = _trouver(t);
    if (!el) throw new Error('element introuvable : ' + JSON.stringify(t) + ' (voir GET /ui/catalog)');
    return el;
  }
  // ZONES RESERVEES A L'UTILISATEUR (2026-09-30). Au niveau STANDARD de la
  // Control API (interrupteur des Reglages, acces confie a Claude), main pose
  // __garde : une automatisation ne peut ni se donner l'acces complet
  // (Reglages > Assistant), ni desinstaller ou tout effacer, ni reconfigurer,
  // ni toucher au controle parental (code PIN), ni changer le consentement aux
  // rapports d'erreur. Le niveau complet (developpement, FABMESH_TEST_API=1)
  // n'est pas concerne.
  const _ZONES_RESERVEES = ['#set-assistant', '#modal-assistant-aide', '#set-uninstall', '#about-suppr-donnees',
    '#modal-suppr-donnees', '#set-reconfigure', '#parental-toggle', '#btn-parental-lock', '#np-unlock',
    '#_pin-input', '#set-crash-optin', '#set-blender-browse'];
  function _garder(el, p) {
    if (!p || p.__garde !== true || !el || !el.closest) return;
    for (const sel of _ZONES_RESERVEES) {
      let dedans = false;
      try { dedans = !!el.closest(sel); } catch (_) {}
      if (dedans) throw new Error('reserved to the user, not available to automation: ' + _ref(el) + ' (' + sel + ')');
    }
  }
  /** Rend l'element atteignable : carte d'etape depliee, <details> parents ouverts. */
  function _deplier(el) {
    const ouverts = [];
    const carte = el.closest('.step-card');
    if (carte && carte.classList.contains('collapsed')) { carte.classList.remove('collapsed'); ouverts.push(carte.id || 'step-card'); }
    for (let d = el.closest('details'); d; d = d.parentElement ? d.parentElement.closest('details') : null) {
      if (!d.open) { d.open = true; ouverts.push('details'); }
    }
    return ouverts;
  }
  function _poser(el, val) {
    if (el.tagName === 'SELECT') {
      const v = String(val);
      const opt = [...el.options].find((o) => o.value === v) || [...el.options].find((o) => o.text.trim().toLowerCase() === v.toLowerCase());
      if (!opt) throw new Error('option absente de ' + _ref(el) + ' : ' + v + ' (options : ' + [...el.options].map((o) => o.value).join(', ') + ')');
      el.value = opt.value;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = val === true || val === 1 || val === 'true' || val === 'on';
    } else if (el.isContentEditable) {
      el.textContent = String(val == null ? '' : val);
    } else {
      el.value = String(val == null ? '' : val);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  }
  function _decrire(el, vis) {
    const e = { ref: _ref(el), tag: el.tagName.toLowerCase(), label: _libelle(el), zone: _zone(el) };
    if (el.type && el.tagName !== 'BUTTON') e.type = el.type;
    if (el.disabled || el.classList.contains('disabled')) e.disabled = true;
    if (!vis) e.hidden = true;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      e.value = el.type === 'checkbox' || el.type === 'radio' ? el.checked : String(el.value).slice(0, 200);
      if (el.type === 'range' || el.type === 'number') { if (el.min !== '') e.min = el.min; if (el.max !== '') e.max = el.max; }
    }
    if (el.tagName === 'SELECT') {
      e.value = el.value;
      e.options = [...el.options].slice(0, 60).map((o) => (o.text && o.text.trim() !== o.value ? o.value + '=' + o.text.trim().slice(0, 40) : o.value));
    }
    if (el.tagName === 'CANVAS') { const r = el.getBoundingClientRect(); e.taille = Math.round(r.width) + 'x' + Math.round(r.height); }
    if (el.tagName === 'DETAILS') e.open = el.open;
    if (el.title && el.title !== e.label) e.title = el.title.slice(0, 200);
    return e;
  }
  const _SEL_ACTIONS = 'button, input, select, textarea, summary, a[href], [role="button"], [contenteditable="true"], .version-thumb, .project-card, canvas';
  function uiCatalogue(p) {
    p = p || {};
    const tous = p.all === true || p.all === '1' || p.all === 1;
    const q = String(p.q || '').toLowerCase(), zone = String(p.zone || '');
    const out = [];
    for (const el of document.querySelectorAll(_SEL_ACTIONS)) {
      if (el.type === 'hidden') continue;
      const vis = _visible(el);
      if (!tous && !vis) continue;
      const e = _decrire(el, vis);
      if (zone && !e.zone.includes(zone)) continue;
      if (q && !(e.ref + ' ' + e.label + ' ' + (e.title || '') + ' ' + e.zone).toLowerCase().includes(q)) continue;
      out.push(e);
      if (out.length >= (Number(p.limit) || 800)) break;
    }
    const st = window.state || {};
    return { projet: (st.currentProject && st.currentProject.name) || null, modales: _idsFenetres(),
             n: out.length, elements: out };
  }
  async function uiClic(p) {
    const el = _exiger(p.target !== undefined ? p.target : p);
    _garder(el, p);
    const deplies = _deplier(el);
    if (el.disabled) throw new Error('element desactive : ' + _ref(el) + ' ' + _libelle(el));
    el.scrollIntoView({ block: 'center' });
    const avantM = _idsFenetres(), avantT = _toasts.length;
    if (el.tagName === 'OPTION' && el.parentElement && el.parentElement.tagName === 'SELECT') _poser(el.parentElement, el.value);
    else el.click();
    await new Promise((r) => setTimeout(r, Number(p.wait) >= 0 ? Number(p.wait) : 400));
    const modales = _idsFenetres();
    return { clique: _ref(el), label: _libelle(el), deplies, nouvellesModales: modales.filter((m) => !avantM.includes(m)),
             modales, toasts: _toasts.slice(avantT) };
  }
  function uiRemplir(p) {
    const res = {};
    for (const [k, v] of Object.entries((p && p.fields) || {})) {
      const el = _trouver(k);
      if (!el) { res[k] = { erreur: 'introuvable' }; continue; }
      try { _garder(el, p); } catch (e) { res[k] = { erreur: e.message }; continue; }
      _deplier(el);
      try { res[k] = _poser(el, v); } catch (e) { res[k] = { erreur: e.message }; }
    }
    return res;
  }
  function uiModale() {
    return _fenetresOuvertes().map((racine) => {
      const m = { id: racine.id, title: (racine.querySelector('h1, h2, h3, .modal-title') || {}).innerText || '',
                  text: (racine.innerText || '').trim() };
      const champs = [], boutons = [];
      if (racine) {
        for (const el of racine.querySelectorAll('input, select, textarea, canvas')) {
          if (el.type === 'hidden') continue;
          const vis = _visible(el);
          if (vis) champs.push(_decrire(el, vis));
        }
        for (const b of racine.querySelectorAll('button, summary, [role="button"]')) {
          if (_visible(b)) boutons.push({ ref: _ref(b), label: _libelle(b), disabled: !!b.disabled || undefined });
        }
      }
      return { id: m.id, titre: String(m.title).trim().slice(0, 200), texte: String(m.text || '').slice(0, 1500), champs, boutons };
    });
  }
  function uiRect(p) {
    const el = _exiger(p.target !== undefined ? p.target : p);
    _deplier(el);
    let r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || p.scroll) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
    return { ref: _ref(el), x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
  }
  async function uiAttendre(p) {
    p = p || {};
    const fin = Date.now() + Math.min(Number(p.timeout) || 30000, 600000);
    const ok = () => {
      if (p.target !== undefined) {
        const el = _trouver(p.target);
        const vu = !!el && _visible(el);
        if (p.gone ? vu : !vu) return false;
        if (p.enabled && el && el.disabled) return false;
      }
      if (p.modal && !_idsFenetres().includes(p.modal)) return false;
      if (p.noModal && _idsFenetres().length) return false;
      if (p.toast && !_toasts.some((t) => t.ts >= (Number(p.since) || 0) && t.text.toLowerCase().includes(String(p.toast).toLowerCase()))) return false;
      if (p.text && !(document.body.innerText || '').toLowerCase().includes(String(p.text).toLowerCase())) return false;
      if (p.jobsDone) {
        const j = getJobs();
        if (j.some((x) => x.status === 'running' || x.status === 'queued' || x.status === 'pending')) return false;
      }
      return true;
    };
    while (Date.now() < fin) {
      if (ok()) return { ok: true };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, timeout: true };
  }

  // ----------------------------------------------------------
  // 3. Command dispatcher (main -> renderer)
  // ----------------------------------------------------------
  window.__fabmeshTest.on('test:command', async (msg) => {
    if (!msg || !msg.id) return;
    const reply = (data, error) => window.__fabmeshTest.send('test:result', { id: msg.id, data, error });
    try {
      let data;
      switch (msg.action) {
        case 'state':          data = snapshotState(); break;
        case 'click':          data = clickSelector(msg.payload.selector); break;
        case 'set':            data = setInputValue(msg.payload.selector, msg.payload.value); break;
        case 'select-project': data = selectProjectByName(msg.payload.name); break;
        case 'generate-image': data = await generateImage(msg.payload); break;
        case 'generate-3d':    data = await generate3d(msg.payload); break;
        case 'auto-rig':       data = await autoRig(msg.payload); break;
        case 'jobs':           data = getJobs().map(j => ({ id: j.id, name: j.name, status: j.status, progress: j.progress })); break;
        case 'get-job':        data = getJob(msg.payload.id); break;
        case 'popups':         data = getPopups(); break;
        case 'dismiss-popup':  data = dismissPopup(msg.payload); break;
        case 'eval':           data = await evalCode(msg.payload.code); break;
        case 'ui-catalog':     data = uiCatalogue(msg.payload); break;
        case 'ui-click':       data = await uiClic(msg.payload || {}); break;
        case 'ui-fill':        data = uiRemplir(msg.payload); break;
        case 'ui-modal':       data = uiModale(); break;
        case 'ui-rect':        data = uiRect(msg.payload || {}); break;
        case 'ui-wait':        data = await uiAttendre(msg.payload); break;
        case 'ui-toasts':      data = _toasts.filter((t) => t.ts >= (Number(msg.payload && msg.payload.since) || 0)); break;
        default: throw new Error('unknown action: ' + msg.action);
      }
      reply(data, null);
    } catch (e) {
      reply(null, (e && e.message) || String(e));
    }
  });

  // Expose helpers on window for manual DevTools poking
  window.__fabmeshTestHelpers = {
    clickSelector, setInputValue, evalCode, snapshotState,
    getJobs, getJob, selectProjectByName, generateImage, generate3d, autoRig,
    getPopups, dismissPopup, uiCatalogue, uiClic, uiRemplir, uiModale, uiRect, uiAttendre
  };

  origLog('[test_api_client] installed');
})();
