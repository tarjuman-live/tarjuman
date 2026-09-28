import { describe, expect, it, vi } from "vitest";
import { META_SENTINEL, translateSegment } from "./translate-client";

const req = { text: "الحمد لله", source: "ar", target: "en" };

function streamResponse(chunks: string[], status = 200) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status },
  );
}

describe("translateSegment", () => {
  it("streams prose, hides the sentinel, and parses the trailer", async () => {
    const partials: string[] = [];
    const trailer = JSON.stringify({ translatedText: "All praise is due to Allah" });
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        "All praise is due to Allah",
        META_SENTINEL.slice(0, 5),
        META_SENTINEL.slice(5) + trailer,
      ]),
    );
    const out = await translateSegment(req, {
      url: "/api/translate",
      fetchImpl,
      onPartial: (p) => partials.push(p),
    });
    expect(out).toEqual({ kind: "ok", translatedText: "All praise is due to Allah" });
    expect(partials.every((p) => !p.includes("␞"))).toBe(true);
  });

  it("reads a whole-text body when no stream is available (plain RN fetch)", async () => {
    const res = new Response(JSON.stringify({ filtered: true }));
    Object.defineProperty(res, "body", { value: null });
    const out = await translateSegment(req, {
      url: "https://x/api/translate",
      fetchImpl: vi.fn(async () => res),
    });
    expect(out).toEqual({ kind: "filtered" });
  });

  it("fails open to blank on meta-commentary or empty text", async () => {
    const out = await translateSegment(req, {
      url: "/api/translate",
      fetchImpl: vi.fn(async () =>
        streamResponse([JSON.stringify({ translatedText: "" })]),
      ),
    });
    expect(out).toEqual({ kind: "blank" });
  });

  it("retries a transient 503 but not a 401", async () => {
    const flaky = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        streamResponse([JSON.stringify({ translatedText: "ok" })]),
      );
    expect(
      await translateSegment(req, { url: "/api/translate", fetchImpl: flaky }),
    ).toEqual({ kind: "ok", translatedText: "ok" });
    expect(flaky).toHaveBeenCalledTimes(2);

    const denied = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    expect(
      await translateSegment(req, { url: "/api/translate", fetchImpl: denied }),
    ).toEqual({ kind: "error", message: "Unauthorized" });
    expect(denied).toHaveBeenCalledTimes(1);
  });
});
