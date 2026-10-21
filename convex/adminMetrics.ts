/**
 * Admin dashboard math — PURE (no Convex imports, no I/O, no Date.now()).
 *
 * convex/adminStats.ts pages compact rows out of the database and hands them
 * here; everything the dashboard shows is derived in this file so it can be
 * unit-tested exhaustively (adminMetrics.test.ts) and reasoned about in one
 * place.
 *
 * Definitions used throughout:
 *  - "real user": not an automated test account (see admin.ts isTestEmail).
 *  - "real session": owned by a real, still-existing user AND has ≥ 1 saved
 *    segment. Empty "phantom" rows (createSession fires on /record prewarm) and
 *    ownerless/orphaned rows are excluded from every product metric and
 *    reported under `health` instead.
 *  - "active user" in a window: recorded ≥ 1 real session that STARTED in it.
 *  - Days are reporting-zone days (convex/reporting.ts — Makkah time).
 *
 * Two views are computed from the same rows: `everyone`, and `external`
 * (team/admin accounts excluded) — pre-launch, the founder's own testing would
 * otherwise dominate DAU. AI spend comes from day-level rollups with no user
 * dimension, so it is the same in both views (labelled in the UI).
 */
import {
  DAY_MS,
  dayKey,
  lastDayKeys,
  startOfDay,
  weekdayHour,
} from "./reporting";
import { AI_KINDS, type UsageKind } from "./usageShared";

/** Bump whenever the shape of DashboardData changes (UI forces a recompute). */
export const DASHBOARD_SCHEMA_VERSION = 1;
export const SERIES_DAYS = 90;
/** Sessions still "recording" this long after their last save are stuck. */
export const STUCK_AFTER_MS = 6 * 60 * 60 * 1000;
/** Cap for estimating an in-progress session's length from its timestamps. */
const MAX_ESTIMATED_SECONDS = 6 * 60 * 60;

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  createdAt: number;
  email: string | null;
  isTest: boolean;
}
export interface AccountRow {
  userId: string;
  provider: string;
}
export type SessionStatus = "recording" | "paused" | "completed";
export interface SessionRow {
  id: string;
  userId: string | null;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  durationSec: number;
  segmentCount: number;
  legacyInline: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  hasSummary: boolean;
  summaryGeneratedAt: number | null;
  platform: "web" | "ios" | null;
  isTestTitle: boolean;
}
export interface SubRow {
  userId: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  plan: "free" | "pro";
  priceId: string | null;
  cancelAtPeriodEnd: boolean;
}
export interface GrantRow {
  userId: string;
  active: boolean;
}
export interface PrefRow {
  userId: string;
  mainSpeakerOnly: boolean | null;
  ttsEnabled: boolean | null;
}
export interface AuthSessionRow {
  userId: string;
  createdAt: number;
  expirationTime: number;
}
export interface UsageDayRow {
  day: string;
  kind: UsageKind;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
  unpricedCalls: number;
}

export interface DashboardInput {
  now: number;
  users: UserRow[];
  accounts: AccountRow[];
  sessions: SessionRow[];
  subs: SubRow[];
  grants: GrantRow[];
  prefs: PrefRow[];
  authSessions: AuthSessionRow[];
  usageDays: UsageDayRow[];
  /** Team/admin user ids, excluded from the `external` view. */
  teamIds: string[];
  /** Stripe price id of the annual plan (to split MRR), if configured. */
  annualPriceId: string | null;
  proMonthlyUsd: number;
  proAnnualPerMonthUsd: number;
}

// ─── Outputs ────────────────────────────────────────────────────────────────

/** A count over the standard windows. `prev*` is the window just before. */
export interface Windowed {
  today: number;
  d7: number;
  prev7: number;
  d30: number;
  prev30: number;
  d90: number;
  total: number;
}

export interface RankedItem {
  label: string;
  sessions: number;
  seconds: number;
}

export interface DashboardView {
  kpis: {
    users: Windowed; // signups by window; total = all real users
    activeUsers: Windowed; // DAU (today) / WAU (d7) / MAU (d30); total = ever activated
    sessions: Windowed;
    recordingSeconds: Windowed;
    summaries: Windowed;
    avgSessionSeconds: number;
    medianSessionSeconds: number;
    activationRate: number; // users with ≥1 real session / users
    liveDevices: number; // unexpired auth sessions (signed-in devices)
  };
  series: {
    signups: number[];
    cumulativeUsers: number[];
    activeUsers: number[];
    sessions: number[];
    recordingMinutes: number[];
    summaries: number[];
  };
  breakdowns: {
    languagePairs: RankedItem[];
    sourceLanguages: RankedItem[];
    targetLanguages: RankedItem[];
    platforms: { web: number; ios: number; unknown: number };
    providers: { google: number; password: number; both: number; none: number };
    lengthHistogram: { label: string; count: number }[];
    /** [weekday 0=Sun..6=Sat][hour 0..23] real-session starts, last 90 days. */
    heatmap: number[][];
    prefs: {
      usersWithPrefs: number;
      mainSpeakerOn: number;
      mainSpeakerOff: number;
      ttsOn: number;
    };
  };
  funnel: {
    signedUp: number;
    recorded1: number;
    recorded3: number;
    summarized: number;
    pro: number;
  };
  revenue: {
    byStatus: Record<SubRow["status"], number>;
    paidPro: number;
    monthlySubs: number;
    annualSubs: number;
    comped: number;
    mrrUsd: number;
    pastDue: number;
    canceling: number;
  };
  aiPerUser: {
    costPerActiveUser30MicroUsd: number | null;
    costPerRecordingHour30MicroUsd: number | null;
  };
}

export interface AiTotals {
  calls: number;
  errors: number;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  unpricedCalls: number;
}

export interface AiSummary {
  today: AiTotals;
  d7: AiTotals;
  d30: AiTotals;
  d90: AiTotals;
  /** Per series day: total AI cost and cost per kind (micro-USD). */
  costByDay: { total: number; byKind: Partial<Record<UsageKind, number>> }[];
  callsByDay: number[];
  errorsByDay: number[];
  byKind30: {
    kind: UsageKind;
    calls: number;
    errors: number;
    costMicroUsd: number;
  }[];
  byModel30: {
    model: string;
    calls: number;
    costMicroUsd: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  sttTokens30: number;
  sttErrors30: number;
}

export interface Health {
  totalSessionRows: number;
  phantomSessions: number;
  stuckRecordings: number;
  legacyInlineSessions: number;
  ownerlessSessions: number;
  orphanSessions: number;
  testUsers: number;
  testSessions: number;
  /** Auth rows whose user no longer exists (break Google sign-in — see admin.ts). */
  orphanAuthAccounts: number;
  orphanAuthSessions: number;
}

export interface DashboardData {
  schemaVersion: number;
  /** Series day keys, oldest first (length SERIES_DAYS). */
  days: string[];
  everyone: DashboardView;
  external: DashboardView;
  ai: AiSummary;
  health: Health;
}

export interface UserStats {
  sessions: number;
  recordingSeconds: number;
  summaries: number;
  lastRecordedAt: number | null;
  platforms: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Best estimate of a session's recorded length in seconds. Completed sessions
 * carry `duration` from the client; in-progress ones (and the rare completed
 * row with duration 0) fall back to wall-clock between creation and the last
 * save, capped at the 6h anti-runaway fuse.
 */
export function sessionSeconds(
  s: Pick<SessionRow, "durationSec" | "createdAt" | "updatedAt">,
): number {
  if (s.durationSec > 0) return s.durationSec;
  const est = Math.max(0, Math.round((s.updatedAt - s.createdAt) / 1000));
  return Math.min(est, MAX_ESTIMATED_SECONDS);
}

function emptyWindowed(): Windowed {
  return { today: 0, d7: 0, prev7: 0, d30: 0, prev30: 0, d90: 0, total: 0 };
}

interface WindowBounds {
  todayStart: number;
  d7: number;
  d14: number;
  d30: number;
  d60: number;
  d90: number;
  now: number;
}

function bounds(now: number): WindowBounds {
  return {
    todayStart: startOfDay(now),
    d7: now - 7 * DAY_MS,
    d14: now - 14 * DAY_MS,
    d30: now - 30 * DAY_MS,
    d60: now - 60 * DAY_MS,
    d90: now - 90 * DAY_MS,
    now,
  };
}

/** Add `amount` at time `ts` into every window it falls in. */
function addWindowed(w: Windowed, b: WindowBounds, ts: number, amount = 1) {
  w.total += amount;
  if (ts > b.now) return;
  if (ts >= b.todayStart) w.today += amount;
  if (ts >= b.d7) w.d7 += amount;
  else if (ts >= b.d14) w.prev7 += amount;
  if (ts >= b.d30) w.d30 += amount;
  else if (ts >= b.d60) w.prev30 += amount;
  if (ts >= b.d90) w.d90 += amount;
}

/** Distinct-user version of addWindowed (e.g. active users). */
function distinctWindowed(
  events: { userId: string; ts: number }[],
  b: WindowBounds,
): Windowed {
  const sets = {
    today: new Set<string>(),
    d7: new Set<string>(),
    prev7: new Set<string>(),
    d30: new Set<string>(),
    prev30: new Set<string>(),
    d90: new Set<string>(),
    total: new Set<string>(),
  };
  for (const { userId, ts } of events) {
    sets.total.add(userId);
    if (ts > b.now) continue;
    if (ts >= b.todayStart) sets.today.add(userId);
    if (ts >= b.d7) sets.d7.add(userId);
    else if (ts >= b.d14) sets.prev7.add(userId);
    if (ts >= b.d30) sets.d30.add(userId);
    else if (ts >= b.d60) sets.prev30.add(userId);
    if (ts >= b.d90) sets.d90.add(userId);
  }
  return {
    today: sets.today.size,
    d7: sets.d7.size,
    prev7: sets.prev7.size,
    d30: sets.d30.size,
    prev30: sets.prev30.size,
    d90: sets.d90.size,
    total: sets.total.size,
  };
}

function rank(
  map: Map<string, { sessions: number; seconds: number }>,
  limit: number,
): RankedItem[] {
  return Array.from(map.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.sessions - a.sessions || b.seconds - a.seconds)
    .slice(0, limit);
}

function bump(
  map: Map<string, { sessions: number; seconds: number }>,
  key: string,
  seconds: number,
) {
  const cur = map.get(key) ?? { sessions: 0, seconds: 0 };
  cur.sessions += 1;
  cur.seconds += seconds;
  map.set(key, cur);
}

export const LENGTH_BUCKETS: { label: string; maxSeconds: number }[] = [
  { label: "< 5 min", maxSeconds: 5 * 60 },
  { label: "5–15 min", maxSeconds: 15 * 60 },
  { label: "15–30 min", maxSeconds: 30 * 60 },
  { label: "30–60 min", maxSeconds: 60 * 60 },
  { label: "1–2 h", maxSeconds: 2 * 60 * 60 },
  { label: "2 h +", maxSeconds: Infinity },
];

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Real sessions for a given set of real user ids. */
function realSessionsFor(
  sessions: SessionRow[],
  userIds: Set<string>,
): SessionRow[] {
  return sessions.filter(
    (s) => s.userId !== null && userIds.has(s.userId) && s.segmentCount > 0,
  );
}

// ─── AI ─────────────────────────────────────────────────────────────────────

function emptyAiTotals(): AiTotals {
  return {
    calls: 0,
    errors: 0,
    costMicroUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    unpricedCalls: 0,
  };
}

function addAi(t: AiTotals, r: UsageDayRow) {
  t.calls += r.calls;
  t.errors += r.errors;
  t.costMicroUsd += r.costMicroUsd;
  t.inputTokens += r.inputTokens;
  t.outputTokens += r.outputTokens;
  t.cacheReadTokens += r.cacheReadTokens;
  t.cacheWriteTokens += r.cacheWriteTokens;
  t.unpricedCalls += r.unpricedCalls;
}

export function computeAi(rows: UsageDayRow[], days: string[]): AiSummary {
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const last7 = new Set(days.slice(-7));
  const last30 = new Set(days.slice(-30));
  const todayKey = days[days.length - 1];

  const today = emptyAiTotals();
  const d7 = emptyAiTotals();
  const d30 = emptyAiTotals();
  const d90 = emptyAiTotals();
  const costByDay = days.map(() => ({
    total: 0,
    byKind: {} as Partial<Record<UsageKind, number>>,
  }));
  const callsByDay = days.map(() => 0);
  const errorsByDay = days.map(() => 0);
  const byKind = new Map<
    UsageKind,
    { calls: number; errors: number; costMicroUsd: number }
  >();
  const byModel = new Map<
    string,
    {
      calls: number;
      costMicroUsd: number;
      inputTokens: number;
      outputTokens: number;
    }
  >();
  let sttTokens30 = 0;
  let sttErrors30 = 0;

  for (const r of rows) {
    if (r.kind === "stt_token") {
      if (last30.has(r.day)) sttTokens30 += r.calls;
      continue;
    }
    if (r.kind === "stt_error") {
      if (last30.has(r.day)) sttErrors30 += r.calls;
      continue;
    }
    if (!AI_KINDS.includes(r.kind)) continue;

    const i = dayIndex.get(r.day);
    if (i !== undefined) {
      addAi(d90, r);
      const slot = costByDay[i];
      slot.total += r.costMicroUsd;
      slot.byKind[r.kind] = (slot.byKind[r.kind] ?? 0) + r.costMicroUsd;
      callsByDay[i] += r.calls;
      errorsByDay[i] += r.errors;
    }
    if (r.day === todayKey) addAi(today, r);
    if (last7.has(r.day)) addAi(d7, r);
    if (last30.has(r.day)) {
      addAi(d30, r);
      const k = byKind.get(r.kind) ?? { calls: 0, errors: 0, costMicroUsd: 0 };
      k.calls += r.calls;
      k.errors += r.errors;
      k.costMicroUsd += r.costMicroUsd;
      byKind.set(r.kind, k);
      if (r.model) {
        const m = byModel.get(r.model) ?? {
          calls: 0,
          costMicroUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        m.calls += r.calls;
        m.costMicroUsd += r.costMicroUsd;
        m.inputTokens += r.inputTokens;
        m.outputTokens += r.outputTokens;
        byModel.set(r.model, m);
      }
    }
  }

  return {
    today,
    d7,
    d30,
    d90,
    costByDay,
    callsByDay,
    errorsByDay,
    byKind30: Array.from(byKind.entries())
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => b.costMicroUsd - a.costMicroUsd || b.calls - a.calls),
    byModel30: Array.from(byModel.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.costMicroUsd - a.costMicroUsd || b.calls - a.calls),
    sttTokens30,
    sttErrors30,
  };
}

// ─── Views ──────────────────────────────────────────────────────────────────

export function computeView(
  input: DashboardInput,
  days: string[],
  exclude: Set<string>,
  ai: AiSummary,
): DashboardView {
  const b = bounds(input.now);
  const users = input.users.filter((u) => !u.isTest && !exclude.has(u.id));
  const userIds = new Set(users.map((u) => u.id));
  const sessions = realSessionsFor(input.sessions, userIds);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const zeros = () => days.map(() => 0);

  // Signups.
  const signups = emptyWindowed();
  const signupSeries = zeros();
  const firstDayStart = startOfDay(input.now) - (days.length - 1) * DAY_MS;
  let usersBeforeSeries = 0;
  for (const u of users) {
    addWindowed(signups, b, u.createdAt);
    const i = dayIndex.get(dayKey(u.createdAt));
    if (i !== undefined) signupSeries[i]++;
    else if (u.createdAt < firstDayStart) usersBeforeSeries++;
  }
  const cumulativeUsers: number[] = [];
  let running = usersBeforeSeries;
  for (const n of signupSeries) {
    running += n;
    cumulativeUsers.push(running);
  }

  // Sessions, minutes, active users, summaries.
  const sessionsW = emptyWindowed();
  const secondsW = emptyWindowed();
  const summariesW = emptyWindowed();
  const sessionSeries = zeros();
  const minuteSeries = zeros();
  const summarySeries = zeros();
  const activeByDay = days.map(() => new Set<string>());
  const activityEvents: { userId: string; ts: number }[] = [];
  const perUserSessions = new Map<string, number>();
  const summarizedUsers = new Set<string>();
  const pairs = new Map<string, { sessions: number; seconds: number }>();
  const sources = new Map<string, { sessions: number; seconds: number }>();
  const targets = new Map<string, { sessions: number; seconds: number }>();
  const platforms = { web: 0, ios: 0, unknown: 0 };
  const lengthCounts = LENGTH_BUCKETS.map(() => 0);
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const heatmapSince = input.now - SERIES_DAYS * DAY_MS;
  const durations: number[] = [];

  for (const s of sessions) {
    const userId = s.userId as string;
    const secs = sessionSeconds(s);
    addWindowed(sessionsW, b, s.createdAt);
    addWindowed(secondsW, b, s.createdAt, secs);
    activityEvents.push({ userId, ts: s.createdAt });
    perUserSessions.set(userId, (perUserSessions.get(userId) ?? 0) + 1);

    const i = dayIndex.get(dayKey(s.createdAt));
    if (i !== undefined) {
      sessionSeries[i]++;
      minuteSeries[i] += secs / 60;
      activeByDay[i].add(userId);
    }

    if (s.hasSummary) {
      summarizedUsers.add(userId);
      if (s.summaryGeneratedAt !== null) {
        addWindowed(summariesW, b, s.summaryGeneratedAt);
        const j = dayIndex.get(dayKey(s.summaryGeneratedAt));
        if (j !== undefined) summarySeries[j]++;
      } else {
        // Summaries from before summaryGeneratedAt existed: lifetime only.
        summariesW.total++;
      }
    }

    bump(pairs, `${s.sourceLanguage}→${s.targetLanguage}`, secs);
    bump(sources, s.sourceLanguage, secs);
    bump(targets, s.targetLanguage, secs);
    platforms[s.platform ?? "unknown"]++;

    const bucket = LENGTH_BUCKETS.findIndex((x) => secs < x.maxSeconds);
    lengthCounts[bucket === -1 ? LENGTH_BUCKETS.length - 1 : bucket]++;
    if (s.status === "completed" && secs > 0) durations.push(secs);

    if (s.createdAt >= heatmapSince) {
      const { weekday, hour } = weekdayHour(s.createdAt);
      heatmap[weekday][hour]++;
    }
  }

  durations.sort((x, y) => x - y);
  const activeUsers = distinctWindowed(activityEvents, b);

  // Providers per user.
  const providersByUser = new Map<string, Set<string>>();
  for (const a of input.accounts) {
    if (!userIds.has(a.userId)) continue;
    const set = providersByUser.get(a.userId) ?? new Set<string>();
    set.add(a.provider);
    providersByUser.set(a.userId, set);
  }
  const providers = { google: 0, password: 0, both: 0, none: 0 };
  for (const u of users) {
    const set = providersByUser.get(u.id);
    const g = set?.has("google") ?? false;
    const p = set?.has("password") ?? false;
    if (g && p) providers.both++;
    else if (g) providers.google++;
    else if (p) providers.password++;
    else providers.none++;
  }

  // Preferences.
  const prefs = { usersWithPrefs: 0, mainSpeakerOn: 0, mainSpeakerOff: 0, ttsOn: 0 };
  for (const p of input.prefs) {
    if (!userIds.has(p.userId)) continue;
    prefs.usersWithPrefs++;
    if (p.mainSpeakerOnly === true) prefs.mainSpeakerOn++;
    if (p.mainSpeakerOnly === false) prefs.mainSpeakerOff++;
    if (p.ttsEnabled === true) prefs.ttsOn++;
  }

  // Revenue.
  const byStatus: Record<SubRow["status"], number> = {
    active: 0,
    trialing: 0,
    past_due: 0,
    canceled: 0,
    incomplete: 0,
  };
  const paidUsers = new Set<string>();
  let monthlySubs = 0;
  let annualSubs = 0;
  let canceling = 0;
  for (const s of input.subs) {
    if (!userIds.has(s.userId)) continue;
    byStatus[s.status]++;
    if (s.plan === "pro") {
      paidUsers.add(s.userId);
      if (input.annualPriceId && s.priceId === input.annualPriceId) annualSubs++;
      else monthlySubs++;
      if (s.cancelAtPeriodEnd) canceling++;
    }
  }
  const compedUsers = new Set<string>();
  for (const g of input.grants) {
    if (g.active && userIds.has(g.userId) && !paidUsers.has(g.userId)) {
      compedUsers.add(g.userId);
    }
  }

  // Signed-in devices right now.
  let liveDevices = 0;
  for (const a of input.authSessions) {
    if (userIds.has(a.userId) && a.expirationTime > input.now) liveDevices++;
  }

  const recorded1 = Array.from(perUserSessions.values()).filter((n) => n >= 1).length;
  const recorded3 = Array.from(perUserSessions.values()).filter((n) => n >= 3).length;
  const recordingHours30 = secondsW.d30 / 3600;

  return {
    kpis: {
      users: { ...signups, total: users.length },
      activeUsers,
      sessions: sessionsW,
      recordingSeconds: secondsW,
      summaries: summariesW,
      avgSessionSeconds: durations.length
        ? Math.round(durations.reduce((x, y) => x + y, 0) / durations.length)
        : 0,
      medianSessionSeconds: median(durations),
      activationRate: users.length ? recorded1 / users.length : 0,
      liveDevices,
    },
    series: {
      signups: signupSeries,
      cumulativeUsers,
      activeUsers: activeByDay.map((s) => s.size),
      sessions: sessionSeries,
      recordingMinutes: minuteSeries.map((m) => Math.round(m)),
      summaries: summarySeries,
    },
    breakdowns: {
      languagePairs: rank(pairs, 12),
      sourceLanguages: rank(sources, 12),
      targetLanguages: rank(targets, 12),
      platforms,
      providers,
      lengthHistogram: LENGTH_BUCKETS.map((x, i) => ({
        label: x.label,
        count: lengthCounts[i],
      })),
      heatmap,
      prefs,
    },
    funnel: {
      signedUp: users.length,
      recorded1,
      recorded3,
      summarized: summarizedUsers.size,
      pro: paidUsers.size + compedUsers.size,
    },
    revenue: {
      byStatus,
      paidPro: paidUsers.size,
      monthlySubs,
      annualSubs,
      comped: compedUsers.size,
      mrrUsd:
        monthlySubs * input.proMonthlyUsd +
        annualSubs * input.proAnnualPerMonthUsd,
      pastDue: byStatus.past_due,
      canceling,
    },
    aiPerUser: {
      costPerActiveUser30MicroUsd: activeUsers.d30
        ? Math.round(ai.d30.costMicroUsd / activeUsers.d30)
        : null,
      costPerRecordingHour30MicroUsd:
        recordingHours30 > 0
          ? Math.round(ai.d30.costMicroUsd / recordingHours30)
          : null,
    },
  };
}

export function computeHealth(input: DashboardInput): Health {
  const allUserIds = new Set(input.users.map((u) => u.id));
  const testUserIds = new Set(
    input.users.filter((u) => u.isTest).map((u) => u.id),
  );
  const h: Health = {
    totalSessionRows: input.sessions.length,
    phantomSessions: 0,
    stuckRecordings: 0,
    legacyInlineSessions: 0,
    ownerlessSessions: 0,
    orphanSessions: 0,
    testUsers: testUserIds.size,
    testSessions: 0,
    orphanAuthAccounts: input.accounts.filter((a) => !allUserIds.has(a.userId))
      .length,
    orphanAuthSessions: input.authSessions.filter(
      (a) => !allUserIds.has(a.userId),
    ).length,
  };
  for (const s of input.sessions) {
    if (s.segmentCount === 0) h.phantomSessions++;
    if (s.status === "recording" && input.now - s.updatedAt > STUCK_AFTER_MS) {
      h.stuckRecordings++;
    }
    if (s.legacyInline) h.legacyInlineSessions++;
    if (s.userId === null) h.ownerlessSessions++;
    else if (!allUserIds.has(s.userId)) h.orphanSessions++;
    if (s.isTestTitle || (s.userId !== null && testUserIds.has(s.userId))) {
      h.testSessions++;
    }
  }
  return h;
}

/** Per-user activity rollup (written to adminUserStats). Real sessions only. */
export function computeUserStats(
  input: DashboardInput,
): Map<string, UserStats> {
  const userIds = new Set(input.users.map((u) => u.id));
  const stats = new Map<string, UserStats>();
  for (const s of realSessionsFor(input.sessions, userIds)) {
    const userId = s.userId as string;
    const cur = stats.get(userId) ?? {
      sessions: 0,
      recordingSeconds: 0,
      summaries: 0,
      lastRecordedAt: null,
      platforms: [],
    };
    cur.sessions++;
    cur.recordingSeconds += sessionSeconds(s);
    if (s.hasSummary) cur.summaries++;
    if (cur.lastRecordedAt === null || s.createdAt > cur.lastRecordedAt) {
      cur.lastRecordedAt = s.createdAt;
    }
    if (s.platform && !cur.platforms.includes(s.platform)) {
      cur.platforms.push(s.platform);
    }
    stats.set(userId, cur);
  }
  stats.forEach((st) => st.platforms.sort());
  return stats;
}

/** Everything the dashboard snapshot stores. */
export function computeDashboard(input: DashboardInput): DashboardData {
  const days = lastDayKeys(input.now, SERIES_DAYS);
  const ai = computeAi(input.usageDays, days);
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    days,
    everyone: computeView(input, days, new Set(), ai),
    external: computeView(input, days, new Set(input.teamIds), ai),
    ai,
    health: computeHealth(input),
  };
}
