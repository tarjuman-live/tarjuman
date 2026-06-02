import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Server-side helpers for the Next.js API routes.
 *
 * Why this exists: routes like /api/translate and /api/summarize call paid
 * upstream APIs (Anthropic). On localhost they were unauthenticated which
 * is fine, but as soon as the app is deployed publicly anyone who finds
 * those URLs can curl them in a loop and burn the budget.
 *
 * Two protections:
 *  1. requireAuthFromHeader — verifies a Bearer token issued by Convex Auth.
 *     Returns the userId on success, null on failure (caller returns 401).
 *  2. checkRateLimit — in-memory token-bucket per (userId, kind) pair.
 *     Single-process scope (we run on a single Node server, no edge fan-out),
 *     which is sufficient for MVP. If we ever scale to multiple replicas
 *     this becomes per-replica rather than global; tighten by ~half then.
 */

interface AuthOk {
  userId: Id<"users">;
}

const cachedClient = (() => {
  let c: ConvexHttpClient | null = null;
  return () => {
    if (!c) {
      const url = process.env.NEXT_PUBLIC_CONVEX_URL;
      if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
      c = new ConvexHttpClient(url);
    }
    return c;
  };
})();

export async function requireAuthFromHeader(
  req: Request
): Promise<AuthOk | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  // Use a fresh client per request — ConvexHttpClient.setAuth mutates state,
  // so concurrent requests on the same client could race. Cheap to create.
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  const client = new ConvexHttpClient(url);
  client.setAuth(token);

  try {
    const me = await client.query(api.users.me, {});
    if (!me) return null;
    return { userId: me._id };
  } catch {
    // Invalid / expired token, malformed, etc. Treat as unauthenticated.
    return null;
  }
}

// Touch the cached client to keep TS from removing it as unused — it's the
// fallback the future may want to switch back to once we trust no concurrent
// auth-per-request mutations.
void cachedClient;

// ─── Rate limiter (token bucket per user, per action) ──────────────────────

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

interface LimitConfig {
  capacity: number;
  refillPerSec: number;
}

const buckets = new Map<string, Bucket>();

const LIMITS: Record<string, LimitConfig> = {
  // Translation runs once per finalized transcript segment. A typical
  // 30-min khutbah produces ~50 finals, ≈1.7/min average, with bursts up
  // to ~6/min during fast speech. Cap at 60/min absorbs reasonable bursts;
  // a malicious loop hits the cap immediately.
  translate: { capacity: 60, refillPerSec: 1 },
  // Summary is once per session. A user shouldn't need more than ~10/hour
  // even with re-generations.
  summarize: { capacity: 10, refillPerSec: 10 / 3600 },
  // TTS fires once per translated segment, same burst pattern as translate.
  tts: { capacity: 60, refillPerSec: 1 },
  // Whisper transcribe fires once per finalized segment (same as translate).
  transcribe: { capacity: 60, refillPerSec: 1 },
};

export function checkRateLimit(
  userId: string,
  kind: keyof typeof LIMITS
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const cfg = LIMITS[kind];
  const key = `${userId}:${kind}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: cfg.capacity, lastRefillMs: now };
    buckets.set(key, bucket);
  }

  const elapsedSec = (now - bucket.lastRefillMs) / 1000;
  bucket.tokens = Math.min(
    cfg.capacity,
    bucket.tokens + elapsedSec * cfg.refillPerSec
  );
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterSec = Math.ceil(tokensNeeded / cfg.refillPerSec);
    return { allowed: false, retryAfterSec };
  }
  bucket.tokens -= 1;
  return { allowed: true };
}

// ─── Periodic GC ───────────────────────────────────────────────────────────
// In-memory map grows unbounded over the life of the server. GC stale buckets
// every 10 minutes — anything that hasn't been touched in 60 minutes is dropped.
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const [key, bucket] of buckets) {
        if (bucket.lastRefillMs < cutoff) buckets.delete(key);
      }
    },
    10 * 60 * 1000
  );
}
