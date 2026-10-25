import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { WithoutSystemFields } from "convex/server";
import { EMAIL_CODE_PROVIDER_ID } from "./emailCode";
import { enforceCodeSendLimit } from "./authThrottle";

/**
 * Convex Auth's `createOrUpdateUser` callback: decides which `users` row an
 * account belongs to, every time an account is created, a code is sent, or a
 * code is verified.
 *
 * It is a faithful copy of the library's default (@convex-dev/auth 0.0.92,
 * server/implementation/users.js `defaultCreateOrUpdateUser`, which isn't
 * exported) plus three Tarjuman rules. Password, Google and dev-bypass
 * resolve users exactly as they did before this callback existed.
 *
 * 1. Email-code linking. The library only links a new account to a user whose
 *    email is VERIFIED — and password sign-ups are never verified. Without
 *    this rule, a password user who picks "Email code" would land in a brand
 *    new, empty account and think their history was gone. So when an
 *    email-code account finds no verified user, it links to the single
 *    existing user with that exact email. The link is made when the code is
 *    sent, but nobody gets in without entering the code, and verifying it
 *    marks the user's email verified.
 *
 *    Accepted risk (account pre-hijacking): someone who registered a password
 *    for an address they don't own keeps that password after the real owner
 *    starts signing in with codes. Low value here (lecture transcripts), and
 *    the alternative is a duplicate account for every password user who tries
 *    a code.
 *
 * 2. No duplicate password sign-up. A password sign-up for an email that
 *    already belongs to a verified user (Google or email code) would create a
 *    second, empty account (password sign-ups never link — linking an
 *    unproven email would hand that account to whoever typed it). Refuse with
 *    `email_in_use` so the form can point them to the method they used.
 *
 * 3. Send limit. type "email" is the code-SEND step (sign-in code and password
 *    reset alike); see authThrottle.ts.
 */

type Profile = Record<string, unknown> & {
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
};

export type CreateOrUpdateUserArgs = {
  existingUserId: Id<"users"> | null;
  type: "oauth" | "credentials" | "email" | "phone" | "verification";
  provider: { id: string; type: string };
  profile: Profile;
  /** Passed at runtime by createAccount() (missing from the library's type). */
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};

const PASSWORD_PROVIDER_ID = "password";

export async function createOrUpdateUser(
  ctx: MutationCtx,
  args: CreateOrUpdateUserArgs,
): Promise<Id<"users">> {
  const { provider, existingUserId } = args;
  const {
    emailVerified: profileEmailVerified,
    phoneVerified: profilePhoneVerified,
    ...profile
  } = args.profile;

  if (args.type === "email" && typeof profile.email === "string") {
    await enforceCodeSendLimit(ctx, profile.email);
  }

  if (
    existingUserId === null &&
    args.type === "credentials" &&
    provider.id === PASSWORD_PROVIDER_ID &&
    typeof profile.email === "string" &&
    (await firstUserWithVerifiedEmail(ctx, profile.email)) !== null
  ) {
    throw new ConvexError({ code: "email_in_use" });
  }

  // ── Library default from here, except the marked email-code branch ──
  const emailVerified =
    profileEmailVerified ??
    ((provider.type === "oauth" || provider.type === "oidc") &&
      (provider as { allowDangerousEmailAccountLinking?: boolean })
        .allowDangerousEmailAccountLinking !== false);
  const phoneVerified = profilePhoneVerified ?? false;
  const shouldLinkViaEmail =
    args.shouldLinkViaEmail || emailVerified || provider.type === "email";
  const shouldLinkViaPhone =
    args.shouldLinkViaPhone || phoneVerified || provider.type === "phone";

  let userId: Id<"users"> | null = existingUserId;
  if (existingUserId === null) {
    const verifiedEmailUserId =
      typeof profile.email === "string" && shouldLinkViaEmail
        ? ((await uniqueUserWithVerifiedEmail(ctx, profile.email))?._id ?? null)
        : null;
    const verifiedPhoneUserId =
      typeof profile.phone === "string" && shouldLinkViaPhone
        ? ((await uniqueUserWithVerifiedPhone(ctx, profile.phone))?._id ?? null)
        : null;
    if (verifiedEmailUserId !== null && verifiedPhoneUserId !== null) {
      // Both an email- and a phone-verified user match: ambiguous, don't link.
      userId = null;
    } else if (verifiedEmailUserId !== null) {
      userId = verifiedEmailUserId;
    } else if (verifiedPhoneUserId !== null) {
      userId = verifiedPhoneUserId;
    } else if (
      // Tarjuman rule 1 — see the header comment.
      provider.id === EMAIL_CODE_PROVIDER_ID &&
      typeof profile.email === "string"
    ) {
      userId = (await uniqueUserWithEmail(ctx, profile.email))?._id ?? null;
    } else {
      userId = null;
    }
  }

  const userData = {
    ...(emailVerified ? { emailVerificationTime: Date.now() } : null),
    ...(phoneVerified ? { phoneVerificationTime: Date.now() } : null),
    ...profile,
  } as Partial<WithoutSystemFields<Doc<"users">>>;

  if (userId !== null) {
    try {
      await ctx.db.patch("users", userId, userData);
    } catch (error) {
      throw new Error(
        `Could not update user document with ID \`${userId}\`, ` +
          `either the user has been deleted but their account has not, ` +
          `or the profile data doesn't match the \`users\` table schema: ` +
          `${(error as Error).message}`,
      );
    }
    return userId;
  }
  return await ctx.db.insert(
    "users",
    userData as WithoutSystemFields<Doc<"users">>,
  );
}

/** Users sharing an email — a handful at most, so a small bounded read. */
async function usersWithEmail(
  ctx: MutationCtx,
  email: string,
): Promise<Doc<"users">[]> {
  return await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .take(10);
}

async function uniqueUserWithVerifiedEmail(
  ctx: MutationCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  const verified = (await usersWithEmail(ctx, email)).filter(
    (u) => u.emailVerificationTime !== undefined,
  );
  return verified.length === 1 ? verified[0] : null;
}

async function firstUserWithVerifiedEmail(
  ctx: MutationCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  return (
    (await usersWithEmail(ctx, email)).find(
      (u) => u.emailVerificationTime !== undefined,
    ) ?? null
  );
}

async function uniqueUserWithEmail(
  ctx: MutationCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  const users = await usersWithEmail(ctx, email);
  return users.length === 1 ? users[0] : null;
}

async function uniqueUserWithVerifiedPhone(
  ctx: MutationCtx,
  phone: string,
): Promise<Doc<"users"> | null> {
  const verified = (
    await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .take(10)
  ).filter((u) => u.phoneVerificationTime !== undefined);
  return verified.length === 1 ? verified[0] : null;
}
