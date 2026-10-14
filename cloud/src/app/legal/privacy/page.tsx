// Privacy Policy — GDPR-compliant baseline for the EU launch.
// Tailored to MyFabmesh.AI's actual data flows (Supabase auth, Stripe
// payments, Cloudflare R2 storage, Modal GPU compute, Replicate API).
// The data-controller identity is defined ONCE in @/config/legal-identity.
//
// 2026-09-28 : les deux langues dans la page (PrivacyFr / PrivacyEn), la langue de
// l'appli choisit laquelle s'affiche (lib/langue.tsx), et BasculeLangue garde
// l'autre a un clic.

import { BasculeLangue, AvisJuridique } from '@/components/BasculeLangue';
import { PrivacyFr } from './PrivacyFr';
import { PrivacyEn } from './PrivacyEn';

export const metadata = {
  title: 'Privacy Policy — MyFabmesh.AI',
  description: 'How MyFabmesh.AI collects, stores, and uses your personal data.',
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px', lineHeight: 1.65 }}>
      <BasculeLangue />
      <AvisJuridique />
      <div className="juridique-fr" lang="fr" dir="ltr"><PrivacyFr /></div>
      <div className="juridique-en" lang="en" dir="ltr"><PrivacyEn /></div>
    </main>
  );
}
