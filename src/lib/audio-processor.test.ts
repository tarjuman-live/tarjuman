import { describe, it, expect } from "vitest";
import { mapMicError, MicPermissionError } from "./audio-processor";

// getUserMedia rejects with a DOMException; we only read .name/.message, so a
// plain object is a faithful stand-in for the non-passthrough cases.
function domEx(name: string, message = ""): DOMException {
  return { name, message } as DOMException;
}

describe("mapMicError", () => {
  it("maps permission errors to MicPermissionError", () => {
    for (const n of [
      "NotAllowedError",
      "PermissionDeniedError",
      "SecurityError",
    ]) {
      expect(mapMicError(domEx(n))).toBeInstanceOf(MicPermissionError);
    }
  });

  it("maps no-device errors to an actionable 'no microphone' message", () => {
    for (const n of ["NotFoundError", "DevicesNotFoundError"]) {
      const msg = mapMicError(domEx(n)).message;
      expect(msg).toMatch(/no microphone found/i);
      expect(msg).toMatch(/try again/i);
      // Never leak the cryptic raw browser string.
      expect(msg).not.toMatch(/requested device not found/i);
    }
  });

  it("maps in-use / hardware errors to a 'busy' message", () => {
    for (const n of ["NotReadableError", "TrackStartError", "AbortError"]) {
      expect(mapMicError(domEx(n)).message).toMatch(/busy/i);
    }
  });

  it("passes a genuine unknown Error through unchanged", () => {
    const e = Object.assign(new Error("something odd"), { name: "WeirdError" });
    expect(mapMicError(e as unknown as DOMException)).toBe(e);
  });
});
