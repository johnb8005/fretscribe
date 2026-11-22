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

/** Same values as the Tailwind theme, for canvas drawing. */
export const C = {
  rosewood: "#1f1915",
  ebony: "#2a221d",
  grain: "#3b312a",
  nickel: "#a39c90",
  bone: "#ece4d4",
  boneDim: "#d9cfbb",
  ink: "#231d19",
  lamp: "#f5a524",
  jewel: "#e04e39",
  pearl: "#a9d2cb",
};

export const GEAR_FONT = '"Barlow Condensed", "Barlow", sans-serif';
export const BODY_FONT = '"Barlow", sans-serif';

/** HiDPI canvas that redraws on every analysis frame (and when idle/resized). */
export function useEngineCanvas(engine: AudioEngine, draw: DrawFn) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let w = 0, h = 0;
    const paint = (f: AnalysisFrame | null) => {
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h, f, engine);
    };
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
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    document.fonts?.ready.then(() => paint(engine.latest));
    const unsub = engine.subscribe((f) => paint(f));
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [engine]);

  return ref;
}
