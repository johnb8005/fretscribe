// Karplus–Strong plucked-string synth + a frame driver mimicking the live app.

import { Analyzer, FFT_SIZE, type AnalysisFrame } from "../src/analysis/pipeline";
import { midiToFreq } from "../src/theory/theory";

export const SR = 48000;
export const HOP = 800; // 60 frames per second

function pluck(midi: number, seconds: number, amp = 0.4, seed = midi): Float32Array {
  // Karplus–Strong with a first-order allpass for accurate fractional tuning.
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const period = SR / midiToFreq(midi) - 0.5; // averaging filter adds ½ sample
  const N = Math.floor(period - 0.5);
  const frac = period - N;
  const C = (1 - frac) / (1 + frac);
  const line = new Float32Array(N);
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280) * 2 - 1;
  for (let i = 0; i < N; i++) line[i] = rand();
  let idx = 0, prevX = 0, prevY = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const x = line[idx];
    const avg = 0.996 * 0.5 * (x + last);
    last = x;
    const y = C * avg + prevX - C * prevY; // allpass
    prevX = avg;
    prevY = y;
    line[idx] = y;
    out[i] = x * amp;
    idx = (idx + 1) % N;
  }
  return out;
}

export interface Event { midis: number[]; dur: number; strumMs?: number }

export function render(events: Event[], noise = 0.001): Float32Array {
  const total = events.reduce((a, e) => a + e.dur, 0) + 0.5;
  const out = new Float32Array(Math.floor(total * SR));
  let t = 0;
  for (const e of events) {
    e.midis.forEach((m, i) => {
      const off = Math.floor((t + (i * (e.strumMs ?? 12)) / 1000) * SR);
      const p = pluck(m, e.dur + 0.3, 0.35 / Math.sqrt(e.midis.length), m * 7 + i);
      // mute at next event (player lifts finger), short fade
      const len = Math.min(p.length, Math.floor((e.dur + 0.02) * SR));
      for (let k = 0; k < len && off + k < out.length; k++) {
        const fade = k > len - 240 ? (len - k) / 240 : 1;
        out[off + k] += p[k] * fade;
      }
    });
    t += e.dur;
  }
  let s = 12345;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] += ((s / 0x7fffffff) * 2 - 1) * noise;
  }
  return out;
}

export function run(
  audio: Float32Array,
  onFrame?: (f: AnalysisFrame, a: Analyzer) => void,
  jitter = false,
): Analyzer {
  const a = new Analyzer(SR);
  const win = new Float32Array(FFT_SIZE);
  let r = 7;
  // Browsers deliver frames irregularly (rAF + 128-sample render quanta).
  const hop = () => (jitter ? 768 + 128 * ((r = (r * 48271) % 2147483647) % 6) : HOP);
  for (let pos = HOP; pos <= audio.length; pos += hop()) {
    const start = pos - FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) win[i] = start + i >= 0 ? audio[start + i] : 0;
    const f = a.process(win, pos / SR);
    onFrame?.(f, a);
  }
  return a;
}
