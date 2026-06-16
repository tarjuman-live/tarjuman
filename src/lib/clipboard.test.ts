import { describe, it, expect, vi, afterEach } from "vitest";
import { copyToClipboard } from "./clipboard";

// Build a minimal fake `document` good enough for the execCommand fallback.
function makeFakeDom(execResult: boolean) {
  const textarea = {
    value: "",
    setAttribute: vi.fn(),
    style: {} as Record<string, string>,
    setSelectionRange: vi.fn(),
    focus: vi.fn(),
  };
  const selection = {
    rangeCount: 0,
    getRangeAt: vi.fn(),
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  };
  const doc = {
    createElement: vi.fn(() => textarea),
    getSelection: vi.fn(() => selection),
    createRange: vi.fn(() => ({ selectNodeContents: vi.fn() })),
    execCommand: vi.fn(() => execResult),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  };
  return { doc, textarea, selection };
}

describe("copyToClipboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns false for empty text without touching any API", async () => {
    expect(await copyToClipboard("")).toBe(false);
  });

  it("uses the async Clipboard API when it works", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { doc } = makeFakeDom(true);
    vi.stubGlobal("document", doc);

    expect(await copyToClipboard("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    // The fallback must NOT run when the async API succeeds.
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the async API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { doc } = makeFakeDom(true);
    vi.stubGlobal("document", doc);

    expect(await copyToClipboard("hello")).toBe(true);
    expect(writeText).toHaveBeenCalled();
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
    // Always cleans up the temporary textarea.
    expect(doc.body.removeChild).toHaveBeenCalled();
  });

  it("falls back when the async API is absent entirely", async () => {
    vi.stubGlobal("navigator", {}); // no .clipboard
    const { doc } = makeFakeDom(true);
    vi.stubGlobal("document", doc);

    expect(await copyToClipboard("hello")).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false (no silent success) when every strategy fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { doc } = makeFakeDom(false); // execCommand returns false
    vi.stubGlobal("document", doc);

    expect(await copyToClipboard("hello")).toBe(false);
    expect(doc.body.removeChild).toHaveBeenCalled(); // still cleaned up
  });
});
