"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { COLORS } from "@/lib/constants";
import { formatMicroUsd } from "@/lib/usage/pricing";
import {
  AI_KINDS,
  USAGE_KIND_LABEL,
  type UsageKind,
} from "../../../../../convex/usageShared";
import type { AiTotals } from "../../../../../convex/adminMetrics";
import { useAdmin, type RangeDays } from "@/components/admin/admin-context";
import {
  Card,
  EmptyHint,
  Notice,
  SectionLabel,
  Segmented,
  StatTile,
} from "@/components/admin/ui";
import { BarSeries, SERIES_COLORS, type Series } from "@/components/admin/charts";
import { compact, dayLabel, int, percent } from "@/components/admin/format";
import { Skeleton } from "@/components/shared/skeleton";

/**
 * AI & costs: Claude spend by feature and model, call volume, error rate,
 * per-user cost, top spenders, and STT credential activity.
 *
 * Source: usageDaily rollups (written in the same transaction as each raw
 * usage event — convex/usage.ts), so there is no user dimension per day and
 * these numbers always include team accounts. Costs are computed from
 * token counts × the rate table in src/lib/usage/pricing.ts.
 */

/** Fixed feature → colour mapping: colour follows the entity, never its rank. */
const KIND_COLOR: Record<UsageKind, string> = {
  translate: SERIES_COLORS[0],
  summarize: SERIES_COLORS[1],
  ask: SERIES_COLORS[2],
  study_notes: SERIES_COLORS[3],
  translate_transcript: SERIES_COLORS[4],
  trial_translate: SERIES_COLORS[5],
  stt_token: COLORS.t4,
  stt_error: COLORS.red,
};

function totalsFor(
  ai: { today: AiTotals; d7: AiTotals; d30: AiTotals; d90: AiTotals },
  range: RangeDays,
): AiTotals {
  return range === 7 ? ai.d7 : range === 30 ? ai.d30 : ai.d90;
}

/** Micro-USD axis/tooltip format: whole dollars once amounts are large. */
function usd(micro: number): string {
  return formatMicroUsd(micro);
}

export default function AdminUsagePage() {
  const { data, view, range, setRange, refreshing, loading } = useAdmin();

  if (!data || !view) {
    return (
      <div className="flex flex-col gap-3">
        <div className="section-label">
          {refreshing || loading ? "Computing…" : "AI & costs"}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} style={{ height: 116 }} rounded={16} />
          ))}
        </div>
        <Skeleton style={{ height: 260 }} rounded={16} />
      </div>
    );
  }

  const ai = data.ai;
  const days = data.days.slice(-range);
  const costByDay = ai.costByDay.slice(-range);
  const t = totalsFor(ai, range);
  const errorRate = t.calls ? t.errors / t.calls : 0;
  const firstDataIdx = ai.callsByDay.findIndex((n) => n > 0);
  const tracking = firstDataIdx !== -1;

  const kinds = AI_KINDS.filter((k) => costByDay.some((d) => (d.byKind[k] ?? 0) > 0));
  const costSeries: Series[] = kinds.map((k) => ({
    key: k,
    label: USAGE_KIND_LABEL[k],
    color: KIND_COLOR[k],
    values: costByDay.map((d) => d.byKind[k] ?? 0),
  }));

  return (
    <div
      className="flex flex-col transition-opacity duration-300"
      style={{ opacity: refreshing ? 0.65 : 1 }}
    >
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
        <span className="text-[11.5px]" style={{ color: COLORS.t4 }}>
          Includes every account (team too) · costs are estimates from token counts
        </span>
      </div>

      {!tracking ? (
        <div className="mt-5">
          <Notice tone="blue">
            No AI usage recorded yet. Logging starts once{" "}
            <code>USAGE_INGEST_SECRET</code> is set to the same value on the
            Convex deployment and in the Vercel environment — every
            translation, summary and Pro tool call after that shows up here.
          </Notice>
        </div>
      ) : (
        <p className="text-[11.5px] mt-3" style={{ color: COLORS.t4 }}>
          Usage is recorded from {dayLabel(data.days[firstDataIdx])} — earlier days
          show zero because nothing was logged before then.
        </p>
      )}

      {t.unpricedCalls > 0 && (
        <div className="mt-3">
          <Notice tone="amber">
            {int(t.unpricedCalls)} call{t.unpricedCalls === 1 ? "" : "s"} used a
            model with no price entry, so they count as $0 — add the model to{" "}
            <code>src/lib/usage/pricing.ts</code>.
          </Notice>
        </div>
      )}

      <SectionLabel>Last {range} days</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="AI spend"
          value={usd(t.costMicroUsd)}
          hint={`Today ${usd(ai.today.costMicroUsd)}`}
          spark={costByDay.map((d) => d.total)}
        />
        <StatTile
          label="AI calls"
          value={compact(t.calls)}
          hint={`${compact(t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens)} in · ${compact(t.outputTokens)} out tokens`}
          spark={ai.callsByDay.slice(-range)}
        />
        <StatTile
          label="Error rate"
          value={percent(errorRate, 1)}
          hint={`${int(t.errors)} failed call${t.errors === 1 ? "" : "s"}`}
          spark={ai.errorsByDay.slice(-range)}
        />
        <StatTile
          label="Cost per active user"
          value={usd(view.aiPerUser.costPerActiveUser30MicroUsd ?? 0)}
          hint={`30 days · ${usd(view.aiPerUser.costPerRecordingHour30MicroUsd ?? 0)} per recording hour`}
        />
      </div>

      <SectionLabel>Spend</SectionLabel>
      <Card title="Spend per day by feature">
        {costSeries.length === 0 ? (
          <EmptyHint>No spend in this range.</EmptyHint>
        ) : (
          <BarSeries
            days={days}
            series={costSeries}
            height={220}
            format={usd}
            ariaLabel="AI spend per day by feature"
          />
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2 mt-3">
        <Card title="Calls per day">
          <BarSeries
            days={days}
            format={compact}
            ariaLabel="AI calls per day"
            series={[
              { key: "calls", label: "Calls", color: COLORS.accent, values: ai.callsByDay.slice(-range) },
            ]}
          />
        </Card>
        <Card title="Failed calls per day" subtitle="Upstream errors, timeouts, exhausted credits">
          <BarSeries
            days={days}
            format={compact}
            ariaLabel="Failed AI calls per day"
            series={[
              { key: "errors", label: "Failed calls", color: COLORS.red, values: ai.errorsByDay.slice(-range) },
            ]}
          />
        </Card>
      </div>

      <SectionLabel>Breakdown · last 30 days</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="By feature" padded={false}>
          <Table
            head={["Feature", "Calls", "Errors", "Cost"]}
            empty="No calls in the last 30 days."
            rows={ai.byKind30.map((k) => [
              <span key="k" className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  style={{ width: 10, height: 10, borderRadius: 3, background: KIND_COLOR[k.kind] }}
                />
                {USAGE_KIND_LABEL[k.kind]}
              </span>,
              int(k.calls),
              k.errors ? `${int(k.errors)} (${percent(k.errors / Math.max(1, k.calls))})` : "0",
              usd(k.costMicroUsd),
            ])}
          />
        </Card>
        <Card title="By model" padded={false}>
          <Table
            head={["Model", "Calls", "Tokens in / out", "Cost"]}
            empty="No calls in the last 30 days."
            rows={ai.byModel30.map((m) => [
              <code key="m" className="text-[11.5px]">{m.model}</code>,
              int(m.calls),
              `${compact(m.inputTokens)} / ${compact(m.outputTokens)}`,
              usd(m.costMicroUsd),
            ])}
          />
        </Card>
        <Card title="Top spenders this month" subtitle="Per user, all features" padded={false}>
          <Table
            head={["User", "Calls", "Cost"]}
            empty="No attributed spend this month."
            rows={data.topSpenders.map((s) => [
              <Link
                key="u"
                href={`/admin/users/${s.userId}`}
                className="hover:underline underline-offset-2"
                style={{ color: COLORS.w }}
              >
                {s.email ?? s.name ?? "deleted user"}
              </Link>,
              int(s.calls),
              usd(s.costMicroUsd),
            ])}
          />
        </Card>
        <Card title="Speech-to-text" subtitle="Last 30 days">
          <dl className="flex flex-col gap-2.5 text-[12.5px]">
            <div className="flex justify-between gap-3">
              <dt style={{ color: COLORS.t2 }}>Credentials minted</dt>
              <dd className="font-semibold tabular-nums" style={{ color: COLORS.w }}>
                {int(ai.sttTokens30)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: COLORS.t2 }}>Engine errors reported by clients</dt>
              <dd
                className="font-semibold tabular-nums"
                style={{ color: ai.sttErrors30 ? COLORS.red : COLORS.w }}
              >
                {int(ai.sttErrors30)}
              </dd>
            </div>
          </dl>
          <p className="text-[11.5px] mt-3 leading-snug" style={{ color: COLORS.t4 }}>
            A credential is minted on every record-screen prewarm and every
            reconnect, so this is not a recording count — see Sessions and
            recording time on the Overview for that. STT minutes are billed by
            the provider; check the Speechmatics portal for dollars.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) return <EmptyHint>{empty}</EmptyHint>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-4 py-2 font-medium text-[11px] uppercase tracking-wider ${i === 0 ? "text-left" : "text-right"}`}
                style={{ color: COLORS.t4, borderBottom: `1px solid ${COLORS.border}` }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="transition-colors duration-150 hover:bg-black/15"
              style={{ borderTop: i ? `1px solid ${COLORS.border}` : undefined }}
            >
              {r.map((c, j) => (
                <td
                  key={j}
                  className={`px-4 py-2.5 ${j === 0 ? "text-left" : "text-right tabular-nums"}`}
                  style={{ color: j === 0 ? COLORS.t2 : COLORS.w }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
