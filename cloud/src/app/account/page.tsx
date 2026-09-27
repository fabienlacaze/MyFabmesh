'use client';
/* /account N'EST PLUS UNE PAGE (2026-09-28, user : « cette page est trop
 * bizarre », « supprime-la et reintegre ces elements dans les bons endroits de
 * l'appli »). Tout son contenu vit dans l'appli, ⚙ Parametres : compte,
 * historique, gains Marketplace et versements Stripe, reponses du support,
 * double authentification, donnees personnelles. Cette route ne fait que
 * rediriger, pour que les anciens liens (e-mails, favoris, retours Stripe deja
 * emis) arrivent au bon endroit. */
import { useEffect } from 'react';

export default function AccountRedirect() {
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const p = new URLSearchParams();
    for (const k of ['paid', 'session_id', 'stripe_return', 'stripe_refresh']) {
      const v = qs.get(k);
      if (v) p.set(k, v);
    }
    p.set('reglages', qs.get('stripe_return') || qs.get('stripe_refresh') ? 'paiements' : 'compte');
    window.location.replace('/app/?' + p.toString());
  }, []);
  return <div className="page">…</div>;
}
