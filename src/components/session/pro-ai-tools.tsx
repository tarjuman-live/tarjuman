"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import { COLORS } from "@/lib/constants";
import { isRtl, getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { usePlan } from "@/hooks/use-plan";
import { UpgradeCard } from "@/components/billing/upgrade-card";
import { BILLING_ENABLED } from "../../../convex/billingLimits";
import { streamText } from "@/lib/stream-text";
import { Markdown } from "./markdown";
import { LangDropdown } from "./lang-dropdown";

interface Segment {
  sourceText: string;
  translatedText: string;
}

type Tab = "notes" | "ask" | "translate";
type Gen = { phase: "idle" } | { phase: "loading"; text: string } | { phase: "ready"; text: string } | { phase: "error"; message: string };

/**
 * Pro AI tools shown under a completed / saved session: AI study notes,
 * Ask-the-lecture (grounded Q&A), and full-transcript translation into any
 * language. Ephemeral (results held in local state, not persisted — v1).
 *
 * Gating: `locked` only when billing is LIVE and the user isn't Pro. While
 * billing is off everyone can use them (consistent with the rest of the app),
 * but they're clearly marked ✦ Pro.
 */
export function ProAiTools({
  segments,
  sourceLang,
  targetLang,
}: {
  segments: Segment[];
  sourceLang: string;
  targetLang: string;
}) {
  const plan = usePlan();
  const authToken = useAuthToken();
  const [tab, setTab] = useState<Tab>("notes");

  const locked = BILLING_ENABLED && plan?.plan !== "pro";
  if (segments.length === 0) return null;

  // Content the LLM reasons over (target/English translation, like the summary).
  const transcriptForLLM = segments
    .map((s) => s.translatedText || s.sourceText)
    .join(" ");
  // Original speech, for re-translating the whole lecture into a new language.
  const sourceTranscript = segments.map((s) => s.sourceText).join(" ");

  return (
    <div
      className="px-4 py-4 rounded-2xl mb-5"
      style={{ background: COLORS.surface, border: `1px solid ${COLORS.accent}30` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon name="sparkle" size={14} color={COLORS.accent} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: COLORS.accent }}>
          AI tools
        </span>
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-[6px] py-[2px] rounded-md"
          style={{ background: COLORS.accentSoft, color: COLORS.accent }}
        >
          ✦ Pro
        </span>
      </div>

      {locked ? (
        <UpgradeCard
          title="Unlock AI tools with Pro"
          message="AI study notes, Ask-the-lecture, and any-language transcript translation are Tarjuman Pro features."
        />
      ) : (
        <>
          {/* Tabs */}
          <div
            className="flex gap-1 p-1 rounded-xl mb-4"
            style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
          >
            {(
              [
                ["notes", "Study notes"],
                ["ask", "Ask"],
                ["translate", "Translate"],
              ] as [Tab, string][]
            ).map(([id, label]) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className="flex-1 h-8 rounded-lg text-[12.5px] font-bold cursor-pointer transition-all duration-200"
                  style={{
                    background: active ? COLORS.accent : "transparent",
                    color: active ? "#0A0F1C" : COLORS.t2,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {tab === "notes" && (
            <StudyNotes
              transcript={transcriptForLLM}
              targetLang={targetLang}
              authToken={authToken}
            />
          )}
          {tab === "ask" && (
            <AskLecture
              transcript={transcriptForLLM}
              targetLang={targetLang}
              authToken={authToken}
            />
          )}
          {tab === "translate" && (
            <TranslateTranscript
              transcript={sourceTranscript}
              sourceLang={sourceLang}
              targetLang={targetLang}
              authToken={authToken}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Study notes ─────────────────────────────────────────────────────────────
function StudyNotes({
  transcript,
  targetLang,
  authToken,
}: {
  transcript: string;
  targetLang: string;
  authToken: string | null | undefined;
}) {
  const [lang, setLang] = useState(targetLang);
  const [gen, setGen] = useState<Gen>({ phase: "idle" });
  // Abort the in-flight stream when the user switches tabs (this component
  // unmounts) or starts a new run — otherwise the server keeps generating up to
  // the full token budget for output nobody will see, burning Anthropic cost.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGen({ phase: "loading", text: "" });
    try {
      const text = await streamText(
        "/api/study-notes",
        { transcript, targetLanguage: lang },
        authToken,
        (t) => setGen({ phase: "loading", text: t }),
        controller.signal
      );
      setGen({ phase: "ready", text });
    } catch (e) {
      // Aborted (superseded run / unmount) — not a real error; leave state be.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setGen({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <PrimaryButton onClick={run} disabled={gen.phase === "loading"} icon="doc">
          {gen.phase === "loading" ? "Generating…" : gen.phase === "ready" ? "Regenerate" : "Generate study notes"}
        </PrimaryButton>
        <LangDropdown value={lang} onChange={setLang} disabled={gen.phase === "loading"} />
      </div>
      {(gen.phase === "loading" || gen.phase === "ready") && gen.text && (
        <Markdown fontSize={15} rtl={isRtl(lang)}>{gen.text}</Markdown>
      )}
      {gen.phase === "error" && <ErrorLine message={gen.message} onRetry={run} />}
    </div>
  );
}

// ── Ask the lecture ─────────────────────────────────────────────────────────
function AskLecture({
  transcript,
  targetLang,
  authToken,
}: {
  transcript: string;
  targetLang: string;
  authToken: string | null | undefined;
}) {
  const [messages, setMessages] = useState<{ q: string; a: string; error?: boolean }[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  // Cancel the in-flight answer stream if the user leaves the tab (unmount).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || asking) return;
    setInput("");
    setAsking(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const idx = messages.length;
    setMessages((m) => [...m, { q: question, a: "" }]);
    try {
      await streamText(
        "/api/ask",
        { transcript, question, targetLanguage: targetLang },
        authToken,
        (t) =>
          setMessages((m) => {
            const next = [...m];
            if (next[idx]) next[idx] = { ...next[idx], a: t };
            return next;
          }),
        controller.signal
      );
    } catch (err) {
      // Aborted (unmount) — leave the partial answer, don't flag an error.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMessages((m) => {
        const next = [...m];
        if (next[idx])
          next[idx] = {
            ...next[idx],
            a: err instanceof Error ? err.message : String(err),
            error: true,
          };
        return next;
      });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div>
      {messages.length === 0 && (
        <p className="text-[13px] mb-3" style={{ color: COLORS.t3 }}>
          Ask anything about this lecture — answers come only from the transcript.
        </p>
      )}
      <div className="flex flex-col gap-3 mb-3">
        {messages.map((m, i) => (
          <div key={i}>
            <div
              className="inline-block px-3 py-2 rounded-2xl text-[13px] font-semibold mb-1.5"
              style={{ background: COLORS.accentSoft, color: COLORS.accent }}
            >
              {m.q}
            </div>
            {m.a ? (
              m.error ? (
                <div className="text-[12.5px]" style={{ color: COLORS.red }}>{m.a}</div>
              ) : (
                <Markdown fontSize={14}>{m.a}</Markdown>
              )
            ) : (
              <div className="text-[13px]" style={{ color: COLORS.t3 }}>…thinking</div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the lecture…"
          className="flex-1 h-10 px-3 rounded-xl text-[13px] outline-none"
          style={{ background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, color: COLORS.w }}
        />
        <button
          type="submit"
          disabled={asking || !input.trim()}
          className="h-10 px-4 rounded-xl text-[13px] font-bold cursor-pointer transition-all duration-200 active:scale-[0.98] hover:brightness-110 disabled:opacity-50"
          style={{ background: COLORS.accent, color: "#0A0F1C" }}
        >
          Ask
        </button>
      </form>
    </div>
  );
}

// ── Translate full transcript ───────────────────────────────────────────────
function TranslateTranscript({
  transcript,
  sourceLang,
  targetLang,
  authToken,
}: {
  transcript: string;
  sourceLang: string;
  targetLang: string;
  authToken: string | null | undefined;
}) {
  const [lang, setLang] = useState(targetLang === "en" ? "ur" : "en");
  const [gen, setGen] = useState<Gen>({ phase: "idle" });
  // Abort the (potentially long, up-to-8000-token) translation when the user
  // switches tabs or restarts it, so it doesn't run to completion unseen.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGen({ phase: "loading", text: "" });
    try {
      const text = await streamText(
        "/api/translate-transcript",
        { transcript, targetLanguage: lang },
        authToken,
        (t) => setGen({ phase: "loading", text: t }),
        controller.signal
      );
      setGen({ phase: "ready", text });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setGen({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div>
      <p className="text-[13px] mb-3" style={{ color: COLORS.t3 }}>
        Translate the whole lecture (from {getLangName(sourceLang)}) into another language.
      </p>
      <div className="flex items-center gap-2 mb-3">
        <PrimaryButton onClick={run} disabled={gen.phase === "loading"} icon="globe">
          {gen.phase === "loading" ? "Translating…" : gen.phase === "ready" ? "Retranslate" : "Translate"}
        </PrimaryButton>
        <LangDropdown value={lang} onChange={setLang} disabled={gen.phase === "loading"} />
      </div>
      {(gen.phase === "loading" || gen.phase === "ready") && gen.text && (
        <div
          dir={isRtl(lang) ? "rtl" : "ltr"}
          className="text-[15px] leading-relaxed whitespace-pre-wrap"
          style={{
            color: COLORS.w,
            direction: isRtl(lang) ? "rtl" : "ltr",
            textAlign: isRtl(lang) ? "right" : "left",
          }}
        >
          {gen.text}
        </div>
      )}
      {gen.phase === "error" && <ErrorLine message={gen.message} onRetry={run} />}
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────
function PrimaryButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: "doc" | "globe";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 px-4 h-10 rounded-xl font-bold text-[13px] cursor-pointer transition-all duration-200 active:scale-[0.98] hover:brightness-110 disabled:opacity-50"
      style={{
        background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDk})`,
        color: "#0A0F1C",
      }}
    >
      <Icon name={icon} size={15} color="#0A0F1C" />
      {children}
    </button>
  );
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-[12.5px]" style={{ color: COLORS.red }}>
      {message}{" "}
      <button type="button" onClick={onRetry} className="underline font-semibold" style={{ color: COLORS.accent }}>
        Try again
      </button>
    </div>
  );
}
