/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  createOrUpdateUser,
  type CreateOrUpdateUserArgs,
} from "./authLinking";
import { CODE_SEND_LIMIT, CODE_SEND_WINDOW_MS } from "./authThrottle";

const modules = import.meta.glob("./**/*.ts");

type T = ReturnType<typeof convexTest>;

const PASSWORD = { id: "password", type: "credentials" };
const EMAIL_CODE = { id: "email-code", type: "email" };
const RESET = { id: "password-reset", type: "email" };
const GOOGLE = { id: "google", type: "oidc" };

const HOUR = 60 * 60 * 1000;

let t: T;
beforeEach(() => {
  t = convexTest(schema, modules);
});
afterEach(() => {
  vi.useRealTimers();
});

function call(args: Partial<CreateOrUpdateUserArgs> & Pick<CreateOrUpdateUserArgs, "type" | "provider" | "profile">) {
  return t.run((ctx) =>
    createOrUpdateUser(ctx, { existingUserId: null, ...args }),
  );
}

/** The code-SEND step, as Convex Auth calls the callback for it. */
const sendCode = (email: string, provider = EMAIL_CODE) =>
  call({ type: "email", provider, profile: { email } });

async function makeUser(
  email: string,
  opts: { verified?: boolean } = {},
): Promise<Id<"users">> {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      ...(opts.verified ? { emailVerificationTime: Date.now() } : {}),
    }),
  );
}

async function addAccount(userId: Id<"users">, provider: string, id: string) {
  return await t.run((ctx) =>
    ctx.db.insert("authAccounts", {
      userId,
      provider,
      providerAccountId: id,
    }),
  );
}

async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return (e.data as { code?: string }).code;
    throw e;
  }
  return undefined;
}

describe("createOrUpdateUser — library default preserved", () => {
  it("a password sign-up creates a new, unverified user", async () => {
    const id = await call({
      type: "credentials",
      provider: PASSWORD,
      profile: { email: "a@x.com" },
    });
    const user = await t.run((ctx) => ctx.db.get("users", id));
    expect(user?.email).toBe("a@x.com");
    expect(user?.emailVerificationTime).toBeUndefined();
  });

  it("a password sign-up never links to an existing unverified user", async () => {
    const existing = await makeUser("a@x.com");
    const id = await call({
      type: "credentials",
      provider: PASSWORD,
      profile: { email: "a@x.com" },
    });
    expect(id).not.toBe(existing);
  });

  it("a new Google account links to the verified user with that email", async () => {
    const existing = await makeUser("g@x.com", { verified: true });
    const id = await call({
      type: "oauth",
      provider: GOOGLE,
      profile: { email: "g@x.com", name: "G" },
    });
    expect(id).toBe(existing);
  });

  it("an existing account's user is patched, not re-resolved", async () => {
    const existing = await makeUser("v@x.com");
    const id = await call({
      existingUserId: existing,
      type: "verification",
      provider: EMAIL_CODE,
      profile: { email: "v@x.com", emailVerified: true },
    });
    expect(id).toBe(existing);
    const user = await t.run((ctx) => ctx.db.get("users", existing));
    expect(user?.emailVerificationTime).toBeTypeOf("number");
  });
});

describe("createOrUpdateUser — email code", () => {
  it("links to an existing password user, who becomes verified on code entry", async () => {
    const pw = await makeUser("p@x.com");
    await addAccount(pw, "password", "p@x.com");

    const atSend = await sendCode("p@x.com");
    expect(atSend).toBe(pw);
    let user = await t.run((ctx) => ctx.db.get("users", pw));
    // Sending alone proves nothing.
    expect(user?.emailVerificationTime).toBeUndefined();

    await call({
      existingUserId: atSend,
      type: "verification",
      provider: EMAIL_CODE,
      profile: { email: "p@x.com", emailVerified: true },
    });
    user = await t.run((ctx) => ctx.db.get("users", pw));
    expect(user?.emailVerificationTime).toBeTypeOf("number");
  });

  it("links to an existing Google (verified) user", async () => {
    const g = await makeUser("g@x.com", { verified: true });
    expect(await sendCode("g@x.com")).toBe(g);
  });

  it("creates a new user for a new email", async () => {
    await makeUser("someone-else@x.com");
    const id = await sendCode("new@x.com");
    const user = await t.run((ctx) => ctx.db.get("users", id));
    expect(user?.email).toBe("new@x.com");
  });

  it("does not link when two unverified users share the email", async () => {
    const a = await makeUser("d@x.com");
    const b = await makeUser("d@x.com");
    const id = await sendCode("d@x.com");
    expect([a, b]).not.toContain(id);
  });
});

describe("createOrUpdateUser — no duplicate password sign-up", () => {
  it("refuses a password sign-up for an email a verified user owns", async () => {
    await makeUser("v@x.com", { verified: true });
    const code = await errorCode(
      call({
        type: "credentials",
        provider: PASSWORD,
        profile: { email: "v@x.com" },
      }),
    );
    expect(code).toBe("email_in_use");
  });
});

describe("code send limit", () => {
  it(`allows ${CODE_SEND_LIMIT} sends per window, refuses the next, recovers after`, async () => {
    vi.useFakeTimers();
    for (let i = 0; i < CODE_SEND_LIMIT; i++) {
      expect(await errorCode(sendCode("s@x.com"))).toBeUndefined();
    }
    expect(await errorCode(sendCode("s@x.com"))).toBe("too_many_codes");
    // Password-reset codes count against the same address.
    expect(await errorCode(sendCode("s@x.com", RESET))).toBe("too_many_codes");
    // Other addresses are unaffected.
    expect(await errorCode(sendCode("other@x.com"))).toBeUndefined();

    vi.advanceTimersByTime(CODE_SEND_WINDOW_MS + 1000);
    expect(await errorCode(sendCode("s@x.com"))).toBeUndefined();
  });

  it("a refused send writes nothing (the code already sent stays valid)", async () => {
    for (let i = 0; i < CODE_SEND_LIMIT; i++) await sendCode("r@x.com");
    const before = await t.run((ctx) => ctx.db.query("authCodeSends").collect());
    await errorCode(sendCode("r@x.com"));
    const after = await t.run((ctx) => ctx.db.query("authCodeSends").collect());
    expect(after.length).toBe(before.length);
  });
});

describe("pruneAuthCodes", () => {
  it("removes only abandoned email-code sign-ups in the 24–72h band", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));

    // Abandoned: email-code account only, never verified, no session.
    const abandoned = await sendCode("gone@x.com");
    await addAccount(abandoned, "email-code", "gone@x.com");
    // Password user who requested a code — has another account.
    const pw = await makeUser("pw@x.com");
    await addAccount(pw, "password", "pw@x.com");
    await addAccount(pw, "email-code", "pw@x.com");
    // Verified via code.
    const verified = await makeUser("ok@x.com", { verified: true });
    await addAccount(verified, "email-code", "ok@x.com");
    // Unverified but did open a session.
    const withSession = await makeUser("s@x.com");
    await addAccount(withSession, "email-code", "s@x.com");
    await t.run((ctx) =>
      ctx.db.insert("authSessions", {
        userId: withSession,
        expirationTime: Date.now() + HOUR,
      }),
    );

    vi.advanceTimersByTime(30 * HOUR);
    // Too young to judge.
    const fresh = await sendCode("fresh@x.com");
    await addAccount(fresh, "email-code", "fresh@x.com");

    await t.mutation(internal.authThrottle.pruneAuthCodes, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const ids = (await t.run((ctx) => ctx.db.query("users").collect())).map(
      (u) => u._id,
    );
    expect(ids).not.toContain(abandoned);
    expect(ids).toEqual(
      expect.arrayContaining([pw, verified, withSession, fresh]),
    );
    // Day-old send-log rows are pruned too; the fresh one stays.
    const sends = await t.run((ctx) => ctx.db.query("authCodeSends").collect());
    expect(sends.map((s) => s.identifier)).toEqual(["fresh@x.com"]);
  });
});
