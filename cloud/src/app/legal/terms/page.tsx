// Terms of Service — baseline tailored to MyFabmesh.AI's actual flows.
// The business identity is defined ONCE in @/config/legal-identity.
//
// 2026-09-28 : les deux langues dans la page (TermsFr / TermsEn), la langue de
// l'appli choisit laquelle s'affiche (lib/langue.tsx), et BasculeLangue garde
// l'autre a un clic.

import { BasculeLangue } from '@/components/BasculeLangue';
import { TermsFr } from './TermsFr';
import { TermsEn } from './TermsEn';

export const metadata = {
  title: 'Terms of Service — MyFabmesh.AI',
  description: 'The terms that govern your use of MyFabmesh.AI.',
};

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px', lineHeight: 1.65 }}>
      <BasculeLangue />
      <div className="lang-fr"><TermsFr /></div>
      <div className="lang-en"><TermsEn /></div>
    </main>
  );
}
