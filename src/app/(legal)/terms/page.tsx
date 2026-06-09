import { COLORS } from "@/lib/constants";

// PLACEHOLDER text. Replace before public launch. The structure follows
// common SaaS Terms of Service templates.

export const metadata = {
  title: "Terms of Service",
  description: "Terms governing use of Tarjuman.",
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

export default function TermsPage() {
  return (
    <>
      <h1 style={styles.h1}>Terms of Service</h1>
      <div style={styles.meta}>Last updated: 2026-05-04 — DRAFT.</div>

      <p style={styles.p}>
        By using Tarjuman (the &quot;Service&quot;), you agree to these
        Terms of Service. If you don&apos;t agree, don&apos;t use the Service.
      </p>

      <h2 style={styles.h2}>Eligibility</h2>
      <p style={styles.p}>
        You must be at least 13 years old to use the Service. By using the
        Service you confirm you meet this requirement.
      </p>

      <h2 style={styles.h2}>Your account</h2>
      <p style={styles.p}>
        You&apos;re responsible for maintaining the confidentiality of your
        account credentials and for all activity that occurs under your
        account. Notify us immediately at hiqmalabs@gmail.com if you suspect
        unauthorized access.
      </p>

      <h2 style={styles.h2}>Acceptable use</h2>
      <p style={styles.p}>You agree NOT to:</p>
      <ul style={styles.ul}>
        <li>
          Record audio of people without their knowledge where doing so would
          violate applicable wiretap or recording-consent laws.
        </li>
        <li>
          Use the Service to transcribe content that violates the
          intellectual-property rights or privacy of others.
        </li>
        <li>
          Attempt to circumvent rate limits, abuse bug reports for credits,
          or use the API in automated bulk ways without prior arrangement.
        </li>
        <li>
          Reverse-engineer, decompile, or scrape the Service for the purpose
          of building a competing product.
        </li>
      </ul>

      <h2 style={styles.h2}>Recording consent</h2>
      <p style={styles.p}>
        Recording-consent law varies by jurisdiction. Some places require all
        parties&apos; consent to record audio. <strong>You</strong> are
        responsible for ensuring your use of the Service complies with
        applicable law in your location. The Service is designed for
        lectures, classes, sermons (khutbahs), and meetings where the speaker
        is publicly addressing an audience and would reasonably expect the
        audio to be recorded — but you remain responsible for compliance.
      </p>

      <h2 style={styles.h2}>Content ownership</h2>
      <p style={styles.p}>
        You retain ownership of your transcripts, translations, and
        summaries. We grant ourselves no license to your content beyond what
        is necessary to operate the Service.
      </p>

      <h2 style={styles.h2}>Service availability</h2>
      <p style={styles.p}>
        We aim for high availability but make no uptime guarantee. The
        Service depends on third-party providers (Deepgram, Anthropic,
        Convex) whose outages may affect our availability.
      </p>

      <h2 style={styles.h2}>Pricing</h2>
      <p style={styles.p}>
        The Service is currently free during the MVP period. We may introduce
        paid plans in the future; existing users will be notified in advance
        and will retain access to a reasonable free tier.
      </p>

      <h2 style={styles.h2}>Disclaimer of warranties</h2>
      <p style={styles.p}>
        The Service is provided &quot;as is&quot; and &quot;as
        available.&quot; Transcription accuracy depends on audio quality,
        language, and acoustics — we don&apos;t warrant that transcripts will
        be accurate or complete. Translation and summarization are AI-generated
        and may contain errors. <strong>Don&apos;t rely on the Service for
        legal, medical, religious, or other consequential decisions without
        independent verification.</strong>
      </p>

      <h2 style={styles.h2}>Limitation of liability</h2>
      <p style={styles.p}>
        To the maximum extent permitted by law, we are not liable for
        indirect, incidental, consequential, or punitive damages arising from
        your use of the Service. Our total liability is limited to the
        amount you have paid us in the 12 months preceding the claim (which
        is currently $0 since the Service is free).
      </p>

      <h2 style={styles.h2}>Termination</h2>
      <p style={styles.p}>
        You can terminate your account at any time via the &quot;Delete
        account&quot; button in the app. We may suspend or terminate accounts
        for violation of these Terms, abuse of the Service, or non-payment
        (when paid plans exist).
      </p>

      <h2 style={styles.h2}>Changes</h2>
      <p style={styles.p}>
        We may update these Terms from time to time. Material changes will
        be communicated via the email associated with your account.
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
