import type { AudioEngine } from "../audio/engine";
import { midiToName, pc } from "../theory/theory";
import { pcColor, useEngineCanvas } from "./canvas";

// ------------------------------------------------------------- oscilloscope

export function Waveform({ engine }: { engine: AudioEngine }) {
  const ref = useEngineCanvas(engine, (ctx, w, h, frame, eng) => {
    const s = eng.samples;
    const mid = h / 2;

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }
    if (!frame) return;

    // Show ~4 periods of the detected pitch (stable, "triggered" scope),
    // else a fixed 40 ms window.
    const sr = eng.sampleRate;
    const span = Math.min(
      s.length - 1,
      Math.round(frame.pitch ? (4 * sr) / frame.pitch.freq : sr * 0.04),
    );
    // Trigger: latest rising zero crossing that leaves room for `span` samples.
    let start = s.length - span - 1;
    for (let i = s.length - span - 1; i > s.length - span - 1 - sr / 60 && i > 0; i--) {
      if (s[i - 1] < 0 && s[i] >= 0) {
        start = i;
        break;
      }
    }

    let peak = 0.02;
    for (let i = start; i < start + span; i++) peak = Math.max(peak, Math.abs(s[i]));
    const scale = (h * 0.42) / Math.max(peak, 0.15 * (1 - frame.level) + 0.02);

    const color = frame.pitch ? pcColor(pc(frame.pitch.midi)) : "#5eead4";
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const v = s[start + Math.floor((x / w) * span)];
      const y = mid - v * scale;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Full-window envelope strip at the bottom.
    ctx.fillStyle = "rgba(94,234,212,0.18)";
    const stripH = 22;
    const step = s.length / w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const a = Math.floor(x * step);
      for (let i = a; i < a + step; i++) m = Math.max(m, Math.abs(s[i] || 0));
      const bh = Math.min(1, m * 3) * stripH;
      ctx.fillRect(x, h - bh, 1, bh);
    }
  });
  return <canvas ref={ref} className="viz" />;
}

// ------------------------------------------------------------- spectrum

const F_MIN = 40;
const F_MAX = 5000;
const LABELS: [number, string][] = [
  [82.4, "E2"], [110, "A2"], [146.8, "D3"], [196, "G3"], [246.9, "B3"], [329.6, "E4"],
  [659.3, "E5"], [1318.5, "E6"], [2637, "E7"],
];

export function Spectrum({ engine }: { engine: AudioEngine }) {
  const ref = useEngineCanvas(engine, (ctx, w, h, frame, eng) => {
    const xOf = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const [f, label] of LABELS) {
      const x = xOf(f);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(x, 0, 1, h - 14);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText(label, x, h - 3);
    }
    const bars = eng.analyzer?.spectrumBars;
    if (!bars || !frame) return;
    const bw = w / bars.length;
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#0ea5e9");
    grad.addColorStop(0.6, "#5eead4");
    grad.addColorStop(1, "#fbbf24");
    ctx.fillStyle = grad;
    for (let i = 0; i < bars.length; i++) {
      const bh = bars[i] * (h - 18);
      ctx.fillRect(i * bw + 0.5, h - 14 - bh, Math.max(1, bw - 1), bh);
    }
    if (frame.pitch) {
      const x = xOf(frame.pitch.freq);
      ctx.fillStyle = pcColor(pc(frame.pitch.midi));
      ctx.fillRect(x - 1, 0, 2, h - 14);
      ctx.textAlign = "left";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.fillText(`${frame.pitch.freq.toFixed(1)} Hz`, Math.min(x + 4, w - 70), 12);
    }
  });
  return <canvas ref={ref} className="viz" />;
}

// ------------------------------------------------------------- piano roll

const ROLL_SECONDS = 10;
const LOW = 38;
const HIGH = 90;

export function PianoRoll({ engine }: { engine: AudioEngine }) {
  const ref = useEngineCanvas(engine, (ctx, w, h, frame, eng) => {
    const gutter = 34;
    const rowH = h / (HIGH - LOW + 1);
    const yOf = (m: number) => h - (m - LOW + 1) * rowH;

    for (let m = LOW; m <= HIGH; m++) {
      const black = [1, 3, 6, 8, 10].includes(pc(m));
      ctx.fillStyle = black ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.035)";
      ctx.fillRect(gutter, yOf(m), w - gutter, rowH - 0.5);
      if (pc(m) === 0 || pc(m) === 4) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "10px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillText(midiToName(m), gutter - 4, yOf(m) + rowH - 1);
      }
    }
    if (!frame || !eng.analyzer) return;
    const now = frame.t;
    const xOf = (t: number) => gutter + (1 - (now - t) / ROLL_SECONDS) * (w - gutter);

    // Second grid.
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let s = Math.ceil(now - ROLL_SECONDS); s <= now; s++) ctx.fillRect(xOf(s), 0, 1, h);

    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "left";
    const notes = eng.analyzer.notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const end = n.end ?? now;
      if (end < now - ROLL_SECONDS) break;
      const x0 = Math.max(gutter, xOf(n.start));
      const x1 = xOf(end);
      const y = yOf(n.midi);
      const active = n.end === null;
      ctx.fillStyle = pcColor(pc(n.midi), active ? 66 : 52, active ? 1 : 0.85);
      if (active) {
        ctx.shadowColor = pcColor(pc(n.midi));
        ctx.shadowBlur = 14;
      }
      ctx.beginPath();
      ctx.roundRect(x0, y - 1, Math.max(3, x1 - x0), rowH + 2, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (x1 - x0 > 26) {
        ctx.fillStyle = "rgba(10,12,20,0.85)";
        ctx.fillText(midiToName(n.midi), x0 + 3, y + rowH - 1);
      }
    }
    // Live pitch trace.
    if (frame.pitch) {
      const y = h - (frame.pitch.midi + frame.pitch.cents / 100 - LOW + 0.5) * rowH;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(w - 4, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return <canvas ref={ref} className="viz" />;
}
