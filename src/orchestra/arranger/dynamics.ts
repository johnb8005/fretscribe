// Dynamics: pp … ff per bar, hairpins between them, and sfz accents.
//
// The orchestra-wide level for each bar comes from
//   * how loudly you sang that bar (relative to the rest of the take),
//   * phrase shape — each 4-bar phrase leans toward its 3rd bar,
//   * form — the last phrase is the climax,
//   * the style's home dynamic (Impressionist lives at mp, Epic at f).
// Each part sits relative to that (accompaniment a notch under the tune),
// note velocities follow it (interpolating across hairpins), and sudden sung
// accents / the climax downbeat get sfz.

import { STEPS_PER_BEAT, type Arrangement, type Role } from "./types";

export const DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"] as const;
export type Dynamic = (typeof DYNAMICS)[number];

/** Velocity multiplier per level (mf ≈ 1×). */
export const DYN_GAIN = [0.45, 0.6, 0.78, 1, 1.18, 1.35];

const ROLE_OFFSET: Partial<Record<Role, number>> = {
  melody: 0, double: -1, pad: -1, pulse: -1, oompah: -1, arp: -1, ostinato: -1,
  counter: -1, bass: 0, walk: -1, perc: 0, timpani: 0, swell: 0,
};

const PHRASE = 4;

/** Orchestra-wide dynamic level (0 = pp … 5 = ff) for each bar. */
export function formDynamics(arr: Arrangement, base = 3): number[] {
  const barSteps = arr.beatsPerBar * STEPS_PER_BEAT;
  const bars = Math.max(1, Math.ceil(arr.totalSteps / barSteps));
  const vels = arr.melody.map((n) => n.vel);
  const mean = vels.length ? vels.reduce((a, b) => a + b, 0) / vels.length : 0.8;
  const lastPhrase = Math.floor((bars - 1) / PHRASE);

  const raw: number[] = [];
  for (let b = 0; b < bars; b++) {
    const inBar = arr.melody.filter((n) => n.step >= b * barSteps && n.step < (b + 1) * barSteps);
    // Sung energy: ±2 levels for the loudest / softest bars of the take.
    const energy = inBar.length ? (inBar.reduce((a, n) => a + n.vel, 0) / inBar.length - mean) * 6 : -0.3;
    const arc = [0, 0.4, 1, 0.2][b % PHRASE];
    const climax = bars > PHRASE && Math.floor(b / PHRASE) === lastPhrase ? 1 : 0;
    const ending = b === bars - 1 && bars > 1 ? -0.6 : 0;
    raw.push(base + Math.max(-2, Math.min(2, energy)) + arc + climax + ending);
  }
  // Round and limit jumps to one level per bar (unless the singer really jumped).
  const out: number[] = [];
  raw.forEach((v, i) => {
    let l = Math.round(v);
    if (i > 0 && Math.abs(raw[i] - raw[i - 1]) < 1.5) l = Math.max(out[i - 1] - 1, Math.min(out[i - 1] + 1, l));
    out.push(Math.max(0, Math.min(5, l)));
  });
  return out;
}

/** Fill in part levels, scale velocities (with hairpins) and mark sfz accents. */
export function applyDynamics(arr: Arrangement, base = arr.style.dynamicBase ?? 3): Arrangement {
  const barSteps = arr.beatsPerBar * STEPS_PER_BEAT;
  const form = formDynamics(arr, base);
  const climaxBar = form.indexOf(Math.max(...form));
  const big = form[climaxBar] >= 4;

  for (const part of arr.parts) {
    const off = part.spec.dyn ?? ROLE_OFFSET[part.spec.role] ?? 0;
    part.levels = form.map((l) => Math.max(0, Math.min(5, l + off)));
    const lv = part.levels;
    let prevVel = 0;
    const followsTune = part.spec.role === "melody" || part.spec.role === "double";
    part.notes.forEach((n, i) => {
      const bar = Math.min(lv.length - 1, Math.floor(n.step / barSteps));
      const frac = (n.step - bar * barSteps) / barSteps;
      const next = lv[bar + 1] ?? lv[bar];
      // Hairpin: glide toward next bar's level across this bar.
      const g = DYN_GAIN[lv[bar]] + (DYN_GAIN[next] - DYN_GAIN[lv[bar]]) * frac;
      const sung = followsTune ? arr.melody[i]?.vel ?? 0.8 : n.vel;
      n.vel = Math.max(0.05, Math.min(1, n.vel * g));
      // sfz: a sudden sung accent in the tune, or the climax downbeat for the rhythm section.
      if (part.spec.role === "melody" && sung >= 0.9 && sung - prevVel >= 0.25) n.accent = true;
      if (big && n.step === climaxBar * barSteps && ["perc", "timpani", "bass", "ostinato"].includes(part.spec.role)) n.accent = true;
      if (n.accent) n.vel = 1;
      prevVel = sung;
    });
  }
  arr.dynamics = form;
  return arr;
}
