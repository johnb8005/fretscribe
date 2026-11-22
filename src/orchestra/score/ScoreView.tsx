import { useEffect, useRef, useState } from "react";
import type { Conductor } from "../conductor";
import { STEPS_PER_BEAT } from "../arranger/types";
import { engrave, type Layout } from "./engrave";
import { termFor } from "../arranger/tempo";

/** Bone-paper full score. Re-engraves on changes (and ~4×/s while recording); a lamp-coloured band follows playback. */
export function ScoreView({ conductor, version }: { conductor: Conductor | null; version: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const layout = useRef<Layout | null>(null);
  const [width, setWidth] = useState(1000);
  const [fontsReady, setFontsReady] = useState(0);
  const recording = conductor?.state === "recording" || conductor?.state === "countIn";
  const view = conductor?.scoreView() ?? null;
  const empty = !view || view.parts.every((p) => p.notes.length === 0) && !recording;

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    // Bravura loads asynchronously; engrave again once it's there.
    document.fonts?.load("30px Bravura").then(() => setFontsReady((n) => n + 1)).catch(() => {});
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1));
    return () => ro.disconnect();
  }, []);

  // Engrave
  useEffect(() => {
    if (!paper.current) return;
    const draw = () => {
      const v = conductor?.scoreView();
      if (!paper.current) return;
      if (!v || (v.parts.every((p) => p.notes.length === 0) && conductor?.state === "idle")) {
        paper.current.innerHTML = "";
        layout.current = null;
        return;
      }
      layout.current = engrave(paper.current, v, { width, lastBars: recording ? 4 : undefined, patchOf: (spec) => conductor!.patchFor(spec), tempo: { term: termFor(conductor!.bpm).name, bpm: conductor!.bpm, swing: conductor!.style.swing > 0 } });
    };
    draw();
    if (!recording) return;
    const id = setInterval(draw, 250);
    return () => clearInterval(id);
  }, [conductor, version, width, recording, fontsReady]);

  // Playhead band
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = band.current;
      const L = layout.current;
      if (!el || !conductor || !L || conductor.state !== "playing") {
        if (el) el.style.opacity = "0";
        return;
      }
      const barSteps = conductor.style.beatsPerBar * STEPS_PER_BEAT;
      const step = conductor.currentStep();
      const bar = Math.floor(step / barSteps);
      const m = L.measures.find((x) => x.bar === bar);
      if (!m) {
        el.style.opacity = "0";
        return;
      }
      const frac = (step - bar * barSteps) / barSteps;
      el.style.opacity = "1";
      el.style.transform = `translate(${m.x + frac * m.w}px, ${m.y}px)`;
      el.style.height = `${m.h}px`;
      // Keep the current system in view.
      const sc = wrap.current;
      if (sc && (m.y < sc.scrollTop || m.y + m.h > sc.scrollTop + sc.clientHeight)) {
        sc.scrollTo({ top: Math.max(0, m.y - 20), behavior: "smooth" });
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [conductor]);

  return (
    <div
      ref={wrap}
      className="relative max-h-[68vh] min-h-[320px] overflow-y-auto rounded-lg bg-bone text-ink shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_12px_30px_-12px_rgba(0,0,0,0.6)]"
    >
      <div ref={paper} aria-label="Orchestral score" role="img" className="relative" />
      <div ref={band} aria-hidden className="pointer-events-none absolute top-0 left-0 w-[3px] rounded-full bg-lamp opacity-0 shadow-[0_0_14px_var(--color-lamp)]" />
      {empty && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <div>
            <p className="font-gear text-3xl font-semibold text-ink">The score is written here as you hum.</p>
            <p className="mt-2 text-ink/60">Press Record, wait for the one-bar count-in, then hum or whistle a tune. Or try the demo tune.</p>
          </div>
        </div>
      )}
    </div>
  );
}
