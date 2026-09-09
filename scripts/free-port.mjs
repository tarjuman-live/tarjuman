// Reclaim the dev port before the server boots.
//
// Why this exists: server.js calls server.listen(port) with no retry and no
// auto-increment, so a leftover dev server anywhere on the machine turns
// `bun run dev` into a bare EADDRINUSE stack trace. That happens often here —
// this repo is checked out into several Conductor workspaces, each of which can
// leave a server running on 3000.
//
// Port 3000 is not cosmetic: NEXT_PUBLIC_APP_URL, Convex SITE_URL and the
// Stripe/auth callbacks are all pinned to http://localhost:3000. Drifting to
// 3001 silently breaks sign-in, which is worse than failing to start. So we
// take the port back rather than move off it.
//
// Wired into the `dev` scripts only — never `start`. Killing whatever holds a
// port is a local-development affordance, not something to do on a real server.

import { execFileSync } from "node:child_process";

const port = Number(process.env.PORT) || 3000;

/** PIDs currently LISTENing on `port`, minus our own process tree. */
function holders() {
  let out;
  try {
    out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // lsof exits 1 when nothing matches, and ENOENT if it isn't installed.
    // Both mean "nothing to do" — never block a boot on this helper.
    return [];
  }
  const own = new Set([process.pid, process.ppid]);
  return [...new Set(out.split("\n").map(Number))].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && !own.has(pid),
  );
}

/** Best-effort `ps` description of a pid, for the log line. */
function describe(pid) {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .slice(0, 60);
  } catch {
    return "unknown";
  }
}

function signal(pids, sig) {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch {
      // Already gone, or not ours to kill — the poll below is the real check.
    }
  }
}

/** Poll until the port frees up, or the budget runs out. */
function waitUntilFree(ms) {
  const deadline = Date.now() + ms;
  let left = holders();
  while (left.length > 0 && Date.now() < deadline) {
    // Synchronous sleep: this script's whole job is to finish before the
    // server starts, so there is nothing else to yield to.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    left = holders();
  }
  return left;
}

const initial = holders();
if (initial.length === 0) {
  process.exit(0);
}

const described = initial.map((pid) => `${pid} — ${describe(pid)}`);

signal(initial, "SIGTERM");
let survivors = waitUntilFree(2000);

if (survivors.length > 0) {
  signal(survivors, "SIGKILL");
  survivors = waitUntilFree(1000);
}

if (survivors.length > 0) {
  console.error(
    `\n   ✗ port ${port} is still held by ${survivors.join(", ")} after SIGKILL.` +
      `\n     Holders: ${described.join("; ")}\n`,
  );
  process.exit(1);
}

console.log(`   ↻ freed port ${port} (killed ${described.join("; ")})`);
