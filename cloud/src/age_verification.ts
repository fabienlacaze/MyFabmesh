/* VERIFICATION D'AGE avant le mode « sans restriction » (2026-10-01).
 *
 * POURQUOI CE FICHIER EXISTE. Le controle parental ne prouvait rien : au premier deverrouillage, la
 * personne CREAIT elle-meme son code PIN (aucun secret prealable, aucune preuve d'age), et le serveur
 * (_meta/parental/<uid>.json) acceptait ce PIN sans verifier qui etait devant l'ecran. Un mineur pouvait
 * lever le filtre en quatre clics, et le PIN de 4 chiffres n'avait aucune limite d'essais.
 *
 * Decision du proprietaire (2026-10-01) : verification d'age PUIS choix du PIN.
 *   1. le compte passe par Stripe Identity (piece d'identite + selfie, hebergees par Stripe) ;
 *   2. le serveur lit la date de naissance verifiee, en deduit l'age, et ne garde QUE « majeur verifie le
 *      <date> » (ni date de naissance, ni image, ni nom) ; la session Stripe est ensuite effacee (redact) ;
 *   3. seulement apres, la personne CHOISIT son PIN ; un ancien PIN cree sans verification est efface.
 *
 * Ici : des fonctions PURES (aucun acces R2, aucun reseau, l'heure passee en parametre). Le worker les appelle,
 * le banc `build/test-verif-age.mjs` les appelle telles quelles. Syntaxe TypeScript « effacable » uniquement
 * (pas d'enum, pas de namespace) : Node les execute directement avec --experimental-strip-types.
 *
 * LIMITES ASSUMEES (a ne pas promettre a l'ecran) :
 *   - ce verrou protege le SERVEUR (generations cloud, site web). L'application de bureau fonctionne hors
 *     ligne : son verrou local est un frein, pas une preuve (un utilisateur determine peut modifier sa copie) ;
 *   - le plancher illegal (checkHardFloor) n'a RIEN a voir avec l'age : il bloque pour tous, partout. */

export const AGE_MAJORITE = 18;
/** Departs de verification par compte et par jour : chaque verification est facturee par Stripe a l'exploitant. */
export const AGE_DEPARTS_PAR_JOUR = 3;
/** Plafond GLOBAL de departs par jour : la facture Stripe est reelle, et des comptes jetables contournent le plafond par compte. */
export const AGE_DEPARTS_GLOBAUX_PAR_JOUR = 20;
/** Essais de PIN avant verrouillage, et duree du verrou. 10 000 combinaisons sans limite = tout se devine par script. */
export const PIN_ECHECS_MAX = 5;
export const PIN_VERROU_MS = 15 * 60 * 1000;

export interface DateNaissance { day?: number | null; month?: number | null; year?: number | null }

/** Age en annees revolues a `maintenant` (UTC), ou null si la date est incomplete / invraisemblable. */
export function ageRevolu(dob: DateNaissance | null | undefined, maintenant: Date): number | null {
  if (!dob) return null;
  const y = Number(dob.year), m = Number(dob.month), d = Number(dob.day);
  if (![y, m, d].every((v) => Number.isInteger(v))) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  const naissance = Date.UTC(y, m - 1, d);
  if (naissance > maintenant.getTime()) return null;           // ne en 2040 : donnee fausse, on refuse
  let age = maintenant.getUTCFullYear() - y;
  const mois = maintenant.getUTCMonth() + 1;
  if (mois < m || (mois === m && maintenant.getUTCDate() < d)) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

export type VerdictAge =
  | { etat: 'verifie' }
  | { etat: 'mineur' }
  | { etat: 'en_cours' }
  | { etat: 'a_refaire'; raison: string }
  | { etat: 'invalide'; raison: string };

/** Verdict a partir d'une VerificationSession Stripe (avec verified_outputs developpe). Rien n'est accepte par defaut :
 *  toute donnee manquante ou incoherente donne « invalide », jamais « verifie ». */
export function verdictSession(
  session: any,
  ctx: { userId: string; sessionAttendue: string | null | undefined; maintenant: Date; autoriserTest?: boolean },
): VerdictAge {
  if (!session || typeof session !== 'object') return { etat: 'invalide', raison: 'session_absente' };
  if (!ctx.sessionAttendue || session.id !== ctx.sessionAttendue) return { etat: 'invalide', raison: 'session_inconnue' };
  if (!session.metadata || session.metadata.uid !== ctx.userId) return { etat: 'invalide', raison: 'session_autre_compte' };
  if (session.type !== 'document') return { etat: 'invalide', raison: 'type_inattendu' };
  // MODE TEST : avec une cle sk_test_, les « documents de test » de Stripe donnent un « verifie » sans aucune piece reelle. Refuse sauf autorisation
  // explicite (variable AGE_ALLOW_TEST_MODE du worker, pour les essais seulement).
  if (session.livemode !== true && !ctx.autoriserTest) return { etat: 'invalide', raison: 'mode_test' };
  switch (session.status) {
    case 'verified': {
      const age = ageRevolu(session.verified_outputs && session.verified_outputs.dob, ctx.maintenant);
      if (age === null) return { etat: 'invalide', raison: 'date_naissance_absente' };
      return age >= AGE_MAJORITE ? { etat: 'verifie' } : { etat: 'mineur' };
    }
    case 'processing':
      return { etat: 'en_cours' };
    case 'requires_input': {
      const code = session.last_error && session.last_error.code;
      // Stripe sait deja que le titulaire est trop jeune : c'est un refus d'age, pas une nouvelle tentative a facturer
      if (code === 'under_supported_age') return { etat: 'mineur' };
      // une session toute neuve est aussi « requires_input » : sans erreur, la personne n'a simplement pas fini
      return code ? { etat: 'a_refaire', raison: String(code) } : { etat: 'en_cours' };
    }
    case 'canceled':
      return { etat: 'a_refaire', raison: 'canceled' };
    default:
      return { etat: 'invalide', raison: 'statut_inattendu' };
  }
}

export interface EtatParental {
  pinHash?: string;
  unrestricted: boolean;
  ageVerifiedAt?: string;
  ageSessionId?: string;
  ageRefusedAt?: string;
  pinEchecs?: number;
  pinVerrouJusqua?: number;
}

/** Le filtre n'est leve que pour un compte dont l'age a ete verifie : un ancien « unrestricted » sans verification est ignore. */
export function unrestrictedEffectif(s: EtatParental): boolean {
  return !!s.unrestricted && !!s.ageVerifiedAt;
}

/** Millisecondes restantes de verrouillage du PIN (0 = libre). */
export function pinVerrouRestant(s: EtatParental, maintenant: Date): number {
  const fin = Number(s.pinVerrouJusqua || 0);
  return fin > maintenant.getTime() ? fin - maintenant.getTime() : 0;
}

/** Etat apres un PIN faux : au PIN_ECHECS_MAX-ieme echec consecutif, verrou de PIN_VERROU_MS et compteur remis a zero. */
export function apresEchecPin(s: EtatParental, maintenant: Date): EtatParental {
  const echecs = Number(s.pinEchecs || 0) + 1;
  if (echecs >= PIN_ECHECS_MAX) return { ...s, pinEchecs: 0, pinVerrouJusqua: maintenant.getTime() + PIN_VERROU_MS };
  return { ...s, pinEchecs: echecs };
}

export function apresSuccesPin(s: EtatParental): EtatParental {
  return { ...s, pinEchecs: 0, pinVerrouJusqua: 0 };
}

/** Etat apres une verification REUSSIE : age enregistre, ancien PIN efface (il a pu etre cree sans preuve d'age),
 *  filtre re-verrouille jusqu'au choix d'un nouveau PIN. Ni date de naissance ni image ne sont conservees. */
export function apresVerificationReussie(s: EtatParental, sessionId: string, maintenant: Date): EtatParental {
  const { pinHash: _ancien, ...reste } = s;
  return { ...reste, unrestricted: false, ageVerifiedAt: maintenant.toISOString(), ageSessionId: sessionId, pinEchecs: 0, pinVerrouJusqua: 0 };
}

/** Etat apres un refus « mineur » : definitif pour ce compte (une autre piece du parent ne doit pas etre reessayee en boucle). */
export function apresRefusMineur(s: EtatParental, maintenant: Date): EtatParental {
  const { pinHash: _p, ...reste } = s;
  return { ...reste, unrestricted: false, ageRefusedAt: maintenant.toISOString() };
}
