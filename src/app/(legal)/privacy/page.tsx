import { COLORS } from "@/lib/constants";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata = {
  title: "Privacy Policy",
  description: "How Tarjuman collects, uses, and stores your data.",
};

const styles = {
  h1: { color: COLORS.w, fontSize: 28, fontWeight: 700, marginBottom: 8 },
  meta: { color: COLORS.t4, fontSize: 13, marginBottom: 24 },
  h2: {
    color: COLORS.w,
    fontSize: 18,
    fontWeight: 600,
    marginTop: 28,
    marginBottom: 8,
  },
  p: { color: COLORS.t2, fontSize: 14, lineHeight: 1.7, marginBottom: 12 },
  ul: { color: COLORS.t2, fontSize: 14, lineHeight: 1.7, paddingLeft: 24 },
} as const;

export default function PrivacyPage() {
  return (
    <>
      <h1 style={styles.h1}>Privacy Policy</h1>
      <div style={styles.meta}>Last updated: 2026-10-21</div>

      <p style={styles.p}>
        This Privacy Policy explains how Tarjuman (&quot;Tarjuman&quot;,
        &quot;we&quot;, &quot;our&quot;) collects, uses, shares, and protects
        information when you use the Tarjuman service (the &quot;Service&quot;) at
        tarjuman.live. By using the Service, you agree to this policy.
      </p>

      <h2 style={styles.h2}>What we collect</h2>
      <ul style={styles.ul}>
        <li>
          <strong>Account information:</strong> your email address, and your
          name and profile picture if you sign in with Google.
        </li>
        <li>
          <strong>Audio you record:</strong> when you start a session, your
          microphone audio is streamed to our speech-to-text provider
          (Speechmatics, or Deepgram as a standby if Speechmatics is
          unavailable) for live transcription. Audio is processed in transit and
          is <strong>not stored</strong> by us — only the resulting text is
          saved.
        </li>
        <li>
          <strong>Transcripts, translations &amp; summaries:</strong> the
          source-language text from your recordings, the translations, and any
          AI summaries you generate. These are stored in our database and are
          visible to your authenticated account. A small number of authorized
          Tarjuman operators can see account and session details (such as
          session titles, languages and length) and, only when needed to
          provide support, investigate abuse, or fix a problem, open a
          transcript — every transcript they open is logged.
        </li>
        <li>
          <strong>Preferences:</strong> your default languages and display
          settings.
        </li>
        <li>
          <strong>Diagnostics &amp; usage:</strong> page views, error reports,
          and a record of each AI and transcription call linked to your
          account (which feature, which model, token counts, estimated cost,
          success or failure). We use these to keep the Service running,
          control costs, catch bugs, and prevent abuse. Per-call records are
          deleted after 35 days (only daily totals are kept), and none of them
          include your transcript content.
        </li>
      </ul>

      <h2 style={styles.h2}>Third-party processors</h2>
      <p style={styles.p}>
        We share data with the following subprocessors only as needed to run the
        Service. Each handles data under its own privacy policy:
      </p>
      <ul style={styles.ul}>
        <li>
          <strong>Speechmatics</strong> — real-time speech-to-text (our primary
          engine). Your audio is sent to Speechmatics for transcription and
          returned as text.{" "}
          <a
            href="https://www.speechmatics.com/legal/privacy-policy"
            style={{ color: COLORS.accent }}
          >
            Policy
          </a>
          .
        </li>
        <li>
          <strong>Deepgram</strong> — standby speech-to-text, used only if
          Speechmatics is unavailable. When it is in use, your audio is sent to
          Deepgram for transcription and returned as text.{" "}
          <a href="https://deepgram.com/privacy" style={{ color: COLORS.accent }}>
            Policy
          </a>
          .
        </li>
        <li>
          <strong>Anthropic (Claude)</strong> — translation and summarization.
          Transcript text is sent to Anthropic&apos;s API. Anthropic does not
          train its models on API data by default.{" "}
          <a href="https://www.anthropic.com/legal/privacy" style={{ color: COLORS.accent }}>
            Policy
          </a>
          .
        </li>
        <li>
          <strong>Convex</strong> — our database and authentication backend.
          Stores your account, transcripts, summaries, and preferences.
        </li>
        <li>
          <strong>Vercel</strong> — hosts the web app and provides cookieless,
          aggregate usage analytics (e.g. page views). No cross-site tracking.
        </li>
        <li>
          <strong>Sentry</strong> — error monitoring. To diagnose crashes it may
          process technical data such as your IP address, browser, and device
          type. It does not receive your transcripts.
        </li>
        <li>
          <strong>Resend</strong> — sends transactional email (password-reset
          codes only).
        </li>
        <li>
          <strong>Google</strong> — only if you choose to sign in with Google
          (OAuth). We receive your name, email, and profile picture.
        </li>
      </ul>

      <h2 style={styles.h2}>How we use your data</h2>
      <ul style={styles.ul}>
        <li>To provide transcription, translation, and summary features.</li>
        <li>To let you access your transcript history across devices.</li>
        <li>To send transactional email (password reset).</li>
        <li>To monitor, secure, and improve the Service and prevent abuse.</li>
      </ul>
      <p style={styles.p}>
        We do <strong>not</strong> sell your personal data, share it for
        advertising, or use your transcripts to train our own models. We share
        data only with the subprocessors above, for the purposes described.
      </p>

      <h2 style={styles.h2}>AI-generated content</h2>
      <p style={styles.p}>
        Transcriptions, translations, and summaries are generated by automated
        systems and <strong>may contain errors</strong>. For religious content
        such as khutbahs, Qur&apos;an, or Hadith, treat the output as an aid
        only — not an authoritative translation or ruling — and verify with
        qualified scholars and primary sources.
      </p>

      <h2 style={styles.h2}>Data retention</h2>
      <p style={styles.p}>
        Your transcripts, translations, and summaries are kept until you delete
        them — individually (delete a session) or all at once (delete your
        account). Deleting your account permanently removes your sessions and
        user record; this cannot be undone.
      </p>

      <h2 style={styles.h2}>Your rights</h2>
      <ul style={styles.ul}>
        <li>
          <strong>Access &amp; export:</strong> view all your sessions in the
          History tab, or export any session as Markdown from its detail page.
        </li>
        <li>
          <strong>Deletion:</strong> tap your avatar → &quot;Delete account&quot;
          to permanently remove your data.
        </li>
        <li>
          <strong>Correction &amp; questions:</strong> email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: COLORS.accent }}>
            {CONTACT_EMAIL}
          </a>
          . Depending on where you live, you may have additional rights under
          laws such as the GDPR or CCPA; contact us to exercise them.
        </li>
      </ul>

      <h2 style={styles.h2}>Security</h2>
      <p style={styles.p}>
        Data is encrypted in transit (HTTPS/WSS). Your transcripts are
        accessible through your authenticated account; operator access is
        limited to named administrators, used only for support, abuse
        investigation, or fixing problems, and every transcript an operator
        opens is recorded in an audit log. No system is perfectly secure, but we use reputable
        infrastructure providers and limit access to your data.
      </p>

      <h2 style={styles.h2}>International transfers</h2>
      <p style={styles.p}>
        Our processors are based primarily in the United States and the
        United Kingdom (Speechmatics), so your data may be processed there. By
        using the Service, you consent to this transfer and processing.
      </p>

      <h2 style={styles.h2}>Cookies</h2>
      <p style={styles.p}>
        We use cookies only to keep you signed in (authentication). We do not
        use advertising or cross-site tracking cookies. Our analytics (Vercel)
        measures aggregate page views without cookies.
      </p>

      <h2 style={styles.h2}>Children</h2>
      <p style={styles.p}>
        Tarjuman is not intended for children under 13. If you believe a child
        has provided us personal information, contact us and we will delete it.
      </p>

      <h2 style={styles.h2}>Changes</h2>
      <p style={styles.p}>
        We may update this policy from time to time. The &quot;Last updated&quot;
        date reflects the most recent change; material changes will be
        communicated via the email associated with your account.
      </p>

      <h2 style={styles.h2}>Contact</h2>
      <p style={styles.p}>
        Questions? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: COLORS.accent }}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </>
  );
}
