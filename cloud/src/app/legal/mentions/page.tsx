// Legal Notice (Mentions legales) — publisher and host identity.
// The business identity is defined ONCE in @/config/legal-identity.
//
// 2026-09-28 : les deux langues dans la page (MentionsFr / MentionsEn), la langue de
// l'appli choisit laquelle s'affiche (lib/langue.tsx), et BasculeLangue garde
// l'autre a un clic.

import { BasculeLangue, AvisJuridique } from '@/components/BasculeLangue';
import { MentionsFr } from './MentionsFr';
import { MentionsEn } from './MentionsEn';

export const metadata = {
  title: 'Legal Notice — MyFabmesh.AI',
  description: 'Identification of the publisher and the host of MyFabmesh.AI.',
};

export default function LegalNoticePage() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px', lineHeight: 1.65 }}>
      <BasculeLangue />
      <AvisJuridique />
      <div className="juridique-fr" lang="fr" dir="ltr"><MentionsFr /></div>
      <div className="juridique-en" lang="en" dir="ltr"><MentionsEn /></div>
    </main>
  );
}
