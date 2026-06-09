import { ImageResponse } from "next/og";
import { SITE_TAGLINE } from "@/lib/site";

// Generated at request time, then cached by the CDN. This is the card people
// see when the link is shared in iMessage/WhatsApp/X — the single highest-value
// SEO/sharing asset that was missing.
export const alt = "Tarjuman — Live Khutbah Transcription & Translation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The app mark (rounded square + abstract mic), reused from public/icon.svg.
// Inner square uses the surface color so it reads against the darker page bg.
const ICON_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><rect width='512' height='512' rx='112' fill='#0E1525'/><rect x='180' y='120' width='152' height='220' rx='76' fill='#2ECC71'/><path d='M 110 240 Q 110 386 256 386 Q 402 386 402 240' fill='none' stroke='#2ECC71' stroke-width='22' stroke-linecap='round'/><line x1='256' y1='386' x2='256' y2='430' stroke='#2ECC71' stroke-width='22' stroke-linecap='round'/><line x1='200' y1='430' x2='312' y2='430' stroke='#2ECC71' stroke-width='22' stroke-linecap='round'/></svg>`;

async function loadFont(weight: 400 | 700): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/fontsource/fonts/dm-sans@latest/latin-${weight}-normal.ttf`
    );
    if (res.ok) return await res.arrayBuffer();
  } catch {
    // Fall back to the built-in font rather than failing the whole image.
  }
  return null;
}

export default async function OpengraphImage() {
  const [regular, bold] = await Promise.all([loadFont(400), loadFont(700)]);
  const fonts = [
    regular && { name: "DM Sans", data: regular, weight: 400 as const, style: "normal" as const },
    bold && { name: "DM Sans", data: bold, weight: 700 as const, style: "normal" as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[];

  const iconDataUri = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#060B18",
          color: "#F0F4F8",
          fontFamily: "DM Sans",
          position: "relative",
          padding: "80px",
        }}
      >
        {/* Subtle accent glow — restrained, not a neon wash. */}
        <div
          style={{
            position: "absolute",
            top: -220,
            left: -160,
            width: 640,
            height: 640,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle, rgba(46,204,113,0.16), rgba(46,204,113,0) 70%)",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={148} height={148} src={iconDataUri} alt="" style={{ borderRadius: 32 }} />
        <div style={{ display: "flex", fontSize: 112, fontWeight: 700, marginTop: 40, letterSpacing: "-0.03em" }}>
          Tarjuman
        </div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 400, color: "#B0BEC5", marginTop: 6 }}>
          {SITE_TAGLINE}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 50 }}>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#2ECC71" }}>Arabic → English</div>
          <div style={{ display: "flex", fontSize: 28, color: "#455A64" }}>·</div>
          <div style={{ display: "flex", fontSize: 28, color: "#6B7D8D" }}>real-time, on screen</div>
        </div>
        <div style={{ position: "absolute", bottom: 54, display: "flex", fontSize: 26, fontWeight: 700, color: "#455A64" }}>
          tarjuman.live
        </div>
      </div>
    ),
    { ...size, ...(fonts.length ? { fonts } : {}) }
  );
}
