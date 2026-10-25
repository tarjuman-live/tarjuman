/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("waitlist.join", () => {
  it("stores a normalized address once, however often it's submitted", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.waitlist.join, { email: "  Someone@Example.org ", locale: "fr" });
    await t.mutation(api.waitlist.join, { email: "someone@example.org" });
    const rows = await t.run((ctx) => ctx.db.query("waitlist").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "someone@example.org", locale: "fr" });
  });

  it("rejects something that isn't an email", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.waitlist.join, { email: "not-an-email" })).rejects.toThrow(
      /invalid_email/,
    );
    const rows = await t.run((ctx) => ctx.db.query("waitlist").collect());
    expect(rows).toHaveLength(0);
  });

  it("refuses a flood of new addresses within a minute", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 30; i++) {
      await t.mutation(api.waitlist.join, { email: `bot${i}@example.org` });
    }
    await expect(t.mutation(api.waitlist.join, { email: "bot31@example.org" })).rejects.toThrow(
      /busy/,
    );
  });
});
