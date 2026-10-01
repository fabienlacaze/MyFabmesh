// Banc d'essai de cloud/src/age_verification.ts (verification d'age avant le mode « sans restriction »).
// Lancer :  node --experimental-strip-types build/test-verif-age.mjs
// Les fonctions sont PURES : aucun reseau, aucun R2, l'heure est passee en parametre.
import {
  ageRevolu, verdictSession, unrestrictedEffectif, pinVerrouRestant, apresEchecPin, apresSuccesPin,
  apresVerificationReussie, apresRefusMineur, AGE_MAJORITE, PIN_ECHECS_MAX, PIN_VERROU_MS,
} from '../cloud/src/age_verification.ts';

let echecs = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  ECHEC ') + m); if (!c) echecs++; };
const D = (iso) => new Date(iso);
const maintenant = D('2026-10-01T12:00:00Z');

// --- age revolu : les cas de bord
ok(ageRevolu({ day: 1, month: 10, year: 2008 }, maintenant) === 18, '18 ans pile le jour de l\'anniversaire -> 18');
ok(ageRevolu({ day: 2, month: 10, year: 2008 }, maintenant) === 17, 'la veille des 18 ans -> 17');
ok(ageRevolu({ day: 30, month: 9, year: 2008 }, maintenant) === 18, 'la veille, mois precedent -> 18');
ok(ageRevolu({ day: 29, month: 2, year: 2008 }, maintenant) === 18, 'ne un 29 fevrier, tres avant -> 18');
ok(ageRevolu({ day: 1, month: 1, year: 1990 }, maintenant) === 36, '1990 -> 36');
for (const [nom, dob] of [
  ['absente', null], ['vide', {}], ['annee manquante', { day: 1, month: 1 }], ['mois 13', { day: 1, month: 13, year: 1990 }],
  ['jour 0', { day: 0, month: 5, year: 1990 }], ['texte', { day: 'x', month: 5, year: 1990 }], ['future', { day: 1, month: 1, year: 2040 }],
  ['avant 1900', { day: 1, month: 1, year: 1800 }], ['decimal', { day: 1.5, month: 1, year: 1990 }],
]) ok(ageRevolu(dob, maintenant) === null, 'date de naissance ' + nom + ' -> null (jamais « majeur » par defaut)');

// --- verdict d'une session Stripe
const base = (extra = {}) => ({ id: 'vs_1', type: 'document', status: 'verified', metadata: { uid: 'u1' }, verified_outputs: { dob: { day: 1, month: 1, year: 1990 } }, ...extra });
const ctx = { userId: 'u1', sessionAttendue: 'vs_1', maintenant };
ok(verdictSession(base(), ctx).etat === 'verifie', 'majeur verifie -> verifie');
ok(verdictSession(base({ verified_outputs: { dob: { day: 2, month: 10, year: 2008 } } }), ctx).etat === 'mineur', '17 ans -> mineur');
ok(verdictSession(base({ verified_outputs: { dob: { day: 1, month: 10, year: 2008 } } }), ctx).etat === 'verifie', '18 ans pile -> verifie');
ok(verdictSession(base({ verified_outputs: null }), ctx).etat === 'invalide', 'verifie mais sans date de naissance -> invalide (echec ferme)');
ok(verdictSession(base({ verified_outputs: { dob: { day: 1, month: 1 } } }), ctx).etat === 'invalide', 'date incomplete -> invalide');
ok(verdictSession(base({ id: 'vs_autre' }), ctx).etat === 'invalide', 'session d\'un autre identifiant -> invalide');
ok(verdictSession(base(), { ...ctx, sessionAttendue: null }).etat === 'invalide', 'aucune session attendue -> invalide');
ok(verdictSession(base({ metadata: { uid: 'u2' } }), ctx).etat === 'invalide', 'session d\'un AUTRE compte -> invalide');
ok(verdictSession(base({ metadata: {} }), ctx).etat === 'invalide', 'session sans compte -> invalide');
ok(verdictSession(base({ type: 'id_number' }), ctx).etat === 'invalide', 'mauvais type de verification -> invalide');
ok(verdictSession(base({ status: 'processing' }), ctx).etat === 'en_cours', 'processing -> en cours');
ok(verdictSession(base({ status: 'requires_input', last_error: null }), ctx).etat === 'en_cours', 'session neuve (requires_input sans erreur) -> en cours');
const rf = verdictSession(base({ status: 'requires_input', last_error: { code: 'document_unverified_other' } }), ctx);
ok(rf.etat === 'a_refaire' && rf.raison === 'document_unverified_other', 'requires_input avec erreur -> a refaire + raison');
ok(verdictSession(base({ status: 'canceled' }), ctx).etat === 'a_refaire', 'canceled -> a refaire');
ok(verdictSession(base({ status: 'bizarre' }), ctx).etat === 'invalide', 'statut inconnu -> invalide');
ok(verdictSession(null, ctx).etat === 'invalide' && verdictSession(undefined, ctx).etat === 'invalide' && verdictSession('x', ctx).etat === 'invalide', 'session absente / pas un objet -> invalide');

// --- le filtre ne se leve que pour un age verifie
ok(!unrestrictedEffectif({ unrestricted: true }), 'ancien « unrestricted » SANS verification -> ignore');
ok(unrestrictedEffectif({ unrestricted: true, ageVerifiedAt: '2026-10-01T00:00:00Z' }), 'unrestricted + age verifie -> effectif');
ok(!unrestrictedEffectif({ unrestricted: false, ageVerifiedAt: '2026-10-01T00:00:00Z' }), 'age verifie mais filtre en place -> pas effectif');

// --- PIN : essais limites
let s = { pinHash: 'h', unrestricted: false };
for (let i = 1; i < PIN_ECHECS_MAX; i++) { s = apresEchecPin(s, maintenant); ok(pinVerrouRestant(s, maintenant) === 0, 'echec ' + i + '/' + PIN_ECHECS_MAX + ' : pas encore verrouille'); }
s = apresEchecPin(s, maintenant);
ok(pinVerrouRestant(s, maintenant) === PIN_VERROU_MS, PIN_ECHECS_MAX + 'e echec : verrou de ' + (PIN_VERROU_MS / 60000) + ' min');
ok(pinVerrouRestant(s, new Date(maintenant.getTime() + PIN_VERROU_MS - 1)) > 0, 'toujours verrouille juste avant la fin');
ok(pinVerrouRestant(s, new Date(maintenant.getTime() + PIN_VERROU_MS)) === 0, 'libre a la fin du verrou');
s = apresEchecPin({ ...s, pinVerrouJusqua: 0 }, maintenant);
ok(s.pinEchecs === 1, 'le compteur repart de zero apres un verrou');
ok(apresSuccesPin({ pinEchecs: 3, pinVerrouJusqua: 5, unrestricted: false }).pinEchecs === 0, 'un bon PIN remet le compteur a zero');

// --- apres verification : l'ancien PIN (cree sans preuve d'age) disparait
const v = apresVerificationReussie({ pinHash: 'ancien', unrestricted: true, pinEchecs: 2 }, 'vs_9', maintenant);
ok(!('pinHash' in v) && v.unrestricted === false && v.ageVerifiedAt === maintenant.toISOString() && v.ageSessionId === 'vs_9', 'verification reussie : ancien PIN efface, filtre re-verrouille, age enregistre');
ok(!JSON.stringify(v).match(/dob|birth|naissance|1990/i), 'aucune date de naissance conservee');
const m = apresRefusMineur({ pinHash: 'p', unrestricted: true }, maintenant);
ok(m.ageRefusedAt && !m.unrestricted && !('pinHash' in m) && !m.ageVerifiedAt, 'refus mineur : definitif, filtre en place, PIN efface');
ok(AGE_MAJORITE === 18, 'majorite fixee a 18 ans');

console.log(echecs ? '\n' + echecs + ' ECHEC(S)' : '\nTOUT PASSE');
process.exit(echecs ? 1 : 0);
