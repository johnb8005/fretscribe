// Concert-stage seating plan (American seating) and which section plays a part.

import type { PartSpec } from "../arranger/types";

export interface Section {
  id: string;
  label: string;
  /** Radii from the podium and angles (degrees, 0 = straight back, negative = stage left). */
  r0: number;
  r1: number;
  a0: number;
  a1: number;
  chairs: number;
}

export const SECTIONS: Section[] = [
  { id: "vln1", label: "Violins I", r0: 95, r1: 215, a0: -88, a1: -38, chairs: 16 },
  { id: "vln2", label: "Violins II", r0: 95, r1: 215, a0: -36, a1: 4, chairs: 14 },
  { id: "vla", label: "Violas", r0: 95, r1: 215, a0: 6, a1: 46, chairs: 10 },
  { id: "vc", label: "Cellos", r0: 95, r1: 215, a0: 48, a1: 88, chairs: 8 },
  { id: "harp", label: "Harp", r0: 228, r1: 298, a0: -88, a1: -71, chairs: 1 },
  { id: "keys", label: "Keyboard", r0: 228, r1: 298, a0: -69, a1: -50, chairs: 1 },
  { id: "fl", label: "Flutes", r0: 232, r1: 298, a0: -30, a1: -8, chairs: 2 },
  { id: "ob", label: "Oboes", r0: 232, r1: 298, a0: -6, a1: 16, chairs: 2 },
  { id: "cb", label: "Basses", r0: 228, r1: 298, a0: 60, a1: 88, chairs: 6 },
  { id: "hn", label: "Horns", r0: 308, r1: 372, a0: -62, a1: -34, chairs: 4 },
  { id: "cl", label: "Clarinets", r0: 308, r1: 372, a0: -30, a1: -8, chairs: 2 },
  { id: "bn", label: "Bassoons", r0: 308, r1: 372, a0: -6, a1: 16, chairs: 2 },
  { id: "tpt", label: "Trumpets", r0: 382, r1: 446, a0: -24, a1: 4, chairs: 3 },
  { id: "tbn", label: "Trombones", r0: 382, r1: 446, a0: 6, a1: 30, chairs: 3 },
  { id: "tuba", label: "Tuba", r0: 382, r1: 446, a0: 32, a1: 46, chairs: 1 },
  { id: "mallets", label: "Mallets", r0: 456, r1: 520, a0: -50, a1: -20, chairs: 2 },
  { id: "timp", label: "Timpani", r0: 456, r1: 520, a0: -16, a1: 14, chairs: 4 },
  { id: "perc", label: "Percussion", r0: 456, r1: 520, a0: 18, a1: 52, chairs: 3 },
  { id: "choir", label: "Choir", r0: 532, r1: 592, a0: -62, a1: 62, chairs: 30 },
];

/** Ensemble seats that map straight onto a stage section. */
const SEAT_SECTION: Record<string, string[]> = {
  vln1: ["vln1"], vln2: ["vln2"], vla: ["vla"], vc: ["vc"],
  fl: ["fl"], ob: ["ob"], cl: ["cl"], hn: ["hn"], bn: ["bn"],
  tp1: ["tpt"], tp2: ["tpt"], tbn: ["tbn"], tba: ["tuba"],
  rh: ["keys"], lh: ["keys"],
};

/** True for one-player-per-part ensemble seats (quartet, quintets, piano). */
export const isSoloSeat = (partId: string) => partId in SEAT_SECTION;

export const ROLE_NAMES: Record<string, string> = {
  melody: "Melody", double: "Doubling the tune", pad: "Harmony", pulse: "Pulse", oompah: "Off-beats",
  arp: "Arpeggios", ostinato: "Ostinato", bass: "Bass line", walk: "Walking bass", counter: "Counter-line",
  perc: "Rhythm", timpani: "Timpani", swell: "Swells",
};

/** Stage sections that play a part, given the instrument actually assigned to it. */
export function sectionsFor(spec: PartSpec, patch: string): string[] {
  const seat = SEAT_SECTION[spec.id];
  if (seat && seat.length) return seat;
  const c = (spec.register[0] + spec.register[1]) / 2;
  const melody = spec.role === "melody";
  switch (patch) {
    case "strings":
    case "spiccato":
    case "soloViolin":
    case "pizz":
      if (c >= 68) return melody ? ["vln1"] : ["vln2"];
      if (c >= 60) return melody ? ["vln1"] : ["vln2", "vla"];
      if (c >= 50) return ["vla"];
      return ["vc", "cb"];
    case "viola": return ["vla"];
    case "cello": return ["vc"];
    case "lowStrings": return c < 45 ? ["vc", "cb"] : ["vc"];
    case "flute": return ["fl"];
    case "oboe": return ["ob"];
    case "clarinet": return ["cl"];
    case "bassoon": return ["bn"];
    case "horns": return ["hn"];
    case "trumpets":
    case "mutedTrumpet": return ["tpt"];
    case "lowBrass": return c < 45 ? ["tbn", "tuba"] : ["tbn"];
    case "choir": return ["choir"];
    case "harp": return ["harp"];
    case "piano":
    case "harpsichord":
    case "celesta": return ["keys"];
    case "glockenspiel":
    case "marimba": return ["mallets"];
    case "timpani": return ["timp"];
    case "percussion": return ["perc"];
    default: return [];
  }
}
