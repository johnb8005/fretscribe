import { useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine, type InputDevice } from "./audio/engine";
import type { AnalysisFrame, ChordChange } from "./analysis/pipeline";
import type { NoteEvent } from "./dsp/noteTracker";
import { chordPcs } from "./theory/theory";
import { PianoRoll, Spectrum, Waveform } from "./components/Visuals";
import { ChordPanel, ChromaBars, Fretboard, KeyPanel, MarkovMatrix, NoteDisplay, NoteTape } from "./components/Panels";

interface Snapshot {
  frame: AnalysisFrame | null;
  notes: NoteEvent[];
  progression: ChordChange[];
}

const UI_HZ = 20;

export default function App() {
  const engine = useMemo(() => new AudioEngine(), []);
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG) (window as unknown as { fretscribe: AudioEngine }).fretscribe = engine;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [gain, setGain] = useState(1);
  const [gate, setGate] = useState(0.008);
  const [snap, setSnap] = useState<Snapshot>({ frame: null, notes: [], progression: [] });
  const lastUi = useRef(0);

  // Throttled React state for the text panels; canvases redraw every frame.
  useEffect(
    () =>
      engine.subscribe((frame, eng) => {
        const now = performance.now();
        if (now - lastUi.current < 1000 / UI_HZ) return;
        lastUi.current = now;
        const a = eng.analyzer!;
        setSnap({ frame, notes: a.notes.slice(-48), progression: a.progression.slice() });
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
      setDevices(await AudioEngine.listInputs()); // labels appear after permission
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setError(msg);
    }
  };

  const reset = () => {
    engine.reset();
    setSnap((s) => ({ ...s, notes: [], progression: [] }));
  };

  const frame = snap.frame;
  const chordTones = new Set(frame?.chord?.quality ? chordPcs(frame.chord.root, frame.chord.quality) : []);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◉</span> Fretscribe
          <span className="tag">realtime guitar → notes · scale · chords</span>
        </div>
        <div className="controls">
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={running}>
            <option value="">Default input</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <label className="slider">
            Gain <input type="range" min={0.5} max={12} step={0.1} value={gain} onChange={(e) => setGain(+e.target.value)} />
            <span>{gain.toFixed(1)}×</span>
          </label>
          <label className="slider">
            Gate <input type="range" min={0.001} max={0.05} step={0.001} value={gate} onChange={(e) => setGate(+e.target.value)} />
            <span>{(20 * Math.log10(gate)).toFixed(0)} dB</span>
          </label>
          <button className="ghost" onClick={reset}>Reset</button>
          <button className={running ? "stop" : "start"} onClick={toggle}>
            {running ? "■ Stop" : "● Listen"}
          </button>
        </div>
      </header>

      {error && (
        <div className="error">
          Couldn't open the microphone — {error}
          <div className="small">
            macOS: System Settings → Privacy & Security → Microphone → allow Fretscribe (or your terminal in dev).
            Windows: Settings → Privacy → Microphone → allow desktop apps.
          </div>
        </div>
      )}

      <main className="grid">
        <section className="card note-card">
          <h2>Now playing</h2>
          <NoteDisplay frame={frame} />
        </section>

        <section className="card wave-card">
          <h2>Waveform</h2>
          <Waveform engine={engine} />
        </section>

        <section className="card spec-card">
          <h2>Spectrum</h2>
          <Spectrum engine={engine} />
        </section>

        <section className="card chroma-card">
          <h2>Chroma</h2>
          <ChromaBars chroma={frame?.chroma ?? new Array(12).fill(0)} highlight={chordTones} />
        </section>

        <section className="card roll-card">
          <h2>Transcription</h2>
          <PianoRoll engine={engine} />
          <NoteTape notes={snap.notes} />
        </section>

        <section className="card key-card">
          <h2>Scale / key</h2>
          <KeyPanel frame={frame} />
        </section>

        <section className="card chord-card">
          <h2>Chord</h2>
          <ChordPanel frame={frame} progression={snap.progression} />
        </section>

        <section className="card markov-card">
          <h2>Markov transitions · P(next note | note)</h2>
          <MarkovMatrix frame={frame} />
        </section>

        <section className="card fret-card">
          <h2>
            Fretboard <span className="legend"><i className="lg-tonic" /> tonic <i className="lg-scale" /> scale <i className="lg-chord" /> chord tone <i className="lg-live" /> playing</span>
          </h2>
          <Fretboard frame={frame} />
        </section>
      </main>
    </div>
  );
}
