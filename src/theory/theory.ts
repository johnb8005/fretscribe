// Basic music theory primitives: pitch classes, scales, chords, spelling.

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const pc = (n: number) => ((n % 12) + 12) % 12;

export function pcName(p: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[pc(p)];
}

export function midiToName(midi: number, flats = false): string {
  return pcName(midi, flats) + (Math.floor(midi / 12) - 1);
}

export function freqToMidiFloat(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------- scales

export type ScaleId =
  | "major"
  | "minor"
  | "dorian"
  | "mixolydian"
  | "harmonicMinor"
  | "majorPent"
  | "minorPent"
  | "blues";

export interface ScaleDef {
  id: ScaleId;
  name: string;
  short: string;
  intervals: number[];
  /** Prior belief that a random guitarist is in this scale. */
  prior: number;
  /** 7-note parent used to build diatonic chords (for pentatonics / blues). */
  harmonicParent: number[];
  /** Offset of the parent's tonic relative to this scale's root. */
  parentIsMinor: boolean;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];

export const SCALES: ScaleDef[] = [
  { id: "major", name: "Major (Ionian)", short: "major", intervals: MAJOR, prior: 1.0, harmonicParent: MAJOR, parentIsMinor: false },
  { id: "minor", name: "Natural minor (Aeolian)", short: "minor", intervals: AEOLIAN, prior: 1.0, harmonicParent: AEOLIAN, parentIsMinor: true },
  { id: "dorian", name: "Dorian", short: "dorian", intervals: [0, 2, 3, 5, 7, 9, 10], prior: 0.55, harmonicParent: [0, 2, 3, 5, 7, 9, 10], parentIsMinor: true },
  { id: "mixolydian", name: "Mixolydian", short: "mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10], prior: 0.55, harmonicParent: [0, 2, 4, 5, 7, 9, 10], parentIsMinor: false },
  { id: "harmonicMinor", name: "Harmonic minor", short: "harm. minor", intervals: [0, 2, 3, 5, 7, 8, 11], prior: 0.45, harmonicParent: [0, 2, 3, 5, 7, 8, 11], parentIsMinor: true },
  { id: "majorPent", name: "Major pentatonic", short: "major pent.", intervals: [0, 2, 4, 7, 9], prior: 0.8, harmonicParent: MAJOR, parentIsMinor: false },
  { id: "minorPent", name: "Minor pentatonic", short: "minor pent.", intervals: [0, 3, 5, 7, 10], prior: 0.9, harmonicParent: AEOLIAN, parentIsMinor: true },
  { id: "blues", name: "Blues", short: "blues", intervals: [0, 3, 5, 6, 7, 10], prior: 0.6, harmonicParent: AEOLIAN, parentIsMinor: true },
];

export const SCALE_BY_ID: Record<ScaleId, ScaleDef> = Object.fromEntries(
  SCALES.map((s) => [s.id, s]),
) as Record<ScaleId, ScaleDef>;

export function scalePcs(root: number, scale: ScaleDef): number[] {
  return scale.intervals.map((i) => pc(root + i));
}

/** Use flats for keys whose (relative) major is a flat key. */
export function prefersFlats(root: number, scale: ScaleDef): boolean {
  const majorRoot = scale.parentIsMinor ? pc(root + 3) : pc(root);
  return [5, 10, 3, 8, 1].includes(majorRoot);
}

// ---------------------------------------------------------------- chords

export type QualityId = "maj" | "min" | "7" | "maj7" | "m7" | "sus2" | "sus4" | "dim" | "5";

export interface ChordQuality {
  id: QualityId;
  suffix: string;
  intervals: number[];
  prior: number;
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { id: "maj", suffix: "", intervals: [0, 4, 7], prior: 1.0 },
  { id: "min", suffix: "m", intervals: [0, 3, 7], prior: 1.0 },
  { id: "7", suffix: "7", intervals: [0, 4, 7, 10], prior: 0.6 },
  { id: "maj7", suffix: "maj7", intervals: [0, 4, 7, 11], prior: 0.45 },
  { id: "m7", suffix: "m7", intervals: [0, 3, 7, 10], prior: 0.55 },
  { id: "sus2", suffix: "sus2", intervals: [0, 2, 7], prior: 0.3 },
  { id: "sus4", suffix: "sus4", intervals: [0, 5, 7], prior: 0.35 },
  { id: "dim", suffix: "dim", intervals: [0, 3, 6], prior: 0.3 },
  { id: "5", suffix: "5", intervals: [0, 7], prior: 0.35 },
];

export function chordName(root: number, q: ChordQuality, flats = false): string {
  return pcName(root, flats) + q.suffix;
}

export function chordPcs(root: number, q: ChordQuality): number[] {
  return q.intervals.map((i) => pc(root + i));
}

// ---------------------------------------------------------------- diatonic harmony

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export interface DiatonicChord {
  degree: number;
  root: number;
  quality: QualityId;
  roman: string;
  name: string;
}

/** Triads built by stacking thirds inside a 7-note scale. */
export function diatonicTriads(root: number, scale: ScaleDef): DiatonicChord[] {
  const parent = scale.harmonicParent;
  const flats = prefersFlats(root, scale);
  const out: DiatonicChord[] = [];
  for (let d = 0; d < 7; d++) {
    const r = parent[d];
    const third = pc(parent[(d + 2) % 7] - r);
    const fifth = pc(parent[(d + 4) % 7] - r);
    let quality: QualityId = "maj";
    let roman = ROMAN[d];
    if (third === 4 && fifth === 7) quality = "maj";
    else if (third === 3 && fifth === 7) { quality = "min"; roman = roman.toLowerCase(); }
    else if (third === 3 && fifth === 6) { quality = "dim"; roman = roman.toLowerCase() + "°"; }
    else if (third === 4 && fifth === 8) { quality = "maj"; roman = roman + "+"; }
    // Accidentals relative to the major scale (e.g. bIII, bVI, bVII in minor).
    const diff = r - MAJOR[d];
    if (diff === -1) roman = "♭" + roman;
    else if (diff === 1) roman = "♯" + roman;
    const q = CHORD_QUALITIES.find((c) => c.id === quality)!;
    const chordRoot = pc(root + r);
    out.push({ degree: d, root: chordRoot, quality, roman, name: chordName(chordRoot, q, flats) });
  }
  return out;
}

// ---------------------------------------------------------------- guitar

/** Standard tuning, low E (MIDI 40) to high E (MIDI 64). */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
