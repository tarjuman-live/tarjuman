/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type T = ReturnType<typeof convexTest>;

/**
 * The real Convex Auth sign-in action, end to end, for the "email-code"
 * provider: send → verify → signed in. With RESEND_API_KEY unset, authEmail.ts
 * logs the code instead of emailing it — the test reads it from there.
 */

async function pkcs8Pem(): Promise<string> {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
}

let jwtKey: string;
let t: T;
let logged: string[];

beforeEach(async () => {
  jwtKey ??= await pkcs8Pem();
  vi.stubEnv("JWT_PRIVATE_KEY", jwtKey);
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("RESEND_API_KEY", "");
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  t = convexTest(schema, modules);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function lastCode(email: string): string {
  const line = [...logged]
    .reverse()
    .find((l) => l.includes(`signin code for ${email} is:`));
  const code = line?.match(/is: (\d{6})/)?.[1];
  if (!code) throw new Error(`no code logged for ${email}`);
  return code;
}

const signIn = (params: Record<string, string>) =>
  t.action(api.auth.signIn, { provider: "email-code", params });

describe("email-code sign-in (real Convex Auth flow)", () => {
  it("send → verify signs in and marks the email verified", async () => {
    expect(await signIn({ email: "new@x.com" })).toEqual({ started: true });
    const code = lastCode("new@x.com");
    expect(code).toMatch(/^\d{6}$/);

    const res = await signIn({ email: "new@x.com", code });
    expect(res.tokens?.token).toBeTruthy();

    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("new@x.com");
    expect(users[0].emailVerificationTime).toBeTypeOf("number");
  });

  it("a wrong code is refused, and the right one still works after", async () => {
    await signIn({ email: "w@x.com" });
    const code = lastCode("w@x.com");
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(signIn({ email: "w@x.com", code: wrong })).rejects.toThrow(
      /Could not verify code/,
    );
    const res = await signIn({ email: "w@x.com", code });
    expect(res.tokens?.token).toBeTruthy();
  });

  it("a code only works with the email it was sent to", async () => {
    await signIn({ email: "a@x.com" });
    const code = lastCode("a@x.com");
    await expect(signIn({ email: "b@x.com", code })).rejects.toThrow();
  });

  it("a later password sign-up for that email is refused, not duplicated", async () => {
    await signIn({ email: "v@x.com" });
    await signIn({ email: "v@x.com", code: lastCode("v@x.com") });

    const err = await t
      .action(api.auth.signIn, {
        provider: "password",
        params: { email: "v@x.com", password: "a-long-password", flow: "signUp" },
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<{ code: string }>).data.code).toBe("email_in_use");
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
  });

  it("an existing password user signs into their own account", async () => {
    const pw = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "p@x.com" });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "password",
        providerAccountId: "p@x.com",
        secret: "irrelevant",
      });
      return userId;
    });

    await signIn({ email: "p@x.com" });
    const res = await signIn({ email: "p@x.com", code: lastCode("p@x.com") });
    expect(res.tokens?.token).toBeTruthy();

    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.map((u) => u._id)).toEqual([pw]);
    const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
    expect(sessions.map((s) => s.userId)).toEqual([pw]);
  });
});
