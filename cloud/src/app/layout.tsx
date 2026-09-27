import './globals.css';
import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { CookieBanner } from '@/components/CookieBanner';
import { SCRIPT_LANGUE, T } from '@/lib/langue';

export const metadata: Metadata = {
  // Titre unique (une page statique n'en a qu'un) : l'anglais, langue par
  // defaut de l'appli. Le contenu, lui, suit la langue de l'appli (lib/langue).
  title: 'MyFabmesh.AI Cloud — Image to 3D',
  description: 'Generate game-ready 3D meshes from a single image. Cloud GPUs, no local install required.',
  openGraph: {
    title: 'MyFabmesh.AI Cloud',
    description: 'Image → 3D mesh in 90 s. Pay-as-you-go, no install.',
    type: 'website',
  },
};

import { legalIdentity as id } from '@/config/legal-identity';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang est reecrit par SCRIPT_LANGUE avant le premier rendu : l'ecart avec
    // le HTML statique est voulu (suppressHydrationWarning).
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_LANGUE }} />
      </head>
      <body>
        <Nav />
        <main>{children}</main>
        <CookieBanner />
        <footer className="site-footer">
          <div>
            © 2026 Ayros Studio · MyFabmesh.AI <span className="pill" style={{ marginLeft: 6 }}>BETA</span>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <a href="/legal/terms"><T fr="Conditions générales" en="Terms" /></a>
            <a href="/legal/privacy"><T fr="Confidentialité" en="Privacy" /></a>
            <a href="/legal/mentions"><T fr="Mentions légales" en="Legal notice" /></a>
            {/* Un visiteur bloque a l'inscription n'avait AUCUN moyen d'ecrire :
                le pied de page ne proposait que des pages juridiques, et le
                formulaire de contact est derriere la session — precisement ce
                qu'il n'arrive pas a obtenir. */}
            <a href={`mailto:${id.supportEmail}`}>Contact</a>
            <a href="https://fabienlacaze.github.io/MyFabmesh" target="_blank"><T fr="Application de bureau" en="Desktop app" /></a>
          </div>
        </footer>
      </body>
    </html>
  );
}
