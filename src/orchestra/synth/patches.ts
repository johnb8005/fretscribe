// Orchestral instruments built from Web Audio synthesis — no samples, no MIDI.
//
// Building blocks:
//   * subtractive(): detuned oscillator stacks (incl. custom PeriodicWave
//     spectra) → filter with envelope → resonant body peaks → amp ADSR,
//     with delayed vibrato, pitch scoop and breath noise.
//   * fm(): two-operator FM with decaying index (bells, mallets, celesta).
//   * dedicated drum voices (timpani, taiko, cymbals, brushes, ride, triangle).

import { midiToFreq } from "../../theory/theory";

export interface VoiceParams {
  /** 0..1 — filter opening / tone colour. */
  brightness: number;
  /** 0..1 — 0.5 is the patch default; lower = snappier, higher = slower swell. */
  attack: number;
  /** 0..1 — vibrato depth multiplier (0.5 = default). */
  vibrato: number;
  /** 0..1 — ensemble detune spread (0.5 = default). */
  spread: number;
}

export const DEFAULT_PARAMS: VoiceParams = { brightness: 0.5, attack: 0.5, vibrato: 0.5, spread: 0.5 };

export interface NoteSpec {
  midi: number;
  time: number;
  velocity: number; // 0..1
}

export interface Voice {
  /** Release at `time`; returns when the voice is fully silent. */
  stop(time: number): number;
}

export type Family = "strings" | "brass" | "woodwinds" | "voices" | "keys" | "plucked" | "mallets" | "percussion";

export interface Patch {
  id: string;
  name: string;
  family: Family;
  range: [number, number];
  clef: "treble" | "bass" | "percussion";
  /** Percussion kits map MIDI numbers to sounds. */
  kit?: boolean;
  play(ctx: BaseAudioContext, out: AudioNode, note: NoteSpec, p: VoiceParams): Voice;
}

// ------------------------------------------------------------------ helpers

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
function periodic(ctx: BaseAudioContext, key: string, harmonics: number[]): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  let w = m.get(key);
  if (!w) {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((a, i) => (imag[i + 1] = a));
    w = ctx.createPeriodicWave(real, imag);
    m.set(key, w);
  }
  return w;
}

const scale = (v: number, range = 3) => Math.pow(2, (v - 0.5) * range); // 0.5 → 1×

function cleanup(nodes: AudioScheduledSourceNode[], others: AudioNode[]) {
  if (nodes.length === 0) return;
  nodes[0].onended = () => {
    for (const n of [...nodes, ...others]) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  };
}

type WaveSpec = OscillatorType | { key: string; harmonics: number[] };

interface Osc {
  wave: WaveSpec;
  gain: number;
  detune?: number; // cents, multiplied by spread
  octave?: number;
}

interface SubtractiveCfg {
  oscs: Osc[];
  filter: { type?: BiquadFilterType; base: number; keyTrack?: number; env: number; a: number; d: number; s: number; q?: number };
  amp: { a: number; d: number; s: number; r: number };
  vibrato?: { rate: number; depth: number; delay: number };
  scoop?: number; // cents below at onset
  peaks?: { f: number; q: number; db: number }[];
  highpass?: number;
  breath?: { gain: number; mul: number; q: number };
  gain: number;
  /** Decaying instruments: amp sustain is reached by exponential decay. */
  percussive?: boolean;
}

function subtractive(cfg: SubtractiveCfg) {
  return (ctx: BaseAudioContext, out: AudioNode, note: NoteSpec, p: VoiceParams): Voice => {
    const t = Math.max(note.time, ctx.currentTime);
    const f0 = midiToFreq(note.midi);
    const vel = note.velocity;
    const atk = scale(p.attack, 3);
    const bright = 0.35 + 1.3 * p.brightness;
    const sources: AudioScheduledSourceNode[] = [];
    const others: AudioNode[] = [];

    const vca = ctx.createGain();
    vca.gain.value = 0;
    others.push(vca);

    // Filter + body resonances
    const filt = ctx.createBiquadFilter();
    filt.type = cfg.filter.type ?? "lowpass";
    filt.Q.value = cfg.filter.q ?? 0.7;
    const kt = cfg.filter.keyTrack ?? 0.5;
    const base = cfg.filter.base * Math.pow(f0 / 261.6, kt) * bright;
    const peak = Math.min(18000, base + cfg.filter.env * bright * (0.4 + 0.6 * vel));
    const fa = cfg.filter.a * atk;
    filt.frequency.setValueAtTime(base, t);
    filt.frequency.linearRampToValueAtTime(peak, t + fa);
    filt.frequency.setTargetAtTime(base + (peak - base) * cfg.filter.s, t + fa, cfg.filter.d / 3);
    others.push(filt);
    let chainEnd: AudioNode = filt;
    for (const pk of cfg.peaks ?? []) {
      const b = ctx.createBiquadFilter();
      b.type = "peaking";
      b.frequency.value = pk.f;
      b.Q.value = pk.q;
      b.gain.value = pk.db;
      chainEnd.connect(b);
      chainEnd = b;
      others.push(b);
    }
    if (cfg.highpass) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = cfg.highpass;
      chainEnd.connect(hp);
      chainEnd = hp;
      others.push(hp);
    }
    chainEnd.connect(vca);
    vca.connect(out);

    // Vibrato (delayed onset)
    let lfoGain: GainNode | null = null;
    if (cfg.vibrato && p.vibrato > 0.01) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = cfg.vibrato.rate * (0.95 + Math.random() * 0.1);
      lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, t);
      lfoGain.gain.linearRampToValueAtTime(cfg.vibrato.depth * p.vibrato * 2, t + cfg.vibrato.delay * atk + 0.3);
      lfo.connect(lfoGain);
      lfo.start(t);
      sources.push(lfo);
      others.push(lfoGain);
    }

    const spread = p.spread * 2;
    for (const o of cfg.oscs) {
      const osc = ctx.createOscillator();
      if (typeof o.wave === "string") osc.type = o.wave;
      else osc.setPeriodicWave(periodic(ctx, o.wave.key, o.wave.harmonics));
      osc.frequency.value = f0 * Math.pow(2, o.octave ?? 0);
      const det = (o.detune ?? 0) * spread + (Math.random() - 0.5) * 3;
      if (cfg.scoop) {
        osc.detune.setValueAtTime(det + cfg.scoop, t);
        osc.detune.linearRampToValueAtTime(det, t + 0.07 * atk);
      } else osc.detune.value = det;
      if (lfoGain) lfoGain.connect(osc.detune);
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g).connect(filt);
      osc.start(t);
      sources.push(osc);
      others.push(g);
    }

    if (cfg.breath) {
      const n = ctx.createBufferSource();
      n.buffer = noise(ctx);
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = Math.min(12000, f0 * cfg.breath.mul);
      bp.Q.value = cfg.breath.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(cfg.breath.gain * 2.5, t);
      g.gain.setTargetAtTime(cfg.breath.gain, t + 0.05, 0.08);
      n.connect(bp).connect(g).connect(vca);
      n.start(t, Math.random());
      sources.push(n);
      others.push(bp, g);
    }

    // Amp envelope
    const A = Math.max(0.002, cfg.amp.a * atk);
    const level = cfg.gain * (0.35 + 0.65 * vel);
    vca.gain.setValueAtTime(0, t);
    vca.gain.linearRampToValueAtTime(level, t + A);
    if (cfg.percussive) vca.gain.setTargetAtTime(level * cfg.amp.s, t + A, cfg.amp.d / 3);
    else vca.gain.setTargetAtTime(level * cfg.amp.s, t + A, cfg.amp.d / 3);
    cleanup(sources, others);

    // Percussive voices die on their own.
    if (cfg.percussive) {
      const end = t + A + cfg.amp.d * 2.5;
      sources.forEach((s) => s.stop(end));
    }

    return {
      stop(time: number) {
        const r = cfg.amp.r * Math.sqrt(atk);
        const at = Math.max(time, t + A * 0.5);
        vca.gain.cancelScheduledValues(at);
        vca.gain.setTargetAtTime(0, at, r / 4);
        const end = at + r * 1.6 + 0.05;
        sources.forEach((s) => {
          try {
            s.stop(end);
          } catch {
            /* already stopped */
          }
        });
        return end;
      },
    };
  };
}

interface FmCfg {
  ratio: number;
  index: number;
  indexDecay: number;
  decay: number;
  gain: number;
  attack?: number;
  partial?: { ratio: number; gain: number; decay: number };
}

function fm(cfg: FmCfg) {
  return (ctx: BaseAudioContext, out: AudioNode, note: NoteSpec, p: VoiceParams): Voice => {
    const t = Math.max(note.time, ctx.currentTime);
    const f0 = midiToFreq(note.midi);
    const vel = note.velocity;
    const bright = 0.3 + 1.4 * p.brightness;
    const car = ctx.createOscillator();
    car.frequency.value = f0;
    const mod = ctx.createOscillator();
    mod.frequency.value = f0 * cfg.ratio;
    const modGain = ctx.createGain();
    const idx = cfg.index * f0 * bright * (0.5 + 0.5 * vel);
    modGain.gain.setValueAtTime(idx, t);
    modGain.gain.setTargetAtTime(idx * 0.08, t + 0.005, cfg.indexDecay);
    mod.connect(modGain).connect(car.frequency);
    const vca = ctx.createGain();
    const level = cfg.gain * (0.3 + 0.7 * vel);
    const decay = cfg.decay * Math.pow(261.6 / f0, 0.3);
    vca.gain.setValueAtTime(0, t);
    vca.gain.linearRampToValueAtTime(level, t + (cfg.attack ?? 0.002));
    vca.gain.setTargetAtTime(0, t + (cfg.attack ?? 0.002), decay / 3);
    car.connect(vca).connect(out);
    const sources: AudioScheduledSourceNode[] = [car, mod];
    const others: AudioNode[] = [modGain, vca];
    if (cfg.partial) {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * cfg.partial.ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(cfg.partial.gain * level, t);
      g.gain.setTargetAtTime(0, t + 0.002, cfg.partial.decay / 3);
      o.connect(g).connect(out);
      sources.push(o);
      others.push(g);
    }
    const natural = t + decay * 2.5;
    sources.forEach((s) => {
      s.start(t);
      s.stop(natural);
    });
    cleanup(sources, others);
    return {
      stop(time: number) {
        // Mallets ring through; a late "damp" shortens the tail a little.
        const at = Math.max(time, t + 0.05);
        if (at < natural) {
          vca.gain.cancelScheduledValues(at);
          vca.gain.setTargetAtTime(0, at, Math.min(0.4, decay / 4));
        }
        return Math.min(natural, at + 1.5);
      },
    };
  };
}

// ------------------------------------------------------------------ drums

function noiseHit(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  { type, freq, q = 0.7, gain, attack = 0.001, decay }: { type: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; decay: number },
) {
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay / 3);
  n.connect(f).connect(g).connect(out);
  n.start(t, Math.random());
  n.stop(t + attack + decay * 2.5);
  cleanup([n], [f, g]);
}

function toneHit(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  { freq, endFreq, sweep, gain, decay, type = "sine" }: { freq: number; endFreq?: number; sweep?: number; gain: number; decay: number; type?: OscillatorType },
) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + (sweep ?? 0.1));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, decay / 3);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay * 2.5);
  cleanup([o], [g]);
}

const RIDE_RATIOS = [1, 1.483, 1.932, 2.546, 2.63, 3.897];

function metal(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, decay: number, base = 420) {
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 9000;
  bp.Q.value = 0.8;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.002);
  g.gain.setTargetAtTime(gain * 0.25, t + 0.01, 0.05);
  g.gain.setTargetAtTime(0, t + 0.06, decay / 3);
  bp.connect(hp).connect(g).connect(out);
  const oscs = RIDE_RATIOS.map((r) => {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = base * r;
    o.connect(bp);
    o.start(t);
    o.stop(t + decay * 2.5 + 0.1);
    return o;
  });
  cleanup(oscs, [bp, hp, g]);
}

/** Kit note numbers (General-MIDI-like, used by the arranger). */
export const KIT = {
  BASS_DRUM: 36,
  BRUSH: 38,
  TAIKO_LOW: 41,
  TAIKO_HIGH: 43,
  SWELL: 49,
  RIDE: 51,
  TRIANGLE: 81,
} as const;

function kitVoice(ctx: BaseAudioContext, out: AudioNode, note: NoteSpec, p: VoiceParams): Voice {
  const t = Math.max(note.time, ctx.currentTime);
  const v = note.velocity;
  const b = 0.5 + p.brightness;
  switch (note.midi) {
    case KIT.BASS_DRUM:
      toneHit(ctx, out, t, { freq: 70, endFreq: 42, sweep: 0.25, gain: 0.7 * v, decay: 1.4 });
      noiseHit(ctx, out, t, { type: "lowpass", freq: 300, gain: 0.25 * v, decay: 0.12 });
      break;
    case KIT.TAIKO_LOW:
    case KIT.TAIKO_HIGH: {
      const hi = note.midi === KIT.TAIKO_HIGH;
      toneHit(ctx, out, t, { freq: hi ? 190 : 120, endFreq: hi ? 110 : 52, sweep: 0.18, gain: 0.9 * v, decay: hi ? 0.45 : 0.9 });
      noiseHit(ctx, out, t, { type: "lowpass", freq: 700 * b, gain: 0.5 * v, decay: 0.06 });
      break;
    }
    case KIT.BRUSH:
      noiseHit(ctx, out, t, { type: "bandpass", freq: 2800 * b, q: 0.6, gain: 0.22 * v, attack: 0.012, decay: 0.16 });
      break;
    case KIT.RIDE:
      metal(ctx, out, t, 0.12 * v, 1.1);
      break;
    case KIT.TRIANGLE:
      toneHit(ctx, out, t, { freq: 3520, gain: 0.08 * v, decay: 2.2 });
      toneHit(ctx, out, t, { freq: 3520 * 2.76, gain: 0.03 * v, decay: 1.4 });
      break;
    case KIT.SWELL: {
      // Suspended cymbal roll: noise swelling into the downbeat.
      const n = ctx.createBufferSource();
      n.buffer = noise(ctx);
      n.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 4500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      n.connect(hp).connect(g).connect(out);
      n.start(t);
      return {
        stop(time: number) {
          const peakAt = Math.max(time, t + 0.2);
          g.gain.exponentialRampToValueAtTime(0.25 * v, peakAt);
          g.gain.setTargetAtTime(0, peakAt, 0.6);
          n.stop(peakAt + 3);
          cleanup([n], [hp, g]);
          return peakAt + 3;
        },
      };
    }
    default:
      noiseHit(ctx, out, t, { type: "bandpass", freq: 1500, gain: 0.15 * v, decay: 0.1 });
  }
  return { stop: () => t + 2 };
}

function timpani(ctx: BaseAudioContext, out: AudioNode, note: NoteSpec, p: VoiceParams): Voice {
  const t = Math.max(note.time, ctx.currentTime);
  const f = midiToFreq(note.midi);
  const v = note.velocity;
  // Membrane partials (approx. 1 : 1.5 : 1.98 : 2.44)
  [
    [1, 0.7, 1.6],
    [1.504, 0.35, 0.9],
    [1.98, 0.18, 0.6],
    [2.44, 0.1, 0.4],
  ].forEach(([r, g, d]) => toneHit(ctx, out, t, { freq: f * r * 1.01, endFreq: f * r, sweep: 0.15, gain: g * v * 0.6, decay: d }));
  noiseHit(ctx, out, t, { type: "lowpass", freq: 500 * (0.5 + p.brightness), gain: 0.35 * v, decay: 0.07 });
  return { stop: () => t + 3 };
}

// ------------------------------------------------------------------ the catalogue

const SAW3 = (g = 0.33, d = 9): Osc[] => [
  { wave: "sawtooth", gain: g, detune: -d },
  { wave: "sawtooth", gain: g, detune: 0 },
  { wave: "sawtooth", gain: g, detune: d },
];

export const PATCHES: Patch[] = [
  {
    id: "strings", name: "String section", family: "strings", range: [55, 96], clef: "treble",
    play: subtractive({
      oscs: SAW3(0.3, 11), gain: 0.2,
      filter: { base: 700, keyTrack: 0.6, env: 3200, a: 0.3, d: 1.2, s: 0.55, q: 0.5 },
      amp: { a: 0.28, d: 0.4, s: 0.9, r: 0.55 }, vibrato: { rate: 5.2, depth: 7, delay: 0.35 },
      peaks: [{ f: 2800, q: 1.2, db: 3 }],
    }),
  },
  {
    id: "spiccato", name: "Spiccato strings", family: "strings", range: [48, 91], clef: "treble",
    play: subtractive({
      oscs: SAW3(0.3, 10), gain: 0.22,
      filter: { base: 500, keyTrack: 0.6, env: 4200, a: 0.008, d: 0.12, s: 0.25, q: 0.8 },
      amp: { a: 0.006, d: 0.12, s: 0.3, r: 0.09 },
    }),
  },
  {
    id: "lowStrings", name: "Cellos & basses", family: "strings", range: [28, 72], clef: "bass",
    play: subtractive({
      oscs: [...SAW3(0.3, 8), { wave: "sine", gain: 0.25, octave: 0 }], gain: 0.24,
      filter: { base: 380, keyTrack: 0.5, env: 1800, a: 0.25, d: 1, s: 0.5, q: 0.6 },
      amp: { a: 0.18, d: 0.4, s: 0.9, r: 0.5 }, vibrato: { rate: 5, depth: 5, delay: 0.4 },
    }),
  },
  {
    id: "soloViolin", name: "Solo violin", family: "strings", range: [55, 100], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "sawtooth", gain: 0.5 }, { wave: "sawtooth", gain: 0.35, detune: 4 }], gain: 0.2,
      filter: { base: 1600, keyTrack: 0.5, env: 3000, a: 0.08, d: 0.6, s: 0.6, q: 0.6 },
      amp: { a: 0.07, d: 0.3, s: 0.9, r: 0.3 }, vibrato: { rate: 6, depth: 16, delay: 0.2 },
      peaks: [{ f: 450, q: 2, db: 4 }, { f: 2600, q: 1.5, db: 5 }, { f: 4500, q: 2, db: -4 }],
    }),
  },
  {
    id: "viola", name: "Viola", family: "strings", range: [48, 88], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "sawtooth", gain: 0.5 }, { wave: "sawtooth", gain: 0.35, detune: 5 }], gain: 0.21,
      filter: { base: 1100, keyTrack: 0.5, env: 2400, a: 0.09, d: 0.6, s: 0.55, q: 0.6 },
      amp: { a: 0.08, d: 0.3, s: 0.9, r: 0.32 }, vibrato: { rate: 5.6, depth: 13, delay: 0.22 },
      peaks: [{ f: 350, q: 2, db: 5 }, { f: 1900, q: 1.5, db: 4 }, { f: 4000, q: 2, db: -5 }],
    }),
  },
  {
    id: "cello", name: "Cello", family: "strings", range: [36, 76], clef: "bass",
    play: subtractive({
      oscs: [{ wave: "sawtooth", gain: 0.55 }, { wave: "sawtooth", gain: 0.3, detune: 4 }, { wave: "sine", gain: 0.2 }], gain: 0.24,
      filter: { base: 700, keyTrack: 0.5, env: 1800, a: 0.1, d: 0.6, s: 0.55, q: 0.6 },
      amp: { a: 0.09, d: 0.3, s: 0.9, r: 0.38 }, vibrato: { rate: 5.4, depth: 12, delay: 0.25 },
      peaks: [{ f: 220, q: 2, db: 5 }, { f: 1200, q: 1.5, db: 3 }, { f: 3000, q: 2, db: -6 }],
    }),
  },
  {
    id: "pizz", name: "Pizzicato strings", family: "strings", range: [28, 91], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "sawtooth", gain: 0.5, detune: -5 }, { wave: "triangle", gain: 0.5, detune: 5 }], gain: 0.32,
      filter: { base: 260, keyTrack: 0.8, env: 3400, a: 0.002, d: 0.14, s: 0.1, q: 1.2 },
      amp: { a: 0.002, d: 0.5, s: 0, r: 0.25 }, percussive: true,
    }),
  },
  {
    id: "horns", name: "French horns", family: "brass", range: [41, 77], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "sawtooth", gain: 0.5, detune: -4 }, { wave: "sawtooth", gain: 0.5, detune: 4 }], gain: 0.22,
      filter: { base: 260, keyTrack: 0.7, env: 1300, a: 0.1, d: 0.6, s: 0.55, q: 1 },
      amp: { a: 0.09, d: 0.3, s: 0.85, r: 0.4 }, vibrato: { rate: 5, depth: 3, delay: 0.5 }, scoop: -25,
      peaks: [{ f: 420, q: 1.2, db: 5 }],
    }),
  },
  {
    id: "trumpets", name: "Trumpets", family: "brass", range: [55, 84], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "sawtooth", gain: 0.6 }, { wave: "sawtooth", gain: 0.4, detune: 6 }], gain: 0.17,
      filter: { base: 600, keyTrack: 0.6, env: 4200, a: 0.05, d: 0.4, s: 0.55, q: 1.6 },
      amp: { a: 0.04, d: 0.25, s: 0.85, r: 0.25 }, vibrato: { rate: 5.5, depth: 5, delay: 0.4 }, scoop: -30,
      peaks: [{ f: 1300, q: 1, db: 5 }],
    }),
  },
  {
    id: "mutedTrumpet", name: "Muted trumpet", family: "brass", range: [55, 84], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "sawtooth", gain: 1 }], gain: 0.13,
      filter: { base: 1700, keyTrack: 0.3, env: 900, a: 0.04, d: 0.4, s: 0.7, q: 0.7 },
      amp: { a: 0.03, d: 0.2, s: 0.8, r: 0.18 }, vibrato: { rate: 5, depth: 9, delay: 0.3 }, scoop: -40,
      peaks: [{ f: 1600, q: 4, db: 12 }, { f: 700, q: 2, db: -8 }], highpass: 450,
    }),
  },
  {
    id: "lowBrass", name: "Trombones & tuba", family: "brass", range: [28, 72], clef: "bass",
    play: subtractive({
      oscs: SAW3(0.33, 5), gain: 0.22,
      filter: { base: 180, keyTrack: 0.7, env: 1200, a: 0.12, d: 0.6, s: 0.5, q: 1 },
      amp: { a: 0.1, d: 0.3, s: 0.85, r: 0.35 }, scoop: -20,
      peaks: [{ f: 320, q: 1, db: 4 }],
    }),
  },
  {
    id: "flute", name: "Flute", family: "woodwinds", range: [60, 96], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "triangle", gain: 0.8 }, { wave: "sine", gain: 0.2, octave: 1 }], gain: 0.24,
      filter: { base: 2600, keyTrack: 0.5, env: 1500, a: 0.06, d: 0.3, s: 0.8 },
      amp: { a: 0.07, d: 0.2, s: 0.9, r: 0.15 }, vibrato: { rate: 5, depth: 12, delay: 0.25 },
      breath: { gain: 0.06, mul: 2, q: 1.4 },
    }),
  },
  {
    id: "clarinet", name: "Clarinet", family: "woodwinds", range: [50, 91], clef: "treble",
    play: subtractive({
      oscs: [{ wave: { key: "clarinet", harmonics: [1, 0.02, 0.55, 0.02, 0.35, 0.02, 0.22, 0.01, 0.12, 0.01, 0.08] }, gain: 1 }], gain: 0.25,
      filter: { base: 1600, keyTrack: 0.6, env: 1600, a: 0.05, d: 0.3, s: 0.6 },
      amp: { a: 0.045, d: 0.2, s: 0.92, r: 0.12 }, vibrato: { rate: 5, depth: 2, delay: 0.5 },
      breath: { gain: 0.02, mul: 3, q: 1 },
    }),
  },
  {
    id: "oboe", name: "Oboe", family: "woodwinds", range: [58, 91], clef: "treble",
    play: subtractive({
      oscs: [{ wave: { key: "oboe", harmonics: [0.55, 1, 0.85, 0.7, 0.5, 0.4, 0.3, 0.2, 0.14, 0.1] }, gain: 1 }], gain: 0.16,
      filter: { base: 3200, keyTrack: 0.4, env: 1200, a: 0.04, d: 0.3, s: 0.8 },
      amp: { a: 0.04, d: 0.2, s: 0.9, r: 0.12 }, vibrato: { rate: 5.5, depth: 8, delay: 0.3 },
      peaks: [{ f: 1400, q: 2, db: 6 }],
    }),
  },
  {
    id: "bassoon", name: "Bassoon", family: "woodwinds", range: [34, 75], clef: "bass",
    play: subtractive({
      oscs: [{ wave: { key: "bassoon", harmonics: [1, 0.8, 0.65, 0.5, 0.42, 0.3, 0.2, 0.12] }, gain: 1 }], gain: 0.2,
      filter: { base: 800, keyTrack: 0.5, env: 900, a: 0.05, d: 0.3, s: 0.7 },
      amp: { a: 0.05, d: 0.2, s: 0.9, r: 0.14 }, vibrato: { rate: 5, depth: 4, delay: 0.4 },
      peaks: [{ f: 480, q: 2, db: 6 }],
    }),
  },
  {
    id: "choir", name: "Choir (ah)", family: "voices", range: [43, 81], clef: "treble",
    play: subtractive({
      oscs: SAW3(0.33, 12), gain: 0.07,
      filter: { base: 3600, keyTrack: 0.2, env: 0, a: 0.3, d: 1, s: 1 },
      amp: { a: 0.38, d: 0.4, s: 0.9, r: 0.7 }, vibrato: { rate: 5, depth: 11, delay: 0.3 },
      peaks: [{ f: 800, q: 4, db: 15 }, { f: 1150, q: 4, db: 11 }, { f: 2900, q: 5, db: 9 }, { f: 300, q: 1, db: -6 }],
    }),
  },
  {
    id: "harp", name: "Harp", family: "plucked", range: [24, 103], clef: "treble",
    play: subtractive({
      oscs: [{ wave: "triangle", gain: 0.7 }, { wave: "sine", gain: 0.3, octave: 1 }], gain: 0.34,
      filter: { base: 700, keyTrack: 0.8, env: 4200, a: 0.002, d: 0.35, s: 0.15 },
      amp: { a: 0.002, d: 2.4, s: 0, r: 1.2 }, percussive: true,
    }),
  },
  {
    id: "harpsichord", name: "Harpsichord", family: "plucked", range: [29, 89], clef: "treble",
    play: subtractive({
      oscs: [
        { wave: { key: "harpsichord", harmonics: [1, 0.9, 0.8, 0.72, 0.64, 0.56, 0.5, 0.44, 0.38, 0.33, 0.28, 0.24, 0.2, 0.17, 0.14, 0.12] }, gain: 0.7 },
        { wave: { key: "harpsichord", harmonics: [1, 0.9, 0.8, 0.72, 0.64, 0.56, 0.5, 0.44, 0.38, 0.33, 0.28, 0.24, 0.2, 0.17, 0.14, 0.12] }, gain: 0.3, octave: 1, detune: 3 },
      ],
      gain: 0.1,
      filter: { base: 2200, keyTrack: 0.5, env: 7000, a: 0.001, d: 0.08, s: 0.45, q: 0.8 },
      amp: { a: 0.001, d: 1.3, s: 0, r: 0.25 }, percussive: true,
    }),
  },
  {
    id: "piano", name: "Piano", family: "keys", range: [21, 108], clef: "treble",
    play: subtractive({
      oscs: [
        { wave: { key: "piano", harmonics: [1, 0.45, 0.32, 0.22, 0.16, 0.1, 0.07, 0.05, 0.03] }, gain: 0.5, detune: -2 },
        { wave: { key: "piano", harmonics: [1, 0.45, 0.32, 0.22, 0.16, 0.1, 0.07, 0.05, 0.03] }, gain: 0.5, detune: 2 },
      ],
      gain: 0.3,
      filter: { base: 500, keyTrack: 1, env: 4500, a: 0.002, d: 1.4, s: 0.25, q: 0.5 },
      amp: { a: 0.003, d: 3.2, s: 0, r: 0.35 }, percussive: true,
    }),
  },
  { id: "celesta", name: "Celesta", family: "mallets", range: [60, 108], clef: "treble", play: fm({ ratio: 4, index: 2.2, indexDecay: 0.25, decay: 1.8, gain: 0.22, partial: { ratio: 2, gain: 0.25, decay: 0.6 } }) },
  { id: "glockenspiel", name: "Glockenspiel", family: "mallets", range: [79, 108], clef: "treble", play: fm({ ratio: 2.76, index: 1.4, indexDecay: 0.4, decay: 2.6, gain: 0.16, partial: { ratio: 5.4, gain: 0.3, decay: 0.5 } }) },
  { id: "marimba", name: "Marimba", family: "mallets", range: [45, 96], clef: "treble", play: fm({ ratio: 4, index: 1.1, indexDecay: 0.04, decay: 0.75, gain: 0.32, partial: { ratio: 9.9, gain: 0.08, decay: 0.05 } }) },
  { id: "timpani", name: "Timpani", family: "percussion", range: [38, 57], clef: "bass", play: timpani },
  { id: "percussion", name: "Percussion", family: "percussion", range: [35, 81], clef: "percussion", kit: true, play: kitVoice },
];

export const PATCH_BY_ID: Record<string, Patch> = Object.fromEntries(PATCHES.map((p) => [p.id, p]));

/** Short metronome tick straight to an output. */
export function click(ctx: BaseAudioContext, out: AudioNode, time: number, accent: boolean) {
  toneHit(ctx, out, time, { freq: accent ? 2000 : 1400, gain: accent ? 0.3 : 0.18, decay: 0.05 });
}
