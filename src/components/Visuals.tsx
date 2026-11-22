import { useMemo } from "react";
import type { AudioEngine } from "../audio/engine";
import { TabMapper } from "../analysis/tab";
import { midiToName } from "../theory/theory";
import { BODY_FONT, C, GEAR_FONT, useEngineCanvas } from "./canvas";

// ------------------------------------------------------------- tab staff (hero)

const WINDOW_S = 7;

export function TabStaff({ engine }: { engine: AudioEngine }) {
  const tab = useMemo(() => new TabMapper(), []);
  const ref = useEngineCanvas(engine, (ctx, w, h, frame, eng) => {
    const a = eng.analyzer;
    const notes = a?.notes ?? [];
    const positions = tab.sync(notes);

    const gutter = 64;
    const right = 28;
    const chordRow = 46;
    const staffTop = chordRow + 18;
    const staffBottom = h - 34;
    const gap = (staffBottom - staffTop) / 5;
    const yOf = (string: number) => staffTop + (5 - string) * gap;
    const now = frame?.t ?? 0;
    const xOf = (t: number) => gutter + (1 - (now - t) / WINDOW_S) * (w - gutter - right);

    // TAB clef
    ctx.fillStyle = C.ink;
    ctx.font = `700 ${Math.round(gap * 1.05)}px ${GEAR_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    "TAB".split("").forEach((ch, i) => ctx.fillText(ch, 30, staffTop + gap * (1.25 + i * 1.25)));

    // Strings
    ctx.strokeStyle = "rgba(35,29,25,0.5)";
    ctx.lineWidth = 1;
    for (let s = 0; s < 6; s++) {
      ctx.beginPath();
      ctx.moveTo(gutter - 8, yOf(s) + 0.5);
      ctx.lineTo(w - right, yOf(s) + 0.5);
      ctx.stroke();
    }
    // Opening barline
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gutter - 8, yOf(5));
    ctx.lineTo(gutter - 8, yOf(0));
    ctx.stroke();

    if (!frame || notes.length + (a?.progression.length ?? 0) === 0) {
      const msg = frame
        ? "Play a note. It will be written here as tab, with chords above."
        : "Press Listen and play. Notes are written here as tab, with chords above.";
      const cx = gutter + (w - gutter - right) / 2;
      const cy = (yOf(2) + yOf(3)) / 2;
      ctx.font = `500 16px ${BODY_FONT}`;
      const mw = ctx.measureText(msg).width;
      ctx.fillStyle = C.bone;
      ctx.fillRect(cx - mw / 2 - 12, yOf(3) + 2, mw + 24, gap - 4);
      ctx.fillStyle = "rgba(35,29,25,0.6)";
      ctx.fillText(msg, cx, cy);
      return;
    }

    // Second ticks along the bottom
    ctx.fillStyle = "rgba(35,29,25,0.18)";
    for (let s = Math.ceil(now - WINDOW_S); s <= now; s++) {
      const x = xOf(s);
      if (x > gutter) ctx.fillRect(x, staffBottom + 22, 1, 6);
    }

    // Chord names, lead-sheet style
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 22px ${GEAR_FONT}`;
    let lastRight = -Infinity;
    const prog = a?.progression ?? [];
    for (let i = 0; i < prog.length; i++) {
      const c = prog[i];
      const nextX = i + 1 < prog.length ? xOf(prog[i + 1].start) : Infinity;
      if (nextX <= gutter) continue; // scrolled out entirely
      const x = Math.max(gutter, xOf(c.start));
      const width = ctx.measureText(c.name).width;
      if (x < lastRight + 10) continue;
      const latest = i === prog.length - 1 && frame.chord?.name === c.name;
      ctx.fillStyle = latest ? C.jewel : C.ink;
      ctx.fillText(c.name, x, chordRow);
      ctx.fillStyle = latest ? C.jewel : "rgba(35,29,25,0.3)";
      ctx.fillRect(x, chordRow + 6, 1.5, staffTop - chordRow - 6);
      lastRight = x + width;
    }

    // Notes (drawn newest first; names only where there is room)
    let nameLeft = Infinity;
    const fs = Math.round(Math.min(20, gap * 0.82));
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const end = n.end ?? now;
      if (end < now - WINDOW_S) break;
      const pos = positions.get(n.id);
      if (!pos) continue;
      const x = xOf(n.start);
      const y = yOf(pos.string);
      const live = n.end === null;
      const label = String(pos.fret);
      ctx.font = `600 ${fs}px ${GEAR_FONT}`;
      const tw = ctx.measureText(label).width;

      // Sustain line
      const x1 = xOf(end);
      if (x1 - x > tw) {
        ctx.fillStyle = live ? C.lamp : "rgba(35,29,25,0.16)";
        ctx.fillRect(x + tw / 2 + 4, y - 1.5, x1 - x - tw / 2 - 4, 3);
      }
      if (x < gutter - 4) continue;

      // Knock the string out behind the number, like engraved tab
      const padX = 4;
      ctx.fillStyle = live ? C.lamp : C.bone;
      ctx.beginPath();
      ctx.roundRect(x - tw / 2 - padX, y - fs / 2 - 2, tw + padX * 2, fs + 4, live ? 6 : 2);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y + 1);

      // Note name under the staff
      if (x + 14 < nameLeft) {
        ctx.font = `500 11px ${BODY_FONT}`;
        ctx.fillStyle = live ? C.ink : "rgba(35,29,25,0.5)";
        ctx.fillText(midiToName(n.midi), x, staffBottom + 14);
        nameLeft = x - 14;
      }
    }

    // Now line
    ctx.fillStyle = C.lamp;
    ctx.fillRect(w - right, staffTop - 10, 2, staffBottom - staffTop + 20);
  });
  return (
    <canvas
      ref={ref}
      className="block h-full w-full"
      role="img"
      aria-label="Live guitar tablature of the notes and chords you play"
    />
  );
}

// ------------------------------------------------------------- oscilloscope

export function Scope({ engine }: { engine: AudioEngine }) {
  const ref = useEngineCanvas(engine, (ctx, w, h, frame, eng) => {
    const s = eng.samples;
    const mid = h / 2;
    ctx.fillStyle = C.grain;
    ctx.fillRect(0, Math.round(mid), w, 1);
    if (!frame) return;

    // Trigger on a rising zero crossing and show ~4 periods so the trace stands still.
    const sr = eng.sampleRate;
    const span = Math.min(s.length - 1, Math.round(frame.pitch ? (4 * sr) / frame.pitch.freq : sr * 0.04));
    let start = s.length - span - 1;
    for (let i = start; i > start - sr / 60 && i > 0; i--) {
      if (s[i - 1] < 0 && s[i] >= 0) {
        start = i;
        break;
      }
    }
    let peak = 0.02;
    for (let i = start; i < start + span; i++) peak = Math.max(peak, Math.abs(s[i]));
    const scale = (h * 0.42) / Math.max(peak, 0.05);

    ctx.strokeStyle = frame.pitch ? C.lamp : C.nickel;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const v = s[start + Math.floor((x / w) * span)];
      if (x === 0) ctx.moveTo(x, mid - v * scale);
      else ctx.lineTo(x, mid - v * scale);
    }
    ctx.stroke();
  });
  return <canvas ref={ref} className="block h-full w-full" role="img" aria-label="Waveform" />;
}

// ------------------------------------------------------------- spectrum

const F_MIN = 60;
const F_MAX = 5000;
const MARKS: [number, string][] = [
  [82.4, "E"], [110, "A"], [146.8, "D"], [196, "G"], [246.9, "B"], [329.6, "e"],
  [1000, "1 kHz"], [2000, "2 kHz"], [4000, "4 kHz"],
];

export function Spectrum({ engine }: { engine: AudioEngine }) {
  const ref = useEngineCanvas(engine, (ctx, w, h, frame, eng) => {
    const xOf = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
    const base = h - 18;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const [f, label] of MARKS) {
      const x = xOf(f);
      const isString = label.length === 1;
      ctx.fillStyle = C.grain;
      ctx.fillRect(Math.round(x), 0, 1, base);
      ctx.fillStyle = C.nickel;
      ctx.font = isString ? `600 13px ${GEAR_FONT}` : `500 11px ${BODY_FONT}`;
      ctx.fillText(label, x, h - 3);
    }
    const bars = eng.analyzer?.spectrumBars;
    if (!bars || !frame) return;
    // Only the part of the analysis range that fits our axis.
    const aMin = 40, aMax = 5000;
    ctx.fillStyle = "rgba(236,228,212,0.55)";
    for (let i = 0; i < bars.length; i++) {
      const f0 = aMin * Math.pow(aMax / aMin, i / bars.length);
      const f1 = aMin * Math.pow(aMax / aMin, (i + 1) / bars.length);
      if (f1 < F_MIN) continue;
      const x0 = Math.max(0, xOf(f0));
      const bh = bars[i] * (base - 4);
      ctx.fillRect(x0, base - bh, Math.max(1, xOf(f1) - x0 - 1), bh);
    }
    if (frame.pitch) {
      const x = xOf(frame.pitch.freq);
      ctx.fillStyle = C.lamp;
      ctx.fillRect(x - 1, 0, 2, base);
    }
  });
  return <canvas ref={ref} className="block h-full w-full" role="img" aria-label="Frequency spectrum" />;
}
