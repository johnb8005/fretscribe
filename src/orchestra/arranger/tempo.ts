// Italian tempo terms ↔ metronome marks.

export interface TempoTerm {
  name: string;
  /** Typical mark when the term is chosen. */
  bpm: number;
  /** Lowest bpm that still reads as this term. */
  from: number;
  meaning: string;
}

export const TEMPO_TERMS: TempoTerm[] = [
  { name: "Grave", bpm: 40, from: 0, meaning: "very slow, solemn" },
  { name: "Largo", bpm: 50, from: 45, meaning: "broadly" },
  { name: "Larghetto", bpm: 63, from: 60, meaning: "rather broadly" },
  { name: "Adagio", bpm: 70, from: 66, meaning: "slow, at ease" },
  { name: "Andante", bpm: 88, from: 76, meaning: "at a walking pace" },
  { name: "Moderato", bpm: 110, from: 108, meaning: "moderately" },
  { name: "Allegretto", bpm: 118, from: 114, meaning: "fairly brisk" },
  { name: "Allegro", bpm: 138, from: 125, meaning: "fast, bright" },
  { name: "Vivace", bpm: 164, from: 156, meaning: "lively" },
  { name: "Presto", bpm: 184, from: 176, meaning: "very fast" },
  { name: "Prestissimo", bpm: 208, from: 200, meaning: "as fast as possible" },
];

export function termFor(bpm: number): TempoTerm {
  let t = TEMPO_TERMS[0];
  for (const x of TEMPO_TERMS) if (bpm >= x.from) t = x;
  return t;
}
