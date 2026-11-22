import { useEffect, useRef } from "react";
import type { AudioEngine } from "../audio/engine";
import type { AnalysisFrame } from "../analysis/pipeline";

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: AnalysisFrame | null,
  engine: AudioEngine,
) => void;

/** HiDPI canvas that redraws on every analysis frame (and once when idle). */
export function useEngineCanvas(engine: AudioEngine, draw: DrawFn) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(engine.latest);
    };
    const paint = (f: AnalysisFrame | null) => {
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h, f, engine);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const unsub = engine.subscribe((f) => paint(f));
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [engine]);

  return ref;
}

export const pcColor = (p: number, l = 62, a = 1) => `hsla(${(p * 30 + 170) % 360}, 75%, ${l}%, ${a})`;
