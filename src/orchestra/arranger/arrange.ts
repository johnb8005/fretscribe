// Turns a melody + chord plan into orchestral parts.
//
// Slot generators (pad, arp, ostinato, bass, walk, counter, pulse, oompah,
// perc, timpani, swell) only need the current chord, so the same code drives
// both the live accompaniment while you hum and the full re-arrangement
// afterwards. Melody-following parts (melody, double) are mapped from the
// melody itself.

import { pc } from "../../theory/theory";
import { KIT } from "../synth/patches";
import { applyDynamics } from "./dynamics";
import { harmonize, keyFromMelody } from "./harmony";
import { STEPS_PER_BEAT, type Arrangement, type Chord, type ChordSlot, type KeyInfo, type Part, type PartSpec, type QNote, type StyleDef } from "./types";

const PHRASE_BARS = 4;

/** Deterministic tiny humanisation so tests stay stable. */
function human(seed: number, amount = 0.06): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amount;
}

const clampVel = (v: number) => Math.max(0.05, Math.min(1, v));

/** Octave shift that centres a melody in a register. */
export function registerShift(midis: number[], [lo, hi]: [number, number]): number {
  if (midis.length === 0) return 0;
  const sorted = [...midis].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return 12 * Math.round(((lo + hi) / 2 - median) / 12);
}

/** Nearest MIDI note with pitch class `p` to `target`, kept inside [lo, hi] when possible. */
export function nearest(p: number, target: number, [lo, hi]: [number, number]): number {
  let best = target, bestD = Infinity;
  for (let m = lo - 12; m <= hi + 12; m++) {
    if (pc(m) !== p) continue;
    const out = m < lo || m > hi ? 24 : 0;
    const d = Math.abs(m - target) + out;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/** Close-position voicing with minimal movement from the previous one. */
export function voiceChord(pcs: number[], count: number, register: [number, number], prev: number[] | null): number[] {
  const [lo, hi] = register;
  const center = (lo + hi) / 2;
  let best: number[] = [];
  let bestCost = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = lo; base <= hi; base++) {
      if (pc(base) !== order[0]) continue;
      const v = [base];
      for (let i = 1; i < count; i++) {
        const p = order[i % order.length];
        let m = v[i - 1] + 1;
        while (pc(m) !== p) m++;
        v.push(m);
      }
      if (v[v.length - 1] > hi + 2) continue;
      let cost: number;
      if (prev && prev.length) {
        cost = 0;
        for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - (prev[Math.min(i, prev.length - 1)] ?? center));
      } else {
        cost = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
      }
      // Keep the root in the voicing when there's room for it.
      if (!v.some((m) => pc(m) === pcs[0])) cost += 3;
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
  }
  return best.length ? best : pcs.slice(0, count).map((p) => nearest(p, center, register));
}

export interface GenState {
  voicing?: number[];
  bass?: number;
  counter?: number;
}

export interface SlotContext {
  slot: ChordSlot;
  next: Chord | null;
  style: StyleDef;
  spec: PartSpec;
  state: GenState;
}

const chordPcs = (c: Chord) => [...c.tones, ...c.colors];

/** Notes for one part over one chord slot (absolute steps). */
export function generateSlot({ slot, next, style, spec, state }: SlotContext): QNote[] {
  const out: QNote[] = [];
  const stepsPerBar = style.beatsPerBar * STEPS_PER_BEAT;
  const { chord } = slot;
  const v0 = spec.vel ?? 0.7;
  const reg = spec.register;
  const end = slot.step + slot.dur;
  const barOf = (s: number) => Math.floor(s / stepsPerBar);
  const push = (midi: number, step: number, dur: number, vel: number) =>
    out.push({ midi, step, dur: Math.max(1, Math.min(dur, end - step)), vel: clampVel(vel + human(step * 7 + midi)) });

  switch (spec.role) {
    case "pad": {
      const v = voiceChord(chordPcs(chord), spec.voices ?? 3, reg, state.voicing ?? null);
      state.voicing = v;
      v.forEach((m) => push(m, slot.step, slot.dur, v0));
      break;
    }
    case "pulse": {
      const v = voiceChord(chordPcs(chord), spec.voices ?? 3, reg, state.voicing ?? null);
      state.voicing = v;
      for (let s = slot.step; s < end; s++) {
        const pos = s % stepsPerBar;
        if (!(spec.at ?? [0]).includes(pos)) continue;
        const accent = pos % STEPS_PER_BEAT === 0 ? 1 : 0.85;
        v.forEach((m) => push(m, s, spec.hitDur ?? 2, v0 * accent));
      }
      break;
    }
    case "oompah": {
      const v = voiceChord(chord.tones, spec.voices ?? 3, reg, state.voicing ?? null);
      state.voicing = v;
      for (let s = slot.step; s < end; s++) {
        const pos = s % stepsPerBar;
        if (pos === 0 || pos % STEPS_PER_BEAT !== 0) continue;
        v.forEach((m) => push(m, s, STEPS_PER_BEAT, v0 * 0.85));
      }
      break;
    }
    case "arp": {
      const rate = spec.rate ?? 2;
      const span = spec.span ?? 6;
      // Pool of chord tones climbing from the bottom of the register.
      const pcs = chordPcs(chord);
      const pool: number[] = [];
      let m = nearest(chord.tones[0], reg[0] + 4, reg);
      for (let i = 0; pool.length < span && i < 40; i++, m++) if (pcs.includes(pc(m)) && m <= reg[1]) pool.push(m);
      if (pool.length === 0) break;
      let seq: number[];
      switch (spec.shape) {
        case "updown":
          seq = [...pool.keys(), ...[...pool.keys()].reverse().slice(1, -1)];
          break;
        case "alberti":
          seq = [0, 2, 1, 2].map((i) => Math.min(i, pool.length - 1));
          break;
        case "broken":
          seq = [0, 1, 2, 1].map((i) => Math.min(i, pool.length - 1));
          break;
        default:
          seq = [...pool.keys()];
      }
      let i = 0;
      for (let s = slot.step; s < end; s += rate, i++) {
        const accent = s % STEPS_PER_BEAT === 0 ? 1 : 0.8;
        push(pool[seq[i % seq.length]], s, spec.shape === "alberti" ? rate : rate * 2, v0 * accent);
      }
      break;
    }
    case "ostinato": {
      const root = nearest(chord.tones[0], reg[0] + 3, reg);
      const fifth = nearest(chord.tones[2], root + 7, [root, root + 12]);
      const third = nearest(chord.tones[1], root + 15, [root + 12, root + 24]);
      const pool = [root, fifth, root + 12, third, fifth + 12];
      const cell = spec.cell ?? [0, 1, 2, 1];
      const rate = spec.rate ?? 1;
      let i = 0;
      for (let s = slot.step; s < end; s += rate, i++) {
        const idx = cell[i % cell.length];
        if (idx < 0) continue;
        const accent = s % STEPS_PER_BEAT === 0 ? 1 : 0.75;
        push(pool[idx % pool.length], s, rate, v0 * accent);
      }
      break;
    }
    case "bass": {
      const root = nearest(chord.tones[0], state.bass ?? Math.round(reg[0] + (reg[1] - reg[0]) * 0.35), reg);
      state.bass = root;
      const fifth = nearest(chord.tones[2], root + 7, reg);
      const pattern = spec.pattern ?? "root";
      if (pattern === "root") push(root, slot.step, slot.dur, v0);
      else if (pattern === "rootFifth") {
        const half = Math.max(STEPS_PER_BEAT, Math.floor(slot.dur / 2 / STEPS_PER_BEAT) * STEPS_PER_BEAT);
        push(root, slot.step, half, v0);
        if (slot.dur > half) push(fifth, slot.step + half, slot.dur - half, v0 * 0.85);
      } else if (pattern === "pulse8") {
        for (let s = slot.step; s < end; s += 2) push(root, s, 2, v0 * (s % STEPS_PER_BEAT === 0 ? 1 : 0.8));
      } else {
        for (let s = slot.step; s < end; s++) if (s % stepsPerBar === 0) push(root, s, STEPS_PER_BEAT, v0);
      }
      break;
    }
    case "walk": {
      // One note per beat: root, chord tone, chord tone, then an approach into the next root.
      const beats = Math.max(1, Math.floor(slot.dur / STEPS_PER_BEAT));
      let cur = nearest(chord.tones[0], state.bass ?? Math.round(reg[0] + (reg[1] - reg[0]) * 0.4), reg);
      const nextRoot = nearest((next ?? chord).tones[0], cur, reg);
      // Jazz walks approach the next root chromatically; classical lines use a chord tone.
      const chromatic = style.swing > 0;
      for (let b = 0; b < beats; b++) {
        const s = slot.step + b * STEPS_PER_BEAT;
        let note: number;
        if (b === 0) note = cur;
        else if (b === beats - 1 && beats > 1 && chromatic) note = nextRoot + (nextRoot > cur ? -1 : 1); // chromatic approach
        else {
          const p = chord.tones[b % 2 === 1 ? 2 : 1];
          note = nearest(p, cur + (b % 2 ? 3 : -2), reg);
        }
        push(note, s, STEPS_PER_BEAT, v0 * (b % 2 === 0 ? 1 : 0.85));
        cur = note;
      }
      state.bass = cur;
      break;
    }
    case "counter": {
      // Guide tones (3rd / 7th) moving by the smallest step.
      const guides = chord.colors.length ? [chord.tones[1], chord.colors[0]] : [chord.tones[1], chord.tones[2]];
      const start = state.counter ?? (reg[0] + reg[1]) / 2;
      const first = guides.map((g) => nearest(g, start, reg)).sort((x, y) => Math.abs(x - start) - Math.abs(y - start))[0];
      if (slot.dur >= 2 * STEPS_PER_BEAT) {
        const half = Math.floor(slot.dur / 2 / STEPS_PER_BEAT) * STEPS_PER_BEAT;
        const other = guides.map((g) => nearest(g, first, reg)).find((m) => m !== first) ?? first;
        push(first, slot.step, half, v0);
        push(other, slot.step + half, slot.dur - half, v0 * 0.9);
        state.counter = other;
      } else {
        push(first, slot.step, slot.dur, v0);
        state.counter = first;
      }
      break;
    }
    case "perc": {
      for (let s = slot.step; s < end; s++) {
        const pos = s % stepsPerBar;
        const phraseEnd = barOf(s) % PHRASE_BARS === PHRASE_BARS - 1;
        const hits = phraseEnd && spec.fill ? [...(spec.hits ?? []).filter((h) => h.step < (spec.fill![0]?.step ?? 99)), ...spec.fill] : spec.hits ?? [];
        for (const h of hits) if (h.step === pos) push(h.midi, s, 1, h.vel);
      }
      break;
    }
    case "timpani": {
      for (let s = slot.step; s < end; s++) {
        if (s % stepsPerBar !== 0) continue;
        const bar = barOf(s);
        const root = nearest(chord.tones[0], 45, reg);
        if (bar % PHRASE_BARS === 0) push(root, s, STEPS_PER_BEAT, v0);
        if (bar % PHRASE_BARS === PHRASE_BARS - 1) {
          // Roll into the next phrase on the last beat.
          const rollStart = s + stepsPerBar - STEPS_PER_BEAT;
          for (let r = 0; r < STEPS_PER_BEAT * 2; r++) {
            const at = rollStart + r / 2;
            if (at >= end) break;
            out.push({ midi: root, step: Math.floor(at), dur: 1, vel: clampVel(0.25 + (r / 8) * 0.6) });
          }
        }
      }
      break;
    }
    case "swell": {
      for (let s = slot.step; s < end; s++) {
        if (s % stepsPerBar !== 0 || barOf(s) % PHRASE_BARS !== PHRASE_BARS - 1) continue;
        const half = Math.floor(stepsPerBar / 2);
        push(KIT.SWELL, s + half, stepsPerBar - half, 0.8);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Melody-following parts. */
export function melodyPart(spec: PartSpec, melody: QNote[], melodySpec: PartSpec): QNote[] {
  const shift = registerShift(melody.map((n) => n.midi), melodySpec.register);
  const extra = spec.role === "double" ? (spec.octave ?? 0) * 12 : 0;
  const v0 = spec.vel ?? 0.8;
  // Sung loudness (0.35..1, ~0.8 typical) carries into the line.
  return melody.map((n) => ({ ...n, midi: n.midi + shift + extra, vel: clampVel(v0 * (n.vel / 0.8) * (n.step % STEPS_PER_BEAT === 0 ? 1 : 0.88)) }));
}

export function totalStepsFor(melody: QNote[], style: StyleDef): number {
  const bar = style.beatsPerBar * STEPS_PER_BEAT;
  const last = melody.reduce((m, n) => Math.max(m, n.step + n.dur), 0);
  return Math.max(bar, Math.ceil(last / bar) * bar);
}

export function arrange(melody: QNote[], style: StyleDef, opts: { key?: KeyInfo; chords?: ChordSlot[]; totalSteps?: number } = {}): Arrangement {
  const totalSteps = opts.totalSteps ?? totalStepsFor(melody, style);
  const key = opts.key ?? keyFromMelody(melody, undefined, style.beatsPerBar * STEPS_PER_BEAT);
  const chords = opts.chords ?? harmonize(melody, totalSteps, key, style);
  const melodySpec = style.parts.find((p) => p.role === "melody") ?? style.parts[0];

  const parts: Part[] = style.parts.map((spec) => {
    if (spec.role === "melody" || spec.role === "double") return { spec, notes: melodyPart(spec, melody, melodySpec) };
    const state: GenState = {};
    const notes: QNote[] = [];
    chords.forEach((slot, i) => notes.push(...generateSlot({ slot, next: chords[i + 1]?.chord ?? null, style, spec, state })));
    return { spec, notes };
  });

  return applyDynamics({ style, key, beatsPerBar: style.beatsPerBar, melody, chords, parts, totalSteps });
}

// ------------------------------------------------------------------ quantisation

export interface TimedNote {
  midi: number;
  start: number; // seconds
  end: number;
  /** 0..1 relative loudness as sung. */
  vel?: number;
}

/** Seconds → 16th-step grid; monophonic (later notes cut earlier ones). */
export function quantize(notes: TimedNote[], t0: number, bpm: number, grid = 2): QNote[] {
  const stepDur = 60 / bpm / STEPS_PER_BEAT;
  const q = notes
    .map((n) => {
      const s = Math.round((n.start - t0) / stepDur / grid) * grid;
      let e = Math.round((n.end - t0) / stepDur / grid) * grid;
      if (e <= s) e = s + grid;
      return { midi: n.midi, step: s, dur: e - s, vel: n.vel ?? 0.8 };
    })
    .filter((n) => n.step >= 0)
    .sort((a, b) => a.step - b.step);
  const out: QNote[] = [];
  for (const n of q) {
    const prev = out[out.length - 1];
    if (prev && prev.step === n.step) {
      // Two notes landed on the same slot: keep the longer one.
      if (n.dur > prev.dur) out[out.length - 1] = n;
      continue;
    }
    if (prev && prev.step + prev.dur > n.step) prev.dur = n.step - prev.step;
    out.push({ ...n });
  }
  return out;
}

/** "Ode to Joy" (Beethoven, public domain), two phrases, for the demo. */
export const DEMO_TUNE: QNote[] = (() => {
  const q = 4;
  const seq: [number, number][] = [
    [64, q], [64, q], [65, q], [67, q], [67, q], [65, q], [64, q], [62, q],
    [60, q], [60, q], [62, q], [64, q], [64, q * 1.5], [62, q / 2], [62, q * 2],
    [64, q], [64, q], [65, q], [67, q], [67, q], [65, q], [64, q], [62, q],
    [60, q], [60, q], [62, q], [64, q], [62, q * 1.5], [60, q / 2], [60, q * 2],
  ];
  let step = 0;
  return seq.map(([midi, dur]) => {
    const n = { midi, step, dur, vel: 0.8 };
    step += dur;
    return n;
  });
})();
