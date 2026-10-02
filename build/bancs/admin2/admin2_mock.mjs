// Serveur d'essai de /admin2 : sert la page et SIMULE l'API admin (aucun appel reseau reel, aucun compte). Etat modifiable par les POST.
const OPERATIONS_MOCK = ['text2image', 'tpose', 'rectify', 'back-view', 'sheet', 'remove-bg', 'modify', 'auto_inpaint', 'mask_inpaint', 'face_fix_image', 'upscale', 'tex_variant', 'recolor', 'outfit', 'segment-image', 'mesh', 'mesh-face', 'retexture', 'reshape', 'segment', 'rig', 'animate', 'animate_fbx', 'construction3d', 'mesh-convert', 'mesh-op:smooth', 'mesh-op:decimate', 'mesh-op:watertight', 'mesh-op-client:paint_mesh', 'mesh-op-client:clone3d'];
const FAMILLES_MOCK = Object.fromEntries(OPERATIONS_MOCK.map((k) => [k, ['modify', 'auto_inpaint', 'mask_inpaint', 'face_fix_image', 'upscale', 'tex_variant', 'recolor', 'outfit', 'segment-image'].includes(k) ? 'text2image' : k.includes(':') ? k.split(':')[0] : k]));
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';

const PAGE = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/cloud/public/admin2.html';
const PORT = Number(process.argv[2] || 8799);
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const MAILS = ['lea.martin@exemple.fr', 'hugo.v@exemple.fr', 'nora.b@exemple.be', 'sam.t@exemple.ca'];

const etat = {
  totp: { enrolled: true, enrolled_at: new Date(now - 40 * 86400e3).toISOString(), email: 'admin@exemple.fr' }, annules: [], images: ['u1/front/ref_0.png'],
  recon: [{ created_at: new Date(now - 5 * 3600e3).toISOString(), email: 'lea.martin@exemple.fr', user_id: 'u1', pack_id: 'pack_500', amount_eur: 19, stripe_session_id: 'cs_live_a1b2c3d4e5f6g7h8i9', expected_credits: 500 }],
  meshes: [{ id: 'm1', mesh_url: 'data:text/plain,glb1', project_name: 'bus', asset_type: 'vehicle', created_at: new Date(now - 7200e3).toISOString() }, { id: 'm2', mesh_url: 'data:text/plain,glb2', project_name: 'cochon', asset_type: 'creature', created_at: new Date(now - 90000e3).toISOString() }],
  offerts: [], prixAnnonce: 1200, annonceSupprimee: false,
  svc: { modal_enabled: true, site_enabled: true, stripe_enabled: true }, mkt: { enabled: false, reason: '' },
  garde: { mesh: { on: true, until: now + 2 * 3600e3 } },
  credits: { u1: 420, u2: 85, u3: 1250, u4: 12 }, banned: {},
  msgs: [
    { id: 'm1', name: 'Sam', email: 'sam.t@exemple.ca', user_id: 'u4', user_email: 'sam.t@exemple.ca', subject: 'Génération échouée', message: 'Ma génération a échoué deux fois.', created_at: iso(3 * 3600e3), read: false, replied: false, ip: '203.0.113.7', attachments: [{ role: 'preview', name: 'capture.png', mime: 'image/png', size: 51200, url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><rect width="260" height="160" fill="#a44"/><text x="130" y="90" font-size="28" text-anchor="middle" fill="white">capture</text></svg>') }, { role: 'reported', name: 'objet.glb', mime: 'model/gltf-binary', size: 3200000, url: 'data:text/plain,glb' }] },
    { id: 'm2', name: 'Anonyme <i>x</i>', email: 'visiteur@exemple.org', subject: 'Question', message: 'Bonjour <b>test</b>', created_at: iso(30 * 3600e3), read: true, replied: true, replied_at: iso(20 * 3600e3), reply_body: 'Merci, nous regardons.', attachments: [] },
  ],
  listings: [{ id: 'a1', title: 'Guerrier low-poly', author_display: 'jan.k', user_id: 'u9', licence: 'cc-by', price_cents: 1200, status: 'pending', asset_kind: 'mesh', mesh_url: 'data:text/plain,glb', apercu_url: 'data:text/plain,glb', created_at: iso(7 * 3600e3), description: 'Un guerrier.' },
    { id: 'a2', title: 'Portail <img src=x>', author_display: 'lea', user_id: 'u1', licence: 'commercial', price_cents: 500, status: 'approved', asset_kind: 'image', asset_url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#363"/></svg>'), apercu_url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#363"/></svg>'), created_at: iso(30 * 3600e3), description: '' }],
  pricing: { defaults: { text2image: 4, mesh_fast: 20, rig: 30, desktop_prix_centimes: 8999 }, current: { text2image: 4, mesh_fast: 25, rig: 30 } },
};
const j = (res, o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const evts = Array.from({ length: 30 }, (_, i) => ({ ts: iso((i + 1) * 4 * 60e3), email: MAILS[i % 4], type: ['mesh', 'image', 'rig', 'image_op'][i % 4], statut: i % 9 === 0 ? 'failed' : 'succeeded', projet: ['bus', 'cochon', 'knight'][i % 3], duree_s: 20 + i * 13, credits: i % 9 === 0 ? 0 : [60, 4, 30, 6][i % 4], erreur: i % 9 === 0 ? 'timeout du conteneur' : null }));
const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(now - (29 - i) * 86400e3).toISOString().slice(0, 10); const o = 8 + ((i * 7) % 23); return { day: d, ops: o, users: 2 + (i % 5), revenue_eur: +(o * 0.4).toFixed(2), cost_eur: +(o * 0.17).toFixed(2), margin_eur: +(o * 0.23).toFixed(2), downloads: 3 + ((i * 5) % 11), real_cost_eur: i > 14 ? +(o * 0.12).toFixed(2) : null }; });

const routes = {
  'GET /api/admin/live': () => ({ ok: true, maintenant: iso(0), en_ligne: MAILS.map((e, i) => ({ email: e, vu_il_y_a_s: 20 + i * 200, en_ligne: i < 2 })), en_cours: ([{ id: 'j1', email: MAILS[0], type: 'mesh', statut: 'processing', projet: 'bus', age_s: 140, credits: 60 }, { id: 'j2', email: MAILS[2], type: 'rig', statut: 'processing', projet: 'knight', age_s: 35, credits: 30 }, { id: 'j3', email: MAILS[1], type: 'image', statut: 'processing', projet: 'knight', age_s: 12, credits: 4 }]).filter((x) => etat.annules.indexOf(x.id) < 0),
    fenetres: { m5: { lances: 3, reussis: 3, echecs: 0, credits: 70, comptes: 2 }, m15: { lances: 7, reussis: 6, echecs: 1, credits: 140, comptes: 3 }, h1: { lances: 28, reussis: 25, echecs: 3, credits: 600, comptes: 4 } },
    evenements: evts, serie_5min: Array.from({ length: 12 }, (_, i) => ({ ok: (i * 3) % 7 + 1, echecs: i % 5 === 0 ? 1 : 0 })) }),
  'GET /api/admin/jobs/active': () => ({ jobs: [{ id: 'j1', email: MAILS[0], type: 'mesh', status: 'processing', credit_cost: 60, created_at: iso(140e3), project_name: 'bus' }, { id: 'z1', email: MAILS[3], type: 'mesh', status: 'processing', credit_cost: 60, created_at: iso(5 * 3600e3), project_name: 'vieux-chateau' }].filter((x) => etat.annules.indexOf(x.id) < 0) }),
  'GET /api/admin/services': () => etat.svc,
  'POST /api/admin/services': (b) => { if (b.service === 'all') { etat.svc = { modal_enabled: b.enabled, site_enabled: b.enabled, stripe_enabled: b.enabled }; etat.mkt.enabled = !b.enabled; } else etat.svc[b.service + '_enabled'] = b.enabled; if (!etat.svc.modal_enabled) etat.garde = {}; return { ok: true, ...etat.svc }; },
  'GET /api/admin/market/killswitch': () => ({ killswitch: etat.mkt }),
  'POST /api/admin/market/killswitch': (b) => { etat.mkt = { enabled: b.enabled, reason: b.reason }; return { ok: true }; },
  'GET /api/admin/modal-credits': (b, u) => { const prevision = { calcule_le: iso(0), niveau: 'ok', couleur: 'vert', urgence: false, titre: 'Budget tenu', phrase: 'Au rythme actuel, la limite du mois ne sera pas atteinte.', depense_usd: 41.3, reste_usd: 108.7, limite: { usd: 150, source: 'admin', enregistree_le: iso(5 * 86400e3) }, aujourdhui_usd: 3.42, hier_usd: 2.9, rythme_usd_jour: 3.1, fin_prevue_usd: 93, cycle_nom: 'octobre 2026', cycle_fin_ts: new Date(now + 20 * 86400e3).toISOString(), jour_utc_debut_ts: iso(5 * 3600e3), releve: { ts: iso(40 * 60e3), usage_usd: 41.3, etat: 'a_jour', mois_nom: 'octobre' }, arret_auto: { etat: 'actif', raison: '' }, bandeau: { couleur: 'orange', texte: 'Modal : coupure prévue le mercredi 21 octobre vers 11 h — il reste 143,24 $ sur 150,00 $.' } };
    if (u.searchParams.get('legere') === '1') return { ok: true, prevision };
    return { ok: true, prevision, postes: [{ nom: 'Maillage 3D', usd: 22.4 }, { nom: 'Images', usd: 9.1 }, { nom: 'Squelette', usd: 5.3 }], postes_mois: '2026-10',
      repartition: { mois: '2026-10', admin_usd: 30.2, admin_ops: 310, clients_usd: 7.4, clients_ops: 44, clients_comptes: 5, technique_usd: 3.7, tronque: false },
      protections: { arret_auto: { etat: 'actif', raison: '' }, email_alerte: { configure: etat.emailAlerte !== false, destinataires: ['admin@exemple.fr'] }, interrupteur_modal: { actif: etat.svc.modal_enabled }, plafond_quotidien: { usd: 20, depense_estimee_usd: 6.5, remise_ts: new Date(now + 6 * 3600e3).toISOString() } } }; },
  'POST /api/admin/modal-credits/total': (b) => b.apercu ? ({ ok: true, apercu: true, total: b.total, prevision: b.total < 40 ? { niveau: 'atteinte', depense_usd: 41.3 } : { niveau: 'ok', icone: 'OK', titre: 'Budget tenu', phrase: 'Au rythme actuel, la limite ne sera pas atteinte.' } }) : ({ ok: true, total: b.total, prevision: { calcule_le: iso(0), niveau: 'ok', couleur: 'vert', urgence: false, titre: 'Budget tenu', phrase: 'ok', depense_usd: 41.3, reste_usd: 108.7, limite: { usd: b.total, source: 'admin' }, aujourdhui_usd: 3.42, hier_usd: 2.9, rythme_usd_jour: 3.1, fin_prevue_usd: 93, releve: { ts: iso(40 * 60e3), usage_usd: 41.3 }, arret_auto: { etat: 'actif', raison: '' }, bandeau: null } }),
  'GET /api/admin/badges': () => ({ market_pending: etat.listings.filter((l) => l.status === 'pending').length, messages_unread: etat.msgs.filter((m) => !m.read).length, active: 2 }),
  'GET /api/admin/payments': () => ({ count: 3, acheteurs: 2, total_encaisse_eur: 73, achats: [
    { date: iso(2 * 3600e3), email: MAILS[0], pack: 'Pack 500', encaisse_eur: 19, credits: 500, etat: 'credite', stripe_id: 'cs_live_abc', test: false },
    { date: iso(20 * 3600e3), email: MAILS[2], pack: 'Pack 1500', encaisse_eur: 49, credits: 1500, etat: 'credite', stripe_id: 'cs_live_def', test: false },
    { date: iso(5 * 86400e3), email: MAILS[1], pack: 'Pack 100', encaisse_eur: 5, credits: 100, etat: 'credite', stripe_id: 'cs_test_xyz', test: true }] }),
  'GET /api/admin/stats.json': () => ({ generated_at: iso(0), users: { total: 41, users_with_ops: 12, signups_total: 58, active_7d: 9, active_30d: 17, online_now: 2 }, operations: { total: 900, succeeded: 840, failed: 60 }, cron: { ts: iso((etat.cronAgeMin == null ? 12 : etat.cronAgeMin) * 60e3), scanned: 18, reaped: 1, credits_refunded: 60, duration_ms: 840, errors: [] }, jobs_truncated: false,
    by_type_30d: { cout_reel: true, eur_par_credit: 0.162, facture_sans_operation_eur: 1.4, types: { mesh: { count: 120, failed: 9, credits: 7000, value_eur: 190, real_eur: 95, paid_eur: 60 }, rig: { count: 40, failed: 6, credits: 1200, value_eur: 40, real_eur: 46, paid_eur: 10 }, image: { count: 400, failed: 4, credits: 1600, value_eur: 26, real_eur: 0.003, paid_eur: 8 }, anim: { count: 12, failed: 0, credits: 0, value_eur: 0, real_eur: 3, paid_eur: 0 }, modify: { count: 30, failed: 2, credits: 90, value_eur: 14.6, real_eur: 0.2, paid_eur: 0 }, 'mesh-op:smooth': { count: 5, failed: 0, credits: 5, value_eur: 0.8, real_eur: 0.01, paid_eur: 0 } },
      connues: OPERATIONS_MOCK, familles: FAMILLES_MOCK },
    revenue: { credits_revenue_payeurs_eur: 41.5, credits_revenue_offerts_eur: 12.25, payeurs_count: 2, payments_count: 3, total_gross_eur: 73, total_cost_eur: 310, total_margin_eur: -20, real_cost_eur: 38.4, real_margin_eur: 34.6, real_revenue_mois_eur: 73, real_usage_age_h: 1, real_usage_usd: 41.3 },
    last_7d: { ops: 120, revenue_eur: 40, margin_eur: 22 }, series_30d: days, desktop_downloads_total: 213 }),
  'GET /api/admin/audience.json': () => ({ ok: true, fenetre_jours: 7, par_pays: [{ cle: 'FR', travaux: 320, reussis: 300, echecs: 20, taux_echec_pct: 6.3, credits: 900, comptes: 5 }, { cle: 'BE', travaux: 110, reussis: 105, echecs: 5, taux_echec_pct: 4.5, credits: 400, comptes: 2 }, { cle: 'inconnu', travaux: 40, reussis: 40, echecs: 0, taux_echec_pct: 0, credits: 80, comptes: 1 }], par_provenance: [{ cle: 'web', travaux: 300, reussis: 280, echecs: 20, taux_echec_pct: 6.6, credits: 800, comptes: 6 }, { cle: 'bureau', travaux: 170, reussis: 165, echecs: 5, taux_echec_pct: 2.9, credits: 580, comptes: 3 }], note: 'Les lignes anterieures au 2026-08-23 apparaissent en « inconnu ».' }),
  'GET /api/admin/users': () => ({ total: 4, returned: 4, truncated: false, jobs_truncated: true, users: MAILS.map((e, i) => ({ id: 'u' + (i + 1), email: e, credits: etat.credits['u' + (i + 1)], created_at: iso((i + 3) * 86400e3), banned: !!etat.banned['u' + (i + 1)], projects_count: i + 1, meshes_count: i * 2, ops_total: 10 + i * 20, ops_failed: i, ops_succeeded: 9 + i * 19, credits_spent: 100 * i, rigs_count: i, animations_count: 0, last_activity: iso((i + 1) * 3600e3) })) }),
  'POST /api/admin/users/credits': (b) => { if (b.password !== 'bon') return [401, { error: 'invalid password' }]; etat.credits[b.userId] += b.delta; return { ok: true, credits: etat.credits[b.userId] }; },
  'POST /api/admin/users/ban': (b) => { etat.banned[b.userId] = b.ban; return { ok: true }; },
  'GET /api/admin/contact-messages': () => ({ messages: etat.msgs }),
  'GET /api/admin/market/list': () => ({ listings: etat.annonceSupprimee ? [] : etat.listings.map((l, i) => ({ ...l, price_cents: i === 0 ? etat.prixAnnonce : l.price_cents })), offerts: etat.offerts, offerts_max: 5 }),
  'GET /api/admin/pricing': () => etat.pricing,
  'POST /api/admin/pricing': (b) => { etat.pricing.current = b.prices; return { ok: true, current: b.prices }; },
  'GET /api/admin/modal-status': () => ({ mesh: { etat: etat.garde.mesh ? 'warm' : 'cold' }, image_op: { etat: 'cold' }, text2image: { etat: 'busy' }, rig: { etat: 'cold' }, anim: { etat: 'absent' }, mesh_segment: { etat: 'cold' }, fbx_retarget: { etat: 'cold' }, garde_chaud: etat.garde, garde_chaud_heures: 3 }),
  'POST /api/admin/warm-switch': (b) => { for (const [k, v] of Object.entries(b.cibles)) { if (v) etat.garde[k] = { on: true, until: now + 3 * 3600e3 }; else delete etat.garde[k]; } return { ok: true, echecs: [] }; },
  'GET /api/admin/sante.json': () => ({ ok: true, pret_a_vendre: false, points: [{ cle: 'stripe_mode', ok: false, etat: 'cle de TEST', consequence: 'Aucun paiement réel ne peut aboutir.', action: 'npx wrangler secret put STRIPE_SECRET_KEY' }, { cle: 'dettes_credits', ok: true, etat: 'aucune' }], note: 'Chacun de ces points échoue en silence.' }),
  'GET /api/admin/totp/status': () => ({ enrolled: true, enrolled_at: iso(40 * 86400e3), email: 'admin@exemple.fr' }),
  'GET /api/admin/images/recent': (b, u) => { const uid = u.searchParams.get('uid'); const comptes = ['u1', 'u2', 'u3', 'u4']; const n = Number(u.searchParams.get('n') || 48);
    const liste = Array.from({ length: 14 }, (_, i) => { const cu = uid || comptes[i % 4]; const col = ['#c84cff', '#4cd964', '#ffaa33', '#4c9aff'][i % 4];
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="' + col + '"/><text x="200" y="215" font-size="60" text-anchor="middle" fill="white">img ' + i + '</text></svg>';
      return { key: cu + '/front/ref_' + i + '.png', url: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), size: 250000 + i * 1000, uploaded: iso((i + 1) * 3600e3), email: MAILS[Number(cu.slice(1)) - 1], user_id: cu, dossier: ['front', 'outfit', 'removebg', 'back'][i % 4] }; });
    return { images: liste.slice(0, n), comptes: uid ? 1 : 4, jours: 3, total_trouve: 40 }; },
  'GET /api/admin/creations': (b, u) => { const onglet = u.searchParams.get('onglet') || 'images'; const uid = u.searchParams.get('uid'); const n = Number(u.searchParams.get('n') || 60);
    const comptes = ['u1', 'u2', 'u3', 'u4'];
    const svg = (txt, col) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="' + col + '"/><text x="200" y="215" font-size="48" text-anchor="middle" fill="white">' + txt + '</text></svg>');
    const mk = (i, extra) => { const cu = uid || comptes[i % 4]; return Object.assign({ id: onglet + '-' + i, tab: onglet, email: MAILS[Number(cu.slice(1)) - 1], user_id: cu, created_at: iso((i + 1) * 5400e3), projet: ['Chevalier', 'Bus', 'Cochon volant', 'Portail'][i % 4], key: null }, extra); };
    let items = [];
    if (onglet === 'images') items = Array.from({ length: 9 }, (_, i) => mk(i, { key: 'u1/front/ref_' + i + '.png', kind: ['front', 'rectified', 'tpose', 'modified'][i % 4], url: svg('image ' + i, ['#c84cff', '#4cd964', '#ffaa33', '#4c9aff'][i % 4]), params: { seed: 1000 + i, steps: 30, asset_type: 'character', asset_style: 'realistic', mode: 'text2image', origin: 'web', count: 1 } }));
    else if (onglet === '3d') items = Array.from({ length: 6 }, (_, i) => mk(i, { kind: 'mesh', url: i % 3 ? svg('3D ' + i, '#4c9aff') : null, mesh_url: 'https://exemple.test/mesh/' + i + '.glb', params: { type: 'mesh', objet: 'character', mode: 'quality', credits: 40, cout_usd: 0.31, duree_s: 220 + i * 7, resolution: 1024 } }));
    else if (onglet === 'rigs') items = Array.from({ length: 3 }, (_, i) => mk(i, { kind: 'rig', url: null, mesh_url: 'https://exemple.test/rig/' + i + '.glb', params: { type: 'rig', credits: 15, duree_s: 180 } }));
    else if (onglet === 'animations') items = [];
    else items = Array.from({ length: 5 }, (_, i) => mk(i, { kind: 'projet', url: i % 2 ? svg('projet ' + i, '#ffaa33') : null, params: { images: 4 + i, maillages_3d: i, rigs: i % 2, animations: 0 } }));
    return { ok: true, onglet, items: items.slice(0, n), comptes: uid ? 1 : 4 }; },
  'GET /api/admin/creation-texte': (b, u) => { etat.textesLus = (etat.textesLus || 0) + 1; return { ok: true, texte: { prompt: 'un chevalier en armure bleue <script>alert(1)</script>', negative_prompt: 'flou' } }; },
  'GET /api/admin/argent-recent': (b, u) => { const h = Number(u.searchParams.get('heures') || 24); const pas = h <= 6 ? 30 : h <= 24 ? 60 : 180; const n = Math.ceil(h * 60 / pas);
    const buckets = Array.from({ length: n }, (_, i) => { const v = 1 + ((i * 7) % 5); return { debut: new Date(now - (n - i) * pas * 60e3).toISOString(), ops: v, echecs: i % 6 === 0 ? 1 : 0, comptes: 1 + ((i * 3) % 4), credits: v * 20, valeur_eur: +(v * 3.2).toFixed(2), cout_eur: +(v * 1.1).toFixed(2) }; });
    const sum = (k) => buckets.reduce((a, c) => a + c[k], 0);
    return { ok: true, heures: h, pas_min: pas, estimation: true, tronque: false, eur_par_credit: 0.162, buckets,
      connues: OPERATIONS_MOCK, familles: FAMILLES_MOCK,
      cout_reel: { heure: { usd: 0.41, eur: 0.38, de: iso(3720e3), a: iso(120e3), minutes: 60 }, fenetre: { usd: 2.2, eur: 2.05, de: iso(6 * 3600e3 + 120e3), a: iso(120e3), minutes: 360, complet: true }, dernier_releve: iso(120e3), age_min: 2 },
      types: { mesh: { count: 6, failed: 1, credits: 360, valeur_eur: 58.32, cout_eur: 31.2 }, rig: { count: 3, failed: 0, credits: 90, valeur_eur: 14.58, cout_eur: 21.4 }, 'remove-bg': { count: 9, failed: 0, credits: 18, valeur_eur: 2.9, cout_eur: 0.004 } },
      totaux: { ops: sum('ops'), echecs: 2, credits: sum('credits'), valeur_eur: +sum('valeur_eur').toFixed(2), cout_eur: +sum('cout_eur').toFixed(2) } }; },
  'POST /api/admin/login': (b) => { if (b.password !== 'bon') return [401, { error: 'invalid password' }]; if (sess.totp && !b.totp) return [401, { error: 'totp_required' }]; if (sess.totp && b.totp !== '123456') return [401, { error: 'invalid totp' }]; sess.mdp = false; return { ok: true }; },
  'POST /api/admin/logout': () => { sess.mdp = true; return { ok: true }; },
  'POST /api/admin/reset-request': () => ({ ok: true, sent_to: 'a***@exemple.fr' }),
  'POST /api/admin/reset-verify': (b) => b.code === '654321' ? { ok: true, ticket: 'T1' } : [401, { error: 'invalid_code' }],
  'POST /api/admin/reset-password': (b) => b.ticket === 'T1' && b.newPassword.length >= 20 ? { ok: true } : [400, { error: 'ticket_invalid' }],
  'GET /api/admin/totp/status': () => etat.totp.enrolled ? { enrolled: true, enrolled_at: etat.totp.enrolled_at, email: etat.totp.email } : { enrolled: false },
  'POST /api/admin/totp/setup': () => ({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/MyFabmesh:admin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=MyFabmesh' }),
  'POST /api/admin/totp/confirm': (b) => { if (etat.totp.enrolled && b.current_code !== '654321') return [401, { error: 'invalid current code' }]; if (b.code !== '123456') return [401, { error: 'invalid code' }]; etat.totp = { enrolled: true, enrolled_at: new Date().toISOString(), email: 'admin@exemple.fr' }; return { ok: true }; },
  'POST /api/admin/totp/disable': () => [403, { error: 'totp_disable_unavailable' }],
  'GET /api/admin/traces': (b, u) => ({ traces: [{ id: 't1', date: new Date(now - 600e3).toISOString(), email: MAILS[0], operation: 'mesh', type: 'mesh', asset_type: 'vehicle', projet: 'bus', status: 'failed', duree_s: 301, credits: 0, erreur: 'Le conteneur a dépassé le délai\nligne 2', cout_usd: 0.4, reglages: { preset: 'ultra_8k' }, rapport: '_logs/u1/log1.log' }, { id: 't2', date: new Date(now - 1200e3).toISOString(), email: MAILS[1], operation: 'rig', status: 'succeeded', duree_s: 90, credits: 30, projet: 'knight', reglages: {} }].filter((t) => !u.searchParams.get('failed') || t.status === 'failed') }),
  'GET /api/admin/logs/list': () => ({ count: 1, logs: [{ key: '_logs/u1/log1.log', uid: 'u1', email: MAILS[0], kind: 'client', status: 'error', project: 'bus', uploaded: new Date(now - 700e3).toISOString(), size: 5300 }] }),
  'POST /api/admin/jobs/cancel': (b) => { etat.annules.push(b.jobId); return { ok: true, refunded: b.refund ? 60 : 0, modalCancelled: true }; },
  'GET /api/admin/payments/unreconciled': () => ({ count: etat.recon.length, payments: etat.recon }),
  'POST /api/admin/payments/reconcile': (b) => b.password !== 'bon' ? [401, { error: 'invalid password' }] : (etat.recon = [], { ok: true, credits: 500, amount_eur: 19, balance: 920 }),
  'DELETE /api/admin/images': (b, u) => { etat.images = etat.images.filter((k) => k !== u.searchParams.get('key')); return { ok: true, deleted: u.searchParams.get('key') }; },
  'GET /api/admin/audit': () => ({ day: 'x', entries: [{ ts: iso(3600e3), actor: 'admin@exemple.fr', ip: '198.51.100.4', ua: 'Mozilla', action: 'toggle_service', target: 'modal', enabled: true, service: 'modal' }, { ts: iso(7200e3), actor: 'admin@exemple.fr', ip: '198.51.100.4', ua: 'Mozilla', action: 'reconcile_payment', target: 'cs_live_x', credits: 500, new_balance: 920 }] }),
  'POST /api/admin/force-logout-all': (b) => b.password === 'bon' ? { ok: true } : [401, { error: 'invalid password' }],
  'POST /api/auth/refresh': () => ({ ok: true }),
};
const sess = { perdue: false, mdp: false, totp: false };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const key = req.method + ' ' + u.pathname;
  if (u.pathname === '/admin2') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(PAGE)); return; }
  if (/^\/(logo-symbole|favicon)\.png$/.test(u.pathname)) { const f = 'C:/Users/Utilisateur/Desktop/FabWare/MeshyMyself/cloud/public' + u.pathname; if (existsSync(f)) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(readFileSync(f)); return; } }
  if (u.pathname.indexOf('/api/market/poster/') === 0) { res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#334"/><text x="150" y="110" font-size="30" text-anchor="middle" fill="white">poster</text></svg>'); return; }
  if (u.pathname === '/__session/perdre') { sess.perdue = true; res.end('ok'); return; }
  if (u.pathname === '/__session/mdp') { sess.mdp = true; sess.totp = u.searchParams.get('totp') === '1'; res.end('ok'); return; }
  if (u.pathname === '/__session/rendre') { sess.perdue = false; res.end('ok'); return; }
  if (u.pathname === '/__flag') { const v = u.searchParams.get('v'); etat[u.searchParams.get('k')] = v === 'false' ? false : v === 'true' ? true : isNaN(Number(v)) ? v : Number(v); res.end('ok'); return; }
  if (u.pathname === '/__totp/reset') { etat.totp = { enrolled: false }; res.end('ok'); return; }
  if (u.pathname === '/__etat') { j(res, etat); return; }
  if (u.pathname === '/api/admin/logs/get') { const k = u.searchParams.get('key') || ''; res.writeHead(200, { 'content-type': 'text/plain' }); res.end(k === '_logs/latest/_last_uid.txt' ? 'u1' : 'ligne 1 du journal (' + k + ')\nligne 2 du journal'); return; }
  if (u.pathname.startsWith('/api/')) {
    if (sess.perdue) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return; }
    if (sess.mdp && !/^\/api\/admin\/(login|reset-)/.test(u.pathname)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"admin_password_required"}'); return; }
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      let b = {}; try { b = body ? JSON.parse(body) : {}; } catch (_) {}
      let f = routes[key];
      if (!f) { const m = /^\/api\/admin\/users\/([^/]+)\/listings$/.exec(u.pathname); if (m) f = () => ({ listings: [{ id: 'a9', status: 'approved', title: 'Bus publie', job_id: 'm1', mesh_url: 'data:text/plain,glb1' }, { id: 'a10', status: 'pending', title: 'Camion', job_id: 'm2' }] }); }
      if (!f) { const m = /^\/api\/admin\/users\/([^/]+)\/projects$/.exec(u.pathname); if (m) f = () => ({ projects: [{ name: 'bus', asset_type: 'vehicle', meshes: 2, latest: iso(3600e3) }] }); }
      if (!f) { const m = /^\/api\/admin\/contact-messages\/([^/]+)(\/read|\/reply)?$/.exec(u.pathname); if (m) f = () => { const x = etat.msgs.find((q) => q.id === m[1]); if (req.method === 'DELETE') etat.msgs = etat.msgs.filter((q) => q.id !== m[1]); else if (m[2] === '/read') x.read = true; else if (m[2] === '/reply') { x.replied = true; x.reply_body = b.body; x.read = true; } return { ok: true }; }; }
      if (!f) { const m = /^\/api\/admin\/market\/([^/]+)\/(approve|reject)$/.exec(u.pathname); if (m) f = () => { const x = etat.listings.find((q) => q.id === m[1]); x.status = m[2] === 'approve' ? 'approved' : 'rejected'; x.rejection_reason = b.reason; return { ok: true }; }; }
      if (!f) { const m = /^\/api\/admin\/users\/([^/]+)\/(meshes|rigs)$/.exec(u.pathname); if (m && req.method === 'GET') f = () => m[2] === 'rigs' ? { rigs: [{ id: 'r1', mesh_url: 'data:text/plain,rig', project_name: 'knight', created_at: new Date(now - 5000e3).toISOString(), key: 'u1/rigged/r1.glb', size: 9 }] } : { meshes: etat.meshes }; }
      if (!f) { const m = /^\/api\/admin\/users\/([^/]+)\/meshes\/([^/]+)$/.exec(u.pathname); if (m && req.method === 'DELETE') f = () => { etat.meshes = etat.meshes.filter((x) => x.id !== m[2]); return { ok: true }; }; }
      if (!f) { const m = /^\/api\/admin\/market\/([^/]+)\/(price|offert)$/.exec(u.pathname); if (m) f = () => { if (m[2] === 'price') { etat.prixAnnonce = b.price_cents; return { ok: true }; } etat.offerts = b.actif ? [m[1]] : []; return { ok: true, ids: etat.offerts }; }; }
      if (!f) { const m = /^\/api\/admin\/market\/([^/]+)$/.exec(u.pathname); if (m && req.method === 'DELETE') f = () => { etat.annonceSupprimee = true; return { ok: true }; }; }
      if (!f) { j(res, { error: 'inconnu ' + key }, 404); return; }
      const r = f(b, u); if (Array.isArray(r)) j(res, r[1], r[0]); else j(res, r);
    });
    return;
  }
  res.writeHead(404); res.end('404');
}).listen(PORT, '127.0.0.1', () => console.log('mock admin2 sur http://127.0.0.1:' + PORT + '/admin2'));
