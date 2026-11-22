// Markov models for key/scale and chord inference.
//
// KeyDetector
//   * Learns an empirical 12x12 pitch-class transition matrix from the notes
//     you play (with exponential forgetting so it follows modulations).
//   * Computes the chain's stationary distribution (long-run note weight).
//   * Scores every (root, scale) by
//       - Pearson correlation of (duration histogram ⊕ stationary dist.)
//         against a tonal-hierarchy template for that scale, and
//       - the average log-likelihood of your observed transitions under a
//         theory-driven Markov model of that scale (in-scale targets, stepwise
//         motion, resolution to the tonic / leading tone pull...).
//   * Softmax → posterior over keys.
//
// ChordHMM
//   * Hidden Markov model over 12 roots × 9 qualities + "no chord".
//   * Emissions: cosine similarity between live chroma and chord templates.
//   * Transitions: music-theory matrix — stickiness, root motion by 4ths/5ths,
//     diatonic chords of the detected key favoured, tonic gravity.
//   * Forward algorithm gives P(chord | everything heard so far).

import {
  CHORD_QUALITIES,
  SCALES,
  chordName,
  chordPcs,
  pc,
  prefersFlats,
  scalePcs,
  type ChordQuality,
  type ScaleDef,
} from "./theory";

// ==================================================================== keys

export interface KeyCandidate {
  root: number;
  scale: ScaleDef;
  prob: number;
  score: number;
  correlation: number;
  logLik: number;
}

export interface KeyEstimate {
  candidates: KeyCandidate[];
  best: KeyCandidate | null;
  /** 0..1 normalised duration-weighted pitch-class histogram. */
  histogram: number[];
  /** Stationary distribution of the learned transition matrix. */
  stationary: number[];
  /** Row-normalised learned transition matrix (12x12), lightly smoothed. */
  transitions: number[][];
  /** Row-normalised raw counts; rows you haven't played from are all zero. */
  observed: number[][];
  noteWeight: number;
}

interface ScaleModel {
  root: number;
  scale: ScaleDef;
  template: Float64Array; // 12
  logTrans: Float64Array; // 144, log P(j | i)
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

const PROXIMITY = [0, 1.0, 1.0, 0.75, 0.65, 0.7, 0.35]; // by circular semitone distance

function buildScaleModel(root: number, scale: ScaleDef): ScaleModel {
  const pcs = new Set(scalePcs(root, scale));
  const template = new Float64Array(12);
  for (const iv of scale.intervals) {
    const p = pc(root + iv);
    template[p] = iv === 0 ? 2.0 : iv === 7 ? 1.4 : iv === 3 || iv === 4 ? 1.2 : 1.0;
  }

  const logTrans = new Float64Array(144);
  const tonic = pc(root);
  const fifth = pc(root + 7);
  for (let i = 0; i < 12; i++) {
    const row = new Float64Array(12);
    let sum = 0;
    for (let j = 0; j < 12; j++) {
      if (i === j) continue; // repeated notes are not counted as transitions
      const d = Math.min(Math.abs(i - j), 12 - Math.abs(i - j));
      let w = (pcs.has(j) ? 1 : 0.04) * PROXIMITY[d];
      if (j === tonic) w *= 1.8;
      else if (j === fifth) w *= 1.25;
      // Cadential pulls into the tonic: leading tone, 2nd, 5th, b7.
      if (j === tonic && [11, 2, 7, 10].includes(pc(i - root))) w *= 1.4;
      // Chromatic passing tones should resolve by step into the scale.
      if (!pcs.has(i) && pcs.has(j) && d <= 2) w *= 2;
      row[j] = w;
      sum += w;
    }
    for (let j = 0; j < 12; j++) logTrans[i * 12 + j] = i === j ? 0 : Math.log(row[j] / sum);
  }
  return { root, scale, template, logTrans };
}

export class KeyDetector {
  readonly hist = new Float64Array(12);
  readonly counts = new Float64Array(144);
  private models: ScaleModel[] = [];
  private lastPc = -1;
  private lastEnd = -Infinity;
  /** Forgetting factor applied per new note (≈ memory of ~60 notes). */
  decay = 0.985;
  /** Max silence (s) before we stop linking notes as a transition. */
  phraseGap = 3;

  constructor() {
    for (const scale of SCALES) for (let r = 0; r < 12; r++) this.models.push(buildScaleModel(r, scale));
  }

  noteOn(midi: number, t: number) {
    const p = pc(midi);
    for (let i = 0; i < 12; i++) this.hist[i] *= this.decay;
    for (let i = 0; i < 144; i++) this.counts[i] *= this.decay;
    this.hist[p] += 0.5;
    if (this.lastPc >= 0 && this.lastPc !== p && t - this.lastEnd < this.phraseGap) {
      this.counts[this.lastPc * 12 + p] += 1;
    }
    this.lastPc = p;
    this.lastEnd = t;
  }

  noteOff(midi: number, duration: number, t: number) {
    this.hist[pc(midi)] += Math.min(duration, 2);
    this.lastEnd = t;
  }

  reset() {
    this.hist.fill(0);
    this.counts.fill(0);
    this.lastPc = -1;
  }

  /** Row-normalised transition matrix with light additive smoothing. */
  transitionMatrix(alpha = 0.02): number[][] {
    const m: number[][] = [];
    for (let i = 0; i < 12; i++) {
      let s = 0;
      for (let j = 0; j < 12; j++) if (j !== i) s += this.counts[i * 12 + j] + alpha;
      const row: number[] = [];
      for (let j = 0; j < 12; j++) row.push(j === i ? 0 : (this.counts[i * 12 + j] + alpha) / s);
      m.push(row);
    }
    return m;
  }

  /** Stationary distribution π = πP via power iteration. */
  stationary(P: number[][]): number[] {
    let pi = new Array(12).fill(1 / 12);
    for (let it = 0; it < 80; it++) {
      const next = new Array(12).fill(0);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) next[j] += pi[i] * P[i][j];
      // Lazy chain (½I + ½P) avoids oscillation on periodic patterns.
      for (let j = 0; j < 12; j++) next[j] = 0.5 * pi[j] + 0.5 * next[j];
      pi = next;
    }
    return pi;
  }

  observedMatrix(): number[][] {
    return Array.from({ length: 12 }, (_, i) => {
      let sum = 0;
      for (let j = 0; j < 12; j++) sum += this.counts[i * 12 + j];
      return Array.from({ length: 12 }, (_, j) => (sum > 1e-6 ? this.counts[i * 12 + j] / sum : 0));
    });
  }

  analyze(topN = 6): KeyEstimate {
    const P = this.transitionMatrix();
    const observed = this.observedMatrix();
    const pi = this.stationary(P);
    const histSum = this.hist.reduce((a, b) => a + b, 0);
    let transTotal = 0;
    for (let i = 0; i < 144; i++) transTotal += this.counts[i];
    const histogram = Array.from(this.hist, (h) => (histSum > 0 ? h / histSum : 0));

    if (histSum < 1.5) {
      return { candidates: [], best: null, histogram, stationary: pi, transitions: P, observed, noteWeight: histSum };
    }

    // Trust the Markov stationary distribution more as transitions accumulate.
    const mTrust = Math.min(0.5, transTotal / 40);
    const profile = histogram.map((h, i) => (1 - mTrust) * h + mTrust * pi[i]);

    // Confidence grows with evidence.
    const sharpness = 2 + Math.min(6, histSum / 4);

    const scored = this.models.map((m) => {
      const correlation = pearson(profile, m.template);
      let ll = 0;
      if (transTotal > 0) {
        for (let k = 0; k < 144; k++) if (this.counts[k] > 0) ll += this.counts[k] * m.logTrans[k];
        ll /= transTotal;
      } else ll = -Math.log(11);
      const score = 5 * correlation + 2.5 * (ll + Math.log(11)) * Math.min(1, transTotal / 6) + Math.log(m.scale.prior);
      return { root: m.root, scale: m.scale, correlation, logLik: ll, score, prob: 0 };
    });

    const maxScore = Math.max(...scored.map((s) => s.score));
    let z = 0;
    for (const s of scored) { s.prob = Math.exp(sharpness * (s.score - maxScore)); z += s.prob; }
    for (const s of scored) s.prob /= z;
    scored.sort((a, b) => b.prob - a.prob);

    return { candidates: scored.slice(0, topN), best: scored[0], histogram, stationary: pi, transitions: P, observed, noteWeight: histSum };
  }
}

// ==================================================================== chords

export interface ChordCandidate {
  index: number;
  root: number;
  quality: ChordQuality | null; // null = no chord
  name: string;
  prob: number;
}

// Root motion (semitones up from current root) — circle-of-fifths heavy.
const ROOT_MOTION = [0.6, 0.3, 0.8, 0.7, 0.7, 1.6, 0.25, 1.1, 0.7, 0.9, 0.9, 0.4];

export class ChordHMM {
  readonly Q = CHORD_QUALITIES.length;
  readonly N = 12 * CHORD_QUALITIES.length + 1; // + no-chord
  readonly NC: number;
  private templates: Float64Array[] = [];
  private tones: number[][] = [];
  /** Per-tone presence threshold factor (7ths must be clearly audible). */
  private toneReq: number[][] = [];
  seventhThreshold = 0.18;
  /** Penalty for chord tones that are (almost) absent from the chroma. */
  missingPenalty = 2;
  missingThreshold = 0.15;
  /** Penalty for chroma energy the chord does not explain. */
  unexplainedPenalty = 1.5;
  private trans: Float64Array;
  private alpha: Float64Array;
  private scratch: Float64Array;
  private keyId = "";
  /** Probability of staying on the same chord per frame (~60 fps). */
  stay = 0.96;
  /** Emission sharpness. */
  k = 12;
  private flats = false;

  constructor() {
    this.NC = this.N - 1;
    for (let r = 0; r < 12; r++) {
      for (const q of CHORD_QUALITIES) {
        const t = new Float64Array(12);
        q.intervals.forEach((iv, idx) => (t[pc(r + iv)] = idx === 0 ? 1 : iv === 7 ? 0.9 : 0.8));
        let n = 0;
        for (let i = 0; i < 12; i++) n += t[i] * t[i];
        n = Math.sqrt(n);
        for (let i = 0; i < 12; i++) t[i] /= n;
        this.templates.push(t);
        this.tones.push(chordPcs(r, q));
        this.toneReq.push(q.intervals.map((iv) => (iv === 10 || iv === 11 ? this.seventhThreshold : this.missingThreshold)));
      }
    }
    this.trans = new Float64Array(this.N * this.N);
    this.alpha = new Float64Array(this.N).fill(1 / this.N);
    this.scratch = new Float64Array(this.N);
    this.setKey(null, null);
  }

  stateRoot(s: number) { return Math.floor(s / this.Q); }
  stateQuality(s: number) { return CHORD_QUALITIES[s % this.Q]; }

  stateName(s: number): string {
    if (s === this.NC) return "N.C.";
    return chordName(this.stateRoot(s), this.stateQuality(s), this.flats);
  }

  /** Rebuild the transition matrix for a key (or key-agnostic when null). */
  setKey(root: number | null, scale: ScaleDef | null) {
    const id = root === null || !scale ? "none" : `${root}:${scale.id}`;
    if (id === this.keyId) return;
    this.keyId = id;
    this.flats = root !== null && scale ? prefersFlats(root, scale) : false;
    const keyPcs = root !== null && scale ? new Set(scale.harmonicParent.map((i) => pc(root + i))) : null;

    const fit = new Float64Array(this.N);
    for (let s = 0; s < this.NC; s++) {
      const r = this.stateRoot(s);
      const q = this.stateQuality(s);
      let w = q.prior;
      if (keyPcs && root !== null) {
        const tones = chordPcs(r, q);
        const diatonic = tones.every((p) => keyPcs.has(p));
        w *= diatonic ? 1 : keyPcs.has(r) ? 0.3 : 0.1;
        if (r === root && diatonic) w *= 1.5; // tonic gravity
        if (pc(r - root) === 7 && (q.id === "maj" || q.id === "7")) w *= 1.3; // dominant (incl. V in minor)
      }
      fit[s] = w;
    }

    const N = this.N;
    for (let a = 0; a < N; a++) {
      let sum = 0;
      for (let b = 0; b < N; b++) {
        if (a === b) continue;
        let w: number;
        if (b === this.NC) w = 0;
        else if (a === this.NC) w = fit[b];
        else w = ROOT_MOTION[pc(this.stateRoot(b) - this.stateRoot(a))] * fit[b];
        this.trans[a * N + b] = w;
        sum += w;
      }
      const stay = a === this.NC ? 0.9 : this.stay;
      const toNC = a === this.NC ? 0 : 0.01;
      const move = 1 - stay - toNC;
      for (let b = 0; b < N; b++) {
        if (a === b) this.trans[a * N + b] = stay;
        else if (b === this.NC) this.trans[a * N + b] = toNC;
        else this.trans[a * N + b] = (this.trans[a * N + b] / sum) * move;
      }
    }
  }

  /** One forward-algorithm step. `chroma` must be L2-normalised (or all zero). */
  step(chroma: ArrayLike<number>): void {
    const N = this.N;
    const pred = this.scratch;
    pred.fill(0);
    for (let a = 0; a < N; a++) {
      const pa = this.alpha[a];
      if (pa < 1e-12) continue;
      const base = a * N;
      for (let b = 0; b < N; b++) pred[b] += pa * this.trans[base + b];
    }
    let cmax = 0;
    for (let i = 0; i < 12; i++) if (chroma[i] > cmax) cmax = chroma[i];
    let z = 0;
    for (let s = 0; s < N; s++) {
      let cos: number;
      if (s === this.NC) cos = 0.55;
      else {
        const t = this.templates[s];
        cos = 0;
        for (let i = 0; i < 12; i++) cos += t[i] * chroma[i];
        // A chord is only plausible if each of its tones is actually sounding.
        let explained = 0;
        const tones = this.tones[s];
        const req = this.toneReq[s];
        for (let k = 0; k < tones.length; k++) {
          const v = chroma[tones[k]];
          const thr = req[k] * cmax;
          explained += v * v;
          if (v < thr) cos -= this.missingPenalty * (thr - v);
        }
        if (cmax > 0) cos -= this.unexplainedPenalty * (1 - explained);
      }
      const v = pred[s] * Math.exp(this.k * (cos - 1));
      this.alpha[s] = v;
      z += v;
    }
    if (z <= 0 || !Number.isFinite(z)) this.alpha.fill(1 / N);
    else for (let s = 0; s < N; s++) this.alpha[s] = Math.max(this.alpha[s] / z, 1e-15);
  }

  top(n = 5): ChordCandidate[] {
    const idx = Array.from({ length: this.N }, (_, i) => i).sort((a, b) => this.alpha[b] - this.alpha[a]);
    return idx.slice(0, n).map((s) => ({
      index: s,
      root: s === this.NC ? -1 : this.stateRoot(s),
      quality: s === this.NC ? null : this.stateQuality(s),
      name: this.stateName(s),
      prob: this.alpha[s],
    }));
  }

  reset() {
    this.alpha.fill(1 / this.N);
  }
}
