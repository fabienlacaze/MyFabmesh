'use client';
// Cookie consent banner — RGPD compliant minimum.
//
// We only ever set strictly-necessary cookies (mfm-session, mfm-refresh
// — both HttpOnly), so the legal regime is the "exempted" tier of
// e-Privacy: no opt-in required for THOSE cookies. But the banner is
// still expected by EU users + DPAs as a transparency signal.
//
// Once the user dismisses the banner we stash a localStorage flag so
// it doesn't reappear on every navigation. No tracking cookie set.

import { useEffect, useState } from 'react';
import { T } from '@/lib/langue';
import { useTr } from '@/lib/langue-client';

const LS_KEY = 'mfm-cookie-consent-v1';

export function CookieBanner() {
  const [show, setShow] = useState(false);
  const tr = useTr();

  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY)) return;
      setShow(true);
    } catch { /* localStorage disabled — render the banner anyway */ }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(LS_KEY, new Date().toISOString()); } catch {}
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label={tr('Cookie notice', 'Information sur les cookies')}
      style={{
        position: 'fixed',
        left: 16, right: 16, bottom: 16,
        zIndex: 9000,
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 18px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        fontSize: 13,
        lineHeight: 1.5,
        maxWidth: 920,
        margin: '0 auto',
      }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <strong>🍪 <T en="Cookies" fr="Cookies" /></strong> — <T
          en="We only set strictly necessary cookies (your sign-in session), and we don't track you with analytics or ads. Stripe sets its own cookies on its own domain when you pay. Read more in our [Privacy Policy](/legal/privacy)."
          fr="Nous ne déposons que des cookies strictement nécessaires (votre session de connexion) et nous ne vous suivons ni par des mesures d'audience ni par de la publicité. Stripe dépose ses propres cookies sur son propre domaine lors du paiement. En savoir plus dans notre [politique de confidentialité](/legal/privacy)."
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <a
          href="/legal/privacy"
          className="ghost-btn"
          style={{ textDecoration: 'none', padding: '8px 14px', fontSize: 13 }}
        ><T en="Learn more" fr="En savoir plus" /></a>
        <button
          type="button"
          onClick={dismiss}
          className="primary-btn"
          style={{ padding: '8px 18px', fontSize: 13 }}
        ><T en="Got it" fr="J'ai compris" /></button>
      </div>
    </div>
  );
}
