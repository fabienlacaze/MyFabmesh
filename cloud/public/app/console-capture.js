// console-capture.js — intercepts console.log/warn/error/info into an
// in-memory ring buffer.
//
// The buffer is ALWAYS kept (it costs nothing and never leaves the tab).
// Sending it to the server is a different matter: it is OFF by default
// and only happens after the user turns "Diagnostic logs" on in Settings.
//
// WHY THE OPT-IN (2026-08-20): this file used to POST the whole console
// to /api/client-log at every Generate — prompts, project names, job ids,
// URL and User-Agent included — for every user, with nothing in the
// privacy policy saying so and nothing ever deleting it. That is personal
// data collected without a legal basis (GDPR art. 6) and without notice
// (art. 13). Convenient for solo debugging; not shippable.
//
// What is sent now, when and only when the user has enabled it:
//   - the console ring buffer, with obvious secrets redacted (see _redact)
//   - the page URL and User-Agent
//   - the current project name and job id
// The server keeps it for 30 days (DIAG_LOG_RETENTION_DAYS in worker.ts)
// and the privacy policy says so. Keep the three in sync.
//
// RAPPORTS D'ERREUR (2026-09-27, demande du user : « faire remonter les
// logs utiles, au mieux du RGPD »). Sans consentement au diagnostic complet,
// une operation qui ECHOUE envoie tout de meme un rapport MINIMISE : les 300
// dernieres lignes, secrets ET prompts masques (_redactPrompts). Base legale :
// interet legitime a corriger les defaillances (art. 6.1.f), annonce dans la
// politique de confidentialite, avec OPPOSITION possible dans Settings
// (ERR_KEY). Rien n'est envoye pour une operation reussie. Le serveur borne
// lui-meme ce mode (handleClientLog) : la garde cliente ne suffit pas.

(function () {
  if (window.__consoleCaptureInstalled) return;
  window.__consoleCaptureInstalled = true;

  const MAX_LINES = 2000;
  const OPTIN_KEY = 'fabmesh.diag.optin';
  // Opposition aux rapports d'erreur : '0' = refuse. Absent = accepte (interet
  // legitime, annonce dans la politique ; l'utilisateur peut s'y opposer).
  const ERR_KEY = 'fabmesh.diag.errors';
  const ERR_LINES = 300;
  const buffer = [];
  const orig = {
    log:   console.log.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    info:  console.info.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  };

  function isEnabled() {
    try { return localStorage.getItem(OPTIN_KEY) === '1'; }
    catch (_) { return false; }   // storage blocked → stay off
  }

  function errorsAllowed() {
    try { return localStorage.getItem(ERR_KEY) !== '0'; }
    catch (_) { return false; }   // storage blocked → no automatic report
  }

  function setErrorsAllowed(on) {
    try { localStorage.setItem(ERR_KEY, on ? '1' : '0'); } catch (_) {}
    orig.log('[console-capture] error reports', on ? 'allowed' : 'refused by user');
    return errorsAllowed();
  }

  function setEnabled(on) {
    try { localStorage.setItem(OPTIN_KEY, on ? '1' : '0'); } catch (_) {}
    orig.log('[console-capture] diagnostics', on ? 'ENABLED by user' : 'disabled');
    return isEnabled();
  }

  // Redaction — applied to every line just before it leaves the browser,
  // never to the local buffer (so the developer console stays readable).
  // These are the shapes that actually turn up in this app's logs: Supabase
  // JWTs, Stripe keys, Authorization headers, our own signed-R2 signatures,
  // and e-mail addresses.
  const REDACTIONS = [
    [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[jwt-redacted]'],
    [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,                 '[stripe-key-redacted]'],
    [/\bwhsec_[A-Za-z0-9]{8,}/g,                                       '[stripe-secret-redacted]'],
    [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,                          'Bearer [redacted]'],
    [/([?&](?:sig|token|access_token|refresh_token|api[_-]?key)=)[^&\s"']+/gi, '$1[redacted]'],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,            '[email-redacted]'],
  ];

  function _redact(line) {
    let s = String(line);
    for (const [re, to] of REDACTIONS) s = s.replace(re, to);
    return s;
  }

  // Rapports d'erreur seulement : les TEXTES SAISIS (prompt, prompt negatif,
  // style, zone ciblee…) sont masques, qu'ils apparaissent en JSON
  // ("prompt":"…") ou en texte (prompt: …, prompt=…). Le reste — etapes,
  // codes HTTP, messages d'erreur — est ce qui sert a corriger.
  const CLES_SAISIES = '(?:prompt|negative_?prompt|neg_?prompt|negPrompt|negativePrompt|userPrompt|user_prompt|positive|style|target_?text|targetText|caption|description)';
  const PROMPT_REDACTIONS = [
    [new RegExp('("' + CLES_SAISIES + '"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"', 'gi'), '$1"[texte-masque]"'],
    [new RegExp('\\b(' + CLES_SAISIES + ')(\\s*[:=]\\s*)[^\\n]+', 'gi'), '$1$2[texte-masque]'],   // jusqu'a la fin de ligne : un prompt contient des virgules
  ];
  // NOM DU PROJET (2026-10-03, constat D-08 : le nom du projet — souvent le sujet
  // de la creation, parfois un nom de personne ou de client — partait en clair
  // dans les rapports d'erreur, a la fois dans le champ `project` et dans les
  // lignes du journal). Dans un rapport d'erreur il est remplace par un
  // identifiant COURT ET STABLE (« projet-1a2b3c4d », hachage FNV-1a 32 bits du
  // nom) : deux rapports du meme projet restent rapprochables pour le
  // diagnostic, sans que le nom soit transmis. Le mode « diagnostic complet »
  // (consentement explicite, annonce dans la politique) n'est pas modifie.
  function _idProjet(nom) {
    let h = 0x811c9dc5;
    const s = String(nom);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'projet-' + h.toString(16).padStart(8, '0');
  }
  function _nomsProjet(meta) {
    const noms = [];
    const ajoute = (n) => { if (typeof n === 'string' && n.trim().length >= 3 && noms.indexOf(n.trim()) < 0) noms.push(n.trim()); };
    ajoute(meta && meta.project);
    try { ajoute(window.state?.currentProject?.name); } catch (_) {}
    // Les plus longs d'abord : « Chateau fort » avant « Chateau ».
    return noms.sort((a, b) => b.length - a.length);
  }
  // Toutes les ecritures sous lesquelles un nom peut apparaitre dans un journal ou une URL : exacte, sans
  // accents, et avec les separateurs usuels des slugs et des URL (espace -> _ - + . %20, ou encodage complet).
  // La casse est ignoree a la recherche (relecture du 2026-10-03 : « CHATEAU FORT », chateau_fort.glb et
  // Chateau%20Fort restaient en clair).
  function _formesProjet(nom) {
    const n = String(nom).trim();
    const sansAccents = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const formes = [];
    const ajoute = (f) => { if (f.length >= 3 && formes.indexOf(f) < 0) formes.push(f); };
    for (const base of [n, sansAccents]) {
      ajoute(base);
      for (const sep of ['_', '-', '+', '.', '%20']) ajoute(base.replace(/\s+/g, sep));
      try { ajoute(encodeURIComponent(base)); } catch (_) {}
    }
    return formes;
  }
  function _echapperRegex(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function _masquerProjet(line, noms) {
    const s = String(line);
    if (!noms || !noms.length) return s;
    // UNE SEULE passe sur tous les noms et toutes leurs formes : l'identifiant pose n'est jamais relu (un projet
    // nomme « Projet » ne donne plus projet-xxxxxxxx-xxxxxxxx). Un groupe par nom, les noms les plus longs d'abord
    // (_nomsProjet les trie), les formes de la plus longue a la plus courte. Le nom doit former un MOT ENTIER :
    // delimite par un caractere qui n'est ni lettre ni chiffre (ou par un « %XX » d'URL), sans lookbehind (Safari < 16.4).
    const groupes = [];
    const ids = [];
    for (const n of noms) {
      const formes = _formesProjet(n).sort((a, b) => b.length - a.length);
      if (!formes.length) continue;
      groupes.push('(' + formes.map(_echapperRegex).join('|') + ')');
      ids.push(_idProjet(n));
    }
    if (!groupes.length) return s;
    const re = new RegExp('(^|[^A-Za-z0-9]|%[0-9A-Fa-f]{2})(?:' + groupes.join('|') + ')(?![A-Za-z0-9])', 'gi');
    return s.replace(re, function () {
      for (let i = 0; i < ids.length; i++) if (arguments[i + 2] !== undefined) return arguments[1] + ids[i];
      return arguments[0];
    });
  }
  function _redactPrompts(line, noms) {
    let s = _redact(line);
    if (noms && noms.length) s = _masquerProjet(s, noms);
    for (const [re, to] of PROMPT_REDACTIONS) s = s.replace(re, to);
    return s.length > 600 ? s.slice(0, 600) + ' [...]' : s;
  }
  const ECHEC = /^(error|failed|fail|echec|canceled|cancelled)$/i;

  function _fmt(args) {
    try {
      return Array.from(args).map(a => {
        if (a == null) return String(a);
        if (typeof a === 'string') return a;
        if (typeof a === 'number' || typeof a === 'boolean') return String(a);
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
        try { return JSON.stringify(a); }
        catch { return String(a); }
      }).join(' ');
    } catch { return '[unfmt]'; }
  }

  function _push(level, args) {
    const ts = new Date().toISOString();
    buffer.push(`[${ts}] [${level}] ${_fmt(args)}`);
    if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  }

  ['log', 'warn', 'error', 'info', 'debug'].forEach(level => {
    console[level] = function () {
      _push(level, arguments);
      try { orig[level].apply(null, arguments); } catch (_) {}
    };
  });

  // Capture uncaught errors and unhandled promise rejections too.
  window.addEventListener('error', (e) => {
    _push('uncaught', [`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack || '']);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    _push('unhandledrejection', [r instanceof Error ? `${r.name}: ${r.message}\n${r.stack}` : _fmt([r])]);
  });

  function _payload(meta) {
    return {
      kind: meta.kind || 'unknown',
      status: meta.status || 'unknown',
      job_id: meta.job_id || null,
      project: meta.project || (window.state?.currentProject?.name || null),
      ua: navigator.userAgent,
      url: _redact(location.href),
      lines: buffer.map(_redact),
    };
  }

  // Rapport d'erreur minimise : 300 dernieres lignes, prompts masques.
  function _payloadErreur(meta) {
    const noms = _nomsProjet(meta);
    const projet = meta.project || (window.state?.currentProject?.name || null);
    return {
      mode: 'erreur',
      kind: meta.kind || 'unknown',
      status: meta.status || 'error',
      job_id: meta.job_id || null,
      // 2026-10-03 (D-08) : identifiant court et stable, jamais le nom.
      project: projet && String(projet).trim() ? _idProjet(String(projet).trim()) : null,
      ua: navigator.userAgent,
      url: _masquerProjet(_redact(location.href), noms),
      lines: buffer.slice(-ERR_LINES).map((l) => _redactPrompts(l, noms)),
    };
  }

  // Flush — POST the current buffer to /api/client-log. Full console only
  // with the diagnostics opt-in; otherwise a MINIMISED report for a FAILED
  // operation (unless the user objected). The caller doesn't have to check.
  async function flush(meta = {}) {
    if (!buffer.length) return { ok: true, skipped: true, reason: 'empty' };
    let payload;
    if (isEnabled()) payload = _payload(meta);
    else if (ECHEC.test(String(meta.status || '')) && errorsAllowed()) payload = _payloadErreur(meta);
    else return { ok: true, skipped: true, reason: 'diagnostics off' };
    try {
      const r = await fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
        keepalive: true,
      });
      if (!r.ok) {
        orig.warn('[console-capture] flush failed:', r.status);
        return { ok: false, status: r.status };
      }
      const j = await r.json().catch(() => ({}));
      orig.log('[console-capture] flushed', payload.lines.length, 'lines →', j?.path || '(no path)');
      return { ok: true, path: j?.path };
    } catch (e) {
      orig.warn('[console-capture] flush threw:', e?.message || e);
      return { ok: false, error: String(e) };
    }
  }

  // Saves the buffer to a local file — the way to hand over a log without
  // enabling any upload at all.
  function download() {
    const text = buffer.map(_redact).join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `myfabmesh-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Expose for manual + auto callers.
  window.__consoleCapture = {
    flush,
    download,
    isEnabled,
    setEnabled,
    errorsAllowed,
    setErrorsAllowed,
    buffer: () => buffer.slice(),
    clear: () => { buffer.length = 0; },
    size: () => buffer.length,
  };

  // Last buffer on the way out — same opt-in gate.
  window.addEventListener('beforeunload', () => {
    if (!buffer.length || !isEnabled()) return;
    try {
      const blob = new Blob([JSON.stringify(_payload({ kind: 'beforeunload', status: 'flush' }))],
                            { type: 'application/json' });
      navigator.sendBeacon('/api/client-log', blob);
    } catch (_) {}
  });

  orig.log('[console-capture] installed — buffer max', MAX_LINES,
           'lines; upload', isEnabled() ? 'ENABLED (user opt-in)'
             : (errorsAllowed() ? 'error reports only (minimised)' : 'off'));
})();
