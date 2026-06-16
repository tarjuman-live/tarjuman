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

export default crons;
