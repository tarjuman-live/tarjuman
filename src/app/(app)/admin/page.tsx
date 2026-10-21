"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { COLORS, STT_PROVIDER } from "@/lib/constants";
import { BILLING_ENABLED } from "../../../../convex/billingLimits";
import { REPORT_TZ_LABEL } from "../../../../convex/reporting";
import type { Windowed } from "../../../../convex/adminMetrics";
import { formatMicroUsd } from "@/lib/usage/pricing";
import { useAdmin, useNow, type RangeDays } from "@/components/admin/admin-context";
import {
  Avatar,
  Badge,
  Card,
  EmptyHint,
  Notice,
  ProviderBadges,
  SectionLabel,
  Segmented,
  StatTile,
  Switch,
  cardStyle,
} from "@/components/admin/ui";
import {
  BarSeries,
  Funnel,
  HBarList,
  Heatmap,
  LineSeries,
  SERIES_COLORS,
  ShareBar,
} from "@/components/admin/charts";
import {
  compact,
  duration,
  hours,
  int,
  langName,
  pairName,
  percent,
  timeAgo,
} from "@/components/admin/format";
import { Skeleton } from "@/components/shared/skeleton";

/** Window field + previous-period field for the selected range. */
function pick(w: Windowed, range: RangeDays) {
  if (range === 7) return { cur: w.d7, prev: w.prev7 };
  if (range === 30) return { cur: w.d30, prev: w.prev30 };
  return { cur: w.d90, prev: undefined };
}

const PERIOD_LABEL: Record<RangeDays, string> = {
  7: "vs prior 7 days",
  30: "vs prior 30 days",
  90: "",
};

/** Speechmatics free tier: concurrent realtime sessions allowed app-wide. */
const SPEECHMATICS_CONCURRENCY = 2;

export default function AdminOverviewPage() {
  const {
    data,
    view,
    range,
    setRange,
    viewKey,
    setViewKey,
    refreshing,
    loading,
  } = useAdmin();

  return (
    <div className="flex flex-col">
      {/* Filters scope everything below them. */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<RangeDays>
          ariaLabel="Date range"
          value={range}
          onChange={setRange}
          options={[
            { value: 7, label: "7 days" },
            { value: 30, label: "30 days" },
            { value: 90, label: "90 days" },
          ]}
        />
        <Switch
          checked={viewKey === "external"}
          onChange={(on) => setViewKey(on ? "external" : "everyone")}
          label="Exclude team"
        />
      </div>

      <LiveSection />

      {!data || !view ? (
        <OverviewSkeleton computing={refreshing || loading} />
      ) : (
        <div
          className="flex flex-col transition-opacity duration-300"
          // Refetch keeps the frame: hold the previous render, dimmed.
          style={{ opacity: refreshing ? 0.65 : 1 }}
        >
          <Kpis />
          <Growth />
          <Engagement />
          <Content />
          <Revenue />
        </div>
      )}

      <Recent />
    </div>
  );
}

// ─── Right now ──────────────────────────────────────────────────────────────

function LiveSection() {
  const now = useNow(30_000);
  // Rounded so the subscription key only changes every 30s.
  const since = Math.floor((now - 5 * 60_000) / 30_000) * 30_000;
  const live = useQuery(api.adminPanel.liveNow, { since });
  const { data, view } = useAdmin();
  const liveCount = live?.live.length ?? 0;
  const atCap =
    STT_PROVIDER === "speechmatics" && liveCount >= SPEECHMATICS_CONCURRENCY;

  return (
    <>
      <SectionLabel>Right now</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block w-2 h-2 rounded-full ${liveCount ? "animate-pulse motion-reduce:animate-none" : ""}`}
                style={{ background: liveCount ? COLORS.red : COLORS.t4 }}
              />
              {live === undefined
                ? "Live recordings"
                : `${liveCount} live recording${liveCount === 1 ? "" : "s"}`}
            </span>
          }
          subtitle="Saved a segment in the last 5 min · tabs that only prewarmed the mic aren't listed"
        >
          {atCap && (
            <div className="mb-3">
              <Notice tone="amber">
                {liveCount} of {SPEECHMATICS_CONCURRENCY} concurrent Speechmatics
                sessions in use — the next recorder anywhere will be refused
                (free tier).
              </Notice>
            </div>
          )}
          {live === undefined ? (
            <Skeleton style={{ height: 56 }} rounded={12} />
          ) : live.live.length === 0 ? (
            <EmptyHint>Nobody is recording right now.</EmptyHint>
          ) : (
            <ul className="flex flex-col divide-y" style={{ borderColor: COLORS.border }}>
              {live.live.map((s) => (
                <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                  <Link
                    href={`/admin/sessions/${s.id}`}
                    className="flex items-center gap-3 rounded-lg -mx-2 px-2 py-1 transition-colors duration-200 hover:bg-black/15"
                  >
                    <Avatar image={s.owner?.image} name={s.owner?.name} email={s.owner?.email} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold truncate" style={{ color: COLORS.w }}>
                        {s.owner?.email ?? "Unknown user"}
                      </span>
                      <span className="block text-[11.5px] truncate" style={{ color: COLORS.t3 }}>
                        {pairName(`${s.sourceLanguage}→${s.targetLanguage}`)} · {s.segmentCount} segments
                        {s.platform ? ` · ${s.platform}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {s.status === "paused" ? <Badge tone="amber">Paused</Badge> : <Badge tone="red">Live</Badge>}
                      <span className="block text-[11px] mt-1 tabular-nums" style={{ color: COLORS.t4 }}>
                        {duration((s.updatedAt - s.createdAt) / 1000)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {live && live.warming.length > 0 && (
            <p className="text-[11.5px] mt-3" style={{ color: COLORS.t4 }}>
              + {live.warming.length} on the record screen with nothing transcribed yet.
            </p>
          )}
        </Card>

        <Card title="Today" subtitle={`As of the last refresh · days in ${REPORT_TZ_LABEL}`}>
          {!data || !view ? (
            <Skeleton style={{ height: 96 }} rounded={12} />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                ["New signups", int(view.kpis.users.today)],
                ["Active users", int(view.kpis.activeUsers.today)],
                ["Sessions", int(view.kpis.sessions.today)],
                ["Recording", hours(view.kpis.recordingSeconds.today)],
                ["Summaries", int(view.kpis.summaries.today)],
                ["AI spend", formatMicroUsd(data.ai.today.costMicroUsd)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11.5px]" style={{ color: COLORS.t3 }}>
                    {k}
                  </dt>
                  <dd className="text-[18px] font-bold" style={{ color: COLORS.w }}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}

// ─── KPIs ───────────────────────────────────────────────────────────────────

function Kpis() {
  const { data, view, range } = useAdmin();
  if (!data || !view) return null;
  const k = view.kpis;
  const s = view.series;
  const tail = (xs: number[]) => xs.slice(-range);
  const period = PERIOD_LABEL[range];
  const signups = pick(k.users, range);
  const active = pick(k.activeUsers, range);
  const sessions = pick(k.sessions, range);
  const secs = pick(k.recordingSeconds, range);
  const sums = pick(k.summaries, range);
  const ai = range === 7 ? data.ai.d7 : range === 30 ? data.ai.d30 : data.ai.d90;

  return (
    <>
      <SectionLabel>Last {range} days</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Total users"
          value={compact(k.users.total)}
          hint={`+${int(signups.cur)} in ${range} days · ${percent(k.activationRate)} recorded`}
          spark={tail(s.cumulativeUsers)}
        />
        <StatTile
          label="New signups"
          value={compact(signups.cur)}
          current={signups.cur}
          previous={signups.prev}
          periodLabel={period}
          spark={tail(s.signups)}
        />
        <StatTile
          label="Active users"
          value={compact(active.cur)}
          current={active.cur}
          previous={active.prev}
          periodLabel={period}
          hint={range === 90 ? undefined : `DAU ${k.activeUsers.today} · WAU ${k.activeUsers.d7} · MAU ${k.activeUsers.d30}`}
          spark={tail(s.activeUsers)}
        />
        <StatTile
          label="Sessions"
          value={compact(sessions.cur)}
          current={sessions.cur}
          previous={sessions.prev}
          periodLabel={period}
          spark={tail(s.sessions)}
        />
        <StatTile
          label="Recording time"
          value={hours(secs.cur)}
          current={secs.cur}
          previous={secs.prev}
          periodLabel={period}
          hint={`Avg ${duration(k.avgSessionSeconds)} · median ${duration(k.medianSessionSeconds)}`}
          spark={tail(s.recordingMinutes)}
        />
        <StatTile
          label="AI summaries"
          value={compact(sums.cur)}
          current={sums.cur}
          previous={sums.prev}
          periodLabel={period}
          spark={tail(s.summaries)}
        />
        <StatTile
          label="AI spend"
          value={formatMicroUsd(ai.costMicroUsd)}
          hint={`${compact(ai.calls)} calls · all accounts`}
          spark={tail(data.ai.costByDay.map((d) => d.total))}
        />
        <StatTile
          label="Est. MRR"
          value={`$${int(view.revenue.mrrUsd)}`}
          hint={
            BILLING_ENABLED
              ? `${view.revenue.paidPro} paid · ${view.revenue.comped} comped`
              : `Billing off · ${view.revenue.comped} comped`
          }
        />
      </div>
    </>
  );
}

// ─── Growth ─────────────────────────────────────────────────────────────────

function Growth() {
  const { data, view, range } = useAdmin();
  if (!data || !view) return null;
  const days = data.days.slice(-range);
  const p = view.breakdowns.providers;
  const f = view.funnel;
  return (
    <>
      <SectionLabel>Growth</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Signups per day">
          <BarSeries
            days={days}
            ariaLabel="Signups per day"
            format={compact}
            series={[
              { key: "signups", label: "Signups", color: COLORS.accent, values: view.series.signups.slice(-range) },
            ]}
          />
        </Card>
        <Card title="Total users" subtitle="Cumulative accounts (test accounts excluded)">
          <LineSeries
            days={days}
            label="Total users"
            format={compact}
            values={view.series.cumulativeUsers.slice(-range)}
          />
        </Card>
        <Card title="Activation funnel" subtitle="All-time, per user">
          <Funnel
            steps={[
              { key: "signup", label: "Signed up", value: f.signedUp },
              { key: "rec1", label: "Recorded a session", value: f.recorded1 },
              { key: "rec3", label: "Recorded 3+ sessions", value: f.recorded3 },
              { key: "sum", label: "Generated a summary", value: f.summarized },
              { key: "pro", label: "Pro (paid or comped)", value: f.pro },
            ]}
          />
        </Card>
        <Card title="Sign-in method">
          <ShareBar
            format={int}
            parts={[
              { key: "google", label: "Google", value: p.google, color: SERIES_COLORS[0] },
              { key: "password", label: "Email & password", value: p.password, color: SERIES_COLORS[1] },
              { key: "both", label: "Both", value: p.both, color: SERIES_COLORS[2] },
              { key: "none", label: "No linked sign-in", value: p.none, color: SERIES_COLORS[3] },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

// ─── Engagement ─────────────────────────────────────────────────────────────

function Engagement() {
  const { data, view, range } = useAdmin();
  if (!data || !view) return null;
  const days = data.days.slice(-range);
  return (
    <>
      <SectionLabel>Engagement</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Daily active users" subtitle="Users who recorded a session that day">
          <BarSeries
            days={days}
            ariaLabel="Daily active users"
            format={compact}
            series={[
              { key: "dau", label: "Active users", color: COLORS.accent, values: view.series.activeUsers.slice(-range) },
            ]}
          />
        </Card>
        <Card title="Sessions per day">
          <BarSeries
            days={days}
            ariaLabel="Sessions per day"
            format={compact}
            series={[
              { key: "sessions", label: "Sessions", color: COLORS.accent, values: view.series.sessions.slice(-range) },
            ]}
          />
        </Card>
        <Card title="Recording minutes per day">
          <BarSeries
            days={days}
            ariaLabel="Recording minutes per day"
            format={compact}
            series={[
              { key: "minutes", label: "Minutes", color: COLORS.accent, values: view.series.recordingMinutes.slice(-range) },
            ]}
          />
        </Card>
        <Card title="Session length" subtitle="All-time distribution of real sessions">
          <HBarList
            format={int}
            items={view.breakdowns.lengthHistogram.map((b) => ({
              key: b.label,
              label: b.label,
              value: b.count,
            }))}
          />
        </Card>
        <Card
          className="lg:col-span-2"
          title="When people record"
          subtitle={`Session starts by weekday and hour, last 90 days · ${REPORT_TZ_LABEL}`}
        >
          <Heatmap grid={view.breakdowns.heatmap} unit="sessions" />
        </Card>
      </div>
    </>
  );
}

// ─── Content ────────────────────────────────────────────────────────────────

function Content() {
  const { view } = useAdmin();
  if (!view) return null;
  const b = view.breakdowns;
  const toItems = (xs: typeof b.sourceLanguages, name: (l: string) => string) =>
    xs.map((x) => ({
      key: x.label,
      label: name(x.label),
      value: x.sessions,
      detail: hours(x.seconds),
    }));
  return (
    <>
      <SectionLabel>Languages & platforms</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Top language pairs" subtitle="Sessions · recording time">
          <HBarList format={int} items={toItems(b.languagePairs, pairName)} />
        </Card>
        <Card title="Listening to" subtitle="Source language">
          <HBarList format={int} items={toItems(b.sourceLanguages, langName)} />
        </Card>
        <Card title="Translating to" subtitle="Target language">
          <HBarList format={int} items={toItems(b.targetLanguages, langName)} />
        </Card>
        <Card title="Platform" subtitle="Where sessions were recorded">
          <ShareBar
            format={int}
            parts={[
              { key: "web", label: "Web", value: b.platforms.web, color: SERIES_COLORS[0] },
              { key: "ios", label: "iOS", value: b.platforms.ios, color: SERIES_COLORS[1] },
              { key: "unknown", label: "Not recorded (older sessions)", value: b.platforms.unknown, color: SERIES_COLORS[2] },
            ]}
          />
        </Card>
        <Card title="Preferences" subtitle={`${int(b.prefs.usersWithPrefs)} users saved settings`}>
          <dl className="flex flex-col gap-2 text-[12.5px]">
            {[
              ["Main speaker only — on", b.prefs.mainSpeakerOn],
              ["Main speaker only — off", b.prefs.mainSpeakerOff],
              ["Read-aloud (TTS) on", b.prefs.ttsOn],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt style={{ color: COLORS.t2 }}>{k}</dt>
                <dd className="font-semibold tabular-nums" style={{ color: COLORS.w }}>
                  {int(v as number)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}

// ─── Revenue ────────────────────────────────────────────────────────────────

function Revenue() {
  const { view } = useAdmin();
  if (!view) return null;
  const r = view.revenue;
  const rows: [string, string][] = [
    ["Paid Pro", `${int(r.paidPro)} (${r.monthlySubs} monthly · ${r.annualSubs} annual)`],
    ["Complimentary Pro", int(r.comped)],
    ["Estimated MRR", `$${int(r.mrrUsd)}`],
    ["Past due", int(r.pastDue)],
    ["Canceling at period end", int(r.canceling)],
    [
      "All subscription rows",
      Object.entries(r.byStatus)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${n} ${s.replace("_", " ")}`)
        .join(" · ") || "none",
    ],
  ];
  return (
    <>
      <SectionLabel>Revenue</SectionLabel>
      <Card>
        {!BILLING_ENABLED && (
          <div className="mb-3">
            <Notice tone="blue">
              Billing is OFF (BILLING_ENABLED = false, Stripe in test mode) —
              everyone is unlimited, and these numbers reflect test
              subscriptions only.
            </Notice>
          </div>
        )}
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-[12.5px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt style={{ color: COLORS.t3 }}>{k}</dt>
              <dd className="font-semibold text-right tabular-nums" style={{ color: COLORS.w }}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}

// ─── Recent activity (real-time) ────────────────────────────────────────────

function Recent() {
  const now = useNow(30_000);
  const signups = useQuery(api.adminPanel.recentSignups);
  const sessions = useQuery(api.adminPanel.recentSessions);
  return (
    <>
      <SectionLabel>Recent activity</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title="Newest accounts"
          action={
            <Link href="/admin/users" className="text-[12px] font-semibold" style={{ color: COLORS.accent }}>
              All users
            </Link>
          }
        >
          {signups === undefined ? (
            <Skeleton style={{ height: 200 }} rounded={12} />
          ) : signups.length === 0 ? (
            <EmptyHint>No accounts yet.</EmptyHint>
          ) : (
            <ul className="flex flex-col">
              {signups.map((u) => (
                <li key={u.id}>
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="flex items-center gap-3 rounded-lg -mx-2 px-2 py-2 transition-colors duration-200 hover:bg-black/15"
                  >
                    <Avatar image={u.image} name={u.name} email={u.email} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold truncate" style={{ color: COLORS.w }}>
                        {u.name ?? u.email ?? "—"}
                      </span>
                      <span className="block text-[11.5px] truncate" style={{ color: COLORS.t3 }}>
                        {u.email ?? "no email"}
                      </span>
                    </span>
                    <span className="shrink-0 flex flex-col items-end gap-1">
                      <ProviderBadges providers={u.providers} />
                      <span className="text-[11px]" style={{ color: COLORS.t4 }}>
                        {timeAgo(u.createdAt, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Latest sessions"
          action={
            <Link href="/admin/sessions" className="text-[12px] font-semibold" style={{ color: COLORS.accent }}>
              All sessions
            </Link>
          }
        >
          {sessions === undefined ? (
            <Skeleton style={{ height: 200 }} rounded={12} />
          ) : sessions.length === 0 ? (
            <EmptyHint>No sessions recorded yet.</EmptyHint>
          ) : (
            <ul className="flex flex-col">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/sessions/${s.id}`}
                    className="flex items-center gap-3 rounded-lg -mx-2 px-2 py-2 transition-colors duration-200 hover:bg-black/15"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold truncate" style={{ color: COLORS.w }}>
                        {s.title ?? "Untitled"}
                      </span>
                      <span className="block text-[11.5px] truncate" style={{ color: COLORS.t3 }}>
                        {s.owner?.email ?? "deleted user"} · {pairName(`${s.sourceLanguage}→${s.targetLanguage}`)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[12px] font-semibold tabular-nums" style={{ color: COLORS.w }}>
                        {duration(s.seconds)}
                      </span>
                      <span className="block text-[11px]" style={{ color: COLORS.t4 }}>
                        {timeAgo(s.createdAt, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function OverviewSkeleton({ computing }: { computing: boolean }) {
  return (
    <div className="flex flex-col">
      <SectionLabel>{computing ? "Computing the dashboard…" : "Dashboard"}</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="rounded-2xl p-4" style={cardStyle}>
            <Skeleton style={{ width: "50%", height: 12 }} />
            <Skeleton style={{ width: "70%", height: 26, marginTop: 10 }} />
            <Skeleton style={{ width: "100%", height: 28, marginTop: 16 }} />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2 mt-3">
        <Skeleton style={{ height: 240 }} rounded={16} />
        <Skeleton style={{ height: 240 }} rounded={16} />
      </div>
    </div>
  );
}
