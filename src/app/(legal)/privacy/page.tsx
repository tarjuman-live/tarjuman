import { COLORS } from "@/lib/constants";

// PLACEHOLDER text. Before public launch, replace with text from your
// preferred privacy-policy generator (termly.io / iubenda / privacypolicies.com)
// or have a lawyer review. The structure here matches what most generators
// produce so swapping is straightforward.

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
      <div style={styles.meta}>Last updated: 2026-05-04 — DRAFT.</div>

      <p style={styles.p}>
        This Privacy Policy describes how Tarjuman (&quot;we&quot;,
        &quot;our&quot;) collects, uses, and protects information when you use
        the Tarjuman service.
      </p>

      <h2 style={styles.h2}>What we collect</h2>
      <ul style={styles.ul}>
        <li>
          <strong>Account information:</strong> email address, name (if
          provided via Google sign-in), and profile picture (if provided via
          Google sign-in).
        </li>
        <li>
          <strong>Audio content:</strong> when you record a session, your
          microphone audio is sent to our speech-to-text provider (Deepgram)
          for transcription. Audio is processed in-memory and is not stored on
          our servers.
        </li>
        <li>
          <strong>Transcripts and translations:</strong> the source-language
          text from your recordings, plus translations and summaries generated
          for you. These are stored in our database (Convex) and visible only
          to your authenticated account.
        </li>
        <li>
          <strong>Usage telemetry:</strong> anonymized counts of API calls
          (translation, summary) for cost and abuse monitoring. No transcript
          content is included.
        </li>
      </ul>

      <h2 style={styles.h2}>Third-party processors</h2>
      <p style={styles.p}>
        Your data is processed by these subprocessors:
      </p>
      <ul style={styles.ul}>
        <li>
          <strong>Deepgram</strong> — real-time speech transcription. Audio is
          sent to Deepgram&apos;s servers for transcription and returned as
          text. See{" "}
          <a
            href="https://deepgram.com/privacy"
            style={{ color: COLORS.accent }}
          >
            Deepgram&apos;s privacy policy
          </a>
          .
        </li>
        <li>
          <strong>Anthropic (Claude)</strong> — translation and summary
          generation. Transcript text is sent to Anthropic&apos;s API. See{" "}
          <a
            href="https://anthropic.com/privacy"
            style={{ color: COLORS.accent }}
          >
            Anthropic&apos;s privacy policy
          </a>
          .
        </li>
        <li>
          <strong>Convex</strong> — database and authentication. Stores your
          email, transcripts, summaries, and authentication credentials.
        </li>
        <li>
          <strong>Resend</strong> — transactional email (password reset codes
          only).
        </li>
        <li>
          <strong>Google</strong> — only if you sign in with Google (OAuth).
          We receive your name, email, and profile picture from Google.
        </li>
      </ul>

      <h2 style={styles.h2}>How we use your data</h2>
      <ul style={styles.ul}>
        <li>To provide the transcription, translation, and summary features.</li>
        <li>To let you access your transcript history across devices.</li>
        <li>To send you transactional emails (password reset).</li>
        <li>To monitor abuse and protect the service from automated misuse.</li>
      </ul>
      <p style={styles.p}>
        We do <strong>not</strong> sell your data. We do not share it with
        third parties except the subprocessors listed above. We do not use
        your transcripts for advertising or to train AI models.
      </p>

      <h2 style={styles.h2}>Data retention</h2>
      <p style={styles.p}>
        Your transcripts, translations, and summaries are retained
        indefinitely until you delete them — either individually (delete a
        session) or collectively (delete your account). When you delete your
        account, all your sessions and the user record are permanently
        removed; the deletion is not reversible.
      </p>

      <h2 style={styles.h2}>Your rights</h2>
      <ul style={styles.ul}>
        <li>
          <strong>Access:</strong> use the History tab to view all data we
          hold about your sessions, or export any session as Markdown from
          the session detail page.
        </li>
        <li>
          <strong>Deletion:</strong> tap your avatar → &quot;Delete
          account&quot; in the app to permanently delete your data.
        </li>
        <li>
          <strong>Correction / questions:</strong> email{" "}
          <a href="mailto:hiqmalabs@gmail.com" style={{ color: COLORS.accent }}>
            hiqmalabs@gmail.com
          </a>
          .
        </li>
      </ul>

      <h2 style={styles.h2}>Cookies</h2>
      <p style={styles.p}>
        We use cookies only for authentication (keeping you signed in). We do
        not use third-party tracking cookies or advertising cookies.
      </p>

      <h2 style={styles.h2}>Children</h2>
      <p style={styles.p}>
        Tarjuman is not intended for children under 13. If you become
        aware that a child has provided us with personal information, please
        contact us so we can delete it.
      </p>

      <h2 style={styles.h2}>Changes</h2>
      <p style={styles.p}>
        We may update this policy from time to time. The &quot;Last
        updated&quot; date at the top reflects the most recent change.
        Material changes will be communicated via the email associated with
        your account.
      </p>

      <h2 style={styles.h2}>Contact</h2>
      <p style={styles.p}>
        Questions? Email{" "}
        <a href="mailto:hiqmalabs@gmail.com" style={{ color: COLORS.accent }}>
          hiqmalabs@gmail.com
        </a>
        .
      </p>
    </>
  );
}
