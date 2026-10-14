'use client';

// Password reset landing.
//
// Two paths:
//   1. PKCE link path — Supabase appends ?code=… to the URL. If the
//      SAME browser initiated "Forgot password" we can exchange the
//      code for a session and let the user pick a new password.
//   2. Cross-browser fallback — when the user clicks the email link in
//      a browser different from the one where they typed their email
//      (Outlook desktop → system default browser is the canonical case),
//      the PKCE verifier is missing and step 1 fails. We then show a
//      manual form: email + 6-digit code (from the same email) + new
//      password. We call sb.auth.verifyOtp({ type:'recovery' }) which
//      mints a session without any local verifier.

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { T, Message, texte, type Texte } from '@/lib/langue';
import { useTr } from '@/lib/langue-client';

type Mode = 'init' | 'set-password' | 'enter-code';

/** Messages du service d'authentification les plus frequents sur cet ecran, dans les six langues
 *  (2026-10-13) ; un message inconnu reste tel quel. */
function messageReinit(e: unknown): Texte | string {
  const brut = e instanceof Error ? e.message : String(e);
  const m = brut.toLowerCase();
  if (m.includes('otp_expired') || (m.includes('token') && (m.includes('expired') || m.includes('invalid')))) {
    return texte('That code is invalid or has expired — request a new one.', 'Ce code est invalide ou a expiré : demandez-en un nouveau.');
  }
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) {
    return texte('Too many attempts — please wait a minute and try again.', 'Trop de tentatives : patientez une minute puis réessayez.');
  }
  if (m.includes('should be different')) {
    return texte('The new password must be different from the old one.', "Le nouveau mot de passe doit être différent de l'ancien.");
  }
  return brut;
}

export default function ResetPasswordPage() {
  const [mode, setMode] = useState<Mode>('init');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  // Œil « afficher le mot de passe », comme sur la page de connexion
  // (LoginForm.tsx). Il manquait ici alors que c'est précisément l'écran
  // où l'on tape un mot de passe NEUF, sans champ de confirmation : sans
  // relecture possible, une faute de frappe ne se découvre qu'à la
  // connexion suivante.
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Texte | string | null>(null);
  const [info, setInfo] = useState<Texte | string | null>(null);
  const tr = useTr();

  function client() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  // On mount, try the PKCE path. If it succeeds we go straight to
  // "set new password". If it fails (cross-browser case), drop into
  // the manual OTP fallback.
  useEffect(() => {
    (async () => {
      try {
        const sb = client();
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const hasHash = window.location.hash.includes('access_token');

        if (code) {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState(null, '', window.location.pathname);
          setMode('set-password');
          return;
        }
        if (hasHash) {
          await sb.auth.getSession();
          window.history.replaceState(null, '', window.location.pathname);
          setMode('set-password');
          return;
        }
        // No code, no hash — let the user enter their email + the OTP code
        // from the mail manually.
        setMode('enter-code');
      } catch {
        // PKCE failed (cross-browser) — fall back to manual OTP code.
        setMode('enter-code');
      }
    })();
  }, []);

  async function verifyCodeAndStart(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      const { data, error } = await client().auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'recovery',
      });
      if (error) throw error;
      if (!data.session) { setError(texte('Code accepted but no session was created.', "Code accepté, mais aucune session n'a été créée.")); return; }
      setMode('set-password');
    } catch (e: unknown) {
      setError(messageReinit(e));
    } finally { setBusy(false); }
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (password.length < 6) { setError(texte('Password must be at least 6 characters.', 'Le mot de passe doit contenir au moins 6 caractères.')); return; }
      const sb = client();
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      // Pipe the new session through our HttpOnly cookie endpoint so
      // the JWT stops being readable from JS (matches the login flow).
      const { data: sessData } = await sb.auth.getSession();
      if (sessData.session) {
        await fetch('/api/auth/install-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            access_token: sessData.session.access_token,
            refresh_token: sessData.session.refresh_token,
            expires_in: sessData.session.expires_in,
          }),
        }).catch(() => {});
      }
      setInfo(texte('Password updated — redirecting…', 'Mot de passe modifié, redirection…'));
      setTimeout(() => { window.location.replace('/app/'); }, 700);
    } catch (e: unknown) {
      setError(messageReinit(e));
    } finally { setBusy(false); }
  }

  return (
    <main style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <h2 style={{ marginBottom: 6 }}><T en="Reset your password" fr="Réinitialiser votre mot de passe" /></h2>
        <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 18 }}>
          <T en="Choose a new password for your MyFabmesh.AI account." fr="Choisissez un nouveau mot de passe pour votre compte MyFabmesh.AI." />
        </p>

        {mode === 'init' && (
          <p style={{ color: 'var(--text-2)' }}><T en="Validating link…" fr="Vérification du lien…" /></p>
        )}

        {mode === 'enter-code' && (
          <form onSubmit={verifyCodeAndStart}>
            <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 14 }}>
              <T en="Enter your email and the 6-digit code we sent you to verify your reset request." fr="Saisissez votre adresse e-mail et le code à 6 chiffres que nous vous avons envoyé pour confirmer votre demande." />
            </p>
            <label><T en="Email" fr="E-mail" /></label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="you@studio.com" autoComplete="email" dir="ltr"
                   style={{ marginBottom: 14 }} autoFocus />
            <label><T en="Code from the reset email" fr="Code reçu dans l'e-mail de réinitialisation" /></label>
            <input type="text" required inputMode="numeric" autoComplete="one-time-code"
                   pattern="[0-9]{6}" maxLength={6}
                   value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                   placeholder="123456" dir="ltr"
                   style={{ marginBottom: 14, fontSize: 20, letterSpacing: 6, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} />
            <button type="submit" className="primary-btn"
                    disabled={busy || code.length !== 6 || !email}
                    style={{ width: '100%' }}>
              {busy ? '…' : <T en="Verify code" fr="Vérifier le code" />}
            </button>
            <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 12, textAlign: 'center' }}>
              <T en="No code yet?" fr="Pas encore de code ?" />{' '}
              <a href="/login" style={{ color: 'var(--accent)' }}><T en="Request a new reset" fr="Demander une nouvelle réinitialisation" /></a>
            </p>
            {error && <div className="banner error" role="alert" style={{ marginTop: 12 }}>⚠ <Message m={error} /></div>}
          </form>
        )}

        {mode === 'set-password' && (
          <form onSubmit={setNewPassword}>
            <label><T en="New password" fr="Nouveau mot de passe" /></label>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input type={showPassword ? 'text' : 'password'} required minLength={6}
                     value={password} onChange={(e) => setPassword(e.target.value)}
                     placeholder={tr('At least 6 characters', 'Au moins 6 caractères')}
                     autoComplete="new-password"
                     style={{ width: '100%', paddingInlineEnd: 44, boxSizing: 'border-box', margin: 0 }} autoFocus />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? tr('Hide password', 'Masquer le mot de passe') : tr('Show password', 'Afficher le mot de passe')}
                      title={showPassword ? tr('Hide password', 'Masquer le mot de passe') : tr('Show password', 'Afficher le mot de passe')}
                      style={{ position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)',
                               background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                               color: 'var(--text-2, #8a93b2)', display: 'flex', alignItems: 'center' }}>
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            <button type="submit" className="primary-btn" disabled={busy} style={{ width: '100%' }}>
              {busy ? '…' : <T en="Set new password" fr="Enregistrer le nouveau mot de passe" />}
            </button>
            {info && <div className="banner ok" style={{ marginTop: 12 }}><Message m={info} /></div>}
            {error && <div className="banner error" role="alert" style={{ marginTop: 12 }}>⚠ <Message m={error} /></div>}
          </form>
        )}
      </div>
    </main>
  );
}
