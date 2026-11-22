// Demo tunes (all public domain), so you can hear the orchestra without singing.
// Durations are in 16th steps; a midi of -1 is a rest.

import type { TimeSig } from "./meter";
import type { QNote } from "./types";

export interface Tune {
  id: string;
  name: string;
  composer: string;
  sig: TimeSig;
  notes: QNote[];
}

function build(seq: [number, number][]): QNote[] {
  let step = 0;
  const out: QNote[] = [];
  for (const [midi, dur] of seq) {
    if (midi >= 0) out.push({ midi, step, dur, vel: 0.8 });
    step += dur;
  }
  return out;
}

const e = 2, q = 4, h = 8;

export const TUNES: Tune[] = [
  {
    id: "ode",
    name: "Ode to Joy",
    composer: "Beethoven",
    sig: [4, 4],
    notes: build([
      [64, q], [64, q], [65, q], [67, q], [67, q], [65, q], [64, q], [62, q],
      [60, q], [60, q], [62, q], [64, q], [64, q * 1.5], [62, e], [62, h],
      [64, q], [64, q], [65, q], [67, q], [67, q], [65, q], [64, q], [62, q],
      [60, q], [60, q], [62, q], [64, q], [62, q * 1.5], [60, e], [60, h],
    ]),
  },
  {
    id: "minuet",
    name: "Minuet in G",
    composer: "Petzold",
    sig: [3, 4],
    notes: build([
      // D5 G A B C | D G G | E C D E F# | G G G
      [74, q], [67, e], [69, e], [71, e], [72, e],
      [74, q], [67, q], [67, q],
      [76, q], [72, e], [74, e], [76, e], [78, e],
      [79, q], [67, q], [67, q],
      // C D C B A | B C B A G | F# G A B G | A
      [72, q], [74, e], [72, e], [71, e], [69, e],
      [71, q], [72, e], [71, e], [69, e], [67, e],
      [66, q], [67, e], [69, e], [71, e], [67, e],
      [69, q * 3],
      // second strain: same opening, cadence on G
      [74, q], [67, e], [69, e], [71, e], [72, e],
      [74, q], [67, q], [67, q],
      [76, q], [72, e], [74, e], [76, e], [78, e],
      [79, q], [67, q], [67, q],
      [72, q], [74, e], [72, e], [71, e], [69, e],
      [71, q], [72, e], [71, e], [69, e], [67, e],
      [69, q], [71, e], [69, e], [67, e], [66, e],
      [67, q * 3],
    ]),
  },
  {
    id: "greensleeves",
    name: "Greensleeves",
    composer: "Traditional",
    sig: [6, 8],
    notes: build([
      // pickup: rest for most of an opening bar, then A
      [-1, 10], [69, e],
      // C . D | E . F E | D . B | G . A B
      [72, q], [74, e], [76, 3], [77, 1], [76, e],
      [74, q], [71, e], [67, 3], [69, 1], [71, e],
      // C . A | A . G# A | B . G# | E . A
      [72, q], [69, e], [69, 3], [68, 1], [69, e],
      [71, q], [68, e], [64, q], [69, e],
      // repeat of the opening, then the cadence
      [72, q], [74, e], [76, 3], [77, 1], [76, e],
      [74, q], [71, e], [67, 3], [69, 1], [71, e],
      [72, 3], [71, 1], [69, e], [68, 3], [66, 1], [68, e],
      [69, 12],
    ]),
  },
];

export const TUNE_BY_ID: Record<string, Tune> = Object.fromEntries(TUNES.map((t) => [t.id, t]));
