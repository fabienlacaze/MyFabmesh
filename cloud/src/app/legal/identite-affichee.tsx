// Rendu public de l'identite legale quand elle n'est pas encore renseignee.
//
// 2026-10-03, constat F1 : tant que cloud/src/config/legal-identity.ts contient
// des gabarits « [A COMPLETER ...] », les pages publiques les montraient
// telles quelles a tout visiteur. Ce module remplace, A L'AFFICHAGE
// UNIQUEMENT, chaque gabarit par un texte neutre et veridique (l'exploitant
// est en cours d'immatriculation, aucune vente n'est ouverte).
//
// CE QUE CE FICHIER NE FAIT PAS :
//  - il ne modifie pas legal-identity.ts et ne touche pas la garde
//    scripts/check-legal-identity.mjs : la construction reste refusee tant que
//    les champs ne sont pas remplis (ou que ALLOW_UNFILLED_LEGAL=1 est pose) ;
//  - il n'invente aucune valeur : un champ rempli est affiche tel quel.
// Le marqueur litteral n'est volontairement pas recopie ici (la garde compte
// ses occurrences dans les .tsx de ce dossier).

import {
  legalIdentity,
  isUnfilled,
  legalIdentityUnfilledFields,
  type LegalIdentity,
} from '@/config/legal-identity';

export type Langue = 'fr' | 'en';

const TEXTES: Record<Langue, { general: string; designation: string; mediateur: string }> = {
  fr: {
    general: "en cours d'immatriculation",
    designation: 'en cours de désignation',
    mediateur: "sera désigné avant l'ouverture des ventes",
  },
  en: {
    general: 'registration in progress',
    designation: 'being appointed',
    mediateur: 'to be designated before sales open',
  },
};

/** Copie de l'identite ou chaque gabarit est remplace par un texte neutre. */
export function identiteAffichee(langue: Langue): LegalIdentity {
  const t = TEXTES[langue];
  const sinon = (v: string, texte: string) => (isUnfilled(v) ? texte : v);
  const i = legalIdentity;
  return {
    ...i,
    legalForm: sinon(i.legalForm, t.general),
    siret: sinon(i.siret, t.general),
    rcs: sinon(i.rcs, t.general),
    shareCapital: sinon(i.shareCapital, t.general),
    registeredOffice: sinon(
      i.registeredOffice,
      langue === 'fr' ? "adresse postale en cours d'immatriculation" : 'postal address, registration in progress',
    ),
    vatNumber: sinon(i.vatNumber, t.general),
    publicationDirector: sinon(i.publicationDirector, t.designation),
    designatedAgent: sinon(i.designatedAgent, t.designation),
    mediator: {
      name: sinon(i.mediator.name, t.mediateur),
      postalAddress: sinon(i.mediator.postalAddress, t.mediateur),
      url: sinon(i.mediator.url, t.mediateur),
    },
  };
}

/** Vrai tant qu'au moins un champ d'identite attend sa valeur reelle. */
export function identiteIncomplete(): boolean {
  return legalIdentityUnfilledFields().length > 0;
}

/** Lien vers `url` s'il s'agit d'une adresse web, sinon le texte tel quel. */
export function LienOuTexte({ url }: { url: string }) {
  if (/^https?:\/\//i.test(url)) {
    return <a href={url} target="_blank" rel="noopener">{url}</a>;
  }
  return <>{url}</>;
}

/** Bandeau « phase de test », affiche seulement tant que l'identite est incomplete. */
export function BandeauPhaseTest({ langue }: { langue: Langue }) {
  if (!identiteIncomplete()) return null;
  const mail = legalIdentity.contactEmail;
  return (
    <p
      role="note"
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid var(--border, #333)',
        fontSize: 14,
      }}
    >
      {langue === 'fr' ? (
        <>
          <strong>Service en phase de test&nbsp;:</strong> l&apos;exploitant est en
          cours d&apos;immatriculation&nbsp;; aucune vente n&apos;est ouverte.
          Contact&nbsp;: <a href={`mailto:${mail}`}>{mail}</a>.
        </>
      ) : (
        <>
          <strong>Service in test phase:</strong> the operator is being registered;
          no sale is open. Contact: <a href={`mailto:${mail}`}>{mail}</a>.
        </>
      )}
    </p>
  );
}
