// Your taste, as a Bayesian linear model over sparse, human-readable features.
//
//   score(option) = Σ θ_f · x_f
//
// Each weight has an independent Gaussian posterior N(mean, 1/precision).
// Thompson sampling: draw θ from the posterior, pick the best-scoring option —
// uncertain features get explored, confident ones exploited. Feedback is a
// reward r (±1, scaled by credit) and a standard online Bayesian update.

export type Features = Record<string, number>;

interface Weight {
  mean: number;
  prec: number;
  /** How many times this feature was rated. */
  n: number;
}

export interface TasteEntry {
  key: string;
  label: string;
  mean: number;
  confidence: number; // 0..1
  n: number;
}

export type Rng = () => number;

/** Standard normal via Box–Muller. */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Small seeded RNG for reproducible tests. */
export function seeded(seed = 1): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PRIOR_PREC = 1;
const NOISE_PREC = 1.5;

export class TasteModel {
  private w = new Map<string, Weight>();
  private labels = new Map<string, string>();
  ratings = 0;

  label(key: string, text: string) {
    this.labels.set(key, text);
  }

  private get(key: string): Weight {
    return this.w.get(key) ?? { mean: 0, prec: PRIOR_PREC, n: 0 };
  }

  /** Posterior-mean score (what it currently believes). */
  predict(x: Features): number {
    let s = 0;
    for (const k in x) s += this.get(k).mean * x[k];
    return s;
  }

  /** A Thompson draw of θ, restricted to the features you ask about. */
  sampler(rng: Rng, exploration = 1): (x: Features) => number {
    const drawn = new Map<string, number>();
    return (x) => {
      let s = 0;
      for (const k in x) {
        let th = drawn.get(k);
        if (th === undefined) {
          const wk = this.get(k);
          th = wk.mean + (gaussian(rng) * exploration) / Math.sqrt(wk.prec);
          drawn.set(k, th);
        }
        s += th * x[k];
      }
      return s;
    };
  }

  /** Online Bayesian update for reward r on features x. */
  update(x: Features, r: number) {
    const err = r - this.predict(x);
    for (const k in x) {
      const xk = x[k];
      if (xk === 0) continue;
      const wk = this.get(k);
      const prec = wk.prec + NOISE_PREC * xk * xk;
      const mean = wk.mean + (NOISE_PREC * xk * err) / prec;
      this.w.set(k, { mean, prec, n: wk.n + 1 });
    }
  }

  /** Learned preferences, strongest first. */
  summary(minEvidence = 1): TasteEntry[] {
    const out: TasteEntry[] = [];
    for (const [key, wk] of this.w) {
      if (wk.n < minEvidence) continue;
      out.push({
        key,
        label: this.labels.get(key) ?? key,
        mean: wk.mean,
        confidence: 1 - PRIOR_PREC / wk.prec,
        n: wk.n,
      });
    }
    return out.sort((a, b) => Math.abs(b.mean) * b.confidence - Math.abs(a.mean) * a.confidence);
  }

  reset() {
    this.w.clear();
    this.ratings = 0;
  }

  toJSON() {
    return {
      v: 1,
      ratings: this.ratings,
      w: Object.fromEntries([...this.w].map(([k, x]) => [k, [x.mean, x.prec, x.n]])),
      labels: Object.fromEntries(this.labels),
    };
  }

  static fromJSON(o: unknown): TasteModel {
    const m = new TasteModel();
    const d = o as { v?: number; ratings?: number; w?: Record<string, [number, number, number]>; labels?: Record<string, string> };
    if (d?.v !== 1) return m;
    m.ratings = d.ratings ?? 0;
    for (const [k, [mean, prec, n]] of Object.entries(d.w ?? {})) m.w.set(k, { mean, prec, n });
    for (const [k, l] of Object.entries(d.labels ?? {})) m.labels.set(k, l);
    return m;
  }
}

const STORAGE_KEY = "fretscribe.taste.v1";

export function loadTaste(): TasteModel {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? TasteModel.fromJSON(JSON.parse(raw)) : new TasteModel();
  } catch {
    return new TasteModel();
  }
}

export function saveTaste(m: TasteModel) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* storage full or unavailable — taste just won't persist */
  }
}
