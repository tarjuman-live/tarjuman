import { describe, expect, it } from "vitest";
import type { LiveSegment } from "@/types";
import { stopTailSegment, takeFlushableSegments } from "./recording-persistence";

const seg = (id: string, text = "الحمد لله رب العالمين"): LiveSegment => ({
  id,
  text,
  isFinal: true,
  timestamp: 1,
});

describe("takeFlushableSegments", () => {
  const base = () => ({
    segments: [seg("a"), seg("b"), seg("c")],
    flushed: new Set<string>(),
    filteredIds: new Set(["c"]),
    completedIds: new Set(["a"]),
    errorIds: new Set<string>(),
    translations: { a: "All praise", b: "partial…" },
    merges: {},
    sameLanguage: false,
    force: false,
  });

  it("persists only completed translations on a tick and never filtered noise", () => {
    const input = base();
    const out = takeFlushableSegments(input);
    expect(out.map((s) => s.id)).toEqual(["a"]);
    expect(out[0].translatedText).toBe("All praise");
    // Idempotent: a second tick writes nothing new.
    expect(takeFlushableSegments(input)).toEqual([]);
    // Once b lands, the filtered c behind it is passed over, never written.
    input.completedIds.add("b");
    expect(takeFlushableSegments(input).map((s) => s.id)).toEqual(["b"]);
    expect(input.flushed.has("c")).toBe(true);
  });

  it("force-flushes in-flight finals on Stop — source-only, never the partial", () => {
    const input = { ...base(), force: true };
    const out = takeFlushableSegments(input);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out[1].translatedText).toBe(""); // not the streamed "partial…"
  });

  it("keeps saved order: nothing after a segment still translating", () => {
    const input = {
      ...base(),
      segments: [seg("a"), seg("b"), seg("d")],
      completedIds: new Set(["a", "d"]),
      translations: { a: "One", b: "partial…", d: "Three" },
    };
    expect(takeFlushableSegments(input).map((s) => s.id)).toEqual(["a"]);
    // b completes → b and d land together, in order.
    input.completedIds.add("b");
    input.translations.b = "Two";
    expect(takeFlushableSegments(input).map((s) => s.id)).toEqual(["b", "d"]);
  });

  it("saves a failed translation source-only instead of blocking the rest", () => {
    const input = {
      ...base(),
      segments: [seg("a"), seg("b"), seg("d")],
      completedIds: new Set(["a", "d"]),
      errorIds: new Set(["b"]),
      translations: { a: "One", d: "Three" },
    };
    const out = takeFlushableSegments(input);
    expect(out.map((s) => [s.id, s.translatedText])).toEqual([
      ["a", "One"],
      ["b", ""],
      ["d", "Three"],
    ]);
  });
});

describe("stopTailSegment", () => {
  const id = () => "t";
  it("rescues a real multi-word source tail, source-only", () => {
    expect(stopTailSegment(" اللهم اغفر لنا ", "ar", 42, id)).toEqual({
      id: "t",
      sourceText: "اللهم اغفر لنا",
      translatedText: "",
      timestamp: 42,
    });
  });
  it("drops one-word and off-language tails", () => {
    expect(stopTailSegment("اللهم", "ar", 1, id)).toBeNull();
    expect(stopTailSegment("hello everyone here", "ar", 1, id)).toBeNull();
  });
});
