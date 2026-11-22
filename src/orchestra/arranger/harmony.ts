// Melody harmonisation with a Markov chord model.
//
//   * vocabulary(): diatonic chords of the key (+ major V in minor for
//     classical styles), with 7th/9th colour tones per style.
//   * transition matrix over scale degrees (functional harmony: ii→V, V→I,
//     IV→V, vi→IV …), re-weighted by the style's degree bias.
//   * emission: how well the melody notes in a slot fit each chord, weighted
//     by duration and metric position.
//   * harmonize(): Viterbi over the whole take (with a cadence at the end);
//     nextChord(): greedy online choice while recording.

import { KeyDetector } from "../../theory/markov";
import { SCALE_BY_ID, pc, pcName, prefersFlats } from "../../theory/theory";
import { STEPS_PER_BEAT, type Chord, type ChordSlot, type KeyInfo, type QNote, type Quality, type StyleDef } from "./types";

// Rows: from-degree, cols: to-degree (I ii iii IV V vi vii).
const TRANS = [
  [0.12, 0.1, 0.05, 0.25, 0.25, 0.18, 0.05],
  [0.08, 0.06, 0.02, 0.1, 0.54, 0.1, 0.1],
  [0.05, 0.05, 0.06, 0.25, 0.1, 0.44, 0.05],
  [0.25, 0.12, 0.03, 0.08, 0.32, 0.1, 0.1],
  [0.5, 0.03, 0.05, 0.1, 0.1, 0.2, 0.02],
  [0.08, 0.25, 0.08, 0.34, 0.15, 0.06, 0.04],
  [0.55, 0.02, 0.15, 0.03, 0.1, 0.1, 0.05],
];
const START = [0.5, 0.05, 0.03, 0.15, 0.12, 0.12, 0.03];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** Weight of melody fit vs. transition probability. */
const LAMBDA = 4;

/** Reduce any detected scale to one we can harmonise in. */
export function harmonicKey(key: KeyInfo): KeyInfo {
  const map: Record<string, string> = { majorPent: "major", minorPent: "minor", blues: "minor", harmonicMinor: "minor" };
  const id = map[key.scale.id] ?? key.scale.id;
  return { root: key.root, scale: SCALE_BY_ID[id as keyof typeof SCALE_BY_ID] };
}

export function isMinorKey(key: KeyInfo) {
  return key.scale.intervals.includes(3) && !key.scale.intervals.includes(4);
}

function qualityOf(third: number, fifth: number): Quality {
  if (third === 4 && fifth === 7) return "maj";
  if (third === 3 && fifth === 7) return "min";
  if (third === 3 && fifth === 6) return "dim";
  return "aug";
}

export function chordSymbol(root: number, quality: Quality, colors: number[], flats: boolean): string {
  const ivs = colors.map((c) => pc(c - root));
  const has7 = ivs.find((i) => i === 10 || i === 11 || i === 9);
  const has9 = ivs.includes(2);
  let s = pcName(root, flats);
  if (quality === "dim") return s + (has7 === 10 ? "m7♭5" : has7 === 9 ? "°7" : "°");
  if (quality === "aug") return s + "+";
  if (quality === "min") s += "m";
  if (has7 === 11) s += quality === "min" ? "(maj7)" : "maj7";
  else if (has7 === 10) s += has9 ? "9" : "7";
  if (has7 === 11 && has9) s = s.replace("maj7", "maj9");
  else if (!has7 && has9) s += "add9";
  return s;
}

export function vocabulary(key: KeyInfo, style: StyleDef): Chord[] {
  const k = harmonicKey(key);
  const parent = k.scale.harmonicParent;
  const minor = isMinorKey(k);
  const flats = prefersFlats(k.root, k.scale);
  const out: Chord[] = [];
  for (let d = 0; d < 7; d++) {
    const r = parent[d];
    let third = parent[(d + 2) % 7];
    const fifth = parent[(d + 4) % 7];
    let seventh = parent[(d + 6) % 7];
    if (minor && style.minorDominant && d === 4) {
      third = r + 4; // raised leading tone → major V
      seventh = r + 10;
    }
    const q = qualityOf(pc(third - r), pc(fifth - r));
    const root = pc(k.root + r);
    const tones = [root, pc(k.root + third), pc(k.root + fifth)];
    const colors: number[] = [];
    if (style.color !== "triad") colors.push(pc(k.root + seventh));
    if (style.color === "ninth" && q !== "dim" && d !== 2) colors.push(pc(k.root + parent[(d + 1) % 7]));
    let roman = ROMAN[d];
    if (q === "min" || q === "dim") roman = roman.toLowerCase();
    if (q === "dim") roman += "°";
    const diff = r - MAJOR[d];
    if (diff === -1) roman = "♭" + roman;
    else if (diff === 1) roman = "♯" + roman;
    if (colors.length && q !== "dim") roman += "7";
    out.push({ root, quality: q, degree: d, tones, colors, name: chordSymbol(root, q, colors, flats), roman });
  }
  return out;
}

/** 0..1 — how well a melody note's pitch class fits a chord. */
function fit(chord: Chord, p: number, scalePcs: Set<number>, colorful: boolean): number {
  if (p === chord.tones[0]) return 1;
  if (p === chord.tones[1]) return 0.9;
  if (p === chord.tones[2]) return 0.8;
  if (chord.colors.includes(p)) return colorful ? 0.6 : 0.3;
  return scalePcs.has(p) ? 0.05 : -0.3;
}

export interface WeightedPc {
  pc: number;
  w: number;
}

/** Melody notes overlapping [start, start+dur), weighted by overlap and metric position. */
export function slotEvidence(melody: QNote[], start: number, dur: number, stepsPerBar: number): WeightedPc[] {
  const ev: WeightedPc[] = [];
  for (const n of melody) {
    const a = Math.max(n.step, start);
    const b = Math.min(n.step + n.dur, start + dur);
    if (b <= a) continue;
    let w = b - a;
    if (n.step <= start) w *= 1.6; // sounding on the chord change
    if (n.step % stepsPerBar === 0) w *= 1.3; // downbeat
    else if (n.step % STEPS_PER_BEAT === 0) w *= 1.1;
    ev.push({ pc: pc(n.midi), w });
  }
  return ev;
}

function emission(chord: Chord, ev: WeightedPc[], scalePcs: Set<number>, colorful: boolean): number {
  if (ev.length === 0) return 0.35;
  let s = 0, z = 0;
  for (const e of ev) {
    s += e.w * fit(chord, e.pc, scalePcs, colorful);
    z += e.w;
  }
  return s / z;
}

function scaleSet(key: KeyInfo) {
  const k = harmonicKey(key);
  return new Set(k.scale.intervals.map((i) => pc(k.root + i)));
}

const logT = (from: number, to: number, bias: number[]) => Math.log(TRANS[from][to] * (bias[to] ?? 1) + 1e-6);

/** Viterbi harmonisation of a complete melody. */
/** Extra log-score for a chord move (your learned taste). */
export type ChordBonus = (prev: Chord | null, next: Chord) => number;

export function harmonize(melody: QNote[], totalSteps: number, key: KeyInfo, style: StyleDef, bonus?: ChordBonus): ChordSlot[] {
  const vocab = vocabulary(key, style);
  const stepsPerBar = style.beatsPerBar * STEPS_PER_BEAT;
  const slotSteps = style.harmonicRhythm * STEPS_PER_BEAT;
  const n = Math.max(1, Math.ceil(totalSteps / slotSteps));
  const scalePcs = scaleSet(key);
  const colorful = style.color !== "triad";
  const V = vocab.length;

  const E: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ev = slotEvidence(melody, i * slotSteps, slotSteps, stepsPerBar);
    E.push(vocab.map((c) => emission(c, ev, scalePcs, colorful)));
  }
  // Cadence: end on I, ideally from V.
  E[n - 1][0] += 0.4;
  if (n > 1) E[n - 2][4] += 0.12;

  let delta = vocab.map((c, j) => Math.log(START[j] * (style.degreeBias[j] ?? 1)) + LAMBDA * E[0][j] + (bonus?.(null, c) ?? 0));
  const back: number[][] = [];
  for (let i = 1; i < n; i++) {
    const next: number[] = new Array(V);
    const bp: number[] = new Array(V);
    for (let j = 0; j < V; j++) {
      let best = -Infinity, arg = 0;
      for (let k = 0; k < V; k++) {
        const v = delta[k] + logT(k, j, style.degreeBias) + (bonus?.(vocab[k], vocab[j]) ?? 0);
        if (v > best) { best = v; arg = k; }
      }
      next[j] = best + LAMBDA * E[i][j];
      bp[j] = arg;
    }
    back.push(bp);
    delta = next;
  }
  let j = delta.indexOf(Math.max(...delta));
  const path = [j];
  for (let i = n - 2; i >= 0; i--) {
    j = back[i][j];
    path.unshift(j);
  }
  return path.map((d, i) => ({ step: i * slotSteps, dur: slotSteps, chord: vocab[d] }));
}

/** Greedy choice while recording: previous chord + what was just sung. */
export function nextChord(prev: Chord | null, recent: WeightedPc[], key: KeyInfo, style: StyleDef, bonus?: ChordBonus): Chord {
  const vocab = vocabulary(key, style);
  const scalePcs = scaleSet(key);
  const colorful = style.color !== "triad";
  let best = vocab[0], bestScore = -Infinity;
  for (const c of vocab) {
    const prior = prev ? logT(prev.degree, c.degree, style.degreeBias) : Math.log(START[c.degree]);
    const s = prior + LAMBDA * emission(c, recent, scalePcs, colorful) + (bonus?.(prev, c) ?? 0);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

/** Key of a melody, reduced to a harmonisable scale. */
export function keyFromMelody(melody: QNote[], fallback?: KeyInfo, stepsPerBar = 16): KeyInfo {
  const kd = new KeyDetector();
  const sorted = [...melody].sort((a, b) => a.step - b.step);
  for (const n of sorted) {
    const t = n.step * 0.15;
    kd.noteOn(n.midi, t);
    kd.noteOff(n.midi, n.dur * 0.15, t + n.dur * 0.15);
  }
  const est = kd.analyze(96);
  if (!est.best || sorted.length === 0) return fallback ?? { root: sorted[0] ? pc(sorted[0].midi) : 0, scale: SCALE_BY_ID.major };
  // Cadence prior: tunes end on the tonic, and held notes mark cadences. A take
  // stopped mid-phrase ends on a short note, so the final note counts by its length.
  const first = pc(sorted[0].midi);
  const lastNote = sorted[sorted.length - 1];
  const last = pc(lastNote.midi);
  // Only a held final note is a confident ending; a take stopped mid-phrase isn't.
  const finality = lastNote.dur >= 8 ? 1 : lastNote.dur >= 6 ? 0.3 : 0.1;
  const held = sorted.filter((n) => n.dur >= 8);
  const downbeats = sorted.filter((n) => n.step % stepsPerBar === 0);
  let best = est.best, bestScore = -Infinity;
  for (const c of est.candidates) {
    const triad = [c.root, pc(c.root + (c.scale.intervals.includes(4) ? 4 : 3)), pc(c.root + 7)];
    const inTriad = (p: number) => triad.includes(p);
    let s = 0.6 * c.score; // un-sharpened model score (template correlation + Markov likelihood)
    s += finality * (last === c.root ? 2 : inTriad(last) ? 0.4 : -1);
    s += first === c.root ? 0.5 : inTriad(first) ? 0.3 : 0;
    for (const h of held) s += pc(h.midi) === c.root ? 0.5 : inTriad(pc(h.midi)) ? 0.15 : -0.2;
    // Metric weight: downbeats sit on tonic-chord notes far more often than not.
    for (const d of downbeats) s += inTriad(pc(d.midi)) ? (pc(d.midi) === c.root ? 0.35 : 0.25) : -0.1;
    s += ["major", "minor"].includes(c.scale.id) ? 0.3 : 0; // plain keys harmonise best
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return harmonicKey({ root: best.root, scale: best.scale });
}
