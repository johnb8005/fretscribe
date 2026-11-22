// Synthetic humming / whistling for tests.
import { SR } from "./synth";
import { midiToFreq } from "../src/theory/theory";

export interface SungNote { midi: number; beats: number }

/** Legato hum: glides between notes, vibrato, detuned, short dips between repeated notes. */
export function hum(
  notes: SungNote[],
  { bpm = 100, detuneCents = -35, vibratoCents = 30, whistle = false, octave = 0 } = {},
): Float32Array {
  const beat = 60 / bpm;
  const total = notes.reduce((a, n) => a + n.beats, 0) * beat + 0.6;
  const out = new Float32Array(Math.floor(total * SR));
  let phase = 0;
  let t0 = 0.2;
  const seg = notes.map((n) => {
    const s = { start: t0, end: t0 + n.beats * beat, midi: n.midi + octave * 12 };
    t0 = s.end;
    return s;
  });
  const harmonics = whistle ? [1, 0.02] : [1, 0.6, 0.35, 0.2, 0.12, 0.08, 0.05];
  let si = 0;
  let curMidi = seg[0].midi;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    while (si < seg.length - 1 && t >= seg[si].end) si++;
    const s = seg[si];
    if (t < seg[0].start || t > seg[seg.length - 1].end) continue;
    // Portamento toward the target (≈60 ms)
    curMidi += (s.midi - curMidi) * (1 - Math.exp(-1 / (0.02 * SR)));
    const vib = (vibratoCents / 100) * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, (t - s.start) / 0.25);
    const f = midiToFreq(curMidi + detuneCents / 100 + vib);
    phase += (2 * Math.PI * f) / SR;
    // Amplitude: dip at each note boundary (breath / consonant), fade in/out
    const sinceStart = t - s.start;
    const toEnd = s.end - t;
    const prevSame = si > 0 && seg[si - 1].midi === s.midi;
    const dip = Math.min(1, sinceStart / (prevSame ? 0.06 : 0.02)) * Math.min(1, toEnd / 0.03 + (si < seg.length - 1 && !(seg[si + 1].midi === s.midi) ? 1 : 0));
    let v = 0;
    harmonics.forEach((a, h) => (v += a * Math.sin(phase * (h + 1))));
    out[i] = v * 0.12 * dip;
  }
  let r = 99;
  for (let i = 0; i < out.length; i++) {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    out[i] += ((r / 0x7fffffff) * 2 - 1) * 0.002;
  }
  return out;
}

export const ODE_TO_JOY: SungNote[] = [
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
  [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
].map(([midi, beats]) => ({ midi, beats }));
