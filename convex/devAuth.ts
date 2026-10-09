import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Server-only lookup for the dev sign-in bypass (see the "dev-bypass" provider
 * in convex/auth.ts). Internal: not callable from any client.
 */
export const userIdByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    return user?._id ?? null;
  },
});
