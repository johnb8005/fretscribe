// The conductor: owns the synth graph and the clock.
//
//   record(): count-in → you hum; the accompaniment is chosen slot by slot
//             (Markov chord choice from what you just sang) and scheduled a
//             little ahead; your melody is doubled live by the lead instrument.
//   stop():   the take is quantised and re-arranged with full knowledge
//             (Viterbi harmonisation) — that's what you hear on play().
//   play():   look-ahead scheduling of the whole arrangement, with swing.

import type { AudioEngine } from "../audio/engine";
import type { NoteEvent } from "../dsp/noteTracker";
import { KeyDetector } from "../theory/markov";
import { SCALE_BY_ID, pc } from "../theory/theory";
import { arrange, generateSlot, quantize, registerShift, totalStepsFor, type GenState, type TimedNote } from "./arranger/arrange";
import { harmonicKey, nextChord, slotEvidence, vocabulary } from "./arranger/harmony";
import { pulseSteps, pulsesPerBar } from "./arranger/meter";
import { Planner, type Credit } from "./taste/planner";
import { loadTaste, saveTaste, type TasteModel } from "./taste/model";
import { DYN_GAIN, applyDynamics } from "./arranger/dynamics";
import { STEPS_PER_BEAT, type Arrangement, type Chord, type ChordSlot, type KeyInfo, type Part, type PartSpec, type QNote, type StyleDef } from "./arranger/types";
import { DEFAULT_CHANNEL, DEFAULT_MASTER, Mixer, type ChannelSettings, type MasterSettings } from "./synth/mixer";
import { PATCH_BY_ID, click, type Voice } from "./synth/patches";

export type TransportState = "idle" | "countIn" | "recording" | "playing";

/** Mic + detection delay we subtract from sung onsets (seconds). */
const INPUT_LATENCY = 0.04;
const LOOKAHEAD = 0.15;
const TICK_MS = 25;

interface PlayingVoice {
  voice: Voice;
  until: number;
}

export class Conductor {
  readonly ctx: AudioContext;
  readonly mixer: Mixer;
  style: StyleDef;
  bpm: number;
  state: TransportState = "idle";
  arrangement: Arrangement | null = null;
  /** Click while recording. */
  metronome = true;
  /** Click during playback too. */
  clickOnPlay = false;
  countIn = true;
  liveMelody = true;
  loop = false;
  /** Your learned taste (persisted) and the planner that uses it. */
  readonly taste: TasteModel = loadTaste();
  planner: Planner;
  private adventure = 0.35;
  private scheduledUntil = -1;

  private overrides = new Map<string, { patch?: string; channel?: Partial<ChannelSettings> }>();
  private masterOverrides = new Map<string, Partial<MasterSettings>>();
  private startTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private voices = new Set<PlayingVoice>();
  private listeners = new Set<() => void>();

  // playback
  private events: { part: PartSpec; note: QNote }[] = [];
  private cursor = 0;

  // recording
  private engine: AudioEngine | null = null;
  private unsubNotes: (() => void) | null = null;
  private captured: (TimedNote & { id: number; open: boolean; peak: number })[] = [];
  private loudest = 1e-4;
  private liveChords: ChordSlot[] = [];
  private liveParts = new Map<string, QNote[]>();
  private liveState = new Map<string, GenState>();
  private liveVoices = new Map<number, Voice[]>();
  private liveShift: number | null = null;
  private liveKey: KeyInfo | null = null;
  private nextClickBeat = 0;
  private recordingFrom = 0;

  constructor(ctx: AudioContext, style: StyleDef) {
    this.ctx = ctx;
    this.style = style;
    this.bpm = style.bpm;
    this.mixer = new Mixer(ctx, ctx.destination, this.master());
    this.planner = new Planner(this.taste, style, this.adventure);
    this.mixer.setTempo(this.quarterBpm);
    this.applyMixer();
  }

  /** Counted beat (♩ or ♩.) in 16th steps. */
  get pulse() {
    return pulseSteps(this.style);
  }

  /** Tempo expressed in quarter notes, for the parts of the engine that think in ♩. */
  get quarterBpm() {
    return (this.bpm * STEPS_PER_BEAT) / this.pulse;
  }

  get adventurous() {
    return this.adventure;
  }

  set adventurous(v: number) {
    this.adventure = v;
    this.planner.adventurous = v;
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- settings

  get stepDur() {
    return 60 / this.bpm / this.pulse;
  }

  get stepsPerBar() {
    return this.style.beatsPerBar * STEPS_PER_BEAT;
  }

  master(): MasterSettings {
    return { ...DEFAULT_MASTER, ...this.style.master, ...this.masterOverrides.get(this.style.id) };
  }

  setMaster(patch: Partial<MasterSettings>) {
    this.masterOverrides.set(this.style.id, { ...this.masterOverrides.get(this.style.id), ...patch });
    this.mixer.setMaster(this.master());
    this.emit();
  }

  private key(partId: string) {
    return `${this.style.id}:${partId}`;
  }

  patchFor(spec: PartSpec): string {
    return this.overrides.get(this.key(spec.id))?.patch ?? spec.patch;
  }

  channelFor(spec: PartSpec): ChannelSettings {
    const o = this.overrides.get(this.key(spec.id))?.channel ?? {};
    return {
      ...DEFAULT_CHANNEL,
      level: spec.level,
      pan: spec.pan,
      reverb: spec.reverb,
      echo: spec.echo ?? 0,
      ...o,
      params: { ...DEFAULT_CHANNEL.params, brightness: spec.brightness ?? 0.5, ...(o.params ?? {}) },
    };
  }

  setPatch(spec: PartSpec, patch: string) {
    const k = this.key(spec.id);
    this.overrides.set(k, { ...this.overrides.get(k), patch });
    this.emit();
  }

  setChannel(spec: PartSpec, patch: Partial<ChannelSettings>) {
    const k = this.key(spec.id);
    const cur = this.overrides.get(k) ?? {};
    // Muting a part while it plays is a mild "not this".
    if (patch.mute && !this.channelFor(spec).mute && this.state !== "idle") {
      this.planner.feedbackPart(spec.id, -0.3, this.currentStep());
      saveTaste(this.taste);
    }
    const channel = { ...cur.channel, ...patch, params: { ...cur.channel?.params, ...patch.params } } as Partial<ChannelSettings>;
    this.overrides.set(k, { ...cur, channel });
    this.mixer.configure(spec.id, this.channelFor(spec));
    this.emit();
  }

  resetPart(spec: PartSpec) {
    this.overrides.delete(this.key(spec.id));
    this.mixer.configure(spec.id, this.channelFor(spec));
    this.emit();
  }

  private applyMixer() {
    for (const spec of this.style.parts) this.mixer.configure(spec.id, this.channelFor(spec));
    this.mixer.prune(new Set(this.style.parts.map((p) => p.id)));
  }

  /**
   * @param tempo "style" → the style's own tempo; "keep" → same number;
   *              "convert" → same speed of 16ths (for a metre change, e.g. ♩=84 → ♩.=56).
   */
  setStyle(style: StyleDef, tempo: "style" | "keep" | "convert" = "style") {
    const wasPlaying = this.state === "playing";
    if (this.state !== "idle") this.stop();
    const oldPulse = this.pulse;
    this.style = style;
    if (tempo === "style") this.bpm = style.bpm;
    else if (tempo === "convert") this.bpm = Math.round((this.bpm * oldPulse) / this.pulse);
    this.planner = new Planner(this.taste, style, this.adventure);
    this.mixer.setTempo(this.quarterBpm);
    this.mixer.setMaster(this.master());
    this.applyMixer();
    if (this.arrangement) this.arrangement = arrange(this.arrangement.melody, style, { planner: this.planner });
    this.emit();
    if (wasPlaying) this.play();
  }

  setTempo(bpm: number) {
    if (this.state === "playing") {
      // Keep the playhead where it is.
      const step = this.currentStep();
      this.bpm = bpm;
      this.startTime = this.ctx.currentTime - step * this.stepDur;
      this.nextClickBeat = Math.ceil(step / this.pulse);
    } else this.bpm = bpm;
    this.mixer.setTempo(this.quarterBpm);
    this.emit();
  }

  loadMelody(melody: QNote[]) {
    this.stop();
    this.planner = new Planner(this.taste, this.style, this.adventure);
    this.arrangement = arrange(melody, this.style, { planner: this.planner });
    this.emit();
  }

  clear() {
    this.stop();
    this.arrangement = null;
    this.captured = [];
    this.liveChords = [];
    this.liveParts.clear();
    this.emit();
  }

  // ---------------------------------------------------------------- time

  private swingOffset(step: number) {
    return step % 4 === 2 ? this.style.swing * this.stepDur * 0.667 : 0;
  }

  stepTime(step: number) {
    return this.startTime + step * this.stepDur + this.swingOffset(step);
  }

  currentStep(): number {
    return (this.ctx.currentTime - this.startTime) / this.stepDur;
  }

  // ---------------------------------------------------------------- notes

  private sound(spec: PartSpec, note: QNote) {
    const patch = PATCH_BY_ID[this.patchFor(spec)] ?? PATCH_BY_ID[spec.patch];
    const ch = this.mixer.channel(spec.id, this.channelFor(spec));
    const time = this.stepTime(note.step);
    const voice = patch.play(this.ctx, ch.input, { midi: note.midi, time, velocity: note.vel }, ch.settings.params);
    const off = this.startTime + (note.step + note.dur) * this.stepDur - 0.01;
    const until = voice.stop(Math.max(off, time + 0.03));
    const pv = { voice, until };
    this.voices.add(pv);
  }

  private silence(now = this.ctx.currentTime) {
    for (const v of this.voices) if (v.until > now) v.voice.stop(now);
    this.voices.clear();
    for (const vs of this.liveVoices.values()) vs.forEach((v) => v.stop(now));
    this.liveVoices.clear();
  }

  private startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  // ---------------------------------------------------------------- transport

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  play(fromStep = 0) {
    if (!this.arrangement) return;
    this.stop();
    void this.resume();
    this.state = "playing";
    this.startTime = this.ctx.currentTime + 0.1 - fromStep * this.stepDur;
    this.events = this.arrangement.parts
      .flatMap((p) => p.notes.map((note) => ({ part: p.spec, note })))
      .filter((e) => e.note.step >= fromStep)
      .sort((a, b) => a.note.step - b.note.step);
    this.cursor = 0;
    this.scheduledUntil = fromStep - 1;
    this.nextClickBeat = Math.ceil(fromStep / this.pulse);
    this.startTimer();
    this.emit();
  }

  async record(engine: AudioEngine) {
    this.stop();
    await this.resume();
    this.engine = engine;
    this.captured = [];
    this.loudest = 1e-4;
    this.liveChords = [];
    this.liveParts = new Map(this.style.parts.map((p) => [p.id, []]));
    this.liveState = new Map(this.style.parts.map((p) => [p.id, {}]));
    this.liveShift = null;
    this.liveKey = null;
    this.arrangement = null;
    this.planner = new Planner(this.taste, this.style, this.adventure);
    const barDur = this.stepsPerBar * this.stepDur;
    this.startTime = this.ctx.currentTime + 0.2 + (this.countIn ? barDur : 0);
    this.recordingFrom = this.startTime - (this.countIn ? barDur : 0);
    this.nextClickBeat = this.countIn ? -pulsesPerBar(this.style) : 0;
    this.state = this.countIn ? "countIn" : "recording";

    const tracker = engine.analyzer?.tracker;
    this.unsubNotes = tracker ? tracker.on((type, n) => this.onSungNote(type, n)) : null;
    this.startTimer();
    this.emit();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const was = this.state;
    this.state = "idle";
    this.silence();
    this.unsubNotes?.();
    this.unsubNotes = null;
    if (was === "recording" || was === "countIn") this.finishTake();
    this.emit();
  }

  /** Sung loudness → 0.35..1 relative to the loudest note so far. */
  private loudness(peak: number) {
    return 0.35 + 0.65 * Math.pow(Math.min(1, peak / this.loudest), 0.7);
  }

  private finishTake() {
    const now = this.ctx.currentTime;
    for (const c of this.captured) if (c.open) {
      c.end = now;
      c.open = false;
    }
    const melody = quantize(this.captured.map((c) => ({ ...c, vel: this.loudness(c.peak) })), this.startTime, this.quarterBpm, this.style.melodyGrid);
    // Same planner: the textures you just liked or disliked carry over.
    this.arrangement = melody.length ? arrange(melody, this.style, { planner: this.planner }) : null;
  }

  // ---------------------------------------------------------------- recording

  private toCtxTime(t: number) {
    return t - (this.engine?.clockOffset ?? 0) - INPUT_LATENCY;
  }

  private melodySpecs() {
    return this.style.parts.filter((p) => p.role === "melody" || p.role === "double");
  }

  private onSungNote(type: "on" | "off", n: NoteEvent) {
    if (this.state !== "recording" && this.state !== "countIn") return;
    const now = this.ctx.currentTime;
    if (type === "on") {
      const start = Math.max(this.recordingFrom, this.toCtxTime(n.start));
      this.captured.push({ id: n.id, midi: n.midi, start, end: now, open: true, peak: n.peakRms });
      this.loudest = Math.max(this.loudest, n.peakRms);
      if (this.liveShift === null) {
        const lead = this.style.parts.find((p) => p.role === "melody");
        this.liveShift = lead ? registerShift([n.midi], lead.register) : 0;
      }
      if (this.liveMelody) {
        const vs: Voice[] = [];
        const bar = Math.floor(Math.max(0, this.currentStep()) / this.stepsPerBar);
        for (const spec of this.melodySpecs()) {
          if (spec.role === "double" && this.planner.textureFor(spec, bar) === null) continue;
          const midi = n.midi + this.liveShift + (spec.role === "double" ? (spec.octave ?? 0) * 12 : 0);
          const patch = PATCH_BY_ID[this.patchFor(spec)];
          const ch = this.mixer.channel(spec.id, this.channelFor(spec));
          vs.push(patch.play(this.ctx, ch.input, { midi, time: now, velocity: spec.vel ?? 0.8 }, ch.settings.params));
        }
        this.liveVoices.set(n.id, vs);
      }
    } else {
      const c = this.captured.find((x) => x.id === n.id);
      if (c) {
        c.peak = Math.max(c.peak, n.peakRms);
        this.loudest = Math.max(this.loudest, c.peak);
        c.end = Math.max(c.start + 0.05, this.toCtxTime(n.end ?? now + (this.engine?.clockOffset ?? 0)));
        c.open = false;
      }
      this.liveVoices.get(n.id)?.forEach((v) => v.stop(now));
      this.liveVoices.delete(n.id);
    }
  }

  /** Melody sung so far, on the step grid (open notes run to "now"). */
  private sungSoFar(): QNote[] {
    const now = this.ctx.currentTime;
    return quantize(
      this.captured.map((c) => ({ ...c, end: c.open ? now : c.end, vel: this.loudness(c.peak) })),
      this.startTime,
      this.quarterBpm,
      this.style.melodyGrid,
    );
  }

  private currentKey(melody: QNote[]): KeyInfo {
    if (melody.length >= 4) {
      const kd = new KeyDetector();
      for (const n of melody) {
        kd.noteOn(n.midi, n.step * 0.15);
        kd.noteOff(n.midi, n.dur * 0.15, (n.step + n.dur) * 0.15);
      }
      const best = kd.analyze().best;
      if (best && (best.prob > 0.45 || !this.liveKey)) this.liveKey = harmonicKey({ root: best.root, scale: best.scale });
    }
    if (!this.liveKey && melody.length) this.liveKey = { root: pc(melody[0].midi), scale: SCALE_BY_ID.major };
    return this.liveKey ?? { root: 0, scale: SCALE_BY_ID.major };
  }

  private scheduleLiveSlot(slotIndex: number) {
    const slotSteps = this.style.harmonicRhythm * STEPS_PER_BEAT;
    const step = slotIndex * slotSteps;
    const melody = this.sungSoFar();
    const key = this.currentKey(melody);
    // Evidence: the last beat before the change plus whatever is still sounding.
    const ev = slotEvidence(melody, Math.max(0, step - STEPS_PER_BEAT), STEPS_PER_BEAT * 2, this.stepsPerBar);
    const prev: Chord | null = this.liveChords[this.liveChords.length - 1]?.chord ?? null;
    const bar = Math.floor(step / this.stepsPerBar);
    const picked = ev.length || !prev ? nextChord(prev, ev, key, this.style, this.planner.chordBonus()) : prev;
    const chord = vocabulary(key, { ...this.style, color: this.planner.colorFor(bar) })[picked.degree] ?? picked;
    const slot: ChordSlot = { step, dur: slotSteps, chord };
    this.liveChords.push(slot);
    this.planner.logChord(step, prev, chord);
    // The orchestra follows how loudly you're singing right now.
    const recentNotes = melody.filter((n) => n.step + n.dur > step - 2 * STEPS_PER_BEAT);
    const sungLevel = recentNotes.length ? recentNotes.reduce((a, n) => a + n.vel, 0) / recentNotes.length : 0.6;
    const base = this.style.dynamicBase ?? 3;
    const level = Math.max(0, Math.min(5, Math.round(base - 1 + (sungLevel - 0.35) * 4 + this.planner.dynShiftFor(bar))));
    for (const spec of this.style.parts) {
      if (spec.role === "melody" || spec.role === "double") continue;
      const played = this.planner.textureFor(spec, bar);
      if (!played) continue; // resting this phrase
      const notes = generateSlot({ slot, next: null, style: this.style, spec: played, state: this.liveState.get(spec.id)! });
      const partLevel = Math.max(0, Math.min(5, level + (["bass", "perc", "timpani", "swell"].includes(spec.role) ? 0 : -1)));
      notes.forEach((n) => (n.vel = Math.min(1, n.vel * DYN_GAIN[partLevel])));
      this.liveParts.get(spec.id)!.push(...notes);
      notes.forEach((n) => this.sound(spec, n));
    }
  }

  // ---------------------------------------------------------------- scheduler

  private tick() {
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    const beatDur = this.stepDur * this.pulse;
    const perBar = pulsesPerBar(this.style);

    if (this.state === "countIn" || this.state === "recording") {
      if (this.state === "countIn" && now >= this.startTime) {
        this.state = "recording";
        this.emit();
      }
      // Clicks
      while (this.startTime + this.nextClickBeat * beatDur < horizon) {
        const b = this.nextClickBeat;
        if (this.metronome || b < 0) {
          click(this.ctx, this.mixer.clickOut, this.startTime + b * beatDur, ((b % perBar) + perBar) % perBar === 0);
        }
        this.nextClickBeat++;
      }
      // Accompaniment, one harmonic slot at a time
      const slotSteps = this.style.harmonicRhythm * STEPS_PER_BEAT;
      while (this.startTime + this.liveChords.length * slotSteps * this.stepDur < horizon) {
        this.scheduleLiveSlot(this.liveChords.length);
      }
    } else if (this.state === "playing") {
      const total = this.arrangement?.totalSteps ?? 0;
      while (this.startTime + this.nextClickBeat * beatDur < horizon && this.nextClickBeat * this.pulse < total) {
        const b = this.nextClickBeat++;
        if (this.clickOnPlay) click(this.ctx, this.mixer.clickOut, this.startTime + b * beatDur, b % perBar === 0);
      }
      while (this.cursor < this.events.length && this.stepTime(this.events[this.cursor].note.step) < horizon) {
        const e = this.events[this.cursor++];
        this.sound(e.part, e.note);
        this.scheduledUntil = Math.max(this.scheduledUntil, e.note.step);
      }
      if (this.cursor >= this.events.length && now > this.startTime + total * this.stepDur + 0.2) {
        // Letting a take play to the end is a gentle "this works".
        this.planner.feedbackAll(0.1);
        saveTaste(this.taste);
        if (this.loop) this.play(0);
        else {
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          this.state = "idle";
          this.voices.clear();
          this.emit();
        }
      }
    }
    // Forget finished voices.
    for (const v of this.voices) if (v.until < now - 0.5) this.voices.delete(v);
  }

  // ---------------------------------------------------------------- views

  /** What to engrave right now: the live take while recording, else the arrangement. */
  scoreView(): Arrangement | null {
    if (this.state !== "recording" && this.state !== "countIn") return this.arrangement;
    const melody = this.sungSoFar();
    const nowStep = Math.max(0, Math.ceil(this.currentStep()));
    const totalSteps = Math.max(this.stepsPerBar, Math.ceil(Math.max(nowStep, totalStepsFor(melody, this.style)) / this.stepsPerBar) * this.stepsPerBar);
    const shift = this.liveShift ?? 0;
    const parts: Part[] = this.style.parts.map((spec) => {
      if (spec.role === "melody" || spec.role === "double") {
        const extra = spec.role === "double" ? (spec.octave ?? 0) * 12 : 0;
        return { spec, notes: melody.map((n) => ({ ...n, midi: n.midi + shift + extra })) };
      }
      return { spec, notes: (this.liveParts.get(spec.id) ?? []).filter((n) => n.step < totalSteps).map((n) => ({ ...n })) };
    });
    return applyDynamics({
      style: this.style,
      key: this.liveKey ?? { root: 0, scale: SCALE_BY_ID.major },
      beatsPerBar: this.style.beatsPerBar,
      melody,
      chords: this.liveChords.filter((c) => c.step < totalSteps),
      parts,
      totalSteps,
    });
  }

  // ---------------------------------------------------------------- taste

  /**
   * 👍 (r = +1) or 👎 (r = −1) on what's sounding now. A 👎 re-decides
   * everything from the next bar, so you hear the change straight away.
   */
  feedback(r: number): Credit[] {
    const active = this.state !== "idle";
    const step = active ? Math.max(0, this.currentStep()) : 0;
    let credits: Credit[];
    if (active) credits = this.planner.feedback(r, step);
    else {
      // Rating the whole piece while stopped.
      this.planner.feedbackAll(r * 0.5);
      this.taste.ratings++;
      credits = [];
    }
    saveTaste(this.taste);
    if (r < 0) {
      const nextBar = active ? Math.floor(step / this.stepsPerBar) + 1 : 0;
      this.planner.resample(nextBar);
      this.replan();
    }
    this.emit();
    return credits;
  }

  /** Rebuild the arrangement with the planner's current choices; reschedule what hasn't played yet. */
  private replan() {
    if (!this.arrangement || this.state === "recording" || this.state === "countIn") return;
    this.arrangement = arrange(this.arrangement.melody, this.style, { planner: this.planner, key: this.arrangement.key });
    if (this.state === "playing") {
      this.events = this.arrangement.parts
        .flatMap((p) => p.notes.map((note) => ({ part: p.spec, note })))
        .filter((e) => e.note.step > this.scheduledUntil)
        .sort((a, b) => a.note.step - b.note.step);
      this.cursor = 0;
    }
  }

  resetTaste() {
    this.taste.reset();
    saveTaste(this.taste);
    this.planner = new Planner(this.taste, this.style, this.adventure);
    if (this.arrangement && this.state === "idle") this.arrangement = arrange(this.arrangement.melody, this.style, { planner: this.planner });
    this.emit();
  }

  /** How loudly each part is sounding right now (0..1), for the stage view. */
  activity(): Map<string, number> {
    const out = new Map<string, number>();
    const step = this.currentStep();
    const sounding = (notes: QNote[]) => {
      let v = 0;
      for (const n of notes) {
        if (n.step > step) break;
        // Short hits stay lit for an 8th so the eye can catch them.
        if (step < n.step + Math.max(n.dur, 2)) v = Math.max(v, n.vel);
      }
      return v;
    };
    if (this.state === "playing" && this.arrangement) {
      for (const p of this.arrangement.parts) {
        const v = sounding(p.notes);
        if (v > 0) out.set(p.spec.id, v);
      }
    } else if (this.state === "recording" || this.state === "countIn") {
      for (const spec of this.style.parts) {
        if (spec.role === "melody" || spec.role === "double") {
          if (this.liveVoices.size) out.set(spec.id, 0.8);
          continue;
        }
        const v = sounding(this.liveParts.get(spec.id) ?? []);
        if (v > 0) out.set(spec.id, v);
      }
    }
    return out;
  }

  dispose() {
    this.stop();
  }
}
