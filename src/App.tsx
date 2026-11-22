import { useState } from "react";
import { GuitarView } from "./GuitarView";
import { OrchestraView } from "./orchestra/OrchestraView";

type Mode = "guitar" | "orchestra";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "guitar", label: "Guitar", hint: "Play. It writes it down." },
  { id: "orchestra", label: "Orchestra", hint: "Hum a tune. Hear it orchestrated." },
];

export default function App() {
  const [mode, setMode] = useState<Mode>("guitar");
  const current = MODES.find((m) => m.id === mode)!;
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-grain px-6 pt-3 lg:px-10">
        <div className="flex items-baseline gap-3 pb-3">
          <h1 className="font-gear text-[30px] font-bold tracking-tight text-bone">Fretscribe</h1>
          <span className="hidden text-sm text-nickel md:inline">{current.hint}</span>
        </div>
        <nav aria-label="Mode" className="ml-auto flex gap-6 self-end">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-current={m.id === mode ? "page" : undefined}
              onClick={() => setMode(m.id)}
              className={`-mb-px border-b-2 pb-3 font-gear text-xl font-semibold transition-colors ${
                m.id === mode ? "border-lamp text-bone" : "border-transparent text-nickel hover:text-bone-dim"
              }`}
            >
              {m.label}
            </button>
          ))}
        </nav>
      </header>
      {/* Each mode owns its audio; unmounting stops it. */}
      {mode === "guitar" ? <GuitarView /> : <OrchestraView />}
    </div>
  );
}
