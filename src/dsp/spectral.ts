// Chroma (pitch-class energy) + log-frequency spectrum for display.
//
// Chroma is built from spectral peaks only. Each peak that looks like an
// upper harmonic of a lower peak is attenuated, because harmonics 5, 7 and 9
// land on pitch classes that are NOT in the played chord (major 3rd, minor 7th
// and 9th above the fundamental) and would otherwise make every chord look
// like a maj7 / 7 / add9.

import { freqToMidiFloat } from "../theory/theory";

/** Attenuation for a peak identified as harmonic h of a lower peak.
 *  Octaves (2,4,8,16) keep the pitch class → untouched. Fifths (3,6,12) are
 *  often real chord tones too → mild. Everything else is a foreign pitch class. */
const HARMONICS: [number, number][] = [];
for (let h = 3; h <= 20; h++) {
  if ((h & (h - 1)) === 0) continue;
  HARMONICS.push([h, h === 3 || h === 6 || h === 12 ? 0.55 : 0.12]);
}

export class SpectralAnalyzer {
  private readonly barEdges: Int32Array;
  readonly bars: Float32Array;
  readonly chroma = new Float64Array(12);
  private peakF = new Float64Array(512);
  private peakM = new Float64Array(512);
  minChromaFreq = 75;
  maxChromaFreq = 2200;

  constructor(
    private readonly sampleRate: number,
    private readonly fftSize: number,
    barCount = 144,
    private readonly minFreq = 40,
    private readonly maxFreq = 5000,
  ) {
    this.bars = new Float32Array(barCount);
    this.barEdges = new Int32Array(barCount + 1);
    for (let i = 0; i <= barCount; i++) {
      const f = this.minFreq * Math.pow(this.maxFreq / this.minFreq, i / barCount);
      this.barEdges[i] = Math.max(1, Math.round((f * fftSize) / sampleRate));
    }
  }

  get binHz(): number {
    return this.sampleRate / this.fftSize;
  }

  /** Updates `chroma` (L2 normalised; zero vector if silent) and `bars` (0..1). */
  process(mags: Float32Array): void {
    const binHz = this.binHz;
    const lo = Math.max(2, Math.floor(this.minChromaFreq / binHz));
    const hi = Math.min(mags.length - 2, Math.ceil(this.maxChromaFreq / binHz));

    let peakMax = 0;
    for (let k = lo; k <= hi; k++) if (mags[k] > peakMax) peakMax = mags[k];
    const floor = peakMax * 0.06;

    // 1. Peak picking with parabolic frequency refinement.
    let np = 0;
    for (let k = lo; k <= hi && np < this.peakF.length; k++) {
      const m = mags[k];
      if (m < floor || m <= mags[k - 1] || m < mags[k + 1]) continue;
      const a = Math.log(mags[k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(mags[k + 1] + 1e-12);
      const den = a - 2 * b + c;
      const delta = den !== 0 ? (0.5 * (a - c)) / den : 0;
      this.peakF[np] = (k + delta) * binHz;
      this.peakM[np] = m;
      np++;
    }

    // 2. Harmonic suppression + pitch-class accumulation.
    const ch = this.chroma;
    ch.fill(0);
    for (let p = 0; p < np; p++) {
      const f = this.peakF[p];
      let w = Math.sqrt(this.peakM[p]);
      for (const [h, atten] of HARMONICS) {
        const f0 = f / h;
        if (f0 < this.minChromaFreq * 0.9) break;
        // Tolerance widens a little with h (string inharmonicity).
        const tol = Math.min(0.03, 0.02 + h * 0.001);
        let hit = false;
        for (let q = 0; q < p && !hit; q++) {
          hit = Math.abs(this.peakF[q] - f0) / f0 < tol && this.peakM[q] > this.peakM[p] * 0.25;
        }
        if (hit) w *= atten;
      }
      const mf = freqToMidiFloat(f);
      const nearest = Math.round(mf);
      const cents = (mf - nearest) * 100;
      w *= Math.exp(-(cents * cents) / (2 * 30 * 30)) * (f < 160 ? 0.8 : 1);
      ch[((nearest % 12) + 12) % 12] += w;
    }
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += ch[i] * ch[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-9) for (let i = 0; i < 12; i++) ch[i] /= norm;

    // 3. Display bars in dB, mapped to 0..1 over a 70 dB range.
    for (let b = 0; b < this.bars.length; b++) {
      const lo2 = this.barEdges[b];
      const hi2 = Math.max(lo2 + 1, this.barEdges[b + 1]);
      let m = 0;
      for (let k = lo2; k < hi2 && k < mags.length; k++) if (mags[k] > m) m = mags[k];
      const db = 20 * Math.log10(m + 1e-9);
      this.bars[b] = Math.max(0, Math.min(1, (db + 80) / 70));
    }
  }
}
