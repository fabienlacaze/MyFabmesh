'use client';
//
// Buy page — was a server component. Static-export converts it to a
// client component that fetches /api/me to get the credit balance.
//
import { useEffect, useState } from 'react';
import { PACKS } from '@/lib/packs';
import { BuyButton } from './BuyButton';
import { T } from '@/lib/langue';

interface User { id: string; email: string | null; credits: number; }

export default function BuyPage() {
  const [user, setUser] = useState<User | null>(null);
  // Per-pack availability map from /api/pricing/availability. Subscription
  // packs without a Stripe Price ID configured come back as false; we hide
  // those cards so the user doesn't get a 503 mid-checkout. null = still
  // loading; missing key = treat as available (fail-open on fetch error).
  const [availability, setAvailability] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.ok ? r.json() : { user: null })
      .then(j => setUser(j.user ?? null))
      .catch(() => setUser(null));
  }, []);

  // TARIFS LUS DEPUIS LA GRILLE REELLE, jamais ecrits en dur.
  //
  // La table ci-dessous annoncait 1 / 2 / 4 / 8 credits alors que la grille
  // facturait 3 / 4 / 6 / 8 — puis 8 / 10 / 13 / 16 apres le relevement du
  // 2026-08-04. Un client lisait donc un prix et s'en voyait debiter jusqu'a
  // 2,5 fois plus : en droit francais c'est une pratique commerciale
  // trompeuse, et c'est arrive parce que le chiffre etait duplique dans le
  // JSX au lieu d'etre lu a la source.
  const [prix, setPrix] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    fetch('/api/pricing')
      .then(r => r.ok ? r.json() : null)
      .then(j => setPrix((j && j.prices) || null))
      .catch(() => setPrix(null));
  }, []);
  // Tant que la grille n'est pas chargee on n'affiche AUCUN chiffre : mieux
  // vaut un tiret qu'un prix errone.
  // Vente fermee tant que les mentions legales manquent : annoncee AVANT le
  // clic (le bouton finissait sur une erreur 503).
  const [ventesOuvertes, setVentesOuvertes] = useState<boolean | null>(null);
  // Supplement « nombre de triangles » : meme formule que _supplementTriangles.
  // Les trois parametres viennent de la grille ; l'un manque : un tiret, pas de
  // valeur de repli.
  const supTris = (tris: number) => {
    const tranche = prix?.mesh_tris_500k, socle = prix?.mesh_tris_base, pct = prix?.mesh_tris_courbe_pct;
    if (typeof tranche !== 'number' || typeof socle !== 'number' || typeof pct !== 'number') return '—';
    return String(Math.max(socle, Math.ceil(tranche * Math.pow(tris / 500_000, Math.max(1, pct / 100)) - 1e-9)));
  };
  const cr = (cle: string) => {
    const v = prix?.[cle];
    return typeof v === 'number'
      ? <>{v} <T fr={v > 1 ? 'crédits' : 'crédit'} en={v > 1 ? 'credits' : 'credit'} /></>
      : '—';
  };

  useEffect(() => {
    fetch('/api/pricing/availability')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j && j.available) setAvailability(j.available);
        else setAvailability({}); // fail-open: missing keys default to true below
        if (j && typeof j.ventes_ouvertes === 'boolean') setVentesOuvertes(j.ventes_ouvertes);
      })
      .catch(() => setAvailability({}));
  }, []);

  /* Les abonnements ne s'affichent QUE si le serveur les declare disponibles.
   *
   * Le defaut etait `?? true` : un appel a /api/pricing/availability qui
   * echoue, ou qui n'a pas encore repondu, faisait apparaitre des cartes
   * d'abonnement. Sur un plan sans identifiant de prix configure, le client
   * partait au paiement pour recevoir un 503 — et surtout, tant qu'aucun
   * portail de resiliation n'existe, on ne doit vendre AUCUNE reconduction
   * automatique. En cas de doute, on n'affiche pas. */
  const visibleSubs = Object.values(PACKS).filter(
    p => p.mode === 'subscription' && (availability?.[p.id] ?? false),
  );

  return (
    <div className="page">
      <div className="page-header">
        <h2><T fr="Acheter des crédits" en="Buy credits" /></h2>
        {user && <span className="credits-pill">{user.credits} <T fr="crédits" en="credits" /></span>}
      </div>
      <p style={{ color: 'var(--text-2)', marginBottom: 8 }}>
        <T fr="Sans abonnement. Les crédits n'expirent jamais." en="No subscription. Credits never expire." />
      </p>
      <p className="lang-fr" style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 24 }}>
        Tous les prix affichés sont <strong>TTC (TVA incluse)</strong> — la TVA est
        calculée selon votre pays au moment du paiement.
      </p>
      <p className="lang-en" style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 24 }}>
        All prices shown are <strong>TTC (VAT included)</strong> — VAT is calculated
        according to your country at checkout.
      </p>

      {/* La case de renonciation vivait ICI, au-dessus des cartes. Le
          proprietaire l'a ratee lui-meme le 2026-08-20 : trop discrete, et
          elle desactivait les boutons « Buy » sans rien expliquer. Elle est
          desormais demandee au moment de l'achat, dans une fenetre qui nomme
          le pack — voir BuyButton.tsx. Il ne reste ici qu'un avertissement. */}
      <p
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 24,
          padding: '11px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
          background: 'rgba(255,170,51,.07)', border: '1px solid rgba(255,170,51,.3)',
          color: 'var(--text-2)',
        }}
      >
        <span aria-hidden="true">&#9432;</span>
        <span className="lang-fr">
          Les crédits sont un contenu numérique fourni immédiatement. Avant de
          payer, il vous sera demandé de confirmer que vous{' '}
          <strong>renoncez à votre droit de rétractation de 14 jours</strong> pour
          les crédits que vous consommez (art. L. 221-28 13&deg; du code de la
          consommation). Les crédits non consommés restent remboursables pendant
          14 jours. Voir les{' '}
          <a href="/legal/terms">conditions générales de vente</a>.
        </span>
        <span className="lang-en">
          Credits are digital content delivered immediately. Before paying you
          will be asked to confirm that you{' '}
          <strong>waive your 14-day right of withdrawal</strong> for the credits
          you consume (Art. L221-28 13&deg; of the French Consumer Code). Unspent
          credits stay refundable for 14 days. See the{' '}
          <a href="/legal/terms">Terms of Service</a>.
        </span>
      </p>

      {ventesOuvertes === false && (
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(168,85,247,0.45)', background: 'rgba(168,85,247,0.10)', fontSize: 14 }}>
          {/* Pas de nombre ici : l'octroi est regle dans Supabase (15 depuis le
              2026-08-04, a la confirmation de l'adresse) et « 50 » etait faux. */}
          <span className="lang-fr"><strong>Les achats de crédits ouvrent bientôt.</strong> En attendant, vous créez avec les crédits offerts à l&apos;inscription.</span>
          <span className="lang-en"><strong>Credit purchases open soon.</strong> Meanwhile, you create with the credits offered at sign-up.</span>
        </div>
      )}
      <h3 style={{ marginTop: 24, marginBottom: 12, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-2)' }}><T fr="Recharges ponctuelles" en="One-shot top-ups" /></h3>
      <div className="pricing-grid" style={{ padding: 0 }}>
        {Object.values(PACKS).filter(p => p.mode === 'payment' && (availability?.[p.id] ?? true)).map((p) => (
          <div key={p.id} className={`price-card ${p.id === 'pro' ? 'featured' : ''}`}>
            <div className="name">
              {p.name}
              {p.id === 'pro' && <span className="feat-tag"><T fr="populaire" en="popular" /></span>}
            </div>
            <div className="amount">{p.euros} € <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-2)' }}>TTC</span></div>
            <div className="unit">{p.credits} <T fr="crédits" en="credits" /></div>
            <div className="per-mesh">≈ {(p.euros / p.credits).toFixed(2)} € / <T fr="crédit" en="credit" /></div>
            {ventesOuvertes === false
              ? <button className="primary-btn" disabled style={{ width: '100%', opacity: 0.55, cursor: 'not-allowed' }}><T fr="Bientôt disponible" en="Coming soon" /></button>
              : <BuyButton packId={p.id} loggedIn={!!user} />}
          </div>
        ))}
      </div>

      {/* L'ENTETE ET LA PHRASE DISPARAISSENT AVEC LES CARTES.
          Ils restaient affiches meme sans aucun abonnement en vente, et
          annoncaient « Cancel anytime from your Stripe customer portal » —
          un portail qui N'EXISTE PAS dans ce produit : aucune route
          billing_portal, aucune section abonnement sur /account. Promettre
          une resiliation en un clic qu'on ne fournit pas, sur un contrat a
          reconduction automatique, est une information precontractuelle
          fausse. */}
      {visibleSubs.length > 0 && (
        <>
        <h3 style={{ marginTop: 36, marginBottom: 4, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-2)' }}><T fr="Abonnements mensuels" en="Monthly subscriptions" /></h3>
        <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 16 }}>
          <T fr="Les crédits sont versés automatiquement chaque mois. Pour résilier, écrivez-nous à" en="Credits drop in automatically every month. To cancel, e-mail us at" />{' '}
          <a href="mailto:myfabmesh.contact@gmail.com">myfabmesh.contact@gmail.com</a>{' '}
          — <T fr="nous arrêtons la reconduction sous un jour ouvré, et vous conservez les crédits déjà livrés." en="we stop the renewal within one business day, and you keep the credits already delivered." />
        </p>
        <div className="pricing-grid" style={{ padding: 0 }}>
          {visibleSubs.map((p) => (
            <div key={p.id} className={`price-card ${p.id === 'sub_pro' ? 'featured' : ''}`}>
              <div className="name">
                {p.name}
                {p.id === 'sub_pro' && <span className="feat-tag"><T fr="le plus avantageux" en="best value" /></span>}
              </div>
              <div className="amount">{p.euros} € <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-2)' }}>TTC / <T fr="mois" en="month" /></span></div>
              <div className="unit">{p.credits} <T fr="crédits / mois" en="credits / month" /></div>
              <div className="per-mesh">≈ {(p.euros / p.credits).toFixed(2)} € / <T fr="crédit" en="credit" /></div>
              <BuyButton packId={p.id} loggedIn={!!user} />
            </div>
          ))}
        </div>
        </>
      )}

      <div className="card" style={{ marginTop: 32 }}>
        <h3 style={{ marginBottom: 12 }}><T fr="Ce que coûtent les crédits" en="What credits cost" /></h3>
        <table className="history">
          <thead>
            <tr><th>Action</th><th><T fr="Coût" en="Cost" /></th><th><T fr="Détails" en="Details" /></th></tr>
          </thead>
          <tbody>
            <tr><td><T fr="Image depuis une idée" en="Image from an idea" /></td><td>{cr('text2image')}</td><td><T fr="30 étapes ; le prix suit le nombre d'étapes" en="30 steps; the price follows the number of steps" /></td></tr>
            <tr><td><T fr="Retouche IA d'une image" en="AI image edit" /></td><td>{prix ? <>{prix.modify ?? '—'} <T fr="à" en="to" /> {prix.auto_inpaint ?? '—'} <T fr="crédits" en="credits" /></> : '—'}</td><td><T fr="modifier, réparer, recolorier, vieillir…" en="modify, repair, recolor, age…" /></td></tr>
            <tr><td><T fr="Modèle 3D" en="3D model" /> <strong>Fast</strong></td><td>{cr('mesh_fast')}</td><td><T fr="brouillon" en="draft" /></td></tr>
            <tr><td><T fr="Modèle 3D" en="3D model" /> <strong>Balanced</strong></td><td>{cr('mesh_balanced')}</td><td><T fr="recommandé" en="recommended" /></td></tr>
            <tr><td><T fr="Modèle 3D" en="3D model" /> <strong>Quality</strong></td><td>{cr('mesh_quality')}</td><td><T fr="haut niveau de détail" en="high detail" /></td></tr>
            <tr><td><T fr="Modèle 3D" en="3D model" /> <strong>Ultra</strong></td><td>{cr('mesh_ultra_8k')}</td><td><T fr="détail et texture maximum" en="maximum detail and texture" /></td></tr>
            <tr><td><T fr="Nombre de triangles" en="Triangle count" /></td><td>+{supTris(500_000)} · +{supTris(1_000_000)} · +{supTris(10_000_000)}</td><td><T fr="jusqu'à 500 000 · 1 million · 10 millions" en="up to 500,000 · 1 million · 10 million" /></td></tr>
            <tr><td><T fr="Options 3D : texture affinée à 8192 px · visage · affinage" en="3D options: sharpened 8192px texture · face · refine" /></td><td>+{prix?.mesh_ultra_hd ?? '—'} / +{prix?.mesh_face_fix ?? '—'} / +{prix?.mesh_refine ?? '—'}</td><td><T fr="facultatives" en="optional" /></td></tr>
            <tr><td><T fr="Squelette automatique (rig)" en="Automatic skeleton (rig)" /></td><td>{cr('rig')}</td><td><T fr="tout corps : humain, animal, insecte, créature" en="any body: human, animal, insect, creature" /></td></tr>
            <tr><td>Animation</td><td>{cr('anim')}</td><td><T fr="par clip" en="per clip" /></td></tr>
            <tr><td><T fr="Outils 3D simples" en="Simple 3D tools" /></td><td>{cr('mesh_op_simple')}</td><td><T fr="lisser, boucher les trous, redimensionner…" en="smooth, fill holes, resize…" /></td></tr>
            <tr><td><T fr="Découpe en pièces" en="Split into parts" /></td><td>{cr('mesh_segment')}</td><td><T fr="tête, bras, roues…" en="head, arms, wheels…" /></td></tr>
            <tr><td><T fr="Export · publication sur la Marketplace" en="Export · Marketplace publishing" /></td><td>{prix ? `${prix.export ?? '—'} · ${prix.market_publish ?? '—'}` : '—'}</td><td><T fr="par fichier" en="per file" /></td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>
          <T fr="Une génération 3D prend environ 6 à 9 minutes, quel que soit le préréglage. Le prix exact s'affiche toujours sur le bouton avant de lancer." en="A 3D generation takes about 6 to 9 minutes, whatever the preset. The exact price is always shown on the button before you start." />
        </p>
      </div>
    </div>
  );
}
