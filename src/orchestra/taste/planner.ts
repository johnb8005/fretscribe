// The planner makes the arranger's choices with Thompson sampling, and turns
// your 👍/👎 into credit for the choices that were sounding.
//
// Decisions:
//   * texture per part (arpeggio shape, ostinato, pad thickness, tacet…), per phrase
//   * chord colour (triads / 7ths / 9ths) and loudness shift, per phrase
//   * chord transitions — a learned bonus added to the Markov chord model
//
// Credit assignment (an eligibility trace): textures and colour that are
// sounding get full credit; chords get credit decaying with how long ago
// they changed (about a bar).

import { PATCH_BY_ID } from "../synth/patches";
import { STEPS_PER_BEAT, type Chord, type PartSpec, type StyleDef } from "../arranger/types";
import { COLORS, DYN_SHIFTS, VARIANTS, type Variant } from "./variants";
import { TasteModel, type Features, type Rng } from "./model";

const PHRASE_BARS = 4;
const ROMAN = ["I", "ii", "iii", "IV", "V", "vi", "vii"];

interface Segment {
  fromBar: number;
  toBar: number;
  choice: string;
  x: Features;
}

export interface Credit {
  label: string;
  weight: number;
}

export class Planner {
  readonly model: TasteModel;
  readonly style: StyleDef;
  /** 0 = stick to the style, 1 = explore boldly. */
  adventurous: number;
  private rng: Rng;
  private segs = new Map<string, Segment[]>();
  private chordLog: { step: number; x: Features; label: string }[] = [];
  private barSteps: number;

  constructor(model: TasteModel, style: StyleDef, adventurous = 0.35, rng: Rng = Math.random) {
    this.model = model;
    this.style = style;
    this.adventurous = adventurous;
    this.rng = rng;
    this.barSteps = style.beatsPerBar * STEPS_PER_BEAT;
  }

  /** Thompson-sampling spread; 0 = pure exploitation (posterior mean). */
  private get exploration() {
    return this.adventurous * 1.4;
  }

  /** The style's own option starts ahead; less so when you're feeling adventurous. */
  private get defaultBonus() {
    return 0.15 + 0.55 * (1 - this.adventurous);
  }

  // ---------------------------------------------------------------- choosing

  private choose<T extends { id: string | number; label: string }>(key: string, bar: number, options: T[], defaultId: string | number, feat: (o: T) => Features): T {
    const list = this.segs.get(key) ?? [];
    const hit = list.find((s) => s.fromBar <= bar && bar < s.toBar);
    if (hit) return options.find((o) => String(o.id) === hit.choice) ?? options[0];
    const sample = this.model.sampler(this.rng, this.exploration);
    let best = options[0], bestScore = -Infinity;
    for (const o of options) {
      const s = sample(feat(o)) + (o.id === defaultId ? this.defaultBonus : 0) + this.rng() * 1e-3;
      if (s > bestScore) { bestScore = s; best = o; }
    }
    const toBar = (Math.floor(bar / PHRASE_BARS) + 1) * PHRASE_BARS;
    list.push({ fromBar: bar, toBar, choice: String(best.id), x: feat(best) });
    this.segs.set(key, list);
    return best;
  }

  private textureFeatures(spec: PartSpec, v: Variant): Features {
    const g = `tex:${spec.role}:${v.id}`;
    const s = `tex:${this.style.id.split("/")[0]}:${spec.role}:${v.id}`;
    const part = spec.label.toLowerCase();
    this.model.label(g, `${part} ${v.label}`);
    this.model.label(s, `${part} ${v.label} (${this.style.name})`);
    const x: Features = { [g]: 1, [s]: 0.6 };
    if (v.id !== "tacet") {
      const patch = PATCH_BY_ID[spec.patch];
      const p = `play:${spec.patch}`;
      this.model.label(p, `${patch?.name.toLowerCase() ?? spec.patch} playing`);
      x[p] = 0.5;
    }
    return x;
  }

  /** The variant this part plays in `bar` (null = tacet). */
  textureFor(spec: PartSpec, bar: number): PartSpec | null {
    const opts = VARIANTS[spec.role];
    if (!opts) return spec;
    const v = this.choose(`part:${spec.id}`, bar, opts, "default", (o) => this.textureFeatures(spec, o));
    return v.apply(spec, this.style);
  }

  colorFor(bar: number): StyleDef["color"] {
    return this.choose("color", bar, COLORS, this.style.color, (o) => {
      const k = `color:${o.id}`;
      this.model.label(k, o.label);
      return { [k]: 1 };
    }).id;
  }

  dynShiftFor(bar: number): number {
    return this.choose("dyn", bar, DYN_SHIFTS, 0, (o) => {
      const k = `dyn:${o.id}`;
      this.model.label(k, o.label);
      return { [k]: 1 };
    }).id;
  }

  private chordFeatures(prev: Chord | null, next: Chord): Features {
    const deg = `chord:deg:${next.degree}`;
    this.model.label(deg, `the ${ROMAN[next.degree]} chord`);
    const q = `chord:q:${next.quality}`;
    this.model.label(q, `${next.quality === "maj" ? "major" : next.quality === "min" ? "minor" : next.quality === "dim" ? "diminished" : "augmented"} chords`);
    const x: Features = { [deg]: 0.7, [q]: 0.4 };
    if (prev) {
      const mv = prev.degree === next.degree ? "chord:stay" : `chord:move:${prev.degree}>${next.degree}`;
      this.model.label(mv, prev.degree === next.degree ? "chords held longer" : `the move ${ROMAN[prev.degree]} → ${ROMAN[next.degree]}`);
      x[mv] = 1;
    }
    return x;
  }

  /** A Thompson draw of your chord taste, as a log-space bonus for the Markov chord model. */
  chordBonus(): (prev: Chord | null, next: Chord) => number {
    // Harmony explores more gently than texture: wrong chords hurt more than a different arpeggio.
    const sample = this.model.sampler(this.rng, this.exploration * 0.5);
    return (prev, next) => 3 * sample(this.chordFeatures(prev, next));
  }

  logChord(step: number, prev: Chord | null, next: Chord) {
    this.chordLog = this.chordLog.filter((c) => c.step !== step);
    this.chordLog.push({ step, x: this.chordFeatures(prev, next), label: next.name });
  }

  clearChords() {
    this.chordLog = [];
  }

  /** What was chosen for a part/decision at a bar (for UI and tests). */
  choiceAt(key: string, bar: number): string | undefined {
    return this.segs.get(key)?.find((s) => s.fromBar <= bar && bar < s.toBar)?.choice;
  }

  // ---------------------------------------------------------------- feedback

  /** Let future bars be decided afresh (after a 👎). */
  resample(fromBar: number) {
    for (const [k, list] of this.segs) {
      const kept = list.filter((s) => s.fromBar < fromBar).map((s) => ({ ...s, toBar: Math.min(s.toBar, fromBar) }));
      this.segs.set(k, kept);
    }
  }

  /** Credit what was sounding at `step` with reward r. Returns what was credited, biggest first. */
  feedback(r: number, step: number): Credit[] {
    const bar = Math.floor(step / this.barSteps);
    const credits = new Map<string, number>();
    const give = (x: Features, e: number) => {
      this.model.update(x, r * e);
      for (const k in x) credits.set(k, (credits.get(k) ?? 0) + Math.abs(x[k] * e));
    };
    for (const [key, list] of this.segs) {
      const s = list.find((g) => g.fromBar <= bar && bar < g.toBar);
      if (!s) continue;
      give(s.x, key.startsWith("part:") ? 0.8 : 0.6);
    }
    for (const c of this.chordLog) {
      const age = step - c.step;
      if (age < 0 || age > 2 * this.barSteps) continue;
      give(c.x, Math.exp(-age / this.barSteps));
    }
    this.model.ratings++;
    return this.describe(credits);
  }

  /** Mild signal about one part (e.g. you muted it). */
  feedbackPart(partId: string, r: number, step: number): Credit[] {
    const bar = Math.floor(step / this.barSteps);
    const s = this.segs.get(`part:${partId}`)?.find((g) => g.fromBar <= bar && bar < g.toBar);
    if (!s) return [];
    this.model.update(s.x, r);
    return this.describe(new Map(Object.entries(s.x)));
  }

  /** Mild signal about everything that was used (e.g. a take played through). */
  feedbackAll(r: number) {
    for (const list of this.segs.values()) for (const s of list) this.model.update(s.x, r);
  }

  private describe(credits: Map<string, number>): Credit[] {
    const labels = new Map(this.model.summary(0).map((e) => [e.key, e.label]));
    return [...credits]
      .filter(([k]) => !k.startsWith("tex:" + this.style.id.split("/")[0] + ":")) // style-specific twins read the same
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, w]) => ({ label: labels.get(k) ?? k, weight: w }));
  }
}
