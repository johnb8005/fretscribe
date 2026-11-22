import type { AnalysisFrame, ChordChange } from "../analysis/pipeline";
import type { KeyCandidate } from "../theory/markov";
import {
  STANDARD_TUNING,
  chordPcs,
  diatonicTriads,
  pc,
  pcName,
  prefersFlats,
  scalePcs,
  type QualityId,
} from "../theory/theory";

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function keyLabel(k: KeyCandidate): string {
  const lower = ["major", "natural", "harmonic", "minor", "blues"];
  const name = k.scale.name.replace(/^(\w+)/, (w) => (lower.includes(w.toLowerCase()) ? w.toLowerCase() : w));
  return `${pcName(k.root, prefersFlats(k.root, k.scale))} ${name}`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-gear text-[15px] font-semibold text-nickel">{children}</h2>;
}

// ------------------------------------------------------------- current note

const LEDS = 21;

export function NoteReadout({ frame }: { frame: AnalysisFrame | null }) {
  const p = frame?.pitch;
  const midi = p?.midi ?? frame?.activeNote?.midi;
  const cents = p?.cents ?? 0;
  const lit = p ? Math.round(cents / 5) + 10 : -1;
  const inTune = p && Math.abs(cents) < 5;
  const level = Math.min(1, (frame?.level ?? 0) * 6);

  return (
    <div className="flex h-full flex-col justify-between py-1">
      <SectionLabel>Playing</SectionLabel>
      <div className="flex items-start leading-none" aria-live="polite">
        <span className={`font-gear text-[132px] font-bold tracking-tight ${midi === undefined ? "text-grain" : "text-bone"}`}>
          {midi === undefined ? "·" : pcName(midi)}
        </span>
        {midi !== undefined && (
          <span className="mt-4 ml-1 font-gear text-4xl font-semibold text-nickel">{Math.floor(midi / 12) - 1}</span>
        )}
      </div>
      <div className="flex items-baseline justify-between text-sm text-nickel">
        <span>{p ? `${p.freq.toFixed(1)} Hz` : "No pitch"}</span>
        <span className={inTune ? "text-pearl" : p ? "text-lamp" : ""}>
          {p ? (inTune ? "In tune" : `${cents > 0 ? "+" : ""}${cents.toFixed(0)} cents`) : ""}
        </span>
      </div>
      <div className="mt-3 flex gap-[3px]" aria-hidden>
        {Array.from({ length: LEDS }, (_, i) => {
          const on = i === lit;
          const center = i === 10;
          return (
            <span
              key={i}
              className={`h-5 flex-1 rounded-[2px] ${
                on ? (center ? "bg-pearl shadow-[0_0_10px_var(--color-pearl)]" : "bg-lamp shadow-[0_0_10px_var(--color-lamp)]") : center ? "bg-grain/90" : "bg-ebony"
              }`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-nickel/70">
        <span>flat</span>
        <span>sharp</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-ebony" title="Input level">
        <div className="h-full bg-bone/60 transition-[width] duration-75" style={{ width: pct(level) }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------- key / scale

export function KeyBlock({ frame }: { frame: AnalysisFrame | null }) {
  const est = frame?.key;
  const best = est?.best;
  return (
    <div>
      <SectionLabel>Scale</SectionLabel>
      {!est || !best ? (
        <p className="max-w-sm text-nickel">
          Play a few single notes. The scale is worked out from which notes you play and how you move between them.
        </p>
      ) : (
        <>
          <p className="font-gear text-5xl font-bold leading-none text-bone">{keyLabel(best)}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1 w-40 overflow-hidden rounded-full bg-ebony">
              <div className="h-full bg-lamp transition-[width] duration-300" style={{ width: pct(best.prob) }} />
            </div>
            <span className="text-sm text-nickel">{pct(best.prob)} likely</span>
          </div>
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Scale notes">
            {scalePcs(best.root, best.scale).map((p, i) => (
              <li
                key={p}
                className={`grid size-10 place-items-center rounded-full font-gear text-lg font-semibold ${
                  i === 0 ? "bg-lamp text-ink" : "border border-pearl/60 text-pearl"
                }`}
              >
                {pcName(p, prefersFlats(best.root, best.scale))}
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <p className="mb-1.5 text-sm text-nickel">Also possible</p>
            <ul className="space-y-1 text-[15px]">
              {est.candidates.slice(1, 4).map((c) => (
                <li key={`${c.root}-${c.scale.id}`} className="flex max-w-xs justify-between">
                  <span className="text-bone-dim">{keyLabel(c)}</span>
                  <span className="text-nickel">{pct(c.prob)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- chords

const DEGREE = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
const MINORISH: QualityId[] = ["min", "m7", "dim"];

export function romanFor(root: number, quality: QualityId, keyRoot: number): string {
  let r = DEGREE[pc(root - keyRoot)];
  if (MINORISH.includes(quality)) r = r.toLowerCase();
  const suffix: Partial<Record<QualityId, string>> = { dim: "°", "7": "7", maj7: "maj7", m7: "7", sus2: "sus2", sus4: "sus4", "5": "5" };
  return r + (suffix[quality] ?? "");
}

export function ChordBlock({ frame, progression }: { frame: AnalysisFrame | null; progression: ChordChange[] }) {
  const chord = frame?.chord;
  const best = frame?.key.best;
  const diatonic = best ? diatonicTriads(best.root, best.scale) : [];
  const others = (frame?.chords ?? []).filter((c) => c.quality && c.index !== chord?.index).slice(0, 2);
  const recent = progression.slice(-10);

  return (
    <div>
      <SectionLabel>Chord</SectionLabel>
      <div className="flex items-baseline gap-4">
        <p className={`font-gear text-[88px] font-bold leading-[0.85] ${chord ? "text-bone" : "text-grain"}`}>
          {chord ? chord.name : "No chord"}
        </p>
        {chord?.quality && best && (
          <span className="font-gear text-3xl font-medium text-nickel">{romanFor(chord.root, chord.quality.id, best.root)}</span>
        )}
      </div>
      <p className="mt-3 h-5 text-sm text-nickel">
        {chord && others.length > 0 && others[0].prob > 0.02
          ? `Could also be ${others.filter((o) => o.prob > 0.02).map((o) => `${o.name} (${pct(o.prob)})`).join(" or ")}`
          : ""}
      </p>

      {diatonic.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm text-nickel">Chords in {keyLabel(best!)}</p>
          <ol className="grid max-w-xl grid-cols-7 gap-1.5">
            {diatonic.map((d) => {
              const on = chord?.root === d.root;
              return (
                <li
                  key={d.degree}
                  className={`rounded-md px-1 pt-1.5 pb-2 text-center transition-colors duration-150 ${
                    on ? "bg-bone text-ink" : "bg-ebony text-bone"
                  }`}
                >
                  <span className={`block font-gear text-sm font-medium ${on ? "text-jewel" : "text-nickel"}`}>{d.roman}</span>
                  <span className="block font-gear text-xl font-semibold">{d.name}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="mt-5">
        <p className="mb-1 text-sm text-nickel">Progression</p>
        {recent.length === 0 ? (
          <p className="text-bone-dim">Strum a few chords to start the log.</p>
        ) : (
          <p className="flex flex-wrap gap-x-4 font-gear text-2xl font-semibold">
            {recent.map((c, i) => (
              <span
                key={`${c.start}-${i}`}
                className={i === recent.length - 1 ? "text-bone" : "text-nickel"}
                style={{ opacity: 0.45 + (0.55 * (i + 1)) / recent.length }}
              >
                {c.name}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- fretboard

const FRETS = 15;
const SINGLE_DOTS = [3, 5, 7, 9, 15];

export function Fretboard({ frame }: { frame: AnalysisFrame | null }) {
  const best = frame?.key.best;
  const scale = new Set(best ? scalePcs(best.root, best.scale) : []);
  const chord = frame?.chord?.quality ? new Set(chordPcs(frame.chord.root, frame.chord.quality)) : new Set<number>();
  const live = frame?.pitch?.midi ?? frame?.activeNote?.midi;
  const flats = best ? prefersFlats(best.root, best.scale) : false;

  const W = 1200, H = 196, left = 44, top = 20, bottom = 30, right = 10;
  const span = W - left - right;
  const fretX = (f: number) => left + (span * (1 - Math.pow(2, -f / 12))) / (1 - Math.pow(2, -FRETS / 12));
  const strY = (s: number) => top + ((5 - s) * (H - top - bottom)) / 5;
  const mid = (f: number) => (f === 0 ? left - 22 : (fretX(f - 1) + fretX(f)) / 2);

  const marks = [];
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= FRETS; f++) {
      const midi = STANDARD_TUNING[s] + f;
      const p = pc(midi);
      const isLive = live === midi;
      const inScale = scale.has(p);
      const inChord = chord.has(p);
      if (!isLive && !inScale && !inChord) continue;
      const isTonic = best !== null && best !== undefined && p === best.root;
      const x = mid(f), y = strY(s);
      marks.push(
        <g key={`${s}-${f}`}>
          {isLive && <circle cx={x} cy={y} r={17} className="origin-center animate-glow fill-lamp/35 [transform-box:fill-box]" />}
          <circle
            cx={x}
            cy={y}
            r={isLive ? 12 : 10.5}
            className={isLive ? "fill-lamp" : isTonic ? "fill-lamp/90" : inScale ? "fill-[#2f3b38]" : "fill-ebony"}
            stroke={inChord ? "var(--color-jewel)" : isLive || isTonic ? "none" : "var(--color-pearl)"}
            strokeOpacity={inChord ? 1 : 0.55}
            strokeWidth={inChord ? 2.5 : 1}
          />
          <text
            x={x}
            y={y + 4}
            textAnchor="middle"
            className={`pointer-events-none font-gear text-[12px] font-semibold ${isLive || isTonic ? "fill-ink" : "fill-pearl"}`}
          >
            {pcName(p, flats)}
          </text>
        </g>,
      );
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Fretboard showing the scale, chord tones and the note you are playing">
      <defs>
        <linearGradient id="board" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d2c22" />
          <stop offset="1" stopColor="#2e2019" />
        </linearGradient>
      </defs>
      <rect x={left} y={top - 10} width={span} height={H - top - bottom + 20} rx={3} fill="url(#board)" />
      {SINGLE_DOTS.map((f) => (
        <circle key={f} cx={mid(f)} cy={(strY(2) + strY(3)) / 2} r={6} fill="var(--color-pearl)" fillOpacity={0.18} />
      ))}
      <circle cx={mid(12)} cy={(strY(1) + strY(2)) / 2} r={6} fill="var(--color-pearl)" fillOpacity={0.18} />
      <circle cx={mid(12)} cy={(strY(3) + strY(4)) / 2} r={6} fill="var(--color-pearl)" fillOpacity={0.18} />
      <rect x={left - 4} y={top - 10} width={6} height={H - top - bottom + 20} fill="var(--color-bone)" />
      {Array.from({ length: FRETS }, (_, f) => (
        <g key={f}>
          <rect x={fretX(f + 1) - 1.25} y={top - 10} width={2.5} height={H - top - bottom + 20} fill="#8f897f" />
          {(SINGLE_DOTS.includes(f + 1) || f + 1 === 12) && (
            <text x={mid(f + 1)} y={H - 6} textAnchor="middle" className="fill-nickel font-gear text-[13px] font-medium">
              {f + 1}
            </text>
          )}
        </g>
      ))}
      {STANDARD_TUNING.map((_, s) => (
        <line key={s} x1={left} x2={W - right} y1={strY(s)} y2={strY(s)} stroke="#c9c2b5" strokeOpacity={0.75} strokeWidth={0.7 + (5 - s) * 0.3} />
      ))}
      {marks}
    </svg>
  );
}

// ------------------------------------------------------------- workings

export function Workings({ frame }: { frame: AnalysisFrame | null }) {
  const est = frame?.key;
  const P = est?.observed;
  const pi = est?.stationary ?? new Array(12).fill(1 / 12);
  const piMax = Math.max(...pi, 1e-9);
  const tonic = est?.best?.root ?? -1;
  const chroma = frame?.chroma ?? new Array(12).fill(0);
  const chordTones = new Set(frame?.chord?.quality ? chordPcs(frame.chord.root, frame.chord.quality) : []);
  const hasData = (est?.noteWeight ?? 0) > 0;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <figure>
        <figcaption className="mb-3 max-w-md text-sm text-nickel">
          How often you move from each note (row) to the next (column), learned from what you play. Each scale has its own model of these moves; the closest match wins.
        </figcaption>
        <div className="grid max-w-[400px] grid-cols-[24px_repeat(12,minmax(0,1fr))] gap-[2px] text-[11px]">
          <span />
          {Array.from({ length: 12 }, (_, j) => (
            <span key={j} className={`text-center font-gear ${j === tonic ? "text-lamp" : "text-nickel"}`}>{pcName(j)}</span>
          ))}
          {Array.from({ length: 12 }, (_, i) => (
            <Row key={i} i={i} row={P?.[i]} tonic={tonic} hasData={hasData} />
          ))}
        </div>
      </figure>
      <div className="space-y-8">
        <Bars
          caption="Long-run weight of each note: the stationary distribution of that chain. The tonic usually towers."
          values={pi.map((v) => v / piMax)}
          on={(i) => i === tonic}
          color="bg-lamp"
        />
        <Bars
          caption="Pitch-class energy heard right now, which drives the chord guess. Chord tones are lit."
          values={chroma.map((v) => Math.min(1, v * 1.3))}
          on={(i) => chordTones.has(i)}
          color="bg-jewel"
        />
      </div>
    </div>
  );
}

function Row({ i, row, tonic, hasData }: { i: number; row?: number[]; tonic: number; hasData: boolean }) {
  return (
    <>
      <span className={`self-center font-gear ${i === tonic ? "text-lamp" : "text-nickel"}`}>{pcName(i)}</span>
      {Array.from({ length: 12 }, (_, j) => {
        const v = hasData && row ? row[j] : 0;
        return (
          <span
            key={j}
            className="aspect-square rounded-[2px] bg-ebony"
            title={hasData && row ? `${pcName(i)} → ${pcName(j)}: ${pct(v)}` : undefined}
            style={v > 0.03 ? { backgroundColor: `rgba(169,210,203,${Math.min(1, 0.12 + v * 1.6)})` } : undefined}
          />
        );
      })}
    </>
  );
}

function Bars({ caption, values, on, color }: { caption: string; values: number[]; on: (i: number) => boolean; color: string }) {
  return (
    <figure>
      <figcaption className="mb-3 max-w-md text-sm text-nickel">{caption}</figcaption>
      <div className="grid h-20 max-w-md grid-cols-12 items-end gap-1">
        {values.map((v, i) => (
          <div key={i} className={`rounded-t-[2px] transition-[height] duration-100 ${on(i) ? color : "bg-grain"}`} style={{ height: `${Math.max(2, v * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 grid max-w-md grid-cols-12 gap-1 text-center font-gear text-[12px]">
        {values.map((_, i) => (
          <span key={i} className={on(i) ? "text-bone" : "text-nickel"}>{pcName(i)}</span>
        ))}
      </div>
    </figure>
  );
}
