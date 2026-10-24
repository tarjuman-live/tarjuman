"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * The ambient green light behind the hero.
 *
 * Baseline (always rendered): `.hero-glow` — a CSS radial gradient with a 16s
 * drift keyframe. It ships in the HTML, costs nothing, and is the complete
 * presentation on its own.
 *
 * Enhancement (desktop only): a small WebGL quad drawing the same falloff with
 * organic noise. It is a SEPARATE CHUNK that is never even requested unless
 * every gate below passes, so phones — the majority of this app's traffic —
 * download none of three/R3F/drei.
 */

const CssGlow = () => (
  <div
    aria-hidden
    className="hero-glow pointer-events-none absolute left-1/2 top-1/3 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full"
    style={{
      background:
        "radial-gradient(circle, rgba(46,204,113,0.16), rgba(46,204,113,0) 70%)",
    }}
  />
);

// The loading fallback IS the baseline, so there is never a blank frame and a
// failed/blocked chunk degrades to exactly what shipped before.
const HeroGlow3D = dynamic(() => import("./hero-glow-3d"), {
  ssr: false,
  loading: () => <CssGlow />,
});

/**
 * Can this browser actually create a WebGL context? Hover + core count say
 * nothing about a desktop with hardware acceleration off, a blocklisted GPU or
 * a hardened browser — there three.js threw an unhandled "Error creating WebGL
 * context" and the hero lost its glow entirely. The probe context is released
 * immediately.
 */
function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function HeroGlow() {
  const [use3d, setUse3d] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const check = () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // `(hover: none)` is the honest proxy for "phone or tablet". This is a
      // mobile-first app used in masjids and lecture halls; a decorative WebGL
      // context is the wrong thing to spend a stranger's battery on.
      const coarse = window.matchMedia("(hover: none)").matches;
      const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
      setUse3d(!reduce && !coarse && !weak && canUseWebGL());
    };

    check();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener?.("change", check);
    return () => mq.removeEventListener?.("change", check);
  }, []);

  return use3d ? <HeroGlow3D /> : <CssGlow />;
}
