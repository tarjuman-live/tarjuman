import React from "react";
import { COLORS } from "@/lib/constants";

/**
 * Render plain text that may contain inline markdown links of the form
 * `[label](url)` — used for sunnah.com citation links the translate route
 * produces. Everything outside link patterns renders as plain text.
 *
 * Why not ReactMarkdown: we only need this narrow `[text](url)` pattern;
 * pulling in a full markdown parser for this would add bundle weight and
 * could accidentally interpret stray `*` / `_` / `#` characters in
 * translations as formatting.
 */

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function renderTextWithLinks(text: string): React.ReactNode {
  if (!text || !text.includes("[")) return text;

  const out: React.ReactNode[] = [];
  let cursor = 0;
  LINK_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = LINK_RE.exec(text)); ) {
    if (m.index > cursor) out.push(text.slice(cursor, m.index));
    const label = m[1];
    const url = m[2];
    out.push(
      <a
        key={`${m.index}-${url}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          color: COLORS.accent,
          textDecoration: "underline",
          textUnderlineOffset: "2px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
    );
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
