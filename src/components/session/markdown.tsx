"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { COLORS } from "@/lib/constants";

/**
 * Shared dark-theme markdown renderer for AI output (study notes, Q&A answers,
 * translated text). Same visual language as the summary block in session-body.
 */
export function Markdown({
  children,
  fontSize = 15,
  rtl = false,
}: {
  children: string;
  fontSize?: number;
  rtl?: boolean;
}) {
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="summary-markdown"
      style={{
        color: COLORS.w,
        direction: rtl ? "rtl" : "ltr",
        textAlign: rtl ? "right" : "left",
        fontSize,
        lineHeight: 1.7,
        fontWeight: rtl ? 500 : 400,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => (
            <h1
              className="font-bold mb-3 mt-1"
              style={{ fontSize: fontSize + 4, color: COLORS.w }}
              {...props}
            />
          ),
          h2: (props) => (
            <h2
              className="font-bold mt-4 mb-2"
              style={{ fontSize: fontSize + 1, color: COLORS.accent }}
              {...props}
            />
          ),
          h3: (props) => (
            <h3
              className="font-semibold mt-3 mb-1"
              style={{ fontSize, color: COLORS.w }}
              {...props}
            />
          ),
          p: (props) => <p className="mb-3" {...props} />,
          ul: (props) => <ul className="list-disc pl-5 mb-3 space-y-2" {...props} />,
          ol: (props) => (
            <ol className="list-decimal pl-5 mb-3 space-y-2" {...props} />
          ),
          li: (props) => <li className="leading-relaxed" {...props} />,
          strong: (props) => (
            <strong className="font-bold" style={{ color: COLORS.w }} {...props} />
          ),
          em: (props) => <em className="italic" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="pl-3 my-3 italic"
              style={{
                borderLeft: `3px solid ${COLORS.accent}`,
                color: `${COLORS.w}cc`,
              }}
              {...props}
            />
          ),
          code: (props) => (
            <code
              className="px-1.5 py-0.5 rounded font-mono text-[0.9em]"
              style={{ background: `${COLORS.w}1a` }}
              {...props}
            />
          ),
          a: (props) => (
            <a
              className="underline"
              style={{ color: COLORS.accent }}
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
