import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Hourly sweep: auto-complete sessions abandoned mid-recording (tab killed
// before Stop) so they don't linger at status="recording" in the user's
// history. See sessions.sweepStaleSessions for the 6h grace window.
crons.interval(
  "sweep stale recording sessions",
  { hours: 1 },
  internal.sessions.sweepStaleSessions,
  {}
);

// Operator alerts: AI failure spikes, Anthropic credits exhausted,
// Speechmatics quota refusals, usage-logging silence. Cheap — reads only the
// last 15 minutes of usageEvents. See convex/alerts.ts.
crons.interval(
  "check admin alerts",
  { minutes: 10 },
  internal.alerts.check,
  {}
);

// Raw usage events are kept 35 days (the daily/monthly rollups are kept
// forever). Batched + self-rescheduling. See convex/usage.ts.
crons.interval(
  "prune old usage events",
  { hours: 24 },
  internal.usage.pruneOldEvents,
  {}
);

// Email-code housekeeping: prune the code send log and remove sign-ups that
// were abandoned before the code was entered. See convex/authThrottle.ts.
crons.interval(
  "prune auth codes",
  { hours: 24 },
  internal.authThrottle.pruneAuthCodes,
  {}
);

export default crons;
