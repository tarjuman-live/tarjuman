import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { isAiKind } from "./usageShared";
import { segmentCountOf } from "./sessions";

/**
 * Operator alerts — so the next outage reaches the founder instead of waiting
 * to be noticed on /admin. (The 2026-10-10 "Anthropic credits ran out"
 * incident surfaced only as users seeing "Translation failed".)
 *
 * A 10-minute cron runs `check`: it evaluates a few cheap conditions over the
 * last 15 minutes of usageEvents, stores the active set (shown as a banner on
 * /admin), and emails ADMIN_ALERT_EMAIL via the same Resend account the
 * password-reset emails use — at most once per alert kind per dedupe window.
 *
 * Email is skipped (banner still updates) when ADMIN_ALERT_EMAIL or
 * RESEND_API_KEY is unset, e.g. on the dev deployment.
 */

const WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const STATE_KEY = "alerts";

type AlertKind = "ai_failures" | "credit_balance" | "stt_quota" | "ingest_silent";

/** Minimum gap between two emails for the same kind. */
const DEDUPE_MS: Record<AlertKind, number> = {
  ai_failures: 6 * HOUR_MS,
  credit_balance: 6 * HOUR_MS,
  stt_quota: 6 * HOUR_MS,
  ingest_silent: 24 * HOUR_MS,
};

const conditionValidator = v.object({ kind: v.string(), message: v.string() });

export const evaluate = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("usageEvents")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", now - WINDOW_MS),
      )
      .order("desc")
      .take(3000);

    const conditions: { kind: AlertKind; message: string }[] = [];

    const ai = recent.filter((e) => isAiKind(e.kind));
    const failures = ai.filter((e) => !e.ok);
    if (failures.length >= 5 && failures.length / ai.length >= 0.5) {
      const latest = failures[0];
      conditions.push({
        kind: "ai_failures",
        message:
          `${failures.length} of ${ai.length} AI calls failed in the last 15 min` +
          ` (latest: ${latest.kind}, HTTP ${latest.status ?? "?"}` +
          `${latest.error ? ` — ${latest.error}` : ""}).`,
      });
    }

    if (failures.some((e) => /credit balance/i.test(e.error ?? ""))) {
      conditions.push({
        kind: "credit_balance",
        message:
          "Anthropic reports the credit balance is too low — live translation and summaries are failing. Top up at console.anthropic.com.",
      });
    }

    const quota = recent.filter(
      (e) => e.kind === "stt_error" && /quota/i.test(e.error ?? ""),
    );
    if (quota.length > 0) {
      conditions.push({
        kind: "stt_quota",
        message: `Speechmatics refused ${quota.length} recording(s) for quota in the last 15 min — the free tier allows only 2 concurrent sessions app-wide.`,
      });
    }

    // Ingest silence: real recordings in the last 24h but no server-side usage
    // event (stt_token / translate) arrived — the Vercel USAGE_INGEST_SECRET is
    // missing or wrong. Only meaningful once the Convex side is configured.
    if (process.env.USAGE_INGEST_SECRET) {
      let lastServerEventAt: number | null = null;
      for await (const e of ctx.db.query("usageEvents").order("desc")) {
        if (e.kind !== "stt_error") {
          lastServerEventAt = e._creationTime;
          break;
        }
        if (now - e._creationTime > 24 * HOUR_MS) break;
      }
      const recorded = await ctx.db
        .query("sessions")
        .withIndex("by_status_updated", (q) =>
          q.eq("status", "completed").gte("updatedAt", now - 24 * HOUR_MS),
        )
        .take(20);
      const realRecording = recorded.some((s) => segmentCountOf(s) > 0);
      if (
        realRecording &&
        (lastServerEventAt === null || now - lastServerEventAt > 24 * HOUR_MS)
      ) {
        conditions.push({
          kind: "ingest_silent",
          message:
            "Sessions were recorded in the last 24h but no usage events arrived — check that USAGE_INGEST_SECRET is set (and matches) in the Vercel environment.",
        });
      }
    }

    const state = await ctx.db
      .query("adminState")
      .withIndex("by_key", (q) => q.eq("key", STATE_KEY))
      .unique();
    return {
      conditions,
      lastAlertSentAt: state?.lastAlertSentAt ?? {},
    };
  },
});

export const record = internalMutation({
  args: {
    active: v.array(conditionValidator),
    sentKinds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { active, sentKinds }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("adminState")
      .withIndex("by_key", (q) => q.eq("key", STATE_KEY))
      .unique();
    const prevActive = row?.activeAlerts ?? [];
    const nextActive = active.map((c) => ({
      ...c,
      since: prevActive.find((p) => p.kind === c.kind)?.since ?? now,
    }));
    const lastAlertSentAt = { ...(row?.lastAlertSentAt ?? {}) };
    for (const k of sentKinds) lastAlertSentAt[k] = now;

    // Skip no-op writes so the /admin subscription isn't woken every 10 min.
    const unchanged =
      row &&
      sentKinds.length === 0 &&
      JSON.stringify(prevActive) === JSON.stringify(nextActive);
    if (unchanged) return null;

    if (row) {
      await ctx.db.patch("adminState", row._id, {
        activeAlerts: nextActive,
        lastAlertSentAt,
      });
    } else {
      await ctx.db.insert("adminState", {
        key: STATE_KEY,
        activeAlerts: nextActive,
        lastAlertSentAt,
      });
    }
    return null;
  },
});

async function sendAlertEmail(
  to: string,
  conditions: { kind: string; message: string }[],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY as string;
  const from = process.env.RESEND_FROM ?? "Tarjuman <onboarding@resend.dev>";
  const site = (process.env.SITE_URL ?? "https://tarjuman.live").replace(/\/$/, "");
  const lines = conditions.map((c) => `• ${c.message}`).join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Tarjuman alert: ${conditions.map((c) => c.kind).join(", ")}`,
      text: `${lines}\n\nOpen the admin dashboard: ${site}/admin/system\n\nYou'll get at most one email per alert type every few hours.`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Cron entry point (every 10 minutes). */
export const check = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { conditions, lastAlertSentAt } = await ctx.runQuery(
      internal.alerts.evaluate,
      {},
    );
    const now = Date.now();
    const due = conditions.filter(
      (c) => now - ((lastAlertSentAt as Record<string, number>)[c.kind] ?? 0) >
        DEDUPE_MS[c.kind],
    );
    let sentKinds: string[] = [];
    const to = process.env.ADMIN_ALERT_EMAIL;
    if (due.length > 0 && to && process.env.RESEND_API_KEY) {
      try {
        await sendAlertEmail(to, due);
        sentKinds = due.map((c) => c.kind);
      } catch (e) {
        console.error("[alerts] email failed:", e);
      }
    }
    await ctx.runMutation(internal.alerts.record, {
      active: conditions,
      sentKinds,
    });
    return null;
  },
});
