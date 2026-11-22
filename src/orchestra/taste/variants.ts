// The bandit's arms: different ways each part can play the same harmony.
// Every role has the style's own writing ("as written") plus alternatives,
// including resting (tacet). A variant returns a modified PartSpec, or null
// for tacet.

import { KIT } from "../synth/patches";
import { STEPS_PER_BEAT, type PartSpec, type Role, type StyleDef } from "../arranger/types";

export interface Variant {
  id: string;
  /** Phrase that follows the part's name: "harp in broken chords". */
  label: string;
  apply: (spec: PartSpec, style: StyleDef) => PartSpec | null;
}

const asWritten: Variant = { id: "default", label: "as written", apply: (s) => s };
const tacet: Variant = { id: "tacet", label: "resting", apply: () => null };

const beats = (style: StyleDef) => Array.from({ length: style.beatsPerBar }, (_, i) => i * STEPS_PER_BEAT);

export const VARIANTS: Partial<Record<Role, Variant[]>> = {
  arp: [
    asWritten,
    { id: "up8", label: "in rising 8ths", apply: (s) => ({ ...s, shape: "up", rate: 2, span: 6 }) },
    { id: "updown8", label: "in up-and-down arpeggios", apply: (s) => ({ ...s, shape: "updown", rate: 2, span: 6 }) },
    { id: "up16", label: "in rippling 16ths", apply: (s) => ({ ...s, shape: "up", rate: 1, span: 8 }) },
    { id: "alberti", label: "in Alberti figures", apply: (s) => ({ ...s, shape: "alberti", rate: 2, span: 3 }) },
    { id: "broken", label: "in broken chords", apply: (s) => ({ ...s, shape: "broken", rate: 2, span: 3 }) },
  ],
  ostinato: [
    asWritten,
    { id: "roots8", label: "pulsing on the root", apply: (s) => ({ ...s, cell: [0], rate: 2 }) },
    { id: "rock8", label: "rocking in 8ths", apply: (s) => ({ ...s, cell: [0, 1], rate: 2 }) },
    { id: "climb16", label: "climbing in 16ths", apply: (s) => ({ ...s, cell: [0, 1, 2, 3], rate: 1 }) },
    tacet,
  ],
  pad: [
    asWritten,
    { id: "thin", label: "in two voices", apply: (s) => ({ ...s, voices: 2 }) },
    { id: "full", label: "in four voices", apply: (s) => ({ ...s, voices: 4 }) },
    { id: "restrike", label: "re-struck every half bar", apply: (s, st) => ({ ...s, restrike: (st.beatsPerBar * STEPS_PER_BEAT) / 2 }) },
    tacet,
  ],
  pulse: [
    asWritten,
    { id: "beats", label: "on the beat", apply: (s, st) => ({ ...s, at: beats(st), hitDur: STEPS_PER_BEAT - 1 }) },
    { id: "eighths", label: "in driving 8ths", apply: (s, st) => ({ ...s, at: Array.from({ length: st.beatsPerBar * 2 }, (_, i) => i * 2), hitDur: 2 }) },
    { id: "synco", label: "syncopated", apply: (s) => ({ ...s, at: [0, 3, 6, 10, 12], hitDur: 2 }) },
    tacet,
  ],
  oompah: [asWritten, { id: "pah2", label: "on one off-beat", apply: (s) => ({ ...s, role: "pulse", at: [STEPS_PER_BEAT], hitDur: STEPS_PER_BEAT }) }, tacet],
  bass: [
    asWritten,
    { id: "root", label: "in long notes", apply: (s) => ({ ...s, pattern: "root" }) },
    { id: "rootFifth", label: "on root and fifth", apply: (s) => ({ ...s, pattern: "rootFifth" }) },
    { id: "pulse8", label: "pulsing in 8ths", apply: (s) => ({ ...s, pattern: "pulse8" }) },
  ],
  walk: [asWritten, { id: "halves", label: "in half notes", apply: (s) => ({ ...s, role: "bass", pattern: "rootFifth" }) }],
  counter: [asWritten, tacet],
  double: [asWritten, tacet],
  perc: [
    asWritten,
    {
      id: "sparse",
      label: "kept sparse",
      apply: (s, st) => ({ ...s, hits: (s.hits ?? []).filter((h) => h.step % ((st.beatsPerBar * STEPS_PER_BEAT) / 2) === 0), fill: undefined }),
    },
    {
      id: "busy",
      label: "busier",
      apply: (s) => ({
        ...s,
        hits: [...(s.hits ?? []), ...(s.hits ?? []).filter((h) => h.midi !== KIT.SWELL).map((h) => ({ ...h, step: h.step + 2, vel: h.vel * 0.55 }))],
      }),
    },
    tacet,
  ],
  timpani: [asWritten, tacet],
  swell: [asWritten, tacet],
};

export const COLORS: { id: StyleDef["color"]; label: string }[] = [
  { id: "triad", label: "plain triads" },
  { id: "seventh", label: "seventh chords" },
  { id: "ninth", label: "lush ninth chords" },
];

export const DYN_SHIFTS = [
  { id: -1, label: "softer playing" },
  { id: 0, label: "the style's own dynamics" },
  { id: 1, label: "louder playing" },
];
