// Turns a stream of per-frame pitch estimates into discrete note events
// (onset / offset), with stability filtering and re-attack detection.

import type { PitchResult } from "./pitch";
import { freqToMidiFloat } from "../theory/theory";

export interface NoteEvent {
  id: number;
  midi: number;
  start: number; // seconds
  end: number | null; // null while sounding
  freq: number;
  peakRms: number;
}

export interface TrackerConfig {
  /** RMS below this is silence. */
  gate: number;
  minClarity: number;
  /** Consecutive frames a pitch must hold before it becomes a note. */
  stableFrames: number;
  /** Frames of silence/unpitched before a sounding note is released. */
  releaseFrames: number;
  /** Short-window RMS jump factor that counts as a (re-)pluck. */
  onsetRatio: number;
  /** Frames an onset stays "armed" waiting for a clear pitch. */
  onsetLatch: number;
  /** Extra semitones a pitch may drift from the sounding note before it
   *  counts as a new note (0 for guitar; ~0.3 for voice vibrato/scoops). */
  hysteresis: number;
  /** How far behind "now" the pitch detector's window is centred (s). */
  pitchLag: number;
}

export const DEFAULT_TRACKER: TrackerConfig = {
  gate: 0.008,
  minClarity: 0.8,
  stableFrames: 3,
  releaseFrames: 6,
  onsetRatio: 1.6,
  onsetLatch: 8,
  hysteresis: 0,
  pitchLag: 0.03,
};

export type TrackerListener = (type: "on" | "off", note: NoteEvent) => void;

export class NoteTracker {
  cfg: TrackerConfig;
  active: NoteEvent | null = null;
  private candidate = -1;
  private candidateCount = 0;
  private candidateStart = 0;
  private missCount = 0;
  private prevShort = 0;
  private onsetArmed = 0;
  private onsetTime = 0;
  private sameSinceOnset = 0;
  private nextId = 1;
  private listeners = new Set<TrackerListener>();

  constructor(cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...DEFAULT_TRACKER, ...cfg };
  }

  on(fn: TrackerListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(type: "on" | "off", n: NoteEvent) {
    for (const l of this.listeners) l(type, n);
  }

  private release(t: number) {
    if (!this.active) return;
    this.active.end = t;
    const n = this.active;
    this.active = null;
    this.emit("off", n);
  }

  private attack(midi: number, freq: number, t: number, level: number) {
    this.release(t);
    this.active = { id: this.nextId++, midi, start: t, end: null, freq, peakRms: level };
    this.emit("on", this.active);
  }

  /**
   * @param level      RMS over the analysis window (~43 ms) — gating.
   * @param shortLevel RMS over the newest ~10 ms — onset detection.
   */
  update(pitch: PitchResult | null, level: number, t: number, shortLevel = level): void {
    const { cfg } = this;
    if (shortLevel > cfg.gate && shortLevel > this.prevShort * cfg.onsetRatio) {
      this.onsetArmed = cfg.onsetLatch;
      this.onsetTime = t;
      this.sameSinceOnset = 0;
    }
    this.prevShort = shortLevel;

    const voiced = pitch !== null && level >= cfg.gate && pitch.clarity >= cfg.minClarity;
    if (!voiced) {
      this.candidateCount = 0;
      if (this.onsetArmed > 0) this.onsetArmed--;
      if (this.active && ++this.missCount >= cfg.releaseFrames) this.release(t);
      return;
    }
    const mf = freqToMidiFloat(pitch.freq);
    const midi =
      this.active && Math.abs(mf - this.active.midi) < 0.5 + cfg.hysteresis ? this.active.midi : Math.round(mf);
    // A different (not yet stable) pitch also counts against the sounding note,
    // otherwise a note can "hang" through a strummed chord.
    if (this.active && this.active.midi !== midi) {
      if (++this.missCount >= cfg.releaseFrames) this.release(t);
    } else this.missCount = 0;

    if (midi === this.candidate) this.candidateCount++;
    else {
      this.candidate = midi;
      this.candidateCount = 1;
      this.candidateStart = t;
    }

    if (this.active && this.active.midi === midi) {
      this.active.freq = this.active.freq * 0.8 + pitch.freq * 0.2;
      this.active.peakRms = Math.max(this.active.peakRms, level);
      // Re-pluck of the same note: only once the pitch is confirmed *after*
      // the onset (an onset on a note's last frame is usually the next note).
      if (this.onsetArmed > 0) {
        this.sameSinceOnset++;
        if (this.sameSinceOnset >= cfg.stableFrames && this.onsetTime - this.active.start > 0.06) {
          this.onsetArmed = 0;
          this.attack(midi, pitch.freq, this.onsetTime, level);
        } else this.onsetArmed--;
      }
      return;
    }
    this.sameSinceOnset = 0;
    if (this.candidateCount >= cfg.stableFrames) {
      // Legato notes have no attack: date them from when the new pitch first appeared.
      const start = this.onsetArmed > 0 ? this.onsetTime : Math.max(this.active?.start ?? -Infinity, this.candidateStart - cfg.pitchLag);
      this.onsetArmed = 0;
      this.attack(midi, pitch.freq, start, level);
    } else if (this.onsetArmed > 0) this.onsetArmed--;
  }

  reset() {
    this.active = null;
    this.candidate = -1;
    this.candidateCount = 0;
    this.missCount = 0;
    this.prevShort = 0;
    this.onsetArmed = 0;
  }
}
