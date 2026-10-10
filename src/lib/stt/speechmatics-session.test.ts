import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSegment } from "@/types";
import { startSpeechmaticsSession } from "./speechmatics-session";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  send(data: unknown) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason: "" });
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  msg(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const word = (
  content: string,
  start: number,
  opts: { conf?: number; speaker?: string; eos?: boolean } = {},
) => ({
  type: "word",
  start_time: start,
  end_time: start + 0.4,
  is_eos: opts.eos,
  alternatives: [
    { content, confidence: opts.conf ?? 0.98, speaker: opts.speaker ?? "S1" },
  ],
});
const punct = (content: string, t: number) => ({
  type: "punctuation",
  start_time: t,
  end_time: t,
  is_eos: true,
  alternatives: [{ content }],
});

function setup(
  over: { lang?: string; paused?: boolean; credsStatus?: number } = {},
) {
  const sockets: FakeSocket[] = [];
  const segments: LiveSegment[] = [];
  const states: string[] = [];
  const errors: (string | null)[] = [];
  let interim = "";
  let paused = over.paused ?? false;
  const fetchCredentials = vi.fn(
    async () =>
      over.credsStatus
        ? new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: over.credsStatus,
          })
        : new Response(JSON.stringify({ jwt: "j", url: "wss://sm" }), {
            status: 200,
          }),
  );
  const session = startSpeechmaticsSession({
    sourceLanguage: over.lang ?? "ar",
    getSampleRate: () => 48000,
    fetchCredentials,
    isPaused: () => paused,
    isMainSpeakerOnly: () => true,
    onSegment: (s) => segments.push(s),
    onInterim: (t) => (interim = t),
    onState: (s) => states.push(s),
    onError: (e) => errors.push(e),
    onReconnectAttempt: () => {},
    createWebSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s as unknown as WebSocket;
    },
    makeId: () => `id${segments.length}`,
  });
  return {
    session,
    sockets,
    segments,
    states,
    errors,
    fetchCredentials,
    interim: () => interim,
    setPaused: (p: boolean) => (paused = p),
  };
}

async function connected(t: ReturnType<typeof setup>) {
  await vi.waitFor(() => expect(t.sockets.length).toBe(1));
  const ws = t.sockets[0];
  ws.open();
  ws.msg({ message: "RecognitionStarted" });
  return ws;
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("speechmatics session core", () => {
  it("declares the real capture sample rate and keyterms in StartRecognition", async () => {
    const t = setup();
    const ws = await connected(t);
    expect(ws.url).toBe("wss://sm?jwt=j");
    const start = JSON.parse(ws.sent[0] as string);
    expect(start.message).toBe("StartRecognition");
    expect(start.audio_format).toEqual({
      type: "raw",
      encoding: "pcm_s16le",
      sample_rate: 48000,
    });
    expect(start.transcription_config.language).toBe("ar");
    expect(start.transcription_config.operating_point).toBe("enhanced");
    expect(start.transcription_config.additional_vocab.length).toBeGreaterThan(0);
  });

  it("drops frames before RecognitionStarted and while paused", async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.sockets.length).toBe(1));
    const ws = t.sockets[0];
    ws.open();
    t.session.sendFrame(new ArrayBuffer(8)); // pre-ack
    expect(ws.sent.length).toBe(1); // only StartRecognition
    ws.msg({ message: "RecognitionStarted" });
    t.session.sendFrame(new ArrayBuffer(8));
    expect(ws.sent.length).toBe(2);
    t.setPaused(true);
    t.session.sendFrame(new ArrayBuffer(8));
    expect(ws.sent.length).toBe(2);
  });

  it("accumulates words into one sentence and flushes on is_eos", async () => {
    const t = setup();
    const ws = await connected(t);
    ws.msg({
      message: "AddTranscript",
      results: [word("الحمد", 1), word("لله", 1.5)],
    });
    expect(t.segments).toHaveLength(0);
    expect(t.interim()).toBe("الحمد لله");
    ws.msg({ message: "AddTranscript", results: [punct(".", 2)] });
    expect(t.segments).toHaveLength(1);
    expect(t.segments[0].text).toBe("الحمد لله.");
    expect(t.segments[0].timestamp).toBe(1);
    expect(t.interim()).toBe("");
  });

  it("never emits a punctuation-only segment", async () => {
    const t = setup();
    const ws = await connected(t);
    ws.msg({
      message: "AddTranscript",
      results: [word("الحمد", 1), word("لله", 1.5, { eos: true })],
    });
    ws.msg({ message: "AddTranscript", results: [punct(".", 2)] });
    expect(t.segments.map((s) => s.text)).toEqual(["الحمد لله"]);
  });

  it("drops low-confidence and off-language sentences", async () => {
    const t = setup();
    const ws = await connected(t);
    ws.msg({
      message: "AddTranscript",
      results: [word("الحمد", 1, { conf: 0.2 }), punct(".", 1.5)],
    });
    ws.msg({
      message: "AddTranscript",
      results: [word("hello", 2), word("everyone", 2.5), punct(".", 3)],
    });
    expect(t.segments).toHaveLength(0);
  });

  it("flushes the pending sentence on stop and sends EndOfStream", async () => {
    const t = setup();
    const ws = await connected(t);
    ws.msg({ message: "AddTranscript", results: [word("بسم", 1)] });
    t.session.stop();
    expect(t.segments.map((s) => s.text)).toEqual(["بسم"]);
    expect(JSON.parse(ws.sent.at(-1) as string).message).toBe("EndOfStream");
  });

  it("treats a 401 credential response as terminal, not a retry loop", async () => {
    const t = setup({ credsStatus: 401 });
    await vi.waitFor(() => expect(t.states.at(-1)).toBe("error"));
    expect(t.errors.at(-1)).toBe("Unauthorized");
    expect(t.fetchCredentials).toHaveBeenCalledTimes(1);
    expect(t.sockets).toHaveLength(0);
  });

  it("treats a 4001 close as terminal", async () => {
    const t = setup();
    const ws = await connected(t);
    ws.close(4001);
    expect(t.states.at(-1)).toBe("error");
    expect(t.errors.at(-1)).toMatch(/rejected/);
  });

  it("reconnects on an abnormal close and keeps timestamps monotonic", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t = setup();
    const ws = await connected(t);
    ws.msg({
      message: "AddTranscript",
      results: [word("الحمد", 10), word("لله", 10.5), punct(".", 11)],
    });
    ws.close(1011);
    expect(t.states.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1100);
    await vi.waitFor(() => expect(t.sockets.length).toBe(2));
    const ws2 = t.sockets[1];
    ws2.open();
    ws2.msg({ message: "RecognitionStarted" });
    // The new socket's clock restarts at 0.
    ws2.msg({
      message: "AddTranscript",
      results: [word("رب", 0.2), word("العالمين", 0.6), punct(".", 1)],
    });
    expect(t.segments).toHaveLength(2);
    expect(t.segments[1].timestamp).toBeGreaterThan(t.segments[0].timestamp);
    expect(t.fetchCredentials).toHaveBeenCalledTimes(2);
  });
});
