import { describe, expect, it } from "vitest";
import { costMicroUsd, formatMicroUsd, MODEL_RATES } from "./pricing";

describe("costMicroUsd", () => {
  it("prices Haiku 4.5 input + output ($1 / $5 per MTok)", () => {
    // 1,000 in × 1 µ$ + 200 out × 5 µ$ = 2,000 µ$ = $0.002
    expect(
      costMicroUsd("claude-haiku-4-5-20251001", {
        inputTokens: 1000,
        outputTokens: 200,
      }),
    ).toBe(2000);
  });

  it("prices cache reads at 0.1× and 5-minute cache writes at 1.25× input", () => {
    // Sonnet 5: $2 in → reads $0.20, writes $2.50 per MTok.
    expect(
      costMicroUsd("claude-sonnet-5", {
        cacheReadTokens: 10_000,
        cacheWriteTokens: 1_000,
      }),
    ).toBe(10_000 * 0.2 + 1_000 * 2.5);
  });

  it("treats input_tokens as the uncached remainder only", () => {
    const mixed = costMicroUsd("claude-sonnet-5", {
      inputTokens: 500,
      cacheReadTokens: 4_000,
      outputTokens: 300,
    });
    expect(mixed).toBe(Math.round(500 * 2 + 4_000 * 0.2 + 300 * 10));
  });

  it("returns null for an unknown or missing model (shown as unpriced)", () => {
    expect(costMicroUsd("claude-made-up-9", { inputTokens: 10 })).toBeNull();
    expect(costMicroUsd(undefined, { inputTokens: 10 })).toBeNull();
  });

  it("covers every model the API routes actually call", () => {
    for (const model of ["claude-haiku-4-5-20251001", "claude-sonnet-5"]) {
      expect(MODEL_RATES[model]).toBeDefined();
    }
  });
});

describe("formatMicroUsd", () => {
  it("formats small and large amounts readably", () => {
    expect(formatMicroUsd(null)).toBe("—");
    expect(formatMicroUsd(0)).toBe("$0");
    expect(formatMicroUsd(2000)).toBe("$0.0020");
    expect(formatMicroUsd(1_234_567)).toBe("$1.23");
    expect(formatMicroUsd(250_000_000)).toBe("$250");
  });
});
