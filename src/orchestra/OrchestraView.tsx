import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AudioEngine, type InputDevice } from "../audio/engine";
import { VOICE_OPTIONS } from "../analysis/pipeline";
import { Knob } from "../components/Controls";
import { midiToName, pcName, prefersFlats } from "../theory/theory";
import { DEMO_TUNE } from "./arranger/arrange";
import { STYLES, STYLE_BY_ID } from "./arranger/styles";
import { FORMATIONS, FORMATION_BY_ID, applyFormation } from "./arranger/formations";
import { TEMPO_TERMS, termFor } from "./arranger/tempo";
import { STEPS_PER_BEAT, type PartSpec } from "./arranger/types";
import { Conductor } from "./conductor";
import { ScoreView } from "./score/ScoreView";
import { StageView } from "./stage/StageView";
import { PATCHES, type Family } from "./synth/patches";

const FAMILY_NAMES: Record<Family, string> = {
  strings: "Strings", brass: "Brass", woodwinds: "Woodwinds", voices: "Voices",
  keys: "Keyboards", plucked: "Plucked", mallets: "Mallets", percussion: "Percussion",
};

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
        on ? "border-lamp/70 text-bone" : "border-grain text-nickel hover:text-bone"
      }`}
    >
      <span className={`size-2 rounded-full ${on ? "bg-lamp shadow-[0_0_6px_var(--color-lamp)]" : "bg-grain"}`} />
      {children}
    </button>
  );
}

export function OrchestraView() {
  const engine = useMemo(() => new AudioEngine({ analyzer: VOICE_OPTIONS, echoCancellation: true }), []);
  const conductorRef = useRef<Conductor | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [version, setVersion] = useState(0);
  const [styleId, setStyleId] = useState("epic");
  const [formationId, setFormationId] = useState("full");
  const [view, setView] = useState<"score" | "stage">("score");
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [singing, setSinging] = useState<{ note: string; tuning: number } | null>(null);

  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG) (window as unknown as Record<string, unknown>).fretscribeOrchestra = { engine, conductorRef };
  const c = conductorRef.current;
  const baseStyle = STYLE_BY_ID[styleId];
  const style = useMemo(() => applyFormation(baseStyle, FORMATION_BY_ID[formationId]), [baseStyle, formationId]);

  const ensure = (): Conductor => {
    if (conductorRef.current) return conductorRef.current;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const cond = new Conductor(ctx, style);
    cond.subscribe(() => {
      setVersion((v) => v + 1);
      bump();
    });
    conductorRef.current = cond;
    bump();
    return cond;
  };

  useEffect(() => {
    AudioEngine.listInputs().then(setDevices).catch(() => {});
    return () => {
      conductorRef.current?.dispose();
      void engine.stop();
      void conductorRef.current?.ctx.close();
    };
  }, [engine]);

  // Live readout of what you're singing.
  useEffect(() => {
    let last = 0;
    return engine.subscribe((f) => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      setSinging(f.pitch ? { note: midiToName(f.pitch.midi), tuning: f.tuningCents } : null);
    });
  }, [engine]);

  // Transport status text.
  useEffect(() => {
    let raf = 0, last = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cond = conductorRef.current;
      let s = "";
      if (cond) {
        const barSteps = cond.style.beatsPerBar * STEPS_PER_BEAT;
        const step = cond.currentStep();
        const bar = Math.floor(step / barSteps) + 1;
        const beat = Math.floor((step % barSteps) / STEPS_PER_BEAT) + 1;
        if (cond.state === "countIn") s = `Count-in: ${Math.max(1, cond.style.beatsPerBar + Math.floor(step / STEPS_PER_BEAT) + 1)}`;
        else if (cond.state === "recording") s = `Recording, bar ${bar}, beat ${beat}`;
        else if (cond.state === "playing") s = `Playing bar ${bar} of ${Math.ceil((cond.arrangement?.totalSteps ?? 0) / barSteps)}`;
      }
      if (s !== last) setStatus((last = s));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const pickStyle = (id: string) => {
    setStyleId(id);
    conductorRef.current?.setStyle(applyFormation(STYLE_BY_ID[id], FORMATION_BY_ID[formationId]));
  };

  const pickFormation = (id: string) => {
    setFormationId(id);
    conductorRef.current?.setStyle(applyFormation(STYLE_BY_ID[styleId], FORMATION_BY_ID[id]));
  };

  const record = async () => {
    setError(null);
    const cond = ensure();
    if (cond.state === "recording" || cond.state === "countIn") {
      cond.stop();
      await engine.stop();
      return;
    }
    try {
      await cond.resume();
      await engine.start(deviceId || undefined, cond.ctx);
      engine.reset();
      await cond.record(engine);
      setDevices(await AudioEngine.listInputs());
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  };

  const playStop = async () => {
    const cond = ensure();
    if (cond.state === "idle") {
      await cond.resume();
      cond.play();
    } else {
      cond.stop();
      await engine.stop();
    }
  };

  const demo = async () => {
    const cond = ensure();
    await engine.stop();
    cond.loadMelody(DEMO_TUNE);
    await cond.resume();
    cond.play();
  };

  const state = c?.state ?? "idle";
  const rec = state === "recording" || state === "countIn";
  const arr = c?.arrangement;
  const keyName = arr ? `${pcName(arr.key.root, prefersFlats(arr.key.root, arr.key.scale))} ${arr.key.scale.id === "minor" ? "minor" : arr.key.scale.id === "major" ? "major" : arr.key.scale.name}` : null;
  const bpm = c?.bpm ?? style.bpm;
  const master = c?.master() ?? { ...style.master, volume: 0.85 };

  return (
    <main className="mx-auto max-w-[1680px] space-y-8 px-6 py-8 lg:px-10">
      {/* Style */}
      <section aria-label="Style">
        <h2 className="mb-3 font-gear text-[15px] font-semibold text-nickel">In the style of</h2>
        <div role="radiogroup" className="flex flex-wrap gap-x-6 gap-y-2">
          {STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={s.id === styleId}
              onClick={() => pickStyle(s.id)}
              className={`border-b-2 pb-1 font-gear text-2xl font-semibold transition-colors ${
                s.id === styleId ? "border-lamp text-bone" : "border-transparent text-nickel hover:text-bone-dim"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-bone-dim">{style.blurb}</p>
        <h2 className="mt-6 mb-2 font-gear text-[15px] font-semibold text-nickel">Played by</h2>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {FORMATIONS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={f.id === formationId}
              title={f.blurb}
              onClick={() => pickFormation(f.id)}
              className={`rounded-full border px-3.5 py-1 font-gear text-lg font-semibold transition-colors ${
                f.id === formationId ? "border-bone bg-bone text-ink" : "border-grain text-nickel hover:text-bone"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-nickel">{FORMATION_BY_ID[formationId].blurb}</p>
      </section>

      {/* Transport */}
      <section aria-label="Transport" className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <button
          type="button"
          onClick={record}
          aria-pressed={rec}
          className="group flex items-center gap-3 rounded-full py-1 pr-4 pl-1 hover:bg-ebony"
        >
          <span className="relative grid size-11 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e7e2d8,#8c8579_60%,#4a443d)] shadow-[inset_0_-2px_3px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.5)] group-active:scale-95">
            <span className={`size-4 rounded-full ${rec ? "animate-glow bg-jewel shadow-[0_0_12px_3px_var(--color-jewel)]" : "bg-[#7a2c20]"}`} />
          </span>
          <span className="font-gear text-xl font-semibold text-bone">{rec ? "Stop recording" : "Record"}</span>
        </button>
        <button
          type="button"
          onClick={playStop}
          disabled={!arr && state === "idle"}
          className="rounded-full border border-grain px-5 py-2 font-gear text-xl font-semibold text-bone hover:bg-ebony disabled:opacity-40"
        >
          {state === "playing" ? "Stop" : "Play"}
        </button>
        <button type="button" onClick={demo} className="text-sm text-nickel underline decoration-grain underline-offset-4 hover:text-bone">
          Try the demo tune
        </button>
        <div className="flex items-center gap-3">
          <BeatLight conductor={c} />
          <Knob
            label="Tempo"
            value={bpm}
            min={36}
            max={220}
            step={1}
            defaultValue={style.bpm}
            onChange={(v) => ensure().setTempo(Math.round(v))}
            format={(v) => `♩ = ${Math.round(v)}`}
          />
          <select
            aria-label="Tempo marking"
            value={termFor(bpm).name}
            onChange={(e) => ensure().setTempo(TEMPO_TERMS.find((t) => t.name === e.target.value)!.bpm)}
            className="rounded-md border border-grain bg-ebony px-2 py-1.5 font-gear text-lg font-semibold text-bone"
          >
            {TEMPO_TERMS.map((t) => (
              <option key={t.name} value={t.name}>{t.name}, {t.meaning}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Toggle on={c?.metronome ?? true} onChange={(v) => { ensure().metronome = v; bump(); }}>Click while recording</Toggle>
          <Toggle on={c?.clickOnPlay ?? false} onChange={(v) => { ensure().clickOnPlay = v; bump(); }}>Click on playback</Toggle>
          <Toggle on={c?.countIn ?? true} onChange={(v) => { ensure().countIn = v; bump(); }}>Count-in</Toggle>
          <Toggle on={c?.liveMelody ?? true} onChange={(v) => { ensure().liveMelody = v; bump(); }}>Hear the lead live</Toggle>
          <Toggle on={c?.loop ?? false} onChange={(v) => { ensure().loop = v; bump(); }}>Loop</Toggle>
        </div>
        <label className="flex items-center gap-2 text-sm text-nickel">
          Mic
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={rec}
            className="max-w-52 rounded-md border border-grain bg-ebony px-2.5 py-1.5 text-bone disabled:opacity-60"
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
      </section>

      {error && (
        <div role="alert" className="rounded-lg border border-jewel/60 bg-jewel/10 px-4 py-3">
          <p className="text-bone">Fretscribe can't open the microphone. {error}</p>
          <p className="mt-1 text-sm text-nickel">Allow microphone access for Fretscribe in your system settings, then press Record again.</p>
        </div>
      )}

      {/* Score */}
      <section aria-label="Score">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <div role="tablist" aria-label="View" className="flex gap-4">
              {(["score", "stage"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`border-b-2 pb-0.5 font-gear text-lg font-semibold ${view === v ? "border-lamp text-bone" : "border-transparent text-nickel hover:text-bone-dim"}`}
                >
                  {v === "score" ? "Score" : "Stage"}
                </button>
              ))}
            </div>
            {keyName && <span className="text-sm text-bone-dim">Key of {keyName}</span>}
            {status && <span className="text-sm text-lamp" aria-live="polite">{status}</span>}
          </div>
          <div className="text-sm text-nickel" aria-live="polite">
            {rec && (singing ? (
              <>Hearing <span className="font-gear text-lg font-semibold text-bone">{singing.note}</span>, you're {Math.abs(singing.tuning).toFixed(0)} cents {singing.tuning < 0 ? "flat" : "sharp"} overall, which is fine</>
            ) : "Listening… headphones stop the orchestra leaking into the mic")}
          </div>
        </div>
        {view === "score" ? (
          <ScoreView conductor={c} version={version} />
        ) : (
          <StageView conductor={c} style={style} onChange={bump} />
        )}
      </section>

      {/* Mixer */}
      <section aria-label="Mixer" className="border-t border-grain pt-8">
        <h2 className="mb-4 font-gear text-[15px] font-semibold text-nickel">Orchestra</h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {style.parts.map((spec) => (
            <Strip key={`${style.id}-${spec.id}`} spec={spec} conductor={c} ensure={ensure} onChange={bump} />
          ))}
        </div>
      </section>

      <section aria-label="Hall and master" className="border-t border-grain pt-8 pb-6">
        <h2 className="mb-4 font-gear text-[15px] font-semibold text-nickel">Hall and master</h2>
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <Knob label="Hall size" value={master.hallSize} min={0} max={1} step={0.01} defaultValue={style.master.hallSize} onChange={(v) => ensure().setMaster({ hallSize: v })} format={(v) => `${(0.6 + v * 4.4).toFixed(1)} s`} />
          <Knob label="Hall level" value={master.hallMix} min={0} max={1} step={0.01} defaultValue={style.master.hallMix} onChange={(v) => ensure().setMaster({ hallMix: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Knob label="Echo time" value={master.echoBeats} min={0.25} max={2} step={0.25} defaultValue={style.master.echoBeats} onChange={(v) => ensure().setMaster({ echoBeats: v })} format={(v) => `${v} beat${v === 1 ? "" : "s"}`} />
          <Knob label="Echo repeats" value={master.echoFeedback} min={0} max={0.85} step={0.01} defaultValue={style.master.echoFeedback} onChange={(v) => ensure().setMaster({ echoFeedback: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Knob label="Warmth" value={master.warmth} min={-6} max={6} step={0.5} defaultValue={style.master.warmth} onChange={(v) => ensure().setMaster({ warmth: v })} format={(v) => `${v > 0 ? "+" : ""}${v} dB`} />
          <Knob label="Air" value={master.air} min={-6} max={6} step={0.5} defaultValue={style.master.air} onChange={(v) => ensure().setMaster({ air: v })} format={(v) => `${v > 0 ? "+" : ""}${v} dB`} />
          <Knob label="Volume" value={master.volume} min={0} max={1} step={0.01} defaultValue={0.85} onChange={(v) => ensure().setMaster({ volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </div>
      </section>
    </main>
  );
}

/** Metronome light: flashes on every beat, red on the downbeat. */
function BeatLight({ conductor }: { conductor: Conductor | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      const c = conductor;
      if (!c || c.state === "idle") {
        el.dataset.on = "";
        return;
      }
      const beats = c.currentStep() / STEPS_PER_BEAT;
      const beat = Math.floor(beats);
      const on = beats - beat < 0.18;
      const down = ((beat % c.style.beatsPerBar) + c.style.beatsPerBar) % c.style.beatsPerBar === 0;
      el.dataset.on = on ? (down ? "down" : "beat") : "";
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [conductor]);
  return (
    <span
      ref={ref}
      aria-hidden
      title="Beat"
      className="size-4 rounded-full bg-grain transition-[background,box-shadow] duration-75 data-[on=beat]:bg-lamp data-[on=beat]:shadow-[0_0_12px_var(--color-lamp)] data-[on=down]:bg-jewel data-[on=down]:shadow-[0_0_14px_var(--color-jewel)]"
    />
  );
}

function Strip({ spec, conductor, ensure, onChange }: { spec: PartSpec; conductor: Conductor | null; ensure: () => Conductor; onChange: () => void }) {
  const ch = conductor?.channelFor(spec) ?? {
    level: spec.level, pan: spec.pan, reverb: spec.reverb, echo: spec.echo ?? 0, mute: false, solo: false,
    params: { brightness: spec.brightness ?? 0.5, attack: 0.5, vibrato: 0.5, spread: 0.5 },
  };
  const patchId = conductor?.patchFor(spec) ?? spec.patch;
  const kit = spec.role === "perc" || spec.role === "swell";
  const options = PATCHES.filter((p) => (kit ? p.kit : !p.kit));
  const families = [...new Set(options.map((p) => p.family))];
  const set = (patch: Parameters<Conductor["setChannel"]>[1]) => {
    ensure().setChannel(spec, patch);
    onChange();
  };

  return (
    <div className="w-[208px] shrink-0 rounded-lg bg-ebony/70 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-gear text-lg font-semibold text-bone">{spec.label}</h3>
        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed={ch.mute}
            onClick={() => set({ mute: !ch.mute })}
            title="Mute"
            className={`rounded px-1.5 font-gear text-sm font-semibold ${ch.mute ? "bg-jewel text-ink" : "text-nickel hover:text-bone"}`}
          >
            M
          </button>
          <button
            type="button"
            aria-pressed={ch.solo}
            onClick={() => set({ solo: !ch.solo })}
            title="Solo"
            className={`rounded px-1.5 font-gear text-sm font-semibold ${ch.solo ? "bg-lamp text-ink" : "text-nickel hover:text-bone"}`}
          >
            S
          </button>
        </div>
      </div>
      <select
        aria-label={`Instrument for ${spec.label}`}
        value={patchId}
        disabled={kit}
        onChange={(e) => {
          ensure().setPatch(spec, e.target.value);
          onChange();
        }}
        className="mt-2 w-full rounded-md border border-grain bg-rosewood px-2 py-1.5 text-sm text-bone disabled:opacity-70"
      >
        {families.map((f) => (
          <optgroup key={f} label={FAMILY_NAMES[f]}>
            {options.filter((p) => p.family === f).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-3">
        <Knob label="Level" value={ch.level} min={0} max={1.5} step={0.01} defaultValue={spec.level} onChange={(v) => set({ level: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Knob label="Pan" value={ch.pan} min={-1} max={1} step={0.05} defaultValue={spec.pan} onChange={(v) => set({ pan: v })} format={(v) => (Math.abs(v) < 0.03 ? "Centre" : `${Math.round(Math.abs(v) * 100)} ${v < 0 ? "L" : "R"}`)} />
        <Knob label="Tone" value={ch.params.brightness} min={0} max={1} step={0.01} defaultValue={spec.brightness ?? 0.5} onChange={(v) => set({ params: { ...ch.params, brightness: v } })} format={(v) => (v < 0.35 ? "Dark" : v > 0.65 ? "Bright" : "Natural")} />
        <Knob label="Hall" value={ch.reverb} min={0} max={1} step={0.01} defaultValue={spec.reverb} onChange={(v) => set({ reverb: v })} format={(v) => `${Math.round(v * 100)}%`} />
        {!kit && (
          <>
            <Knob label="Attack" value={ch.params.attack} min={0} max={1} step={0.01} defaultValue={0.5} onChange={(v) => set({ params: { ...ch.params, attack: v } })} format={(v) => (v < 0.35 ? "Snappy" : v > 0.65 ? "Slow" : "Natural")} />
            <Knob label="Vibrato" value={ch.params.vibrato} min={0} max={1} step={0.01} defaultValue={0.5} onChange={(v) => set({ params: { ...ch.params, vibrato: v } })} format={(v) => `${Math.round(v * 100)}%`} />
          </>
        )}
      </div>
    </div>
  );
}
