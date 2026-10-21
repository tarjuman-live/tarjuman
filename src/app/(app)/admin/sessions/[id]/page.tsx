"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../../convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { isRtl } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { renderTextWithLinks } from "@/lib/citation-renderer";
import { Icon } from "@/components/shared/icon";
import { Skeleton } from "@/components/shared/skeleton";
import { Markdown } from "@/components/session/markdown";
import { useNow } from "@/components/admin/admin-context";
import {
  Avatar,
  Badge,
  Card,
  EmptyHint,
  GhostButton,
  Notice,
} from "@/components/admin/ui";
import {
  dateTime,
  duration,
  errorMessage,
  int,
  langName,
  pairName,
  timeAgo,
} from "@/components/admin/format";

/**
 * /admin/sessions/[id] — support view of one user's session: metadata,
 * summary, and the full transcript.
 *
 * Loaded through `openSessionForAdmin`, a MUTATION that writes the access to
 * adminAuditLog in the same transaction. It runs exactly once per session id
 * per mount (ref-guarded so StrictMode's dev double-mount doesn't log twice).
 * The result is a one-shot snapshot, not a live subscription — reload the page
 * to re-read a session that is still recording (that logs another view).
 */

type Opened = NonNullable<
  FunctionReturnType<typeof api.adminPanel.openSessionForAdmin>
>;
type SessionInfo = Opened["session"];

type LoadState =
  | { id: string; phase: "ready"; data: Opened | null }
  | { id: string; phase: "error"; message: string };

interface DisplaySegment {
  id: string;
  timestamp: number;
  source: string;
  translation: string;
  /** Earlier segments absorbed into this verse/hadith parent. */
  mergedCount: number;
}

export default function AdminSessionDetailPage() {
  const params = useParams<{ id: string }>();
  const sessionId = typeof params?.id === "string" ? params.id : "";
  const openSession = useMutation(api.adminPanel.openSessionForAdmin);
  const openedFor = useRef<string | null>(null);
  const [load, setLoad] = useState<LoadState | null>(null);

  useEffect(() => {
    // One audited open per id. The ref survives StrictMode's simulated
    // unmount/remount (same component instance), so the second effect run is
    // skipped — and there is deliberately no cancel-on-cleanup, or the first
    // (only) call's result would be thrown away.
    if (!sessionId || openedFor.current === sessionId) return;
    openedFor.current = sessionId;
    openSession({ sessionId })
      .then((data) => setLoad({ id: sessionId, phase: "ready", data }))
      .catch((e: unknown) =>
        setLoad({
          id: sessionId,
          phase: "error",
          message: errorMessage(e, "Couldn't open this session."),
        }),
      );
  }, [sessionId, openSession]);

  const current = load && load.id === sessionId ? load : null;

  return (
    <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <div>
        <BackLink />
      </div>

      <Notice tone="blue">
        <span className="inline-flex items-start gap-2">
          <span className="mt-[2px] shrink-0 inline-flex">
            <Icon name="shield" size={13} color={COLORS.blue} />
          </span>
          Viewing a user&apos;s transcript is recorded in the admin audit log.
        </span>
      </Notice>

      {!sessionId ? (
        <NotFound />
      ) : !current ? (
        <DetailSkeleton />
      ) : current.phase === "error" ? (
        <Notice tone="red">{current.message}</Notice>
      ) : current.data === null ? (
        <NotFound />
      ) : (
        <SessionDetail data={current.data} />
      )}
    </div>
  );
}

// ─── Loaded view ────────────────────────────────────────────────────────────

function SessionDetail({ data }: { data: Opened }) {
  const now = useNow();
  const { session, owner, segments } = data;

  // Verse/hadith merges: hide every child id listed in a parent's
  // mergedFromIds and render the parent's combined text instead (same rule as
  // session-body.tsx).
  const visible = useMemo<DisplaySegment[]>(() => {
    const suppressed = new Set<string>();
    for (const s of segments) {
      for (const c of s.mergedFromIds ?? []) suppressed.add(c);
    }
    return segments
      .filter((s) => !suppressed.has(s.id))
      .map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        source: s.combinedSourceText ?? s.sourceText,
        translation: s.combinedTranslatedText ?? s.translatedText,
        mergedCount: s.mergedFromIds?.length ?? 0,
      }));
  }, [segments]);

  const copyText = useMemo(
    () =>
      visible
        .map((s) => [s.source, s.translation].filter(Boolean).join("\n"))
        .join("\n\n"),
    [visible],
  );

  return (
    <div className="flex flex-col gap-3 animate-in fade-in duration-300 motion-reduce:animate-none">
      <HeaderCard
        session={session}
        owner={owner}
        shownSegments={visible.length}
        now={now}
      />

      {session.summary && (
        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkle" size={13} color={COLORS.accent} />
              Summary
            </span>
          }
          subtitle={[
            session.summaryLanguage ? langName(session.summaryLanguage) : null,
            session.summaryGeneratedAt
              ? `generated ${timeAgo(session.summaryGeneratedAt, now)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <Markdown
            fontSize={15}
            rtl={isRtl(session.summaryLanguage ?? session.targetLanguage)}
          >
            {session.summary}
          </Markdown>
        </Card>
      )}

      <Card
        title="Transcript"
        subtitle={`${int(visible.length)} segment${visible.length === 1 ? "" : "s"} · ${pairName(
          `${session.sourceLanguage}→${session.targetLanguage}`,
        )}`}
        action={<CopyAllButton text={copyText} />}
      >
        {visible.length === 0 ? (
          <EmptyHint>No transcript captured.</EmptyHint>
        ) : (
          <Transcript
            segments={visible}
            sourceLanguage={session.sourceLanguage}
            targetLanguage={session.targetLanguage}
          />
        )}
      </Card>
    </div>
  );
}

function HeaderCard({
  session,
  owner,
  shownSegments,
  now,
}: {
  session: SessionInfo;
  owner: Opened["owner"];
  shownSegments: number;
  now: number;
}) {
  const mergedAway = session.segmentCount - shownSegments;
  return (
    <section
      className="rounded-2xl p-4 sm:p-5 min-w-0"
      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h2
          className="text-[18px] leading-snug font-bold min-w-0 break-words"
          style={{ color: session.title ? COLORS.w : COLORS.t3 }}
        >
          {session.title?.trim() || "Untitled"}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={session.status} />
          {session.platform && (
            <Badge tone={session.platform === "ios" ? "blue" : "muted"}>
              {session.platform === "ios" ? "iOS" : "Web"}
            </Badge>
          )}
          {session.summary && <Badge tone="accent">Summary</Badge>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
        <Meta label="Owner">
          {owner ? (
            <OwnerLink owner={owner} />
          ) : (
            <span className="italic" style={{ color: COLORS.t4 }}>
              {session.userId ? "Deleted user" : "No owner"}
            </span>
          )}
        </Meta>
        <Meta label="Languages">
          {pairName(`${session.sourceLanguage}→${session.targetLanguage}`)}
        </Meta>
        <Meta label="Duration">
          <span className="tabular-nums">{duration(session.seconds)}</span>
        </Meta>
        <Meta label="Segments">
          <span className="tabular-nums">{int(session.segmentCount)}</span>
          {mergedAway > 0 && (
            <span style={{ color: COLORS.t3 }}>
              {" "}
              · {int(shownSegments)} shown after verse/hadith merges
            </span>
          )}
        </Meta>
        <Meta label="Created">
          <span className="tabular-nums">{dateTime(session.createdAt)}</span>
          <span style={{ color: COLORS.t3 }}> · {timeAgo(session.createdAt, now)}</span>
        </Meta>
        <Meta label="Last saved">
          <span className="tabular-nums">{dateTime(session.updatedAt)}</span>
          <span style={{ color: COLORS.t3 }}> · {timeAgo(session.updatedAt, now)}</span>
        </Meta>
        <Meta label="Summary language">
          {session.summaryLanguage ? (
            langName(session.summaryLanguage)
          ) : (
            <span style={{ color: COLORS.t4 }}>No summary</span>
          )}
        </Meta>
        <Meta label="Session ID">
          <span
            className="font-mono text-[11.5px] break-all select-all"
            style={{ color: COLORS.t3 }}
          >
            {session.id}
          </span>
        </Meta>
      </dl>
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt
        className="text-[10.5px] font-bold uppercase tracking-wider"
        style={{ color: COLORS.t4 }}
      >
        {label}
      </dt>
      <dd className="mt-1 text-[13px] leading-snug min-w-0" style={{ color: COLORS.t2 }}>
        {children}
      </dd>
    </div>
  );
}

function OwnerLink({ owner }: { owner: NonNullable<Opened["owner"]> }) {
  const [lit, litHandlers] = useLit();
  return (
    <Link
      href={`/admin/users/${owner.id}`}
      {...litHandlers}
      className="inline-flex items-center gap-2 max-w-full min-w-0 rounded-lg outline-none"
      style={{ color: lit ? COLORS.accent : COLORS.w, transition: "color 200ms ease" }}
    >
      <Avatar size={24} image={owner.image} name={owner.name} email={owner.email} />
      <span className="truncate font-semibold">
        {owner.email ?? owner.name ?? owner.id}
      </span>
      <span
        className="shrink-0 inline-flex"
        style={{
          transform: lit ? "translateX(2px)" : "translateX(0)",
          transition: "transform 200ms ease",
        }}
      >
        <Icon name="chevron" size={13} color="currentColor" />
      </span>
    </Link>
  );
}

// ─── Transcript ─────────────────────────────────────────────────────────────

function Transcript({
  segments,
  sourceLanguage,
  targetLanguage,
}: {
  segments: DisplaySegment[];
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const srcRtl = isRtl(sourceLanguage);
  const tgtRtl = isRtl(targetLanguage);
  return (
    <ol className="flex flex-col">
      {segments.map((s, i) => (
        <li
          key={s.id}
          className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 py-3.5"
          style={{
            borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`,
            // Long lectures run to 1000+ segments: let the browser skip
            // layout/paint for rows that are off-screen.
            contentVisibility: "auto",
            containIntrinsicSize: "auto 96px",
          }}
        >
          <span
            className="pt-[3px] text-[11px] font-semibold tabular-nums"
            style={{ color: COLORS.t4 }}
          >
            {clock(s.timestamp)}
          </span>
          <div className="min-w-0 flex flex-col gap-1.5">
            <p
              dir={srcRtl ? "rtl" : "ltr"}
              className="break-words"
              style={{
                color: COLORS.w,
                // 16px base; Arabic-script glyphs read smaller at the same
                // size, so RTL sources get a small bump (as session-body does).
                fontSize: srcRtl ? 18 : 16,
                lineHeight: 1.75,
                fontWeight: srcRtl ? 500 : 400,
                textAlign: srcRtl ? "right" : "left",
              }}
            >
              {s.source}
            </p>
            {s.translation ? (
              <p
                dir={tgtRtl ? "rtl" : "ltr"}
                className="break-words"
                style={{
                  color: COLORS.t2,
                  fontSize: tgtRtl ? 16 : 14,
                  lineHeight: 1.65,
                  textAlign: tgtRtl ? "right" : "left",
                }}
              >
                {renderTextWithLinks(s.translation)}
              </p>
            ) : (
              <p className="text-[12px] italic" style={{ color: COLORS.t4 }}>
                No translation saved
              </p>
            )}
            {s.mergedCount > 0 && (
              <span>
                <Badge tone="blue">Verse/hadith · {s.mergedCount + 1} merged</Badge>
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CopyAllButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    const ok = await copyToClipboard(text);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <GhostButton
      onClick={() => void onCopy()}
      disabled={!text}
      tone={state === "failed" ? "danger" : state === "copied" ? "accent" : "default"}
    >
      <span
        key={state}
        className="inline-flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
      >
        <Icon
          name={state === "copied" ? "check" : state === "failed" ? "close" : "copy"}
          size={13}
          color="currentColor"
        />
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy all"}
      </span>
    </GhostButton>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

function NotFound() {
  return (
    <div
      className="rounded-2xl animate-in fade-in duration-300 motion-reduce:animate-none"
      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
    >
      <EmptyHint>
        <div className="font-semibold text-[13.5px]" style={{ color: COLORS.w }}>
          Session not found
        </div>
        <div className="mt-1">
          It may have been deleted (empty sessions are swept after 6h), or the
          link is wrong.
        </div>
      </EmptyHint>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading session">
      <div
        className="rounded-2xl p-4 sm:p-5 flex flex-col gap-4"
        style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
      >
        <Skeleton style={{ width: "55%", height: 20 }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton style={{ width: 64, height: 9 }} />
              <Skeleton style={{ width: i % 2 ? "60%" : "75%", height: 13 }} />
            </div>
          ))}
        </div>
      </div>
      <div
        className="rounded-2xl p-4 flex flex-col gap-4"
        style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
      >
        <Skeleton style={{ width: 96, height: 13 }} />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
            <Skeleton style={{ width: 34, height: 10 }} />
            <div className="flex flex-col gap-1.5">
              <Skeleton style={{ width: i % 2 ? "85%" : "95%", height: 18 }} />
              <Skeleton style={{ width: i % 2 ? "60%" : "70%", height: 14 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function BackLink() {
  const [lit, litHandlers] = useLit();
  return (
    <Link
      href="/admin/sessions"
      {...litHandlers}
      className="inline-flex items-center gap-1.5 h-8 text-[12.5px] font-semibold rounded-lg outline-none"
      style={{ color: lit ? COLORS.accent : COLORS.t2, transition: "color 200ms ease" }}
    >
      <span
        className="inline-flex"
        style={{
          transform: lit ? "translateX(-2px)" : "translateX(0)",
          transition: "transform 200ms ease",
        }}
      >
        <Icon name="back" size={13} color="currentColor" />
      </span>
      All sessions
    </Link>
  );
}

function StatusBadge({ status }: { status: SessionInfo["status"] }) {
  if (status === "recording") {
    return (
      <Badge tone="red">
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse motion-reduce:animate-none"
          style={{ background: COLORS.red }}
        />
        Live
      </Badge>
    );
  }
  if (status === "paused") return <Badge tone="amber">Paused</Badge>;
  return <Badge>Completed</Badge>;
}

/** Hover / keyboard-focus "lit" state for link hover treatments. */
function useLit() {
  const [lit, setLit] = useState(false);
  return [
    lit,
    {
      onPointerEnter: () => setLit(true),
      onPointerLeave: () => setLit(false),
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible")) setLit(true);
      },
      onBlur: () => setLit(false),
    },
  ] as const;
}

/** Seconds from session start → "04:07" / "1:02:09". */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
