import { useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine, type InputDevice } from "./audio/engine";
import type { AnalysisFrame, ChordChange } from "./analysis/pipeline";
import { Scope, Spectrum, TabStaff } from "./components/Visuals";
import { ChordBlock, Fretboard, KeyBlock, NoteReadout, Workings } from "./components/Panels";
import { Footswitch, Knob } from "./components/Controls";

interface Snapshot {
  frame: AnalysisFrame | null;
  progression: ChordChange[];
}

const UI_HZ = 20;
const DEFAULT_GAIN = 1;
const DEFAULT_GATE = 0.008;

export function GuitarView() {
  const engine = useMemo(() => new AudioEngine(), []);
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG) (window as unknown as { fretscribe: AudioEngine }).fretscribe = engine;

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [gain, setGain] = useState(DEFAULT_GAIN);
  const [gate, setGate] = useState(DEFAULT_GATE);
  const [snap, setSnap] = useState<Snapshot>({ frame: null, progression: [] });
  const lastUi = useRef(0);

  // Text panels update at 20 Hz; canvases redraw on every analysis frame.
  useEffect(
    () =>
      engine.subscribe((frame, eng) => {
        const now = performance.now();
        if (now - lastUi.current < 1000 / UI_HZ) return;
        lastUi.current = now;
        setSnap({ frame, progression: eng.analyzer!.progression.slice() });
      }),
    [engine],
  );

  useEffect(() => {
    AudioEngine.listInputs().then(setDevices).catch(() => {});
    const onChange = () => AudioEngine.listInputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
      engine.stop();
    };
  }, [engine]);

  useEffect(() => {
    engine.gain = gain;
  }, [engine, gain]);

  useEffect(() => {
    if (engine.analyzer) engine.analyzer.tracker.cfg.gate = gate;
  }, [engine, gate, running]);

  const toggle = async () => {
    setError(null);
    if (running) {
      await engine.stop();
      setRunning(false);
      return;
    }
    try {
      await engine.start(deviceId || undefined);
      engine.analyzer!.tracker.cfg.gate = gate;
      setRunning(true);
      setDevices(await AudioEngine.listInputs()); // device names appear once permission is granted
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  };

  const clear = () => {
    engine.reset();
    setSnap((s) => ({ ...s, progression: [] }));
  };

  const frame = snap.frame;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-3 border-b border-grain/60 px-6 py-3 lg:px-10">
        <label className="flex items-center gap-2 text-sm text-nickel">
          <span className="sr-only md:not-sr-only">Input</span>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={running}
            className="max-w-56 rounded-md border border-grain bg-ebony px-2.5 py-1.5 text-bone disabled:opacity-60"
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
        <Knob label="Gain" value={gain} min={0.5} max={12} step={0.1} defaultValue={DEFAULT_GAIN} onChange={setGain} format={(v) => `${v.toFixed(1)}×`} />
        <Knob
          label="Gate"
          value={gate}
          min={0.001}
          max={0.05}
          step={0.001}
          defaultValue={DEFAULT_GATE}
          onChange={setGate}
          format={(v) => `${(20 * Math.log10(v)).toFixed(0)} dB`}
        />
        <button type="button" onClick={clear} className="rounded-md px-3 py-1.5 text-sm text-nickel hover:bg-ebony hover:text-bone">
          Clear
        </button>
        <Footswitch on={running} onToggle={toggle} />
      </div>

      {error && (
        <div role="alert" className="mx-6 mt-4 rounded-lg border border-jewel/60 bg-jewel/10 px-4 py-3 lg:mx-10">
          <p className="text-bone">Fretscribe can't open the microphone. {error}</p>
          <p className="mt-1 text-sm text-nickel">
            On macOS, allow it in System Settings › Privacy & Security › Microphone (in dev mode, allow your terminal). On Windows, turn on
            Settings › Privacy › Microphone › Let desktop apps access your microphone. Then press Listen again.
          </p>
        </div>
      )}

      <main className="mx-auto max-w-[1680px] space-y-10 px-6 py-8 lg:px-10">
        <section className="grid gap-8 md:grid-cols-[230px_minmax(0,1fr)]" aria-label="Transcription">
          <NoteReadout frame={frame} />
          <div className="h-[270px] overflow-hidden rounded-lg bg-bone shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_12px_30px_-12px_rgba(0,0,0,0.6)]">
            <TabStaff engine={engine} />
          </div>
        </section>

        <section className="grid gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" aria-label="Signal">
          <div>
            <h2 className="mb-2 font-gear text-[15px] font-semibold text-nickel">Waveform</h2>
            <div className="h-32 rounded-lg bg-[#17120f] px-1">
              <Scope engine={engine} />
            </div>
          </div>
          <div>
            <h2 className="mb-2 font-gear text-[15px] font-semibold text-nickel">Spectrum</h2>
            <div className="h-32">
              <Spectrum engine={engine} />
            </div>
          </div>
        </section>

        <section className="grid gap-12 border-t border-grain pt-8 lg:grid-cols-2" aria-label="Harmony">
          <KeyBlock frame={frame} />
          <ChordBlock frame={frame} progression={snap.progression} />
        </section>

        <section aria-label="Fretboard" className="border-t border-grain pt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-gear text-[15px] font-semibold text-nickel">On the neck</h2>
            <ul className="flex flex-wrap gap-5 text-sm text-nickel">
              <li className="flex items-center gap-2"><i className="size-3 rounded-full bg-lamp" />Root of the scale</li>
              <li className="flex items-center gap-2"><i className="size-3 rounded-full border border-pearl/60 bg-[#2f3b38]" />Scale note</li>
              <li className="flex items-center gap-2"><i className="size-3 rounded-full border-2 border-jewel" />In the current chord</li>
              <li className="flex items-center gap-2"><i className="size-3 rounded-full bg-lamp shadow-[0_0_8px_var(--color-lamp)]" />Sounding now</li>
            </ul>
          </div>
          <Fretboard frame={frame} />
        </section>

        <details open className="group border-t border-grain pt-6">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-gear text-xl font-semibold text-bone-dim hover:text-bone">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            How it's deciding
          </summary>
          <div className="mt-6">
            <Workings frame={frame} />
          </div>
        </details>
      </main>
    </div>
  );
}
