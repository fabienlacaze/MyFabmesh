// Privacy Policy — ENGLISH version (2026-09-28).
// Rebuilt from the English text that preceded the French translation
// (commit 2b2bc56), then brought level with every section added in French
// since: country / app type, automatic error reports, transfers outside the
// EU (4.1), their retention periods. PrivacyFr.tsx holds the French text; the
// two must be kept in step.
//
// The « [À_COMPLÉTER » markers keep their French prefix on purpose:
// scripts/check-legal-identity.mjs searches every .tsx under app/legal for
// that exact prefix and refuses the build while any is left.

import { legalIdentity as id } from '@/config/legal-identity';

export function PrivacyEn() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p style={{ color: 'var(--text-2)' }}>Last updated: 2026-08-23</p>

      <p>
        This page explains what personal data MyFabmesh.AI (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;) collects when you use the service at{' '}
        <code>myfabmesh-cloud.fabien65400.workers.dev</code>, why we collect it, how
        long we keep it, and how to exercise your GDPR rights.
      </p>

      <h2>1. Data controller</h2>
      <p>
        {id.tradeName} is operated by <strong>{id.operator}</strong> ({id.country}).
        Contact for any privacy request:{' '}
        <a href={`mailto:${id.supportEmail}`}>{id.supportEmail}</a>.
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> email address and password hash, stored
          by our authentication provider <strong>Supabase</strong> (EU region).
        </li>
        <li>
          <strong>Generated assets:</strong> images and 3D meshes you produce,
          stored on <strong>Cloudflare R2</strong> under a key prefixed with
          your anonymous user id.
        </li>
        <li>
          <strong>Generation history:</strong> the parameters of each job (asset
          type, mode, seed, options, timestamps, credit cost) stored in our
          Supabase database.
        </li>
        <li>
          <strong>Payment data:</strong> handled by <strong>Stripe</strong>. We
          never see your card number; we only store the Stripe session id, the
          credit pack purchased, and the amount in EUR.
        </li>
        <li>
          <strong>Technical data:</strong> IP address (transient, used only for
          rate-limiting), user-agent string, and short-lived Cloudflare access
          logs.
        </li>
        <li>
          <strong>Country and app type:</strong> for each generation, we keep the{' '}
          <strong>country</strong> the request came from (as our host Cloudflare
          reports it) and whether it came from the desktop app or a browser. We
          use this only to know which markets use the service and to spot an
          outage that would affect a single country or platform. We keep{' '}
          <strong>neither the city, nor the region, nor the IP address</strong>{' '}
          with these statistics, and they are never used for ad targeting.
          Legal basis: legitimate interest (Art. 6(1)(f)) in understanding and
          maintaining our own service.
        </li>
        <li>
          <strong>Diagnostic logs &mdash; off unless you turn them on:</strong> the app
          keeps a rolling copy of your browser console in memory. It is
          <strong> never sent anywhere</strong> unless you tick &ldquo;Send
          diagnostic logs to MyFabmesh&rdquo; in Settings, which you would
          normally only do because support asked you to. When enabled, the log
          &mdash; which includes your prompts, your project names, the page address
          and your browser&apos;s user-agent &mdash; is uploaded after each
          generation. Passwords, access tokens and e-mail addresses are
          stripped out before it leaves your browser. It is kept for 30 days,
          then deleted automatically. Turning the switch back off stops it
          immediately, and Settings also offers &ldquo;Save a copy
          instead&rdquo;, which writes the same log to a file on your computer
          and uploads nothing.
        </li>
        <li>
          <strong>Error reports &mdash; only when an operation fails:</strong>{' '}
          if a generation or a tool fails, the last 300 lines of your browser
          console are sent to us so that we can fix the problem. Before it
          leaves your browser, the report is{' '}
          <strong>stripped of your prompts and other typed text</strong>, your
          e-mail address, passwords and access tokens. Nothing is sent when the
          operation succeeds. Legal basis: legitimate interest (Art. 6(1)(f)) in
          fixing failures of the service. You can object at any time by
          unticking &ldquo;Send error reports automatically&rdquo; in Settings.
          Kept for 30 days, then deleted automatically.
        </li>
      </ul>

      <h2>3. Why we collect it</h2>
      <ul>
        <li>To authenticate you (legitimate interest + contractual necessity).</li>
        <li>To run the generation pipeline you requested (contractual necessity).</li>
        <li>To bill you for credits used (contractual necessity).</li>
        <li>To protect the service from abuse &mdash; rate-limiting, ban lists, audit logs (legitimate interest).</li>
        <li>To investigate a problem you reported, if &mdash; and only if &mdash; you switched diagnostic logs on (consent, Art. 6(1)(a); withdraw it by switching them back off).</li>
        <li>To diagnose and fix a failed operation, from an error report stripped of your typed text (legitimate interest, Art. 6(1)(f); you can object in Settings).</li>
        <li>To comply with French and EU law where applicable (legal obligation).</li>
      </ul>

      <h2>4. Third parties we share data with</h2>
      <p>We don&apos;t sell your data. We share strictly what each provider needs:</p>
      <ul>
        <li><strong>Supabase</strong> (Auth + Postgres, EU region) &mdash; your account and jobs.</li>
        <li><strong>Stripe</strong> &mdash; your payment session.</li>
        <li><strong>Cloudflare</strong> &mdash; Worker, R2 storage, CDN.</li>
        <li><strong>Modal Labs</strong> &mdash; GPU compute for image / mesh generation. Receives the source image you uploaded for the duration of the job.</li>
        <li><strong>Replicate</strong> &mdash; fallback GPU compute. Same scope as Modal.</li>
      </ul>

      <h3>4.1 Transfers outside the European Union</h3>
      <p>
        Some of the providers above are established outside the European
        Union. The processing they carry out on our behalf therefore amounts to{' '}
        <strong>transfers of data outside the EU</strong> within the meaning of
        Chapter V of the GDPR (Art. 44 to 49). For each of them, here is what is
        transferred and for how long:
      </p>
      <ul>
        <li>
          <strong>Modal Labs</strong> (a company established in the{' '}
          <strong>United States</strong>) &mdash; receives the source image you
          upload and the job parameters, for the duration of the GPU compute.
        </li>
        <li>
          <strong>Replicate</strong> (a company established in the{' '}
          <strong>United States</strong>) &mdash; same scope as Modal, only when
          the fallback compute is used.
        </li>
        <li>
          <strong>{id.host.name}</strong> ({id.host.address}) &mdash; runs the
          Worker, the R2 storage and the CDN. Its network being global, your
          requests, your technical logs and your generated files may be
          processed on servers located outside the European Union.
        </li>
        <li>
          <strong>Stripe</strong> &mdash; payment data and, for marketplace
          sellers, KYC verification data.{' '}
          [À_COMPLÉTER: identify, in the Stripe contract actually signed, the
          contracting entity and its country of establishment, then the
          intra-group transfers that follow from it.]
        </li>
        <li>
          <strong>Supabase</strong> &mdash; your account and your job history are
          hosted in the <strong>EU region</strong>, and therefore stored in the
          European Union.{' '}
          [À_COMPLÉTER: confirm with Supabase whether administration or support
          access from a third country takes place, and on what basis.]
        </li>
      </ul>
      <p>
        <strong>Safeguard for these transfers:</strong>{' '}
        [À_COMPLÉTER: state, for each recipient outside the EU, the Chapter V
        mechanism actually relied on &mdash; adequacy decision (Art. 45, for
        example an EU-US Data Privacy Framework certification), standard
        contractual clauses of the European Commission (Art. 46(2)(c)), or
        another appropriate safeguard &mdash; and the date it was put in place.]
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
        Until this statement is completed, no safeguard should be assumed to be
        in place: we would rather flag the missing information than announce a
        protection we have not verified. You can ask us at any time, at{' '}
        <a href={`mailto:${id.supportEmail}`}>{id.supportEmail}</a>, for a copy of
        the safeguards that apply to these transfers (GDPR Art. 15(2) and
        46(1)). If you do not want your image to be sent to a compute provider
        located outside the European Union, do not start a generation: this
        transfer cannot be separated from the service.
      </p>

      <h2>5. How long we keep your data</h2>
      <ul>
        <li>Account + payment history: until you delete your account (GDPR Art. 17 &mdash; see below).</li>
        <li>Generated R2 assets: until you delete them, or until your account is deleted.</li>
        <li>Admin audit logs: 12 months.</li>
        <li>Diagnostic logs (only if you enabled them): 30 days, then deleted automatically.</li>
        <li>Automatic error reports (failed operations): 30 days, then deleted automatically.</li>
        <li>Cloudflare technical logs: 24 hours (Cloudflare default).</li>
      </ul>

      <h2>6. Your rights (GDPR)</h2>
      <ul>
        <li>
          <strong>Right to access (Art. 15):</strong> log in and, in the app, open{' '}
          <a href="/app/?reglages=compte">Settings (⚙) → Privacy &amp; data</a> → &ldquo;Download my data&rdquo; for a
          full JSON export of everything we hold.
        </li>
        <li>
          <strong>Right to erasure (Art. 17):</strong> log in and, in the app, open{' '}
          <a href="/app/?reglages=compte">Settings (⚙) → Privacy &amp; data</a> → &ldquo;Delete my account&rdquo;. We
          will permanently delete your account, projects, meshes, images and
          payment history within seconds. The operation is logged but the
          deleted data itself is unrecoverable.
        </li>
        <li>
          <strong>Right to rectification (Art. 16):</strong> change your password
          from the sign-in page (&ldquo;forgot password&rdquo;), or email us to change
          your email address.
        </li>
        <li>
          <strong>Right to data portability (Art. 20):</strong> covered by the
          JSON export above.
        </li>
        <li>
          <strong>Right to lodge a complaint:</strong> contact the CNIL
          (France) at <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">cnil.fr/fr/plaintes</a>.
        </li>
      </ul>

      <h2>7. Cookies</h2>
      <p>
        We use two strictly necessary cookies and no tracking cookies:
      </p>
      <ul>
        <li><code>mfm-session</code> &mdash; HttpOnly, holds your access token while signed in.</li>
        <li><code>mfm-refresh</code> &mdash; HttpOnly, used to mint a new access token before the current one expires.</li>
      </ul>
      <p>
        Stripe sets its own cookies on its own domain when you check out.
        Cloudflare may set anti-bot cookies (<code>__cf_bm</code>) at the edge.
        Neither is under our control.
      </p>

      <h2>8. NSFW / illegal content</h2>
      <p>
        Generating, uploading or sharing content that is illegal in the
        country of either party (notably CSAM and other content prohibited
        by French law) terminates your account immediately. We cooperate
        with authorities when required by law.
      </p>

      <h3>8.1 Age verification</h3>
      <p>
        To turn off the content filter, we ask you to verify that you are an
        adult. The check is carried out by <strong>Stripe</strong> (Stripe
        Identity) with an identity document and a selfie, which you send to
        Stripe and which Stripe processes; we do not receive them. We
        receive the result and, for a moment, the date of birth read by
        Stripe, only to confirm that you are 18 or older; we do not keep
        it. We store that your account is &ldquo;adult
        verified&rdquo;, the date of the check and the identifier of the
        Stripe check. We do not store your document, your photo or your date
        of birth, and we ask Stripe to erase the check data as soon as the
        decision is made. The legal basis is our legitimate interest in
        protecting minors. If the check shows that you are under 18, the
        account cannot turn off the content filter. Deleting your account
        deletes this record.
      </p>

      <h2>9. Changes</h2>
      <p>
        We update this page when our practices change. The &ldquo;Last
        updated&rdquo; date at the top reflects the current version. Material
        changes are announced by email to active users.
      </p>

      <h2>10. Marketplace &amp; Stripe Connect</h2>
      <p>
        If you list assets on our marketplace, or activate cash payouts as a
        seller, the following additional terms apply.
      </p>

      <h3>10.1 Data we collect from marketplace participants</h3>
      <ul>
        <li>
          <strong>Listing metadata</strong> (title, description, price, licence)
          is stored in our backend and visible to all marketplace visitors once
          approved.
        </li>
        <li>
          <strong>Author display name</strong> (derived from the part of your
          email before the <code>@</code>) is shown next to your listings.
        </li>
        <li>
          <strong>Sales records</strong> (buyer ID, seller ID, amount, currency,
          Stripe session ID, <code>paid_at</code> timestamp, payout details) are
          stored for accounting and audit purposes.
        </li>
      </ul>

      <h3>10.2 Data shared with Stripe (sellers who activate cash payouts)</h3>
      <ul>
        <li>
          When you click &ldquo;Set up cash payouts&rdquo;, you are redirected
          to <strong>Stripe Connect Express</strong> where you provide
          identification data (name, address, date of birth, ID document,
          IBAN / bank account).
        </li>
        <li>
          Stripe performs KYC (&ldquo;Know Your Customer&rdquo;) verification
          under European AML directives or the US Bank Secrecy Act, as
          applicable.
        </li>
        <li>
          We do <strong>not</strong> store your ID document, full bank account
          number, or date of birth. Stripe is the data controller for that
          data.
        </li>
        <li>
          We do store: Stripe account ID (<code>acct_xxx</code>), country,
          <code> charges_enabled</code> / <code>payouts_enabled</code> flags,
          and account creation date.
        </li>
        <li>
          Stripe&apos;s privacy policy applies to that data:{' '}
          <a href="https://stripe.com/privacy" target="_blank" rel="noopener">stripe.com/privacy</a>.
        </li>
      </ul>

      <h3>10.3 Tax reporting</h3>
      <ul>
        <li>
          Where required by law (US IRS 1099-K thresholds, EU DAC7 thresholds),
          we may share aggregated sales data with tax authorities through
          Stripe&apos;s reporting tools.
        </li>
        <li>
          Sellers will be notified by Stripe if their activity reaches a
          reportable threshold.
        </li>
      </ul>

      <h3>10.4 Your rights</h3>
      <ul>
        <li>
          You can request deletion of your seller account at any time. Stripe
          will retain transactional records for the legal minimum (typically
          7&ndash;10 years for accounting).
        </li>
        <li>
          Active listings are unpublished automatically when the seller account
          is deleted.
        </li>
        <li>
          Sales records older than 30 days are not deleted, in order to comply
          with accounting law.
        </li>
      </ul>

      <p style={{ marginTop: 32, fontSize: 13 }}>
        <a href="/legal/terms">Terms of Service</a> &middot;{' '}
        <a href="/">Home</a>
      </p>
    </>
  );
}
