// Pure-TS analysis pipeline: raw samples in → notes, key, chords out.
// No DOM / Web Audio dependency, so it's unit-testable with synthetic audio.

import { FFT } from "../dsp/fft";
import { YinDetector, rms, type PitchResult } from "../dsp/pitch";
import { SpectralAnalyzer } from "../dsp/spectral";
import { NoteTracker, type NoteEvent } from "../dsp/noteTracker";
import { ChordHMM, KeyDetector, type ChordCandidate, type KeyEstimate } from "../theory/markov";
import { freqToMidiFloat, pc } from "../theory/theory";

export const FFT_SIZE = 8192;

export interface PitchInfo extends PitchResult {
  midi: number;
  cents: number;
}

export interface ChordChange {
  name: string;
  root: number;
  start: number;
}

export interface AnalysisFrame {
  t: number;
  level: number;
  pitch: PitchInfo | null;
  activeNote: NoteEvent | null;
  chroma: number[];
  chords: ChordCandidate[];
  chord: ChordCandidate | null;
  key: KeyEstimate;
}

export class Analyzer {
  readonly sampleRate: number;
  readonly fft = new FFT(FFT_SIZE);
  readonly yin: YinDetector;
  readonly spectral: SpectralAnalyzer;
  readonly tracker = new NoteTracker();
  readonly keys = new KeyDetector();
  readonly chordHmm = new ChordHMM();

  /** Completed + active notes, newest last. */
  readonly notes: NoteEvent[] = [];
  readonly progression: ChordChange[] = [];
  maxNotes = 400;

  private chroma = new Float64Array(12);
  private keyEstimate: KeyEstimate;
  private lastKeyUpdate = -Infinity;
  private currentChord: ChordCandidate | null = null;
  private pendingChord = -1;
  private pendingSince = 0;
  /** A chord must lead the HMM posterior this long (s) before it's committed. */
  chordHold = 0.12;
  /** Longer hold before a chord is written into the progression log. */
  progressionHold = 0.35;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.yin = new YinDetector(sampleRate);
    this.spectral = new SpectralAnalyzer(sampleRate, FFT_SIZE);
    this.keyEstimate = this.keys.analyze();

    this.tracker.on((type, n) => {
      if (type === "on") {
        this.notes.push(n);
        if (this.notes.length > this.maxNotes) this.notes.splice(0, this.notes.length - this.maxNotes);
        this.keys.noteOn(n.midi, n.start);
        this.lastKeyUpdate = -Infinity; // force refresh
      } else {
        this.keys.noteOff(n.midi, (n.end ?? n.start) - n.start, n.end ?? n.start);
      }
    });
  }

  /** Spectral bars (0..1) for display, valid after `process`. */
  get spectrumBars(): Float32Array {
    return this.spectral.bars;
  }

  /** Chroma from recently played notes — catches arpeggios that FFT frames miss. */
  private noteChroma(t: number): Float64Array {
    const c = new Float64Array(12);
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      const age = t - (n.end ?? t);
      if (t - n.start > 3) break;
      c[pc(n.midi)] += Math.exp(-age / 0.7) * (n.end === null ? 1.2 : 1);
    }
    // Only scale *down* — faded memories must stay faint, not be re-inflated.
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += c[i] * c[i];
    norm = Math.sqrt(norm);
    if (norm > 1) for (let i = 0; i < 12; i++) c[i] /= norm;
    return c;
  }

  process(samples: Float32Array, t: number): AnalysisFrame {
    const level = rms(samples, 2048);
    const gated = level >= this.tracker.cfg.gate;

    const raw = this.yin.detect(samples);
    let pitch: PitchInfo | null = null;
    if (raw && gated && raw.clarity >= this.tracker.cfg.minClarity) {
      const mf = freqToMidiFloat(raw.freq);
      const midi = Math.round(mf);
      pitch = { ...raw, midi, cents: (mf - midi) * 100 };
    }
    this.tracker.update(raw, level, t, rms(samples, 512));

    const mags = this.fft.magnitude(samples);
    this.spectral.process(mags);

    // Chroma for chords: smoothed spectral chroma blended with note memory.
    const nc = this.noteChroma(t);
    let norm = 0;
    for (let i = 0; i < 12; i++) {
      const frame = gated ? this.spectral.chroma[i] : 0;
      this.chroma[i] = 0.6 * this.chroma[i] + 0.4 * (0.65 * frame + 0.35 * nc[i]);
      norm += this.chroma[i] * this.chroma[i];
    }
    norm = Math.sqrt(norm);
    const chromaN = Array.from(this.chroma, (v) => (norm > 0.05 ? v / norm : 0));

    // Key: refresh on new notes or every 250 ms.
    if (t - this.lastKeyUpdate > 0.25) {
      this.keyEstimate = this.keys.analyze();
      this.lastKeyUpdate = t;
      const best = this.keyEstimate.best;
      if (best && best.prob > 0.2) this.chordHmm.setKey(best.root, best.scale);
    }

    this.chordHmm.step(chromaN);
    const chords = this.chordHmm.top(5);
    const top = chords[0];
    if (top.index !== this.pendingChord) {
      this.pendingChord = top.index;
      this.pendingSince = t;
    }
    const held = t - this.pendingSince >= this.chordHold;
    if (top.quality === null) {
      if (held && top.prob > 0.6) this.currentChord = null;
    } else if (this.currentChord && top.index === this.currentChord.index) {
      this.currentChord = top;
    } else if (held && top.prob > 0.4) {
      this.currentChord = top;
    }
    const c = this.currentChord;
    if (c && c.index === top.index && t - this.pendingSince >= this.progressionHold) {
      const last = this.progression[this.progression.length - 1];
      if (!last || last.name !== c.name) {
        this.progression.push({ name: c.name, root: c.root, start: this.pendingSince });
        if (this.progression.length > 64) this.progression.shift();
      }
    }

    return {
      t,
      level,
      pitch,
      activeNote: this.tracker.active,
      chroma: chromaN,
      chords,
      chord: this.currentChord,
      key: this.keyEstimate,
    };
  }

  reset() {
    this.notes.length = 0;
    this.progression.length = 0;
    this.tracker.reset();
    this.keys.reset();
    this.chordHmm.reset();
    this.chroma.fill(0);
    this.currentChord = null;
    this.keyEstimate = this.keys.analyze();
  }
}
