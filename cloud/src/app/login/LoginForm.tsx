'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { T, Message, texte, type Texte } from '@/lib/langue';
import { useTr } from '@/lib/langue-client';

const MOCK = process.env.NEXT_PUBLIC_MOCK === '1';

/** Map raw Supabase/auth errors to clear, user-facing messages. Falls back to
 *  the original text for anything unrecognized. The signup email-send failure
 *  ("Error sending confirmation email") is the common one when the SMTP relay
 *  is misconfigured — surface something actionable instead of the raw string.
 *
 *  2026-10-13 (lot interface multilingue) : les messages sont des Texte (lib/langue.tsx), rendus dans les
 *  six langues ; un message inconnu du service d'authentification reste tel quel (son texte d'origine). */
function friendlyAuthError(raw: string): Texte | string {
  const m = (raw || '').toLowerCase();
  if (m.includes('sending') && m.includes('email')) {
    return texte("We couldn't send the verification email right now (the email service is temporarily unavailable). Please try again in a minute — if it keeps failing, contact us.", "Impossible d'envoyer l'e-mail de vérification pour le moment (le service d'e-mail est temporairement indisponible). Réessayez dans une minute ; si le problème persiste, contactez-nous.");
  }
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already exists')) {
    return texte('This email is already registered — use "Sign in" instead (or reset your password).', "Cette adresse e-mail est déjà enregistrée : utilisez « Se connecter » (ou réinitialisez votre mot de passe).");
  }
  if (m.includes('invalid login credentials')) {
    return texte('Incorrect email or password.', 'E-mail ou mot de passe incorrect.');
  }
  if (m.includes('email not confirmed')) {
    return texte("Your email isn't verified yet. Enter the 6-digit code we emailed you — or ask for a new one below.", "Votre adresse e-mail n'est pas encore vérifiée. Saisissez le code à 6 chiffres reçu par e-mail, ou demandez-en un nouveau ci-dessous.");
  }
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) {
    return texte('Too many attempts — please wait a minute and try again.', 'Trop de tentatives : patientez une minute puis réessayez.');
  }
  if (m.includes('otp_expired') || (m.includes('token') && (m.includes('expired') || m.includes('invalid')))) {
    return texte('That code is invalid or has expired — request a new one.', "Ce code est invalide ou a expiré : demandez-en un nouveau.");
  }
  return raw;
}

/** Erreur qui porte deja son message traduisible (lib/langue.tsx). */
class ErreurTexte extends Error {
  texte: Texte;
  constructor(t: Texte) { super(t.en); this.texte = t; }
}
function messageErreur(err: unknown): Texte | string {
  if (err instanceof ErreurTexte) return err.texte;
  return friendlyAuthError(err instanceof Error ? err.message : String(err));
}

/**
 * Email + password sign-in (the classic flow).
 *
 * - "Sign in":   email + password → session
 * - "Sign up":   email + password → Supabase emails a 6-digit OTP
 *                code to verify ownership → user pastes code → session
 *                (created with the password they chose, no second prompt)
 * - "Forgot password": email → Supabase emails a reset link
 *
 * Returning users only ever see email + password. Codes are involved
 * only on initial signup and password reset.
 */
type Mode = 'signin' | 'signup' | 'verify' | 'forgot' | 'forgot-sent';

/** Destination `?next=` : UNIQUEMENT un chemin de CE site. Une adresse absolue (https://autre-site), `//autre-site`, `/\autre-site` ou `javascript:` envoyait l'utilisateur,
 *  apres une connexion reussie, vers une page d'hameconnage ou executait du script (revue admin 2026-10-02, transverse/T4). */
function safeNext(brut: string | null, defaut: string): string {
  if (!brut) return defaut;
  try {
    const u = new URL(brut, window.location.origin);
    if (u.origin !== window.location.origin || !brut.startsWith('/') || brut.startsWith('//') || brut.startsWith('/\\')) return defaut;
    return u.pathname + u.search + u.hash;
  } catch { return defaut; }
}

export function LoginForm() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Texte | string | null>(null);
  const [info, setInfo] = useState<Texte | string | null>(null);
  const [consent, setConsent] = useState(false);  // signup gate: ToS/Privacy + age
  const tr = useTr();

  function client() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  /** Hand the Supabase session off to the Worker so it can mint an
   *  HttpOnly cookie. The Worker validates the access_token against
   *  Supabase /auth/v1/user before setting the cookie, then mirrors
   *  the access_token in mfm-session (HttpOnly+Secure+SameSite=Strict)
   *  and the refresh_token in mfm-refresh.
   *
   *  This replaces the previous client-side document.cookie write —
   *  the JWT is now unreachable from any JS context (XSS-safe). */
  async function persistSession(session: { access_token: string; refresh_token?: string; expires_in?: number; expires_at?: number; token_type?: string; user?: unknown }) {
    const r = await fetch('/api/auth/install-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const detail = (j as { error?: string }).error || r.status;
      // Coupe-circuit « Site » : un message lisible plutot que « cookie install failed » (seuls les administrateurs peuvent encore se connecter).
      if (r.status === 503 && /temporarily disabled/i.test(String(detail))) {
        throw new ErreurTexte(texte('MyFabmesh.AI is down for maintenance. Please try again in a few minutes.', 'MyFabmesh.AI est en maintenance. Réessayez dans quelques minutes.'));
      }
      throw new ErreurTexte(texte('Could not open your session ({x}). Please try again.', "Impossible d'ouvrir votre session ({x}). Réessayez.", String(detail)));
    }
  }

  function navigateAfterAuth() {
    // Land in the app on the projects listing (nicer than the bare /account
    // page), unless an explicit ?next= was provided.
    const next = safeNext(new URLSearchParams(window.location.search).get('next'), '/app/#/projects');
    window.location.href = next;
  }

  /** Ask Supabase to email a fresh confirmation message (link + 6-digit
   *  code) for an account that exists but was never confirmed.
   *
   *  Sets info/error itself; the caller owns `busy`. */
  async function sendConfirmation() {
    try {
      const { error } = await client().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setError(null);
      setInfo(texte('We sent a new 6-digit code to {x}. Check your inbox (and spam), then enter it below.', 'Nous avons envoyé un nouveau code à 6 chiffres à {x}. Vérifiez votre boîte de réception (et les indésirables), puis saisissez-le ci-dessous.', email));
    } catch (err: unknown) {
      setInfo(null);
      setError(messageErreur(err));
    }
  }

  async function handleResend() {
    if (!email) { setInfo(null); setError(texte('Enter your email address first.', "Saisissez d'abord votre adresse e-mail.")); return; }
    setBusy(true); setError(null); setInfo(null);
    try { await sendConfirmation(); } finally { setBusy(false); }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (MOCK) {
        const r = await fetch('/api/mock-login', {
          method: 'POST', body: JSON.stringify({ email }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!r.ok) throw new Error('mock login failed');
        navigateAfterAuth();
        return;
      }
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new ErreurTexte(texte('Sign-in succeeded but no session was returned.', "Connexion réussie, mais aucune session n'a été renvoyée."));
      await persistSession(data.session);
      navigateAfterAuth();
    } catch (err: unknown) {
      if (err instanceof ErreurTexte) { setError(err.texte); return; }
      const raw = err instanceof Error ? err.message : String(err);
      // WHAT WAS WRONG: this branch only ever displayed "your email isn't
      // verified yet" and left the user on the sign-in form. The 'verify'
      // screen was reachable exclusively from handleSignUp, i.e. once, in
      // the tab where the account was created. Anyone who closed that tab
      // was locked out of an account that exists and holds credits.
      //
      // Supabase only answers "Email not confirmed" when the password was
      // CORRECT (a wrong one yields "invalid login credentials"), so THIS
      // automatic resend cannot be used to spam a third party's inbox.
      // Careful though: the manual "Send a new code" button on the verify
      // screen is NOT password-gated (someone locked out may not remember
      // their password either). There the only brake is Supabase's own
      // per-address email rate limit, surfaced as "Too many attempts".
      if (raw.toLowerCase().includes('email not confirmed')) {
        setMode('verify');
        setCode('');
        await sendConfirmation();
        return;
      }
      setError(friendlyAuthError(raw));
    } finally { setBusy(false); }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    if (password.length < 6) {
      setBusy(false);
      setError(texte('Password must be at least 6 characters.', 'Le mot de passe doit contenir au moins 6 caractères.'));
      return;
    }
    if (!consent) {
      setBusy(false);
      setError(texte('Please confirm your age and accept the Terms and Privacy Policy.', 'Confirmez votre âge et acceptez les conditions générales et la politique de confidentialité.'));
      return;
    }
    try {
      const { data, error } = await client().auth.signUp({
        email, password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          // GDPR: record the timestamped consent + age attestation on the user.
          data: {
            tos_accepted: true,
            tos_version: 'v1',
            tos_accepted_at: new Date().toISOString(),
            age_confirmed_16: true,
          },
        },
      });
      if (error) throw error;
      // If email confirmation is required (default in Supabase), we don't
      // get a session — we get a "check your inbox" state instead.
      if (data.session) {
        await persistSession(data.session);
        navigateAfterAuth();
        return;
      }
      setMode('verify');
      setInfo(texte('Account created. Check your inbox for a 6-digit code to verify your email.', 'Compte créé. Consultez votre boîte de réception : un code à 6 chiffres vous permettra de vérifier votre adresse e-mail.'));
    } catch (err: unknown) {
      setError(messageErreur(err));
    } finally { setBusy(false); }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      const sb = client();
      // For a brand-new signup, the OTP type is "signup".
      let res = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'signup' });
      if (res.error) {
        // Fallback for users whose Supabase project sends "email" type instead.
        res = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
      }
      if (res.error) throw res.error;
      if (!res.data.session) throw new ErreurTexte(texte('Verification succeeded but no session was returned.', "Vérification réussie, mais aucune session n'a été renvoyée."));
      await persistSession(res.data.session);
      navigateAfterAuth();
    } catch (err: unknown) {
      setError(messageErreur(err));
    } finally { setBusy(false); }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      const { error } = await client().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
      setMode('forgot-sent');
      // CRITICAL: do NOT instruct the user to "click the link in the
      // email" — Outlook SafeLinks blocks Supabase auth URLs as
      // "unsafe" (the email domain `onboarding@resend.dev` has poor
      // reputation + the Supabase callback URL is unknown to Outlook),
      // which locks every hotmail/outlook user out of password reset.
      // The 6-digit code path works in 100% of cases — that's what we
      // direct people to.
      setInfo(texte('We sent a 6-digit code to {x}. Open the email (check spam too) and enter the code on the next screen.', "Nous avons envoyé un code à 6 chiffres à {x}. Ouvrez l'e-mail (pensez aux indésirables) et saisissez le code à l'écran suivant.", email));
    } catch (err: unknown) {
      setError(messageErreur(err));
    } finally { setBusy(false); }
  }

  // -------------------------------------------------------------------

  if (mode === 'verify') return (
    <form onSubmit={handleVerifyCode}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 42, marginBottom: 6 }}>✉</div>
        <h3 style={{ marginBottom: 4 }}><T en="Verify your email" fr="Vérifiez votre adresse e-mail" /></h3>
        {/* Wording has to stay true in the THREE ways this screen is now
            reached: straight after signup, after a blocked sign-in (a fresh
            code was just sent), and from the "Account not verified?" link,
            where nothing was sent in this session. The old text asserted a
            send that, on that third path, never happened — so it makes no
            claim about when the email went out. Only the info banner below,
            set by sendConfirmation(), announces an actual send. */}
        <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
          <T en="Enter the 6-digit code sent to **{x}**." fr="Saisissez le code à 6 chiffres envoyé à **{x}**." vals={[email]} /><br />
          <T en="Don't have it? Request a new one below." fr="Vous ne l'avez pas ? Demandez-en un nouveau ci-dessous." />
        </p>
      </div>
      <label><T en="Verification code" fr="Code de vérification" /></label>
      <input
        type="text" required inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6}
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="123456" dir="ltr"
        style={{ marginBottom: 14, fontSize: 22, letterSpacing: 8, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
        autoFocus
      />
      <button type="submit" className="primary-btn" disabled={busy || code.length !== 6} style={{ width: '100%' }}>
        {busy ? '…' : <T en="Confirm account" fr="Confirmer le compte" />}
      </button>
      <button type="button" onClick={handleResend} disabled={busy}
              style={{ background: 'transparent', border: 'none', color: 'var(--accent)', marginTop: 12, fontSize: 13, cursor: 'pointer', width: '100%' }}>
        <T en="Didn't get it (or code expired)? Send a new code" fr="Pas reçu (ou code expiré) ? Envoyer un nouveau code" />
      </button>
      <button type="button" onClick={() => { setMode('signin'); setCode(''); setError(null); setInfo(null); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', marginTop: 6, fontSize: 13, cursor: 'pointer', width: '100%' }}>
        <T en="← Back to sign in" fr="← Retour à la connexion" />
      </button>
      {info && <div className="banner ok" style={{ marginTop: 12 }}><Message m={info} /></div>}
      {error && <div className="banner error" role="alert" style={{ marginTop: 12 }}>⚠ <Message m={error} /></div>}
    </form>
  );

  if (mode === 'forgot') return (
    <form onSubmit={handleForgot}>
      <h3 style={{ marginBottom: 6 }}><T en="Reset your password" fr="Réinitialiser votre mot de passe" /></h3>
      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 18 }}>
        <T en="Enter your account email — we'll send you a reset link." fr="Saisissez l'adresse e-mail de votre compte : nous vous enverrons un lien de réinitialisation." />
      </p>
      <label><T en="Email" fr="E-mail" /></label>
      <input type="email" required value={email}
             onChange={(e) => setEmail(e.target.value)}
             placeholder="you@studio.com" dir="ltr"
             style={{ marginBottom: 14 }} autoFocus />
      <button type="submit" className="primary-btn" disabled={busy} style={{ width: '100%' }}>
        {busy ? '…' : <T en="Send reset link" fr="Envoyer le lien de réinitialisation" />}
      </button>
      <button type="button" onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', marginTop: 12, fontSize: 13, cursor: 'pointer', width: '100%' }}>
        <T en="← Back to sign in" fr="← Retour à la connexion" />
      </button>
      {error && <div className="banner error" role="alert" style={{ marginTop: 12 }}>⚠ <Message m={error} /></div>}
    </form>
  );

  if (mode === 'forgot-sent') return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 42, marginBottom: 8 }}>✉</div>
      <h3 style={{ marginBottom: 6 }}><T en="Check your inbox" fr="Consultez votre boîte de réception" /></h3>
      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 18 }}><Message m={info} /></p>
      {/* Primary CTA = the code path. Don't rely on clicking the email
          link — Outlook SafeLinks blocks Supabase callback URLs and
          locks users out. */}
      <a href="/auth/reset-password" className="primary-btn"
         style={{ width: '100%', display: 'block', boxSizing: 'border-box', textDecoration: 'none' }}>
        <T en="I have the code → Enter it" fr="J'ai le code → Le saisir" />
      </a>
      <button type="button" onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
              style={{ width: '100%', marginTop: 10, background: 'transparent',
                       border: 'none', color: 'var(--text-3)', cursor: 'pointer',
                       padding: '8px 0', fontSize: 13 }}>
        <T en="← Back to sign in" fr="← Retour à la connexion" />
      </button>
    </div>
  );

  // signin / signup
  const isSignUp = mode === 'signup';
  return (
    <form onSubmit={isSignUp ? handleSignUp : handleSignIn}>
      {MOCK && (
        <div className="banner warn">
          🛠 <strong>DEV MODE</strong> · Instant login · 50 credits offered · No real email sent
        </div>
      )}
      <label><T en="Email" fr="E-mail" /></label>
      <input type="email" required value={email}
             onChange={(e) => setEmail(e.target.value)}
             placeholder="you@studio.com" dir="ltr"
             autoComplete="email"
             style={{ marginBottom: 14 }} />
      <label><T en="Password" fr="Mot de passe" /></label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input type={showPassword ? 'text' : 'password'} required value={password}
               onChange={(e) => setPassword(e.target.value)}
               placeholder={isSignUp ? tr('Choose a password (6+ characters)', 'Choisissez un mot de passe (6 caractères ou plus)') : tr('Your password', 'Votre mot de passe')}
               autoComplete={isSignUp ? 'new-password' : 'current-password'}
               minLength={6}
               style={{ width: '100%', paddingInlineEnd: 44, boxSizing: 'border-box', margin: 0 }} />
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
      {isSignUp && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 0 14px', fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                 style={{ marginTop: 2, flexShrink: 0 }} />
          <span>
            <T
              en="I confirm I am at least 16 years old (or have my guardian's consent) and I accept the [Terms of Service](/legal/terms) and the [Privacy Policy](/legal/privacy)."
              fr="Je confirme avoir au moins 16 ans (ou l'accord de mon représentant légal) et j'accepte les [conditions générales](/legal/terms) et la [politique de confidentialité](/legal/privacy)."
            />
          </span>
        </label>
      )}
      <button type="submit" className="primary-btn"
              disabled={busy || (isSignUp && !consent)} style={{ width: '100%' }}>
        {busy ? '…' : (isSignUp ? <T en="Create account" fr="Créer le compte" /> : <T en="Sign in" fr="Se connecter" />)}
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13 }}>
        {isSignUp ? (
          <button type="button" onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: 0 }}>
            <T en="← Have an account? Sign in" fr="← Vous avez un compte ? Se connecter" />
          </button>
        ) : (
          <>
            <button type="button" onClick={() => { setMode('signup'); setError(null); setInfo(null); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
              <T en="Create an account" fr="Créer un compte" />
            </button>
            <button type="button" onClick={() => { setMode('forgot'); setError(null); setInfo(null); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: 0 }}>
              <T en="Forgot password?" fr="Mot de passe oublié ?" />
            </button>
          </>
        )}
      </div>

      {!isSignUp && (
        <button type="button"
                onClick={() => {
                  if (!email) { setInfo(null); setError(texte('Enter your email address first.', "Saisissez d'abord votre adresse e-mail.")); return; }
                  setMode('verify'); setCode(''); setError(null); setInfo(null);
                }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-3, var(--text-2))',
                         cursor: 'pointer', padding: 0, marginTop: 10, fontSize: 12, width: '100%', textAlign: 'center' }}>
          <T en="Account not verified? Enter your 6-digit code" fr="Compte non vérifié ? Saisissez votre code à 6 chiffres" />
        </button>
      )}

      {info && <div className="banner ok" style={{ marginTop: 12 }}><Message m={info} /></div>}
      {error && <div className="banner error" role="alert" style={{ marginTop: 12 }}>⚠ <Message m={error} /></div>}
    </form>
  );
}
