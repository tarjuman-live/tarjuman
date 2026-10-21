"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { COLORS } from "@/lib/constants";
import { copyToClipboard } from "@/lib/clipboard";
import { formatMicroUsd } from "@/lib/usage/pricing";
import { Icon } from "@/components/shared/icon";
import { Skeleton } from "@/components/shared/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useNow } from "@/components/admin/admin-context";
import {
  Avatar,
  Badge,
  Card,
  EmptyHint,
  GhostButton,
  Notice,
  PlanPill,
  StatTile,
  type Tone,
} from "@/components/admin/ui";
import {
  dateTime,
  duration,
  errorMessage,
  fullDate,
  hours,
  int,
  pairName,
  timeAgo,
} from "@/components/admin/format";
import { GrantProDialog } from "@/components/admin/grant-pro-dialog";
import { DeleteUserDialog } from "@/components/admin/delete-user-dialog";

type Detail = NonNullable<FunctionReturnType<typeof api.adminPanel.getUserDetail>>;
type Brief = Detail["grants"][number]["grantedBy"];

const SESSIONS_PAGE = 20;

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const d = useQuery(api.adminPanel.getUserDetail, { userId: id });

  // The delete dialog lives HERE, outside the detail subtree: once the delete
  // lands, getUserDetail reactively returns null and the subtree unmounts —
  // a dialog inside it would vanish mid-animation. The target is captured at
  // open time for the same reason.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    userId: Id<"users">;
    email: string | null;
  } | null>(null);

  let body: ReactNode;
  if (d === undefined) {
    body = <DetailSkeleton />;
  } else if (d === null) {
    body =
      deleted || deleteOpen ? (
        <Card>
          <EmptyHint>Account deleted. Returning to all users…</EmptyHint>
        </Card>
      ) : (
        <Card>
          <EmptyHint>
            User not found — the ID is invalid or the account was deleted.
            <div className="mt-3 flex justify-center">
              <BackLink />
            </div>
          </EmptyHint>
        </Card>
      );
  } else {
    body = (
      <UserDetailView
        d={d}
        onRequestDelete={() => {
          setDeleteTarget({ userId: d.user.id, email: d.user.email });
          setDeleteOpen(true);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink />
      </div>
      {body}
      {deleteTarget && (
        <DeleteUserDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          userId={deleteTarget.userId}
          email={deleteTarget.email}
          onDeleted={() => {
            setDeleted(true);
            router.replace("/admin/users");
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/users"
      className="inline-flex items-center gap-1.5 h-8 text-[12.5px] font-semibold rounded-lg transition-opacity duration-200 hover:opacity-75"
      style={{ color: COLORS.t2 }}
    >
      <Icon name="back" size={13} color="currentColor" />
      All users
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-200 motion-reduce:animate-none">
      <Skeleton style={{ height: 172 }} rounded={16} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} style={{ height: 96 }} rounded={16} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="lg:col-span-3" style={{ height: 300 }} rounded={16} />
        <Skeleton className="lg:col-span-2" style={{ height: 300 }} rounded={16} />
      </div>
    </div>
  );
}

// ─── Loaded view ────────────────────────────────────────────────────────────

function UserDetailView({
  d,
  onRequestDelete,
}: {
  d: Detail;
  onRequestDelete: () => void;
}) {
  const now = useNow();
  const revokePro = useMutation(api.adminPanel.revokePro);
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  // Any active grant — not just source === "grant" — so a comp sitting under
  // a Stripe subscription can still be revoked.
  const hasActiveComp = d.grants.some((g) => g.active);
  const label = d.user.email ?? d.user.name ?? d.user.id;

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      <HeaderCard d={d} now={now} />
      <StatsGrid d={d} now={now} />

      <div className="grid gap-4 lg:grid-cols-5 items-start">
        <div className="flex flex-col gap-4 lg:col-span-3 min-w-0">
          <PlanCard
            d={d}
            hasActiveComp={hasActiveComp}
            onGrant={() => setGrantOpen(true)}
            onRevoke={() => setRevokeOpen(true)}
          />
          <SessionsCard userId={d.user.id} />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2 min-w-0">
          <PrefsCard d={d} />
          <UsageCard d={d} now={now} />
          <AuditCard d={d} now={now} />
        </div>
      </div>

      <DangerZone d={d} onRequestDelete={onRequestDelete} />

      <GrantProDialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        userId={d.user.id}
        userLabel={label}
        hasActiveComp={hasActiveComp}
        billingEnabled={d.billingEnabled}
      />
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke complimentary Pro?"
        message={`${label} drops back to ${
          d.subscription?.plan === "pro" ? "their Stripe plan" : "Free"
        } immediately. The grant stays in the history as revoked.`}
        confirmLabel="Revoke comp"
        destructive
        onConfirm={async () => {
          try {
            await revokePro({ userId: d.user.id });
          } catch (e) {
            // ConfirmDialog shows Error.message — unwrap the ConvexError text.
            throw new Error(errorMessage(e, "Couldn't revoke. Try again."));
          }
        }}
      />
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function HeaderCard({ d, now }: { d: Detail; now: number }) {
  const { user } = d;
  return (
    <Card>
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <Avatar image={user.image} name={user.name} email={user.email} size={56} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h2
              className="text-[19px] font-bold leading-tight truncate"
              style={{ color: user.name ? COLORS.w : COLORS.t3 }}
            >
              {user.name ?? "No name"}
            </h2>
            <div className="text-[13px] mt-0.5 truncate" style={{ color: COLORS.t2 }}>
              {user.email ?? "No email on file"}
            </div>
            <div className="flex flex-wrap items-center gap-1 mt-2.5">
              <PlanPill plan={d.plan.plan} source={d.plan.source} />
              {d.providers.length === 0 ? (
                <Badge>no sign-in</Badge>
              ) : (
                d.providers.map((p) => (
                  <span
                    key={p.provider}
                    title={p.emailVerified ? "Email verified by this provider" : undefined}
                  >
                    <Badge tone={p.provider === "google" ? "blue" : "muted"}>
                      {providerLabel(p.provider)}
                      {p.emailVerified && (
                        <>
                          <Icon name="check" size={9} color="currentColor" />
                          <span className="sr-only">(email verified)</span>
                        </>
                      )}
                    </Badge>
                  </span>
                ))
              )}
              {user.isAdmin && <Badge tone="blue">Admin</Badge>}
              {user.isTest && <Badge>Test</Badge>}
              {!user.verified && <Badge tone="amber">Unverified</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {user.email && <CopyButton value={user.email} label="Copy email" />}
          <CopyButton value={user.id} label="Copy ID" />
        </div>
      </div>

      <dl
        className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-4 pt-4"
        style={{ borderTop: `1px solid ${COLORS.border}` }}
      >
        <Meta label="Joined">{fullDate(user.createdAt)}</Meta>
        <Meta label="Last sign-in">{timeAgo(d.devices.lastSignInAt, now)}</Meta>
        <Meta label="Signed-in devices">
          {d.devices.live === 0
            ? "None"
            : `${int(d.devices.live)} ${d.devices.live === 1 ? "device" : "devices"}`}
        </Meta>
        <Meta label="User ID">
          <span className="font-mono text-[11.5px] break-all" style={{ color: COLORS.t2 }}>
            {user.id}
          </span>
        </Meta>
      </dl>
    </Card>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium" style={{ color: COLORS.t4 }}>
        {label}
      </dt>
      <dd className="text-[13px] mt-0.5 tabular-nums" style={{ color: COLORS.w }}>
        {children}
      </dd>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    if (!(await copyToClipboard(value))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <GhostButton onClick={() => void copy()}>
      <span
        key={copied ? "done" : "idle"}
        className="inline-flex items-center gap-1.5 animate-in fade-in duration-200 motion-reduce:animate-none"
        style={{ color: copied ? COLORS.accent : undefined }}
      >
        <Icon name={copied ? "check" : "copy"} size={13} color="currentColor" />
        {copied ? "Copied" : label}
      </span>
    </GhostButton>
  );
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function StatsGrid({ d, now }: { d: Detail; now: number }) {
  const st = d.stats;
  const lastCall = d.recentUsage[0] ?? null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatTile
        label="Sessions"
        value={st ? int(st.sessions) : "—"}
        hint={
          st
            ? st.platforms.length > 0
              ? st.platforms.map(platformLabel).join(" · ")
              : undefined
            : "Computed at the next dashboard refresh"
        }
      />
      <StatTile label="Recorded" value={st ? hours(st.recordingSeconds) : "—"} />
      <StatTile label="Summaries" value={st ? int(st.summaries) : "—"} />
      <StatTile
        label="Last recorded"
        value={st ? timeAgo(st.lastRecordedAt, now) : "—"}
        hint={st?.lastRecordedAt ? dateTime(st.lastRecordedAt) : undefined}
      />
      <StatTile
        label="AI cost · this month"
        value={formatMicroUsd(d.ai.thisMonth?.costMicroUsd ?? 0)}
        hint={`${int(d.ai.thisMonth?.calls ?? 0)} calls`}
      />
      <StatTile
        label="AI cost · last month"
        value={formatMicroUsd(d.ai.lastMonth?.costMicroUsd ?? 0)}
        hint={`${int(d.ai.lastMonth?.calls ?? 0)} calls`}
      />
      <StatTile
        label="AI cost · all time"
        value={formatMicroUsd(d.ai.allTimeMicroUsd)}
        hint="Since usage tracking began"
      />
      <StatTile
        label="Last AI / STT call"
        value={lastCall ? timeAgo(lastCall.at, now) : "—"}
        hint={lastCall ? kindLabel(lastCall.kind) : "None in the last 35 days"}
      />
    </div>
  );
}

// ─── Plan & billing ─────────────────────────────────────────────────────────

function PlanCard({
  d,
  hasActiveComp,
  onGrant,
  onRevoke,
}: {
  d: Detail;
  hasActiveComp: boolean;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  const [grantsRef] = useAutoAnimate<HTMLUListElement>({
    duration: 220,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  const [actionsRef] = useAutoAnimate<HTMLDivElement>({
    duration: 220,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  const { plan, subscription: sub } = d;

  const sourceText =
    plan.source === "stripe"
      ? "via Stripe subscription"
      : plan.source === "grant"
        ? plan.compExpiresAt
          ? `complimentary · until ${fullDate(plan.compExpiresAt)}`
          : "complimentary · no expiry"
        : "no subscription or comp";

  return (
    <Card title="Plan & billing">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <PlanPill plan={plan.plan} source={plan.source} />
          <span className="text-[12.5px]" style={{ color: COLORS.t2 }}>
            {sourceText}
          </span>
        </div>

        {!d.billingEnabled && (
          <Notice tone="blue">
            Billing is OFF, so a comp currently only changes the Pro badge +
            celebration on web and unlocks the AI tools card on iOS.
          </Notice>
        )}

        {sub && (
          <div
            className="rounded-xl px-3.5 py-1"
            style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}
          >
            <div className="divide-y divide-white/[0.06]">
              <KV label="Stripe status">
                <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                  <Badge tone={SUB_TONE[sub.status]}>{sub.status.replace("_", " ")}</Badge>
                  {sub.cancelAtPeriodEnd && <Badge tone="amber">Cancels at period end</Badge>}
                </span>
              </KV>
              {sub.currentPeriodEnd && (
                <KV
                  label={
                    sub.cancelAtPeriodEnd || sub.status === "canceled"
                      ? "Ends"
                      : "Renews"
                  }
                >
                  {fullDate(sub.currentPeriodEnd)}
                </KV>
              )}
              <KV label="Customer">
                <a
                  href={`https://dashboard.stripe.com/customers/${sub.stripeCustomerId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11.5px] underline underline-offset-2 decoration-dotted break-all transition-opacity duration-200 hover:opacity-75"
                  style={{ color: COLORS.t2 }}
                >
                  {sub.stripeCustomerId}
                </a>
              </KV>
              {sub.subscriptionId && (
                <KV label="Subscription">
                  <span className="font-mono text-[11.5px] break-all" style={{ color: COLORS.t2 }}>
                    {sub.subscriptionId}
                  </span>
                </KV>
              )}
            </div>
            <p
              className="text-[11px] py-2 leading-snug"
              style={{ color: COLORS.t4, borderTop: `1px solid ${COLORS.border}` }}
            >
              The link opens live mode. Test-mode customers live under{" "}
              <a
                href={`https://dashboard.stripe.com/test/customers/${sub.stripeCustomerId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 transition-opacity duration-200 hover:opacity-75"
                style={{ color: COLORS.t3 }}
              >
                /test/customers
              </a>
              .
            </p>
          </div>
        )}

        <div>
          <div className="section-label mb-1 mt-1">Comp history</div>
          {d.grants.length === 0 ? (
            <p className="text-[12.5px] py-1" style={{ color: COLORS.t4 }}>
              No complimentary Pro granted yet.
            </p>
          ) : (
            <ul ref={grantsRef} className="divide-y divide-white/[0.06]">
              {d.grants.map((g) => {
                const state = g.active ? "Active" : g.revokedAt ? "Revoked" : "Expired";
                return (
                  <li key={g.id} className="py-2.5 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={g.active ? "accent" : g.revokedAt ? "amber" : "muted"}>
                        {state}
                      </Badge>
                      <span className="text-[12.5px] tabular-nums" style={{ color: COLORS.w }}>
                        {g.expiresAt ? `Until ${fullDate(g.expiresAt)}` : "No expiry"}
                      </span>
                    </div>
                    <div className="text-[11.5px] tabular-nums" style={{ color: COLORS.t3 }}>
                      Granted {fullDate(g.grantedAt)} by {briefName(g.grantedBy)}
                      {g.revokedAt ? ` · revoked ${fullDate(g.revokedAt)}` : ""}
                      {g.expiredAt ? ` · expired ${fullDate(g.expiredAt)}` : ""}
                    </div>
                    {g.note && (
                      <div
                        className="text-[12px] leading-snug break-words"
                        dir="auto"
                        style={{ color: COLORS.t2 }}
                      >
                        &ldquo;{g.note}&rdquo;
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div ref={actionsRef} className="flex flex-wrap gap-2 pt-1">
          <GhostButton tone="accent" onClick={onGrant}>
            <Icon name="sparkle" size={13} color="currentColor" />
            {hasActiveComp ? "Extend / replace comp" : "Grant Pro"}
          </GhostButton>
          {hasActiveComp && (
            <GhostButton tone="danger" onClick={onRevoke}>
              Revoke comp
            </GhostButton>
          )}
        </div>
      </div>
    </Card>
  );
}

const SUB_TONE: Record<NonNullable<Detail["subscription"]>["status"], Tone> = {
  active: "accent",
  trialing: "blue",
  past_due: "amber",
  incomplete: "amber",
  canceled: "muted",
};

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[12px] shrink-0" style={{ color: COLORS.t3 }}>
        {label}
      </span>
      <span className="text-[12.5px] text-right min-w-0 tabular-nums" style={{ color: COLORS.w }}>
        {children}
      </span>
    </div>
  );
}

// ─── Sessions ───────────────────────────────────────────────────────────────

function SessionsCard({ userId }: { userId: Id<"users"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.adminPanel.listUserSessions,
    { userId },
    { initialNumItems: SESSIONS_PAGE },
  );

  return (
    <Card
      title="Sessions"
      subtitle="Newest first. Dimmed rows never transcribed anything (a /record tab that warmed the mic)."
    >
      {status === "LoadingFirstPage" ? (
        <div className="flex flex-col gap-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} style={{ height: 52 }} rounded={10} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyHint>No sessions yet.</EmptyHint>
      ) : (
        <ul className="divide-y divide-white/[0.06] -mx-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          {results.map((s) => {
            const empty = s.segmentCount === 0;
            return (
              <li key={s.id}>
                <Link
                  href={`/admin/sessions/${s.id}`}
                  className="flex flex-col gap-1 px-2 py-2.5 rounded-lg transition-[background-color,opacity] duration-200 hover:bg-white/[0.03] hover:opacity-100!"
                  style={{ opacity: empty ? 0.5 : 1 }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className="text-[13px] font-semibold truncate min-w-0"
                      dir="auto"
                      style={{ color: s.title ? COLORS.w : COLORS.t3 }}
                    >
                      {s.title ?? "Untitled"}
                    </span>
                    <span className="text-[11.5px] tabular-nums shrink-0" style={{ color: COLORS.t4 }}>
                      {dateTime(s.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-x-3 gap-y-1 flex-wrap">
                    <span className="text-[11.5px] tabular-nums" style={{ color: COLORS.t3 }}>
                      {pairName(`${s.sourceLanguage}→${s.targetLanguage}`)} · {duration(s.seconds)} ·{" "}
                      {int(s.segmentCount)} {s.segmentCount === 1 ? "segment" : "segments"}
                    </span>
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {empty && <Badge>empty</Badge>}
                      <StatusBadge status={s.status} />
                      {s.hasSummary && <Badge tone="blue">Summary</Badge>}
                      {s.platform && <Badge>{platformLabel(s.platform)}</Badge>}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <div className="flex justify-center mt-3">
          <GhostButton
            onClick={() => loadMore(SESSIONS_PAGE)}
            disabled={status === "LoadingMore"}
          >
            {status === "LoadingMore" ? "Loading…" : "Load more"}
          </GhostButton>
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: "recording" | "paused" | "completed" }) {
  if (status === "recording") return <Badge tone="red">● Live</Badge>;
  if (status === "paused") return <Badge tone="amber">Paused</Badge>;
  return <Badge>Completed</Badge>;
}

// ─── Side cards ─────────────────────────────────────────────────────────────

function PrefsCard({ d }: { d: Detail }) {
  const p = d.prefs;
  const onOff = (v: boolean | null) => (v === null ? "Not set" : v ? "On" : "Off");
  return (
    <Card title="Preferences">
      {!p ? (
        <p className="text-[12.5px]" style={{ color: COLORS.t4 }}>
          Never changed — app defaults.
        </p>
      ) : (
        <div className="divide-y divide-white/[0.06] -mt-1">
          <KV label="Default pair">
            {p.defaultSourceLanguage || p.defaultTargetLanguage
              ? pairName(`${p.defaultSourceLanguage ?? "?"}→${p.defaultTargetLanguage ?? "?"}`)
              : "Not set"}
          </KV>
          <KV label="Main speaker only">{onOff(p.mainSpeakerOnly)}</KV>
          <KV label="Read aloud (TTS)">{onOff(p.ttsEnabled)}</KV>
        </div>
      )}
    </Card>
  );
}

function UsageCard({ d, now }: { d: Detail; now: number }) {
  return (
    <Card title="Recent AI usage" subtitle="Last 15 calls · raw events are kept 35 days">
      {d.recentUsage.length === 0 ? (
        <EmptyHint>No recent calls.</EmptyHint>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {d.recentUsage.map((e) => (
            <li key={e.id} className="py-2 flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <span className="text-[12.5px] font-semibold shrink-0" style={{ color: COLORS.w }}>
                    {kindLabel(e.kind)}
                  </span>
                  {e.ok ? <Badge tone="accent">OK</Badge> : <Badge tone="red">Error</Badge>}
                </span>
                <span className="text-[11.5px] tabular-nums shrink-0" style={{ color: COLORS.t3 }}>
                  {e.costMicroUsd !== null ? formatMicroUsd(e.costMicroUsd) : "—"} ·{" "}
                  {timeAgo(e.at, now)}
                </span>
              </div>
              {(e.model || (!e.ok && e.error)) && (
                <div className="text-[11px] truncate" style={{ color: COLORS.t4 }}>
                  {e.model ? shortModel(e.model) : ""}
                  {e.model && !e.ok && e.error ? " · " : ""}
                  {!e.ok && e.error ? e.error : ""}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AuditCard({ d, now }: { d: Detail; now: number }) {
  const [listRef] = useAutoAnimate<HTMLUListElement>({
    duration: 220,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  return (
    <Card title="Admin actions on this user" subtitle="Grants, revokes and every transcript an admin opened">
      {d.audit.length === 0 ? (
        <EmptyHint>No admin actions yet.</EmptyHint>
      ) : (
        <ul ref={listRef} className="divide-y divide-white/[0.06]">
          {d.audit.map((a) => (
            <li key={a.id} className="py-2 flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold truncate" style={{ color: COLORS.w }}>
                  {AUDIT_LABEL[a.action] ?? a.action}
                </span>
                <span className="text-[11.5px] tabular-nums shrink-0" style={{ color: COLORS.t3 }}>
                  {timeAgo(a.at, now)}
                </span>
              </div>
              <div className="text-[11px] break-words" style={{ color: COLORS.t4 }}>
                by {briefName(a.actor)}
                {a.details ? ` · ${a.details}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Danger zone ────────────────────────────────────────────────────────────

function DangerZone({ d, onRequestDelete }: { d: Detail; onRequestDelete: () => void }) {
  const liveSub =
    d.subscription?.subscriptionId &&
    (d.subscription.status === "active" || d.subscription.status === "trialing");
  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: COLORS.redSoft, border: `1px solid ${COLORS.red}40` }}
    >
      <div className="section-label" style={{ color: COLORS.red }}>
        Danger zone
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2">
        <div className="text-[12.5px] leading-snug" style={{ color: COLORS.t2 }}>
          {d.user.isAdmin ? (
            <>
              Admins can&apos;t be deleted from here. Remove this account from{" "}
              <span className="font-mono text-[11.5px]">ADMIN_USER_IDS</span> in the
              Convex environment first.
            </>
          ) : (
            <>
              Permanently delete this account, all of its sessions and transcripts,
              and its billing and sign-in records. This cannot be undone.
              {liveSub && (
                <span className="block mt-1" style={{ color: COLORS.amber }}>
                  Has a live Stripe subscription — cancel it in Stripe first or the
                  delete will be refused.
                </span>
              )}
            </>
          )}
        </div>
        <div className="shrink-0">
          <GhostButton tone="danger" disabled={d.user.isAdmin} onClick={onRequestDelete}>
            <Icon name="trash" size={13} color="currentColor" />
            Delete user
          </GhostButton>
        </div>
      </div>
    </section>
  );
}

// ─── Labels ─────────────────────────────────────────────────────────────────

function providerLabel(p: string): string {
  return p === "google" ? "Google" : p === "password" ? "Password" : p;
}

function platformLabel(p: string): string {
  return p === "ios" ? "iOS" : p === "web" ? "Web" : p;
}

function briefName(b: Brief): string {
  if (!b) return "a deleted account";
  return b.name ?? b.email ?? b.id;
}

const KIND_LABEL: Record<string, string> = {
  translate: "Translate",
  summarize: "Summary",
  ask: "Ask Tarjuman",
  study_notes: "Study notes",
  translate_transcript: "Transcript translate",
  trial_translate: "Trial translate",
  stt_token: "STT credential",
  stt_error: "STT error",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

const AUDIT_LABEL: Record<string, string> = {
  view_session: "Opened a session",
  grant_pro: "Granted Pro",
  revoke_pro: "Revoked Pro",
  delete_user: "Deleted user",
  cleanup_test_users: "Cleanup · test users",
  cleanup_test_sessions: "Cleanup · test sessions",
  cleanup_orphaned_auth: "Cleanup · orphaned auth",
};

/** "claude-haiku-4-5-20251001" → "haiku-4-5" */
function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
