// Web Audio capture → Analyzer, driven by requestAnimationFrame.

import { Analyzer, FFT_SIZE, type AnalysisFrame } from "../analysis/pipeline";

export type FrameListener = (frame: AnalysisFrame, engine: AudioEngine) => void;

export interface InputDevice {
  id: string;
  label: string;
}

export class AudioEngine {
  analyzer: Analyzer | null = null;
  /** Latest raw samples (time domain), length FFT_SIZE. */
  readonly samples = new Float32Array(FFT_SIZE);
  latest: AnalysisFrame | null = null;
  running = false;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private gainNode: GainNode | null = null;
  private node: AnalyserNode | null = null;
  private raf = 0;
  private lastProcess = 0;
  private listeners = new Set<FrameListener>();
  private gainValue = 1;
  /** Keeps analysis time monotonic across stop/start (each AudioContext restarts at 0). */
  private timeOffset = 0;

  subscribe(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  static async listInputs(): Promise<InputDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  set gain(v: number) {
    this.gainValue = v;
    if (this.gainNode && this.ctx) this.gainNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get gain(): number {
    return this.gainValue;
  }

  async start(deviceId?: string): Promise<void> {
    await this.stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone API unavailable in this webview (getUserMedia missing).");
    }
    // Disable every voice-call "enhancement": they destroy guitar tone & pitch.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const src = this.ctx.createMediaStreamSource(this.stream);
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.gainValue;
    this.node = this.ctx.createAnalyser();
    this.node.fftSize = FFT_SIZE;
    this.node.smoothingTimeConstant = 0;
    src.connect(this.gainNode).connect(this.node);

    if (!this.analyzer || this.analyzer.sampleRate !== this.ctx.sampleRate) {
      this.analyzer = new Analyzer(this.ctx.sampleRate);
    }
    this.timeOffset = (this.latest?.t ?? 0) + 1;
    this.lastProcess = -1;
    this.running = true;
    this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.node = null;
    this.gainNode = null;
  }

  reset() {
    this.analyzer?.reset();
  }

  private loop = () => {
    if (!this.running || !this.node || !this.ctx || !this.analyzer) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = this.timeOffset + this.ctx.currentTime;
    // Cap analysis at ~60 Hz so high-refresh displays don't change HMM dynamics.
    if (now - this.lastProcess < 1 / 62) return;
    this.lastProcess = now;
    this.node.getFloatTimeDomainData(this.samples);
    const frame = this.analyzer.process(this.samples, now);
    this.latest = frame;
    for (const l of this.listeners) l(frame, this);
  };
}
