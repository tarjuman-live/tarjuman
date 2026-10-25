import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
/**
 * Flood guard for an unauthenticated endpoint: at most this many NEW
 * addresses per minute, app-wide. Real traffic is nowhere near it; a script
 * stuffing the table hits it immediately.
 */
const MAX_NEW_PER_MINUTE = 30;

/**
 * Landing-page "Join the waitlist". Public (no sign-in). Joining twice is a
 * silent success — the answer never reveals whether an address was already
 * on the list.
 */
export const join = mutation({
  args: { email: v.string(), locale: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
      throw new ConvexError("invalid_email");
    }
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) return null;

    const latest = await ctx.db
      .query("waitlist")
      .order("desc")
      .take(MAX_NEW_PER_MINUTE);
    const oldest = latest[MAX_NEW_PER_MINUTE - 1];
    if (oldest && oldest._creationTime > Date.now() - 60_000) {
      throw new ConvexError("busy");
    }

    await ctx.db.insert("waitlist", {
      email,
      ...(args.locale ? { locale: args.locale.slice(0, 8) } : {}),
    });
    return null;
  },
});
