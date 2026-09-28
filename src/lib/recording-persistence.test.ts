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
    expect(input.flushed.has("c")).toBe(true);
    // Idempotent: a second tick writes nothing new.
    expect(takeFlushableSegments(input)).toEqual([]);
  });

  it("force-flushes in-flight finals on Stop", () => {
    const input = { ...base(), force: true };
    const out = takeFlushableSegments(input);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
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
