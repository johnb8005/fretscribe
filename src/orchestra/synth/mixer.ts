// Channel strips + master bus: hall reverb (generated impulse response),
// ping-pong echo, warmth/air shelving EQ, glue compressor and limiter.

import { DEFAULT_PARAMS, type VoiceParams } from "./patches";

export interface ChannelSettings {
  level: number; // 0..1.5
  pan: number; // -1..1
  reverb: number; // send 0..1
  echo: number; // send 0..1
  mute: boolean;
  solo: boolean;
  params: VoiceParams;
}

export const DEFAULT_CHANNEL: ChannelSettings = {
  level: 0.8,
  pan: 0,
  reverb: 0.35,
  echo: 0,
  mute: false,
  solo: false,
  params: DEFAULT_PARAMS,
};

export interface MasterSettings {
  /** 0..1 → hall decay 0.6 s … 5 s */
  hallSize: number;
  /** reverb return level 0..1 */
  hallMix: number;
  /** echo time in beats (synced to tempo) */
  echoBeats: number;
  echoFeedback: number;
  /** dB, low shelf at 220 Hz */
  warmth: number;
  /** dB, high shelf at 7 kHz */
  air: number;
  volume: number;
}

export const DEFAULT_MASTER: MasterSettings = {
  hallSize: 0.7,
  hallMix: 0.35,
  echoBeats: 0.75,
  echoFeedback: 0.35,
  warmth: 1,
  air: 0,
  volume: 0.85,
};

/** Stereo hall impulse response: pre-delay, early reflections, damped tail. */
export function hallImpulse(ctx: BaseAudioContext, size: number): AudioBuffer {
  const decay = 0.6 + size * 4.4; // T60 seconds
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * Math.min(6, decay * 1.1));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * (0.012 + size * 0.025));
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.pow(10, (-3 * t) / decay); // -60 dB at T60
      // High frequencies die faster: one-pole lowpass whose cutoff falls over time.
      const k = Math.min(0.95, 0.15 + t * 0.6);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * env * 2.2;
    }
    // Early reflections
    for (let r = 0; r < 10; r++) {
      const at = pre + Math.floor(sr * (0.005 + Math.random() * (0.03 + size * 0.06)));
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.04);
    }
  }
  return buf;
}

export class Channel {
  readonly input: GainNode;
  private readonly level: GainNode;
  private readonly mute: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly reverbSend: GainNode;
  private readonly echoSend: GainNode;
  settings: ChannelSettings;

  constructor(private readonly ctx: BaseAudioContext, bus: AudioNode, reverbIn: AudioNode, echoIn: AudioNode, settings: ChannelSettings) {
    this.settings = settings;
    this.input = ctx.createGain();
    this.level = ctx.createGain();
    this.mute = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.reverbSend = ctx.createGain();
    this.echoSend = ctx.createGain();
    this.input.connect(this.level).connect(this.mute).connect(this.pan);
    this.pan.connect(bus);
    this.pan.connect(this.reverbSend).connect(reverbIn);
    this.pan.connect(this.echoSend).connect(echoIn);
    this.apply(settings, false);
  }

  apply(s: ChannelSettings, audible: boolean | undefined = undefined) {
    this.settings = s;
    const t = this.ctx.currentTime;
    this.level.gain.setTargetAtTime(s.level, t, 0.02);
    this.pan.pan.setTargetAtTime(s.pan, t, 0.02);
    this.reverbSend.gain.setTargetAtTime(s.reverb, t, 0.02);
    this.echoSend.gain.setTargetAtTime(s.echo, t, 0.02);
    if (audible !== undefined) this.setAudible(audible);
  }

  setAudible(on: boolean) {
    this.mute.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.015);
  }

  dispose() {
    for (const n of [this.input, this.level, this.mute, this.pan, this.reverbSend, this.echoSend]) n.disconnect();
  }
}

export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly output: GainNode;
  /** Unprocessed output for the metronome. */
  readonly clickOut: GainNode;
  private readonly bus: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbIn: GainNode;
  private readonly reverbReturn: GainNode;
  private readonly echoIn: GainNode;
  private readonly echoL: DelayNode;
  private readonly echoR: DelayNode;
  private readonly echoFb: GainNode;
  private readonly low: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  private readonly channels = new Map<string, Channel>();
  private master: MasterSettings;
  private irSize = -1;
  private irTimer: ReturnType<typeof setTimeout> | null = null;
  bpm = 90;

  constructor(ctx: BaseAudioContext, destination: AudioNode, master: MasterSettings = DEFAULT_MASTER) {
    this.ctx = ctx;
    this.master = master;
    this.bus = ctx.createGain();

    // Reverb
    this.reverbIn = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverbReturn = ctx.createGain();
    const revHp = ctx.createBiquadFilter();
    revHp.type = "highpass";
    revHp.frequency.value = 180; // keep the low end clean
    this.reverbIn.connect(revHp).connect(this.reverb).connect(this.reverbReturn).connect(this.bus);

    // Ping-pong echo
    this.echoIn = ctx.createGain();
    this.echoL = ctx.createDelay(4);
    this.echoR = ctx.createDelay(4);
    this.echoFb = ctx.createGain();
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = "lowpass";
    echoTone.frequency.value = 3500;
    const merger = ctx.createChannelMerger(2);
    this.echoIn.connect(echoTone).connect(this.echoL);
    this.echoL.connect(this.echoR);
    this.echoR.connect(this.echoFb).connect(this.echoL);
    this.echoL.connect(merger, 0, 0);
    this.echoR.connect(merger, 0, 1);
    merger.connect(this.bus);
    merger.connect(this.reverbIn);

    // Master chain
    this.low = ctx.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 220;
    this.high = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 7000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    this.output = ctx.createGain();
    this.bus.connect(this.low).connect(this.high).connect(comp).connect(limiter).connect(this.output).connect(destination);

    this.clickOut = ctx.createGain();
    this.clickOut.connect(destination);

    this.setMaster(master, true);
  }

  setMaster(m: MasterSettings, immediate = false) {
    this.master = m;
    const t = this.ctx.currentTime;
    this.reverbReturn.gain.setTargetAtTime(m.hallMix * 1.6, t, 0.03);
    const beat = 60 / this.bpm;
    const echoTime = Math.min(3.9, m.echoBeats * beat);
    this.echoL.delayTime.setTargetAtTime(echoTime, t, 0.05);
    this.echoR.delayTime.setTargetAtTime(echoTime, t, 0.05);
    this.echoFb.gain.setTargetAtTime(m.echoFeedback, t, 0.03);
    this.low.gain.setTargetAtTime(m.warmth, t, 0.03);
    this.high.gain.setTargetAtTime(m.air, t, 0.03);
    this.output.gain.setTargetAtTime(m.volume, t, 0.03);
    // Regenerating the IR is costly; debounce knob drags.
    if (Math.abs(m.hallSize - this.irSize) > 0.01) {
      if (this.irTimer) clearTimeout(this.irTimer);
      const build = () => {
        this.reverb.buffer = hallImpulse(this.ctx, m.hallSize);
        this.irSize = m.hallSize;
      };
      if (immediate) build();
      else this.irTimer = setTimeout(build, 120);
    }
  }

  setTempo(bpm: number) {
    this.bpm = bpm;
    this.setMaster(this.master);
  }

  channel(id: string, settings: ChannelSettings = DEFAULT_CHANNEL): Channel {
    let ch = this.channels.get(id);
    if (!ch) {
      ch = new Channel(this.ctx, this.bus, this.reverbIn, this.echoIn, settings);
      this.channels.set(id, ch);
      this.updateSolo();
    }
    return ch;
  }

  configure(id: string, settings: ChannelSettings) {
    this.channel(id, settings).apply(settings);
    this.updateSolo();
  }

  /** Drop channels that are not in `keep`. */
  prune(keep: Set<string>) {
    for (const [id, ch] of this.channels) {
      if (!keep.has(id)) {
        ch.dispose();
        this.channels.delete(id);
      }
    }
  }

  private updateSolo() {
    const anySolo = [...this.channels.values()].some((c) => c.settings.solo);
    for (const ch of this.channels.values()) {
      ch.setAudible(!ch.settings.mute && (!anySolo || ch.settings.solo));
    }
  }
}
