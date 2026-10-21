"use client";

import Link from "next/link";
import { useState, type FocusEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import type { Health } from "../../../../../convex/adminMetrics";
import { USAGE_KIND_LABEL } from "../../../../../convex/usageShared";
import { COLORS, STT_PROVIDER } from "@/lib/constants";
import { Icon } from "@/components/shared/icon";
import { Skeleton } from "@/components/shared/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAdmin, useNow } from "@/components/admin/admin-context";
import {
  Avatar,
  Badge,
  Card,
  EmptyHint,
  GhostButton,
  Notice,
  SectionLabel,
  cardStyle,
  type Tone,
} from "@/components/admin/ui";
import { errorMessage, int, timeAgo } from "@/components/admin/format";

/**
 * /admin/system — data health (from the dashboard snapshot), background
 * cleanups, logging/alerting configuration, recent failures, the admin audit
 * log, and links out to every vendor console.
 */

type SystemInfo = FunctionReturnType<typeof api.adminPanel.getSystemInfo>;
type AuditRow = FunctionReturnType<typeof api.adminPanel.recentAudit>[number];
type CleanupKind = "test_users" | "test_sessions" | "orphaned_auth";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function AdminSystemPage() {
  const { data, computedAt } = useAdmin();
  const health = data?.health ?? null;
  const info = useQuery(api.adminPanel.getSystemInfo);
  const audit = useQuery(api.adminPanel.recentAudit);
  const now = useNow();

  return (
    <div className="flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <SectionLabel>Health</SectionLabel>
      <HealthSection health={health} computedAt={computedAt} now={now} />

      <SectionLabel>Cleanups</SectionLabel>
      <CleanupsCard health={health} />

      <SectionLabel>Usage logging &amp; alerts</SectionLabel>
      <UsageLoggingSection info={info} now={now} />

      <SectionLabel>Recent errors</SectionLabel>
      <RecentErrorsCard info={info} now={now} />

      <SectionLabel>Admin audit log</SectionLabel>
      <AuditCard rows={audit} now={now} />

      <SectionLabel>Dashboards</SectionLabel>
      <DashboardsGrid />
    </div>
  );
}

// ─── 1. Health ──────────────────────────────────────────────────────────────

type HealthKey = Exclude<keyof Health, "totalSessionRows">;

/**
 * `severity` colours a NON-zero count: "danger" = something is broken for a
 * user, "warn" = a job should have fixed it, "info" = expected background noise.
 */
const HEALTH_ROWS: {
  key: HealthKey;
  label: string;
  hint: string;
  severity: "danger" | "warn" | "info";
}[] = [
  {
    key: "stuckRecordings",
    label: "Stuck recordings",
    hint: "Still “recording” 6h+ after their last save. The hourly sweep should complete them — a count that persists means it isn't running.",
    severity: "warn",
  },
  {
    key: "phantomSessions",
    label: "Phantom sessions",
    hint: "Empty rows from /record tabs that never transcribed. Auto-deleted after 6h.",
    severity: "info",
  },
  {
    key: "orphanSessions",
    label: "Orphan sessions",
    hint: "Their owner was deleted but the session remains. The account-deletion purge job should remove them.",
    severity: "warn",
  },
  {
    key: "ownerlessSessions",
    label: "Ownerless sessions",
    hint: "Rows with no owner at all. Excluded from every product metric.",
    severity: "info",
  },
  {
    key: "legacyInlineSessions",
    label: "Legacy inline sessions",
    hint: "Transcript stored on the session doc (pre-migration storage). Informational — still readable.",
    severity: "info",
  },
  {
    key: "orphanAuthAccounts",
    label: "Orphaned auth accounts",
    hint: "Sign-in links whose user is gone. An orphaned Google account breaks that person's sign-in — remove below.",
    severity: "danger",
  },
  {
    key: "orphanAuthSessions",
    label: "Orphaned auth sessions",
    hint: "Auth sessions whose user is gone. Removed together with the orphaned accounts.",
    severity: "warn",
  },
  {
    key: "testUsers",
    label: "Test users",
    hint: "Automated test accounts (lens-…, fluid-…, nav-test-…, lt-verify-… @example.com).",
    severity: "info",
  },
  {
    key: "testSessions",
    label: "Test sessions",
    hint: "Sessions with a programmatic test title, or owned by a test user.",
    severity: "info",
  },
];

function HealthSection({
  health,
  computedAt,
  now,
}: {
  health: Health | null;
  computedAt: number | null;
  now: number;
}) {
  return (
    <>
      <p className="-mt-1 mb-2.5 text-[11.5px]" style={{ color: COLORS.t3 }}>
        {health ? (
          <>
            From the dashboard snapshot of{" "}
            <span className="tabular-nums">{int(health.totalSessionRows)}</span>{" "}
            session rows · computed {timeAgo(computedAt, now)}
          </>
        ) : (
          "Waiting for the first dashboard snapshot…"
        )}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {HEALTH_ROWS.map((r) => {
          const value = health ? health[r.key] : null;
          const color =
            value === null
              ? COLORS.t4
              : value === 0
                ? r.severity === "info"
                  ? COLORS.t2
                  : COLORS.accent
                : r.severity === "danger"
                  ? COLORS.red
                  : r.severity === "warn"
                    ? COLORS.amber
                    : COLORS.w;
          return (
            <div key={r.key} className="rounded-2xl p-4 min-w-0" style={cardStyle}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] font-semibold" style={{ color: COLORS.w }}>
                  {r.label}
                </span>
                <span
                  className="text-[22px] leading-none font-bold tabular-nums transition-colors duration-300"
                  style={{ color }}
                >
                  {value === null ? "—" : int(value)}
                </span>
              </div>
              <p className="mt-2 text-[11.5px] leading-snug" style={{ color: COLORS.t3 }}>
                {r.hint}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── 2. Cleanups ────────────────────────────────────────────────────────────

const CLEANUPS: {
  kind: CleanupKind;
  label: string;
  description: string;
  button: string;
  confirmTitle: string;
  count: (h: Health) => number;
  countLabel: (h: Health) => string;
  message: (h: Health) => string;
}[] = [
  {
    kind: "test_users",
    label: "Test users",
    description: "Automated test accounts and everything they own.",
    button: "Delete test users",
    confirmTitle: "Delete test users?",
    count: (h) => h.testUsers,
    countLabel: (h) => `${int(h.testUsers)} account${h.testUsers === 1 ? "" : "s"}`,
    message: (h) =>
      `Permanently deletes ${int(h.testUsers)} automated test account${h.testUsers === 1 ? "" : "s"} — only emails shaped like lens-123@example.com (also fluid-…, nav-test-…, lt-verify-…) — together with their sign-in rows, sessions, transcripts and summaries. Real accounts never match. Runs in the background in batches; it can't be undone.`,
  },
  {
    kind: "test_sessions",
    label: "Test sessions",
    description: "Sessions whose title is a programmatic test title.",
    button: "Delete test sessions",
    confirmTitle: "Delete test sessions?",
    count: (h) => h.testSessions,
    countLabel: (h) => `${int(h.testSessions)} session${h.testSessions === 1 ? "" : "s"}`,
    message: (h) =>
      `Permanently deletes every session titled like lt-verify-123 (also nav-test-…, lens-…, fluid-…), with its transcript and summary. The snapshot counts ${int(h.testSessions)}, which also includes sessions owned by test users — those are removed by "Delete test users". Runs in the background in batches; it can't be undone.`,
  },
  {
    kind: "orphaned_auth",
    label: "Orphaned auth rows",
    description: "Sign-in rows left behind by deleted users.",
    button: "Remove orphaned auth rows",
    confirmTitle: "Remove orphaned auth rows?",
    count: (h) => h.orphanAuthAccounts + h.orphanAuthSessions,
    countLabel: (h) =>
      `${int(h.orphanAuthAccounts)} account${h.orphanAuthAccounts === 1 ? "" : "s"} · ${int(h.orphanAuthSessions)} auth session${h.orphanAuthSessions === 1 ? "" : "s"}`,
    message: (h) =>
      `Removes ${int(h.orphanAuthAccounts)} sign-in account link${h.orphanAuthAccounts === 1 ? "" : "s"} and ${int(h.orphanAuthSessions)} auth session${h.orphanAuthSessions === 1 ? "" : "s"} whose user no longer exists, plus their pending verification codes and refresh tokens. No user, session or transcript is touched — this is what un-breaks Google sign-in for someone whose old account was deleted. Runs in the background.`,
  },
];

function CleanupsCard({ health }: { health: Health | null }) {
  const { refresh, refreshing } = useAdmin();
  const startCleanup = useMutation(api.adminPanel.startCleanup);
  const [confirming, setConfirming] = useState<CleanupKind | null>(null);
  // Which dialog content to show — kept through the close animation so the
  // text doesn't blank out while the dialog fades away.
  const [dialogKind, setDialogKind] = useState<CleanupKind>("test_users");
  const [started, setStarted] = useState<Partial<Record<CleanupKind, true>>>({});

  const active = CLEANUPS.find((c) => c.kind === dialogKind) ?? CLEANUPS[0];

  return (
    <Card padded={false}>
      <ul>
        {CLEANUPS.map((c, i) => {
          const n = health ? c.count(health) : null;
          return (
            <li
              key={c.kind}
              className="px-4 py-3.5 flex flex-col gap-2.5"
              style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold" style={{ color: COLORS.w }}>
                    {c.label}
                  </div>
                  <div className="text-[11.5px] mt-0.5" style={{ color: COLORS.t3 }}>
                    {c.description}{" "}
                    <span className="tabular-nums" style={{ color: n ? COLORS.t2 : COLORS.t4 }}>
                      {health ? c.countLabel(health) : "Count unavailable until the snapshot exists"}
                    </span>
                  </div>
                </div>
                <GhostButton
                  tone="danger"
                  disabled={!n}
                  onClick={() => {
                    setDialogKind(c.kind);
                    setConfirming(c.kind);
                  }}
                >
                  <Icon name="trash" size={13} color="currentColor" />
                  {c.button}
                </GhostButton>
              </div>
              {started[c.kind] && (
                <Notice tone="blue">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span>Started — counts update after the next refresh.</span>
                    <GhostButton onClick={refresh} disabled={refreshing}>
                      <span
                        className={refreshing ? "animate-spin motion-reduce:animate-none" : ""}
                        style={{ display: "inline-flex" }}
                      >
                        <Icon name="history" size={13} color="currentColor" />
                      </span>
                      {refreshing ? "Refreshing…" : "Refresh now"}
                    </GhostButton>
                  </span>
                </Notice>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={active.confirmTitle}
        message={health ? active.message(health) : ""}
        confirmLabel={active.button}
        destructive
        onConfirm={async () => {
          try {
            await startCleanup({ kind: active.kind });
          } catch (e) {
            // ConfirmDialog shows Error.message inline — hand it the clean one.
            throw new Error(errorMessage(e, "Couldn't start the cleanup."));
          }
          setStarted((s) => ({ ...s, [active.kind]: true }));
        }}
      />
    </Card>
  );
}

// ─── 3. Usage logging & alerts ──────────────────────────────────────────────

const ALERT_KIND_LABEL: Record<string, string> = {
  ai_failures: "AI failure spike",
  credit_balance: "Anthropic credits low",
  stt_quota: "Speechmatics quota",
  ingest_silent: "Usage logging silent",
};

function UsageLoggingSection({
  info,
  now,
}: {
  info: SystemInfo | undefined;
  now: number;
}) {
  if (info === undefined) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3">
        <SkeletonCard rows={8} />
        <SkeletonCard rows={4} />
      </div>
    );
  }

  const last = info.lastUsageEventAt;
  const lastStale = last === null || now - last > DAY_MS;
  const sentKinds = Array.from(
    new Set([...Object.keys(ALERT_KIND_LABEL), ...Object.keys(info.lastAlertSentAt)]),
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3 animate-in fade-in duration-300 motion-reduce:animate-none">
      <Card
        title="Configuration"
        subtitle="Presence flags only — values never leave Convex."
      >
        <ul className="flex flex-col">
          <ConfigRow
            label="Last usage event"
            hint="Every Claude call and STT credential mint writes one. Silence while people record means logging is broken."
            value={
              <StatusText tone={lastStale ? "amber" : "accent"}>
                {last === null ? "Never" : timeAgo(last, now)}
              </StatusText>
            }
          />
          <ConfigRow
            label="USAGE_INGEST_SECRET (Convex)"
            hint="The Vercel project must set USAGE_INGEST_SECRET to the same value, or API routes can't report usage."
            value={<Flag ok={info.env.usageIngestSecret} bad="red" />}
          />
          <ConfigRow
            label="ADMIN_ALERT_EMAIL"
            hint="Where alert emails go. Without it alerts only appear as banners here."
            value={<Flag ok={info.env.adminAlertEmail} bad="amber" />}
          />
          <ConfigRow
            label="RESEND_API_KEY"
            hint="Sends alert emails (the same Resend account as password resets)."
            value={<Flag ok={info.env.resend} bad="amber" />}
          />
          <ConfigRow
            label="Stripe mode"
            hint="From the STRIPE_SECRET_KEY prefix on Convex."
            value={
              info.env.stripeMode === "live" ? (
                <Badge tone="accent">Live</Badge>
              ) : info.env.stripeMode === "test" ? (
                <Badge tone="amber">Test</Badge>
              ) : (
                <Badge>Unset</Badge>
              )
            }
          />
          <ConfigRow
            label="Billing"
            hint="BILLING_ENABLED in convex/billingLimits.ts — plan limits are enforced only when on."
            value={
              info.billingEnabled ? <Badge tone="accent">On</Badge> : <Badge>Off</Badge>
            }
          />
          <ConfigRow
            label="Dev auth bypass"
            hint="DEV_AUTH_BYPASS_SECRET + DEV_AUTH_BYPASS_EMAIL — the simulator sign-in shortcut."
            value={
              info.env.devAuthBypass ? (
                <StatusText tone="red" icon="close">
                  ON — must be OFF in production
                </StatusText>
              ) : (
                <StatusText tone="accent" icon="check">
                  Off
                </StatusText>
              )
            }
          />
          <ConfigRow
            label="Admins"
            hint="User ids in ADMIN_USER_IDS."
            value={
              <span className="text-[13px] font-semibold tabular-nums" style={{ color: COLORS.w }}>
                {int(info.env.adminCount)}
              </span>
            }
          />
          <ConfigRow
            label="STT engine"
            hint="STT_PROVIDER in src/lib/constants.ts (this web build)."
            value={
              <Badge tone={STT_PROVIDER === "speechmatics" ? "accent" : "amber"}>
                {STT_PROVIDER === "speechmatics" ? "Speechmatics" : "Deepgram fallback"}
              </Badge>
            }
          />
          <ConfigRow
            label="Convex deployment"
            hint={null}
            value={
              <span
                className="font-mono text-[11.5px] break-all select-all text-right"
                style={{ color: info.deploymentUrl ? COLORS.t2 : COLORS.t4 }}
              >
                {info.deploymentUrl ?? "unknown"}
              </span>
            }
          />
        </ul>
      </Card>

      <Card
        title="Alerts"
        subtitle="Checked every 10 min over the last 15 min of usage events."
      >
        {info.alerts.length === 0 ? (
          <div
            className="flex items-center gap-2 text-[12.5px] py-1"
            style={{ color: COLORS.t2 }}
          >
            <Icon name="check" size={14} color={COLORS.accent} />
            No active alerts
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {info.alerts.map((a) => (
              <li
                key={a.kind}
                className="rounded-xl px-3 py-2.5 animate-in fade-in duration-200 motion-reduce:animate-none"
                style={{ background: COLORS.redSoft, border: `1px solid ${COLORS.red}40` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold" style={{ color: COLORS.red }}>
                    {ALERT_KIND_LABEL[a.kind] ?? a.kind}
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: COLORS.t3 }}>
                    since {timeAgo(a.since, now)}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-snug" style={{ color: COLORS.t2 }}>
                  {a.message}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div
          className="mt-4 mb-1.5 text-[10.5px] font-bold uppercase tracking-wider"
          style={{ color: COLORS.t4 }}
        >
          Last email per kind
        </div>
        <ul className="flex flex-col">
          {sentKinds.map((k) => {
            const at = info.lastAlertSentAt[k];
            return (
              <li
                key={k}
                className="flex items-center justify-between gap-3 py-1.5 text-[12px]"
              >
                <span style={{ color: COLORS.t2 }}>{ALERT_KIND_LABEL[k] ?? k}</span>
                <span className="tabular-nums" style={{ color: at ? COLORS.t2 : COLORS.t4 }}>
                  {at ? timeAgo(at, now) : "never"}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function ConfigRow({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string | null;
  value: ReactNode;
}) {
  return (
    <li
      className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0 border-b last:border-b-0"
      style={{ borderColor: COLORS.border }}
    >
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold break-words" style={{ color: COLORS.w }}>
          {label}
        </div>
        {hint && (
          <div className="text-[11.5px] mt-0.5 leading-snug" style={{ color: COLORS.t3 }}>
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0 max-w-[55%] flex justify-end pt-px">{value}</div>
    </li>
  );
}

const TONE_COLOR: Record<Exclude<Tone, "blue" | "muted">, string> = {
  accent: COLORS.accent,
  amber: COLORS.amber,
  red: COLORS.red,
};

function StatusText({
  tone,
  icon,
  children,
}: {
  tone: "accent" | "amber" | "red";
  icon?: "check" | "close";
  children: ReactNode;
}) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-right"
      style={{ color }}
    >
      {icon && <Icon name={icon} size={13} color={color} />}
      {children}
    </span>
  );
}

function Flag({ ok, bad }: { ok: boolean; bad: "amber" | "red" }) {
  return ok ? (
    <StatusText tone="accent" icon="check">
      Set
    </StatusText>
  ) : (
    <StatusText tone={bad} icon="close">
      Missing
    </StatusText>
  );
}

// ─── 4. Recent errors ───────────────────────────────────────────────────────

function RecentErrorsCard({
  info,
  now,
}: {
  info: SystemInfo | undefined;
  now: number;
}) {
  if (info === undefined) return <SkeletonCard rows={4} />;
  return (
    <Card
      title="Failed calls"
      subtitle="The 25 most recent failures. Raw usage events are kept 35 days."
    >
      {info.recentErrors.length === 0 ? (
        <EmptyHint>No failed calls on record.</EmptyHint>
      ) : (
        <ul className="flex flex-col animate-in fade-in duration-300 motion-reduce:animate-none">
          {info.recentErrors.map((e, i) => (
            <li
              key={e.id}
              className="py-3 flex flex-col gap-1.5 first:pt-0 last:pb-0"
              style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="red">{USAGE_KIND_LABEL[e.kind] ?? e.kind}</Badge>
                {e.status !== null && <Badge>HTTP {e.status}</Badge>}
                {(e.model || e.provider) && (
                  <span className="text-[11.5px] truncate" style={{ color: COLORS.t3 }}>
                    {[e.model, e.provider].filter(Boolean).join(" · ")}
                  </span>
                )}
                <span
                  className="ml-auto text-[11px] tabular-nums shrink-0"
                  style={{ color: COLORS.t4 }}
                >
                  {timeAgo(e.at, now)}
                </span>
              </div>
              {e.error && (
                <p
                  className="text-[12.5px] leading-snug break-words whitespace-pre-wrap"
                  style={{ color: COLORS.t2 }}
                >
                  {e.error}
                </p>
              )}
              <div className="text-[11.5px]">
                {e.user ? (
                  <UserLink id={e.user.id}>{e.user.email ?? e.user.name ?? "user"}</UserLink>
                ) : (
                  <span style={{ color: COLORS.t4 }}>No signed-in user</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── 5. Admin audit log ─────────────────────────────────────────────────────

const AUDIT_LABEL: Record<AuditRow["action"], string> = {
  view_session: "Viewed transcript",
  grant_pro: "Granted Pro",
  revoke_pro: "Revoked comp",
  delete_user: "Deleted user",
  cleanup_test_users: "Started cleanup: test users",
  cleanup_test_sessions: "Started cleanup: test sessions",
  cleanup_orphaned_auth: "Started cleanup: orphaned auth rows",
};

function AuditCard({ rows, now }: { rows: AuditRow[] | undefined; now: number }) {
  if (rows === undefined) return <SkeletonCard rows={4} />;
  return (
    <Card
      title="Operator actions"
      subtitle="The 30 most recent. Every transcript view, plan change, deletion and cleanup is written here."
    >
      {rows.length === 0 ? (
        <EmptyHint>No admin actions yet.</EmptyHint>
      ) : (
        <ul className="flex flex-col animate-in fade-in duration-300 motion-reduce:animate-none">
          {rows.map((r, i) => (
            <li
              key={r.id}
              className="py-3 flex items-start gap-3 first:pt-0 last:pb-0"
              style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}
            >
              <Avatar
                size={24}
                image={r.actor?.image}
                name={r.actor?.name}
                email={r.actor?.email}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[13px] font-semibold" style={{ color: COLORS.w }}>
                    {AUDIT_LABEL[r.action] ?? r.action}
                  </span>
                  {r.targetUserId && (
                    <span className="text-[12px] min-w-0 break-all">
                      <UserLink id={r.targetUserId}>
                        {r.target?.email ?? r.target?.name ?? "deleted user"}
                      </UserLink>
                    </span>
                  )}
                  {r.targetSessionId && (
                    <span className="text-[12px]">
                      <TextLink
                        href={`/admin/sessions/${r.targetSessionId}`}
                        title="Opening it logs another view"
                      >
                        session
                      </TextLink>
                    </span>
                  )}
                </div>
                <div
                  className="text-[11.5px] mt-0.5 leading-snug break-words"
                  style={{ color: COLORS.t3 }}
                >
                  by {r.actor?.email ?? r.actor?.name ?? "deleted admin"}
                  {r.details ? ` · ${r.details}` : ""}
                </div>
              </div>
              <span
                className="text-[11px] tabular-nums shrink-0 pt-0.5"
                style={{ color: COLORS.t4 }}
              >
                {timeAgo(r.at, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── 6. Dashboards ──────────────────────────────────────────────────────────

const DASHBOARDS: { name: string; href: string; what: string }[] = [
  {
    name: "Convex dashboard",
    href: "https://dashboard.convex.dev",
    what: "Function logs and failures, table data, env vars, cron and scheduled-job runs.",
  },
  {
    name: "Vercel Analytics & logs",
    href: "https://vercel.com/dashboard",
    what: "Deployments, API-route runtime logs, traffic and Web Vitals.",
  },
  {
    name: "Sentry",
    href: "https://sentry.io",
    what: "Client and server exceptions with stack traces, grouped by release.",
  },
  {
    name: "Stripe",
    href: "https://dashboard.stripe.com",
    what: "Subscriptions, payments, refunds and webhook delivery health.",
  },
  {
    name: "Anthropic console — credits & usage",
    href: "https://console.anthropic.com",
    what: "Credit balance and spend. Empty credits = app-wide “Translation failed”.",
  },
  {
    name: "Speechmatics portal",
    href: "https://portal.speechmatics.com",
    what: "Realtime minutes and the concurrency quota (free tier: 2 sessions app-wide).",
  },
  {
    name: "Resend",
    href: "https://resend.com/emails",
    what: "Delivery status of alert emails and password-reset codes.",
  },
];

function DashboardsGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {DASHBOARDS.map((d) => (
        <ExternalCard key={d.href} {...d} />
      ))}
    </div>
  );
}

function ExternalCard({ name, href, what }: { name: string; href: string; what: string }) {
  const [lit, litHandlers] = useLit();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...litHandlers}
      className="rounded-2xl p-4 min-w-0 flex flex-col gap-1.5 outline-none"
      style={{
        background: lit ? COLORS.surfaceLight : COLORS.surface,
        border: `1px solid ${lit ? `${COLORS.accent}66` : COLORS.border}`,
        boxShadow: lit ? `0 0 16px ${COLORS.accent}1f` : "0 0 0 transparent",
        transition:
          "background-color 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
      }}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold" style={{ color: COLORS.w }}>
          {name}
        </span>
        <span
          className="shrink-0 inline-flex"
          style={{
            transform: lit
              ? "translate(2px, -2px) rotate(-45deg)"
              : "translate(0, 0) rotate(-45deg)",
            transition: "transform 200ms ease",
          }}
        >
          <Icon name="chevron" size={14} color={lit ? COLORS.accent : COLORS.t3} />
        </span>
      </span>
      <span className="text-[11.5px] leading-snug" style={{ color: COLORS.t3 }}>
        {what}
      </span>
      <span className="text-[10.5px] font-mono truncate" style={{ color: COLORS.t4 }}>
        {href.replace(/^https:\/\//, "")}
      </span>
    </a>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function SkeletonCard({ rows }: { rows: number }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3.5" style={cardStyle} aria-busy="true">
      <Skeleton style={{ width: 120, height: 13 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="flex-1 flex flex-col gap-1.5">
            <Skeleton style={{ width: i % 2 ? "40%" : "55%", height: 12 }} />
            <Skeleton style={{ width: i % 2 ? "70%" : "85%", height: 10 }} />
          </div>
          <Skeleton style={{ width: 52, height: 14 }} />
        </div>
      ))}
    </div>
  );
}

function UserLink({ id, children }: { id: string; children: ReactNode }) {
  return <TextLink href={`/admin/users/${id}`}>{children}</TextLink>;
}

function TextLink({
  href,
  title,
  children,
}: {
  href: string;
  title?: string;
  children: ReactNode;
}) {
  const [lit, litHandlers] = useLit();
  return (
    <Link
      href={href}
      title={title}
      {...litHandlers}
      className="font-semibold underline-offset-2 rounded outline-none"
      style={{
        color: lit ? COLORS.accent : COLORS.t2,
        textDecoration: lit ? "underline" : "none",
        transition: "color 200ms ease",
      }}
    >
      {children}
    </Link>
  );
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
