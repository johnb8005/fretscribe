// Ensembles. A formation re-casts a style's parts onto real players: each
// seat accepts roles in priority order, so the figures a style asks for
// (ostinato, arpeggio, walking bass…) land on an instrument that can play them.

import type { PartSpec, Role, StyleDef } from "./types";

interface Seat {
  id: string;
  label: string;
  patch: string;
  register: [number, number];
  /** Roles this player can take, most suitable first. */
  accepts: Role[];
  /** Max simultaneous notes (double-stops, a pianist's hand). */
  voices?: number;
  level: number;
  pan: number;
  reverb: number;
}

export interface Formation {
  id: string;
  name: string;
  blurb: string;
  seats?: Seat[];
  /** Hall scale for smaller groups. */
  hall?: number;
  transform?: (parts: PartSpec[], style: StyleDef) => PartSpec[];
}

const seat = (s: Seat) => s;

export const FORMATIONS: Formation[] = [
  {
    id: "full",
    name: "Full orchestra",
    blurb: "Everything the style calls for.",
  },
  {
    id: "chamber",
    name: "Chamber orchestra",
    blurb: "Strings, a few winds and horns, timpani. No choir or big percussion.",
    hall: 0.8,
    transform: (parts, style) =>
      parts
        .filter((p) => p.role !== "swell" && !(p.role === "perc" && style.swing === 0))
        .map((p) => {
          const swap: Record<string, string> = { choir: "strings", lowBrass: "bassoon", taiko: "timpani" };
          const patch = swap[p.patch] ?? p.patch;
          return { ...p, patch, level: p.level * (p.patch === "choir" ? 0.8 : 1) };
        }),
  },
  {
    id: "quartet",
    name: "String quartet",
    blurb: "Two violins, viola and cello.",
    hall: 0.55,
    seats: [
      seat({ id: "vln1", label: "Violin I", patch: "soloViolin", register: [62, 91], accepts: ["melody"], level: 0.9, pan: -0.45, reverb: 0.3 }),
      seat({ id: "vln2", label: "Violin II", patch: "soloViolin", register: [55, 84], accepts: ["ostinato", "arp", "counter", "pulse", "oompah", "double"], voices: 1, level: 0.6, pan: -0.15, reverb: 0.3 }),
      seat({ id: "vla", label: "Viola", patch: "viola", register: [48, 74], accepts: ["pad", "oompah", "counter", "arp", "pulse"], voices: 2, level: 0.55, pan: 0.15, reverb: 0.3 }),
      seat({ id: "vc", label: "Cello", patch: "cello", register: [36, 62], accepts: ["bass", "walk", "counter"], level: 0.75, pan: 0.45, reverb: 0.3 }),
    ],
  },
  {
    id: "winds",
    name: "Wind quintet",
    blurb: "Flute, oboe, clarinet, horn and bassoon.",
    hall: 0.6,
    seats: [
      seat({ id: "fl", label: "Flute", patch: "flute", register: [64, 91], accepts: ["melody"], level: 0.85, pan: -0.35, reverb: 0.35 }),
      seat({ id: "ob", label: "Oboe", patch: "oboe", register: [60, 84], accepts: ["counter", "double", "ostinato", "pulse"], voices: 1, level: 0.55, pan: -0.1, reverb: 0.3 }),
      seat({ id: "cl", label: "Clarinet", patch: "clarinet", register: [52, 79], accepts: ["arp", "ostinato", "pulse", "oompah", "pad"], voices: 1, level: 0.55, pan: 0.15, reverb: 0.3 }),
      seat({ id: "hn", label: "Horn", patch: "horns", register: [48, 70], accepts: ["pad", "oompah", "counter"], voices: 1, level: 0.5, pan: 0.35, reverb: 0.4 }),
      seat({ id: "bn", label: "Bassoon", patch: "bassoon", register: [34, 58], accepts: ["bass", "walk"], level: 0.7, pan: 0.1, reverb: 0.3 }),
    ],
  },
  {
    id: "brass",
    name: "Brass quintet",
    blurb: "Two trumpets, horn, trombone and tuba.",
    hall: 0.7,
    seats: [
      seat({ id: "tp1", label: "Trumpet I", patch: "trumpets", register: [60, 82], accepts: ["melody"], level: 0.8, pan: -0.4, reverb: 0.35 }),
      seat({ id: "tp2", label: "Trumpet II", patch: "trumpets", register: [55, 77], accepts: ["counter", "double", "pulse", "ostinato"], voices: 1, level: 0.5, pan: -0.15, reverb: 0.35 }),
      seat({ id: "hn", label: "Horn", patch: "horns", register: [48, 70], accepts: ["pad", "oompah", "arp", "counter"], voices: 1, level: 0.55, pan: 0.1, reverb: 0.4 }),
      seat({ id: "tbn", label: "Trombone", patch: "lowBrass", register: [40, 65], accepts: ["arp", "ostinato", "pad", "oompah", "pulse"], voices: 1, level: 0.5, pan: 0.3, reverb: 0.35 }),
      seat({ id: "tba", label: "Tuba", patch: "lowBrass", register: [28, 50], accepts: ["bass", "walk"], level: 0.7, pan: 0.05, reverb: 0.3 }),
    ],
  },
  {
    id: "piano",
    name: "Solo piano",
    blurb: "One pianist: tune in the right hand, accompaniment in the left.",
    hall: 0.5,
    seats: [
      seat({ id: "rh", label: "Right hand", patch: "piano", register: [60, 88], accepts: ["melody"], level: 0.9, pan: 0.1, reverb: 0.3 }),
      seat({ id: "lh", label: "Left hand", patch: "piano", register: [45, 67], accepts: ["oompah", "arp", "pulse", "pad", "ostinato"], voices: 3, level: 0.55, pan: -0.05, reverb: 0.3 }),
      seat({ id: "bass", label: "Bass notes", patch: "piano", register: [28, 50], accepts: ["bass", "walk"], level: 0.6, pan: -0.15, reverb: 0.3 }),
    ],
  },
];

export const FORMATION_BY_ID: Record<string, Formation> = Object.fromEntries(FORMATIONS.map((f) => [f.id, f]));

/** The style as played by this ensemble (a new style id, so mixer tweaks are kept per ensemble). */
export function applyFormation(style: StyleDef, f: Formation): StyleDef {
  if (f.id === "full") return style;
  let parts: PartSpec[];
  if (f.transform) parts = f.transform(style.parts, style);
  else {
    const used = new Set<string>();
    parts = [];
    for (const s of f.seats ?? []) {
      let pick: PartSpec | undefined;
      for (const role of s.accepts) {
        pick = style.parts.find((p) => p.role === role && !used.has(p.id));
        if (pick) break;
      }
      if (!pick) continue;
      used.add(pick.id);
      parts.push({
        ...pick,
        id: s.id,
        label: s.label,
        patch: s.patch,
        register: s.register,
        voices: Math.min(pick.voices ?? 3, s.voices ?? 3),
        level: s.level,
        pan: s.pan,
        reverb: s.reverb,
        brightness: undefined,
      });
    }
  }
  const hall = f.hall ?? 1;
  return {
    ...style,
    id: `${style.id}/${f.id}`,
    parts,
    master: { ...style.master, hallSize: style.master.hallSize * hall, hallMix: style.master.hallMix * (0.6 + 0.4 * hall) },
  };
}
