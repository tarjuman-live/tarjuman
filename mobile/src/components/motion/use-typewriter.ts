/**
 * Typewriter drain pump — mirror of the summary reveal in
 * src/components/session/session-body.tsx. Network chunks go into a buffer
 * (pump 1); a 16ms interval (pump 2) moves
 *   take = min(buffer.length, max(10, ceil(buffer.length / 6)), 48)
 * characters per tick to the screen: ≥ ~625 chars/s, ≤ ~3000 chars/s, so a
 * trickle glides and a burst flows in without dumping. setInterval (not rAF)
 * keeps chars/sec identical on 120Hz ProMotion. Not gated by Reduce Motion.
 *
 * Hook:
 *   const tw = useTypewriter();
 *   tw.reset();                              // new run
 *   for await (chunk) tw.push(chunk);        // pump 1 (expo/fetch reader)
 *   const full = await tw.finish();          // stream done → resolves when drained
 *   tw.set(verifiedText);                    // one-shot snap replace (citations pass)
 *   <Markdown>{tw.text}</Markdown>           // tw.started: first tick happened
 *
 * Pure (no React): createTypewriterPump(onText) → { push, finish, set, cancel, reset }.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TYPEWRITER } from "~/lib/motion";

export interface TypewriterPump {
  push: (chunk: string) => void;
  /** Mark the stream done; resolves with the full text once fully drained. */
  finish: () => Promise<string>;
  /** Snap the displayed text (clears the buffer). */
  set: (text: string) => void;
  /** Stop ticking (error / unmount); keeps what's displayed. */
  cancel: () => void;
  /** Clear everything for a new run. */
  reset: () => void;
  displayed: () => string;
}

export function createTypewriterPump(onText: (displayed: string) => void): TypewriterPump {
  let buffer = "";
  let displayed = "";
  let done = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let waiters: ((s: string) => void)[] = [];

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const settle = () => {
    const w = waiters;
    waiters = [];
    w.forEach((r) => r(displayed));
  };
  const tick = () => {
    if (buffer.length > 0) {
      const take = Math.min(
        buffer.length,
        Math.max(TYPEWRITER.minPerTick, Math.ceil(buffer.length / TYPEWRITER.backlogDivisor)),
        TYPEWRITER.maxPerTick
      );
      displayed += buffer.slice(0, take);
      buffer = buffer.slice(take);
      onText(displayed);
    } else if (done) {
      stop();
      settle();
    }
  };
  const ensure = () => {
    if (!timer) timer = setInterval(tick, TYPEWRITER.tickMs);
  };

  return {
    push(chunk) {
      if (!chunk) return;
      buffer += chunk;
      ensure();
    },
    finish() {
      done = true;
      return new Promise<string>((resolve) => {
        waiters.push(resolve);
        if (buffer.length === 0) {
          stop();
          settle();
        } else ensure();
      });
    },
    set(text) {
      buffer = "";
      displayed = text;
      onText(displayed);
    },
    cancel() {
      stop();
      done = true;
      settle();
    },
    reset() {
      stop();
      buffer = "";
      displayed = "";
      done = false;
      settle();
      onText("");
    },
    displayed: () => displayed,
  };
}

export function useTypewriter() {
  const [text, setText] = useState("");
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const pump = useMemo(
    () =>
      createTypewriterPump((d) => {
        if (d && !startedRef.current) {
          startedRef.current = true;
          setStarted(true);
        }
        setText(d);
      }),
    []
  );
  useEffect(() => () => pump.cancel(), [pump]);

  const reset = useCallback(() => {
    startedRef.current = false;
    setStarted(false);
    pump.reset();
  }, [pump]);

  return {
    text,
    /** True once the first characters hit the screen (web: loading → card swap). */
    started,
    push: pump.push,
    finish: pump.finish,
    set: pump.set,
    cancel: pump.cancel,
    reset,
  };
}
