/* TEXTES DU SERVEUR, TRADUITS A L'AFFICHAGE (lot interface multilingue, 2026-10-13 ; constat INTERFACE-03).
 * FICHIER COMMUN bureau / web : src/renderer/lib/textes-serveur.js = cloud/public/app/lib/textes-serveur.js
 * (build/check-noyaux-partages.mjs refuse une construction ou les deux copies different).
 *
 * POURQUOI. Le serveur ecrit ses refus en anglais (« insufficient credits — image generation costs 6
 * credits »), le bureau aussi pour ses propres refus cloud (« Not enough MyFabmesh credits… »), et
 * l'interface les montrait tels quels : la boite « plus assez de credits » etait en anglais dans les
 * six langues, comme les refus de plafond, les echecs « Export failed: … » et la plupart des messages
 * d'erreur. Les points d'affichage (showToast, customError, customErrorWithAction) passent desormais
 * chaque message par FabMessages.traduire(texte) :
 *   1. texte connu tel quel du dictionnaire (« Cloud generation is paused… ») -> sa traduction ;
 *   2. CODE du refus : celui que le serveur a envoye pour ce texte (worker.ts, avecCodeRefus ; retenu
 *      par meshyAPI-cloud.js), sinon celui que ce fichier reconnait (memes familles que REFUS_CONNUS du
 *      worker, verifie par cloud/tests/codes-refus.test.mjs) -> un gabarit traduit, avec le prix ;
 *   3. « <Prefixe>: <detail> » (« Export failed: … », « Error: … », « Server not responding: … ») : quand le
 *      gabarit « <Prefixe>: {x} » est traduit, le prefixe l'est, et le detail est traduit a son tour ;
 *   4. sinon le texte d'origine (l'anglais reste le repli, jamais un message vide).
 * Les tests d'expressions regulieres portent toujours sur le texte ANGLAIS d'origine : traduire ne
 * change aucune decision (bouton d'achat, reprise du jour, filtre de contenu).
 */
(function () {
  'use strict';

  // Familles de refus : MEMES expressions et MEMES codes que REFUS_CONNUS (cloud/src/worker.ts).
  const REFUS = [
    [/^insufficient credits\b(?:[\s\S]*?\bcosts?\s+(\d+))?/i, 'insufficient_credits', (m) => (m[1] ? { cost: Number(m[1]) } : null)],
    [/^Cloud generation is paused\b/i, 'compute_paused', null],
    [/^Free accounts share a daily cloud capacity\b/i, 'free_capacity_used', null],
    [/^You have reached today's generation limit for free accounts\b/i, 'free_daily_limit', null],
    [/^Your account has reached its daily safety limit\b/i, 'account_safety_limit', null],
    [/^The service has reached its daily capacity\b/i, 'service_daily_capacity', null],
    [/per-user daily generation limit|^user limit reached\b/i, 'daily_call_limit', null],
    [/^API key daily credit cap reached \((\d+)\/(\d+) credits today\)/i, 'api_key_daily_cap', (m) => ({ used: Number(m[1]), cap: Number(m[2]) })],
    [/^too many failed attempts\b/i, 'too_many_failed_attempts', null],
    [/^daily mesh upload quota reached\b/i, 'upload_quota', null],
    [/^Too many messages from this IP today\b|^Contact form is rate-limited today\b/i, 'contact_rate_limited', null],
    [/^too many reports today\b|^trop de signalements\b/i, 'reports_rate_limited', null],
    [/^Payments are temporarily unavailable\b/i, 'payments_unavailable', null],
    [/^Sales are not open yet\b/i, 'sales_closed', null],
    [/^site temporarily disabled\b/i, 'site_disabled', null],
    [/^account deletion could not start\b/i, 'account_deletion_failed', null],
    [/^auth(?:entication)? service unavailable\b/i, 'auth_unavailable', null],
    [/^unauthori[sz]ed$/i, 'unauthorized', null],
    [/^forbidden$/i, 'forbidden', null],
    [/^not found$/i, 'not_found', null],
  ];

  const I = () => (typeof window !== 'undefined' ? window.FabI18n : null);
  const t = (s) => { const i = I(); return (i && i.t) ? i.t(s) : s; };
  // Entree presente dans la langue courante (meme quand sa traduction s'ecrit comme la cle).
  const connu = (s) => { const i = I(); return !!(i && (typeof i.connu === 'function' ? i.connu(s) : (i.t && i.t(s) !== s))); };
  const tf = (s, ...a) => {
    const i = I();
    if (i && i.tf) return i.tf(s, ...a);
    let k = 0; return String(s).replace(/\{[xy]\}/g, () => (k < a.length ? String(a[k++]) : ''));
  };

  // Un gabarit traduit par code. Les textes anglais ci-dessous sont des CLES de dictionnaire
  // (lang/_additions6.js) ; build/check-traductions.mjs exige leur traduction dans les 5 langues.
  const GABARITS = {
    insufficient_credits: (p) => (p && p.cost
      ? (p.cost === 1 ? tf('Not enough credits: this action costs {x} credit.', 1) : tf('Not enough credits: this action costs {x} credits.', p.cost))
      : t('Not enough credits.')),
    compute_paused: () => t('Cloud generation is paused for now — your credits are safe and you were not charged. Please try again later.'),
    free_capacity_used: () => t('Free accounts share a daily cloud capacity, which has been used up for today. Your credits are safe and you were not charged.'),
    free_daily_limit: () => t("You have reached today's generation limit for free accounts. Your credits are safe and you were not charged."),
    account_safety_limit: () => t('Your account has reached its daily safety limit for cloud generation. Your credits are safe and you were not charged. Contact support if you need a higher limit.'),
    service_daily_capacity: () => t('The service has reached its daily capacity. Your credits are safe and you were not charged.'),
    daily_call_limit: () => t('You have reached the daily generation limit for your account. Try again tomorrow.'),
    api_key_daily_cap: (p) => tf('This API key has reached its daily credit cap ({x} of {y} credits used today).', p.used, p.cap),
    too_many_failed_attempts: () => t('Too many failed attempts. Try again in an hour.'),
    upload_quota: () => t('Daily upload quota reached. Try again tomorrow.'),
    contact_rate_limited: () => t('Too many messages today. Please try again tomorrow.'),
    reports_rate_limited: () => t('Too many reports today. Please try again tomorrow.'),
    payments_unavailable: () => t('Payments are temporarily unavailable. Please try again later.'),
    sales_closed: () => t('Purchases are not open yet.'),
    site_disabled: () => t('The site is temporarily unavailable. Please try again later.'),
    account_deletion_failed: () => t('Account deletion could not start (temporary error). Nothing was deleted. Please try again.'),
    auth_unavailable: () => t('The sign-in service is unavailable. Please try again in a moment.'),
    unauthorized: () => t('Your session has expired. Please sign in again.'),
    forbidden: () => t('You are not allowed to do this.'),
    not_found: () => t('Not found.'),
  };

  // Codes envoyes par le serveur, par texte (meshyAPI-cloud.js les retient a la reception).
  const _registre = new Map();
  function retenir(corps) {
    try {
      if (!corps || typeof corps.error !== 'string' || typeof corps.code !== 'string') return;
      if (_registre.size > 200) _registre.clear();
      _registre.set(corps.error.trim(), { code: corps.code, params: corps.params || null });
    } catch (_) { /* jamais bloquant */ }
  }

  function reconnaitre(texte) {
    const s = String(texte == null ? '' : texte).trim();
    if (!s) return null;
    const connu = _registre.get(s);
    if (connu) return connu;
    for (const [re, code, params] of REFUS) {
      const m = s.match(re);
      if (m) return { code, params: params ? params(m) : null };
    }
    return null;
  }

  // `detail` : le texte est la SUITE d'un « Prefixe: » (etape 3). Revue du 2026-10-14 : le detail repassait par le
  // dictionnaire entier, et un NOM choisi par l'utilisateur change de texte (« Export failed: Settings » devenait
  // « Error en la exportación: Ajustes »). Un detail d'un seul mot n'est donc plus cherche tel quel dans le
  // dictionnaire : les refus d'un mot (« unauthorized », « forbidden ») passent par leur CODE (etape 2), le reste
  // (nom de projet, de fichier, d'outil) garde son texte. Limite assumee : un nom de plusieurs mots identique a un
  // libelle de l'interface serait encore traduit.
  function traduire(texte, detail) {
    const brut = String(texte == null ? '' : texte);
    const i = I();
    const s = brut.trim();
    if (!s || !i || i.lang === 'en') return brut;
    // 1. texte connu tel quel
    if (!detail || /\s/.test(s)) {
      const direct = t(s);
      if (direct !== s) return direct;
    }
    // 2. refus reconnu par son code
    const info = reconnaitre(s);
    if (info && GABARITS[info.code]) return GABARITS[info.code](info.params || {});
    // 2 bis. « HTTP 503: <message> » (getJSON de meshyAPI-cloud.js pendant un sondage) : le statut reste tel quel, le
    //    message est traduit. Avant (revue du 2026-10-14), le prefixe cachait le message aux etapes 1 et 2.
    const http = s.match(/^(HTTP \d{3}): ([\s\S]+)$/);
    if (http) {
      const suite = traduire(http[2]);
      return suite.trim() !== http[2].trim() ? http[1] + ': ' + suite : brut;
    }
    // 3. « <Prefixe>: <detail> » : n'importe quel prefixe court (premier « : ») dont le gabarit est traduit.
    //    Avant (2026-10-13 matin) seuls « … failed: » / « … error: » l'etaient : « Error: … », « Failed: … »,
    //    « Server not responding: … » restaient en anglais malgre leur gabarit traduit dans les cinq langues.
    const deux = s.indexOf(': ');
    if (deux > 0 && deux <= 80 && s.lastIndexOf('\n', deux) < 0) {
      const gabarit = s.slice(0, deux) + ': {x}';
      if (connu(gabarit)) return tf(gabarit, traduire(s.slice(deux + 2), true));
    }
    return brut;
  }

  const api = { traduire, reconnaitre, retenir, codes: () => REFUS.map((r) => r[1]) };
  if (typeof window !== 'undefined') window.FabMessages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}());
