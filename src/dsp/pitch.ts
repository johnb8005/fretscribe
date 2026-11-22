// YIN monophonic pitch detector (de Cheveigné & Kawahara, 2002),
// tuned for guitar: ~70 Hz (drop D) up to ~1.4 kHz (high E, 24th fret).

export interface PitchResult {
  freq: number;
  /** 0..1, 1 = perfectly periodic. */
  clarity: number;
}

export class YinDetector {
  private readonly sampleRate: number;
  private readonly windowSize: number;
  private readonly minTau: number;
  private readonly maxTau: number;
  private readonly diff: Float32Array;
  private readonly cmnd: Float32Array;
  threshold = 0.15;

  constructor(sampleRate: number, windowSize = 2048, minFreq = 70, maxFreq = 1400) {
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
    this.maxTau = Math.ceil(sampleRate / minFreq);
    this.diff = new Float32Array(this.maxTau + 2);
    this.cmnd = new Float32Array(this.maxTau + 2);
  }

  /** Number of samples the detector needs. */
  get requiredLength(): number {
    return this.windowSize + this.maxTau + 2;
  }

  detect(buf: Float32Array): PitchResult | null {
    const W = this.windowSize;
    const maxTau = this.maxTau;
    const off = buf.length - this.requiredLength;
    if (off < 0) return null;
    const d = this.diff;
    const c = this.cmnd;

    // Difference function.
    for (let tau = 1; tau <= maxTau + 1; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const delta = buf[off + j] - buf[off + j + tau];
        sum += delta * delta;
      }
      d[tau] = sum;
    }

    // Cumulative mean normalised difference.
    c[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau + 1; tau++) {
      running += d[tau];
      c[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }

    // First dip under the absolute threshold, then walk to its local minimum.
    let tauEst = -1;
    for (let tau = this.minTau; tau <= maxTau; tau++) {
      if (c[tau] < this.threshold) {
        while (tau + 1 <= maxTau && c[tau + 1] < c[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    // Fallback: global minimum if it's still reasonably periodic.
    if (tauEst < 0) {
      let best = this.minTau;
      for (let tau = this.minTau; tau <= maxTau; tau++) if (c[tau] < c[best]) best = tau;
      if (c[best] > 0.35) return null;
      tauEst = best;
    }

    // Parabolic interpolation for sub-sample accuracy.
    let refined = tauEst;
    if (tauEst > 1 && tauEst < maxTau) {
      const s0 = c[tauEst - 1];
      const s1 = c[tauEst];
      const s2 = c[tauEst + 1];
      const denom = s0 + s2 - 2 * s1;
      if (denom !== 0) refined = tauEst + (s0 - s2) / (2 * denom);
    }

    return { freq: this.sampleRate / refined, clarity: Math.max(0, Math.min(1, 1 - c[tauEst])) };
  }
}

export function rms(buf: Float32Array, length = 2048): number {
  let s = 0;
  const start = Math.max(0, buf.length - length);
  for (let i = start; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (buf.length - start));
}
