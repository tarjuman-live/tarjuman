import { describe, it, expect } from "vitest";
import { convexErrorText } from "./convex-error";

describe("convexErrorText", () => {
  it("returns a plain Error's message", () => {
    expect(convexErrorText(new Error("[CONVEX A(auth:signIn)] Server Error"))).toBe(
      "[CONVEX A(auth:signIn)] Server Error",
    );
  });

  it("appends a ConvexError's string data, which survives prod redaction", () => {
    const e = Object.assign(new Error("[CONVEX A(auth:signIn)] Server Error"), {
      data: "TooManyFailedAttempts",
    });
    expect(convexErrorText(e)).toBe("[CONVEX A(auth:signIn)] Server Error\nTooManyFailedAttempts");
  });

  it("ignores non-string data", () => {
    const e = Object.assign(new Error("boom"), { data: { code: 1 } });
    expect(convexErrorText(e)).toBe("boom");
  });

  it("stringifies non-Error throws", () => {
    expect(convexErrorText("fetch failed")).toBe("fetch failed");
  });
});
