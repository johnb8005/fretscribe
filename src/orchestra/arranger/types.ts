import type { ScaleDef } from "../../theory/theory";

/** 16th-note grid. */
export const STEPS_PER_BEAT = 4;

export interface QNote {
  midi: number;
  /** Start, in 16th steps from bar 1 beat 1. */
  step: number;
  /** Length in 16th steps. */
  dur: number;
  vel: number;
  /** sfz / accent. */
  accent?: boolean;
}

export interface KeyInfo {
  root: number;
  scale: ScaleDef;
}

export type Quality = "maj" | "min" | "dim" | "aug";

export interface Chord {
  root: number;
  quality: Quality;
  /** 0..6 scale degree in the key. */
  degree: number;
  /** Triad pitch classes, root first. */
  tones: number[];
  /** Added colour tones (7th, 9th) as pitch classes. */
  colors: number[];
  name: string;
  roman: string;
}

export interface ChordSlot {
  step: number;
  dur: number;
  chord: Chord;
}

export type Role =
  | "melody"
  | "double"
  | "pad"
  | "pulse"
  | "oompah"
  | "arp"
  | "ostinato"
  | "bass"
  | "walk"
  | "counter"
  | "perc"
  | "timpani"
  | "swell";

export interface Hit {
  /** Position within the bar, in steps. */
  step: number;
  midi: number;
  vel: number;
}

export interface PartSpec {
  id: string;
  /** What the part does, shown in the mixer ("Melody", "Ostinato", …). */
  label: string;
  role: Role;
  patch: string;
  register: [number, number];
  level: number;
  pan: number;
  reverb: number;
  echo?: number;
  brightness?: number;
  vel?: number;
  /** double: octave offset from the melody part. */
  octave?: number;
  /** arp / ostinato / pulse: note spacing in steps. */
  rate?: number;
  /** arp shape. */
  shape?: "up" | "updown" | "alberti" | "broken";
  /** arp: how many chord tones in the cycle. */
  span?: number;
  /** ostinato: indexes into [root, 5th, 8ve, 3rd+8ve, 5th+8ve]; -1 = rest. */
  cell?: number[];
  /** pad: number of voices. */
  voices?: number;
  /** pad: re-strike the chord every N steps instead of holding it. */
  restrike?: number;
  /** pulse: bar positions (steps) to strike; and note length. */
  at?: number[];
  hitDur?: number;
  /** bass pattern. */
  pattern?: "root" | "rootFifth" | "pulse8" | "oom";
  /** percussion hits per bar, and an optional fill on phrase-ending bars. */
  hits?: Hit[];
  fill?: Hit[];
  /** Dynamic offset from the orchestra level (default by role). */
  dyn?: number;
}

export interface Part {
  spec: PartSpec;
  notes: QNote[];
  /** Dynamic level per bar (0 = pp … 5 = ff). */
  levels?: number[];
}

export interface StyleDef {
  id: string;
  name: string;
  blurb: string;
  bpm: number;
  /** Bar length in quarter notes (6/8 → 3). */
  beatsPerBar: number;
  /** Written time signature, when it isn't n/4 (e.g. [6, 8]). */
  timeSig?: [number, number];
  /** 0..1 — delays off-beat 8ths up to a triplet feel. */
  swing: number;
  /** Beats per chord. */
  harmonicRhythm: number;
  color: "triad" | "seventh" | "ninth";
  /** Use a major V (harmonic minor) in minor keys. */
  minorDominant: boolean;
  /** Multipliers for moving *to* degree I..vii. */
  degreeBias: number[];
  /** Melody quantisation grid in steps (2 = 8ths). */
  melodyGrid: number;
  /** Home dynamic, 0 = pp … 5 = ff (default mf). */
  dynamicBase?: number;
  parts: PartSpec[];
  master: {
    hallSize: number;
    hallMix: number;
    echoBeats: number;
    echoFeedback: number;
    warmth: number;
    air: number;
  };
}

export interface Arrangement {
  style: StyleDef;
  key: KeyInfo;
  beatsPerBar: number;
  melody: QNote[];
  chords: ChordSlot[];
  parts: Part[];
  totalSteps: number;
  /** Orchestra-wide dynamic per bar. */
  dynamics?: number[];
}
