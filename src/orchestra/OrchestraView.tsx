import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AudioEngine, type InputDevice } from "../audio/engine";
import { VOICE_OPTIONS } from "../analysis/pipeline";
import { Knob } from "../components/Controls";
import { midiToName, pcName, prefersFlats } from "../theory/theory";
import { TUNES, TUNE_BY_ID } from "./arranger/tunes";
import { STYLES, STYLE_BY_ID } from "./arranger/styles";
import { FORMATIONS, FORMATION_BY_ID, applyFormation } from "./arranger/formations";
import { TEMPO_TERMS, termFor } from "./arranger/tempo";
import { TIME_SIGS, isCompound, pulseSteps, pulsesPerBar, sigOf, withMeter, type TimeSig } from "./arranger/meter";
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
  const [sig, setSig] = useState<TimeSig | null>(null);
  const [toast, setToast] = useState<{ text: string; good: boolean; id: number } | null>(null);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [singing, setSinging] = useState<{ note: string; tuning: number } | null>(null);

  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG) (window as unknown as Record<string, unknown>).fretscribeOrchestra = { engine, conductorRef };
  const c = conductorRef.current;
  const baseStyle = STYLE_BY_ID[styleId];
  const style = useMemo(() => withMeter(applyFormation(baseStyle, FORMATION_BY_ID[formationId]), sig), [baseStyle, formationId, sig]);
  const effective = (styleKey: string, f: string, m: TimeSig | null) => withMeter(applyFormation(STYLE_BY_ID[styleKey], FORMATION_BY_ID[f]), m);

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
        const pulse = pulseSteps(cond.style);
        const step = cond.currentStep();
        const bar = Math.floor(step / barSteps) + 1;
        const beat = Math.floor((step % barSteps) / pulse) + 1;
        if (cond.state === "countIn") s = `Count-in: ${Math.max(1, pulsesPerBar(cond.style) + Math.floor(step / pulse) + 1)}`;
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
    setSig(null); // each style comes with its own metre
    conductorRef.current?.setStyle(effective(id, formationId, null), "style");
  };

  const pickFormation = (id: string) => {
    setFormationId(id);
    conductorRef.current?.setStyle(effective(styleId, id, sig), "keep");
  };

  const pickMeter = (m: TimeSig | null) => {
    setSig(m);
    conductorRef.current?.setStyle(effective(styleId, formationId, m), "convert");
  };

  const rate = (r: number) => {
    const cond = ensure();
    const credits = cond.feedback(r);
    const what = credits.map((c) => c.label).join(", ");
    const text = r > 0
      ? what ? `Noted. More ${what}.` : "Noted. More like this."
      : what ? `Noted. Less ${what}, changing from the next bar.` : "Noted. Trying something else.";
    setToast({ text, good: r > 0, id: Date.now() });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // L / ↑ = like, D / ↓ = dislike (unless you're typing or turning a knob).
  const rateRef = useRef(rate);
  rateRef.current = rate;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, select, textarea, [role=slider]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "l" || e.key === "L" || e.key === "ArrowUp") { e.preventDefault(); rateRef.current(1); }
      else if (e.key === "d" || e.key === "D" || e.key === "ArrowDown") { e.preventDefault(); rateRef.current(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      setTuneId(null);
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

  const [tuneId, setTuneId] = useState<string | null>(null);
  const playTune = async (id: string) => {
    const t = TUNE_BY_ID[id];
    const cond = ensure();
    await engine.stop();
    // Switch to the tune's own metre (or back to the style's, if they match).
    const own = sigOf(baseStyle);
    const m: TimeSig | null = own[0] === t.sig[0] && own[1] === t.sig[1] ? null : t.sig;
    if ((m ?? []).join("/") !== (sig ?? []).join("/")) pickMeter(m);
    cond.loadMelody(t.notes);
    setTuneId(id);
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
        <div role="group" aria-label="Demo tunes" className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-nickel">Or play a tune:</span>
          {TUNES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => playTune(t.id)}
              title={`${t.name} (${t.composer}), ${t.sig.join("/")}`}
              aria-pressed={tuneId === t.id && !rec && !!arr}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                tuneId === t.id && !rec && arr ? "border-bone text-bone" : "border-grain text-nickel hover:text-bone"
              }`}
            >
              <span className="font-gear text-base font-semibold">{t.name}</span> <span className="text-nickel">{t.composer}</span>
            </button>
          ))}
        </div>
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
            format={(v) => `${isCompound(sigOf(style)) ? "♩." : "♩"} = ${Math.round(v)}`}
          />
          <select
            aria-label="Time signature"
            value={sig ? sig.join("/") : ""}
            onChange={(e) => pickMeter(e.target.value ? (e.target.value.split("/").map(Number) as TimeSig) : null)}
            className="rounded-md border border-grain bg-ebony px-2 py-1.5 font-gear text-lg font-semibold text-bone"
          >
            <option value="">{sigOf(baseStyle).join("/")} (style)</option>
            {TIME_SIGS.map((t) => (
              <option key={t.join("/")} value={t.join("/")}>{t.join("/")}{isCompound(t) ? ", compound" : ""}</option>
            ))}
          </select>
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

      {/* Taste feedback */}
      <section aria-label="Your reaction" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-grain px-4 py-3">
        <p className="font-gear text-lg font-semibold text-bone">Like what you hear?</p>
        <button
          type="button"
          onClick={() => rate(1)}
          title="More like this (L or ↑)"
          className="flex items-center gap-2 rounded-full border border-lamp/70 px-4 py-1.5 font-gear text-lg font-semibold text-bone hover:bg-lamp hover:text-ink"
        >
          <Thumb up /> More like this
        </button>
        <button
          type="button"
          onClick={() => rate(-1)}
          title="Not this (D or ↓)"
          className="flex items-center gap-2 rounded-full border border-jewel/70 px-4 py-1.5 font-gear text-lg font-semibold text-bone hover:bg-jewel hover:text-ink"
        >
          <Thumb /> Not this
        </button>
        <Knob
          label="Adventurous"
          value={c?.adventurous ?? 0.25}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.25}
          onChange={(v) => { ensure().adventurous = v; bump(); }}
          format={(v) => (v < 0.2 ? "Stick to the style" : v > 0.7 ? "Surprise me" : "A little")}
        />
        <p className="ml-auto min-h-6 text-sm" aria-live="polite">
          {toast ? (
            <span key={toast.id} className={toast.good ? "text-lamp" : "text-jewel"}>{toast.text}</span>
          ) : (
            <span className="text-nickel">Press L or D any time while you hum or listen. Changes start from the next bar.</span>
          )}
        </p>
      </section>

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

      <TastePanel conductor={c} onReset={() => { ensure().resetTaste(); bump(); }} />

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

function Thumb({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-5 ${up ? "" : "rotate-180"}`} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="M7 10v10H4V10h3Zm0 0 4-7c1.5 0 2.5 1 2.2 2.6L12.6 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" />
    </svg>
  );
}

function TastePanel({ conductor, onReset }: { conductor: Conductor | null; onReset: () => void }) {
  const entries = conductor?.taste.summary(2) ?? [];
  const likes = entries.filter((e) => e.mean > 0.05).slice(0, 6);
  const dislikes = entries.filter((e) => e.mean < -0.05).slice(0, 6);
  const ratings = conductor?.taste.ratings ?? 0;
  const max = Math.max(0.3, ...entries.map((e) => Math.abs(e.mean)));
  const List = ({ items, tone }: { items: typeof entries; tone: "lamp" | "jewel" }) => (
    <ul className="space-y-1.5">
      {items.map((e) => (
        <li key={e.key} className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3 text-[15px]">
          <span className="truncate text-bone-dim" title={`${e.n} ratings`}>{e.label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-ebony">
            <span className={`block h-full ${tone === "lamp" ? "bg-lamp" : "bg-jewel"}`} style={{ width: `${(Math.abs(e.mean) / max) * 100 * (0.4 + 0.6 * e.confidence)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label="Your taste" className="border-t border-grain pt-8">
      <div className="mb-4 flex flex-wrap items-baseline gap-4">
        <h2 className="font-gear text-[15px] font-semibold text-nickel">Your taste</h2>
        <span className="text-sm text-nickel">{ratings === 0 ? "Nothing learned yet." : `Learned from ${ratings} reaction${ratings === 1 ? "" : "s"}, saved on this device.`}</span>
        {ratings > 0 && (
          <button type="button" onClick={onReset} className="ml-auto text-sm text-nickel underline decoration-grain underline-offset-4 hover:text-bone">
            Forget my taste
          </button>
        )}
      </div>
      {ratings === 0 ? (
        <p className="max-w-2xl text-bone-dim">
          Every reaction teaches it. It learns which textures, chord colours and chord moves you like, then leans that way in every style while
          still trying new things now and then (turn up Adventurous for more of that).
        </p>
      ) : (
        <div className="grid max-w-4xl gap-8 md:grid-cols-2">
          <div>
            <p className="mb-2 font-gear text-lg font-semibold text-lamp">You like</p>
            {likes.length ? <List items={likes} tone="lamp" /> : <p className="text-nickel">Not sure yet.</p>}
          </div>
          <div>
            <p className="mb-2 font-gear text-lg font-semibold text-jewel">Not for you</p>
            {dislikes.length ? <List items={dislikes} tone="jewel" /> : <p className="text-nickel">Nothing yet.</p>}
          </div>
        </div>
      )}
    </section>
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
      const beats = c.currentStep() / pulseSteps(c.style);
      const beat = Math.floor(beats);
      const on = beats - beat < 0.18;
      const per = pulsesPerBar(c.style);
      const down = ((beat % per) + per) % per === 0;
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
