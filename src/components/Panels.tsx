import type { AnalysisFrame, ChordChange } from "../analysis/pipeline";
import type { NoteEvent } from "../dsp/noteTracker";
import type { KeyCandidate } from "../theory/markov";
import {
  STANDARD_TUNING,
  chordPcs,
  diatonicTriads,
  midiToName,
  pc,
  pcName,
  prefersFlats,
  scalePcs,
  type QualityId,
} from "../theory/theory";
import { pcColor } from "./canvas";

const pct = (p: number) => `${(p * 100).toFixed(0)}%`;

function keyLabel(k: KeyCandidate) {
  return `${pcName(k.root, prefersFlats(k.root, k.scale))} ${k.scale.short}`;
}

// ------------------------------------------------------------- current note

export function NoteDisplay({ frame }: { frame: AnalysisFrame | null }) {
  const p = frame?.pitch;
  const note = frame?.activeNote;
  const midi = p?.midi ?? note?.midi;
  const cents = p?.cents ?? 0;
  const inTune = p && Math.abs(cents) < 5;
  return (
    <div className="note-display">
      <div className="note-name" style={{ color: midi !== undefined ? pcColor(pc(midi), 68) : "#2a3045" }}>
        {midi !== undefined ? pcName(midi) : "–"}
        <span className="octave">{midi !== undefined ? Math.floor(midi / 12) - 1 : ""}</span>
      </div>
      <div className="note-meta">
        <span>{p ? `${p.freq.toFixed(2)} Hz` : "listening…"}</span>
        <span>{p ? `clarity ${pct(p.clarity)}` : ""}</span>
      </div>
      <div className="tuner">
        <div className="tuner-scale">
          {[-50, -25, 0, 25, 50].map((c) => (
            <span key={c} style={{ left: `${50 + c}%` }} />
          ))}
        </div>
        <div
          className={`tuner-needle ${inTune ? "in-tune" : ""}`}
          style={{ left: `${50 + Math.max(-50, Math.min(50, cents))}%`, opacity: p ? 1 : 0.2 }}
        />
        <div className="tuner-labels">
          <span>♭</span>
          <span>{p ? `${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢` : "0¢"}</span>
          <span>♯</span>
        </div>
      </div>
      <div className="level">
        <div className="level-fill" style={{ width: pct(Math.min(1, (frame?.level ?? 0) * 6)) }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------- note tape

export function NoteTape({ notes }: { notes: NoteEvent[] }) {
  return (
    <div className="note-tape">
      {notes.length === 0 && <span className="muted">Play something — notes will be written here.</span>}
      {notes.map((n) => (
        <span
          key={n.id}
          className={`chip ${n.end === null ? "chip-live" : ""}`}
          style={{ borderColor: pcColor(pc(n.midi), 55), color: pcColor(pc(n.midi), 72) }}
        >
          {midiToName(n.midi)}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- chroma

export function ChromaBars({ chroma, highlight }: { chroma: number[]; highlight: Set<number> }) {
  return (
    <div className="chroma">
      {chroma.map((v, i) => (
        <div key={i} className="chroma-col">
          <div className="chroma-track">
            <div
              className="chroma-fill"
              style={{ height: pct(Math.min(1, v * 1.4)), background: pcColor(i, highlight.has(i) ? 62 : 38) }}
            />
          </div>
          <span className={highlight.has(i) ? "on" : ""}>{pcName(i)}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- key / scale

export function KeyPanel({ frame }: { frame: AnalysisFrame | null }) {
  const est = frame?.key;
  const best = est?.best;
  if (!est || !best) {
    return (
      <div className="empty">
        Need a few notes to infer the key…
        <div className="muted small">Single notes feed the Markov model; chords alone don't.</div>
      </div>
    );
  }
  const flats = prefersFlats(best.root, best.scale);
  const notes = scalePcs(best.root, best.scale);
  return (
    <div className="key-panel">
      <div className="big-label">
        {keyLabel(best)}
        <span className="confidence">{pct(best.prob)}</span>
      </div>
      <div className="scale-notes">
        {notes.map((p, i) => (
          <span key={p} className={`scale-note ${i === 0 ? "tonic" : ""}`} style={{ borderColor: pcColor(p, 55) }}>
            {pcName(p, flats)}
          </span>
        ))}
      </div>
      <div className="candidates">
        {est.candidates.slice(0, 5).map((c) => (
          <div key={`${c.root}-${c.scale.id}`} className="cand">
            <span className="cand-name">{keyLabel(c)}</span>
            <div className="bar">
              <div className="bar-fill" style={{ width: pct(c.prob) }} />
            </div>
            <span className="cand-p">{pct(c.prob)}</span>
          </div>
        ))}
      </div>
      <div className="muted small">
        r = {best.correlation.toFixed(2)} · Markov log-lik {best.logLik.toFixed(2)} · {est.noteWeight.toFixed(1)} note-weight
      </div>
    </div>
  );
}

// ------------------------------------------------------------- chords

const DEGREE = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
const MINORISH: QualityId[] = ["min", "m7", "dim"];

export function romanFor(root: number, quality: QualityId, keyRoot: number): string {
  let r = DEGREE[pc(root - keyRoot)];
  if (MINORISH.includes(quality)) r = r.toLowerCase();
  if (quality === "dim") r += "°";
  else if (quality === "7") r += "7";
  else if (quality === "maj7") r += "Δ7";
  else if (quality === "m7") r += "7";
  else if (quality === "sus2" || quality === "sus4") r += quality;
  else if (quality === "5") r += "5";
  return r;
}

export function ChordPanel({ frame, progression }: { frame: AnalysisFrame | null; progression: ChordChange[] }) {
  const chord = frame?.chord;
  const best = frame?.key.best;
  const diatonic = best ? diatonicTriads(best.root, best.scale) : [];
  return (
    <div className="chord-panel">
      <div className="chord-now">
        <div className="chord-name">{chord ? chord.name : "N.C."}</div>
        {chord?.quality && best && (
          <div className="chord-roman">{romanFor(chord.root, chord.quality.id, best.root)}</div>
        )}
      </div>
      <div className="candidates">
        {(frame?.chords ?? []).slice(0, 4).map((c) => (
          <div key={c.index} className="cand">
            <span className="cand-name">{c.name}</span>
            <div className="bar">
              <div className="bar-fill amber" style={{ width: pct(c.prob) }} />
            </div>
            <span className="cand-p">{pct(c.prob)}</span>
          </div>
        ))}
      </div>
      {diatonic.length > 0 && (
        <>
          <div className="section-label">Diatonic chords in {keyLabel(best!)}</div>
          <div className="diatonic">
            {diatonic.map((d) => {
              const on = chord && chord.root === d.root;
              return (
                <div key={d.degree} className={`dia ${on ? "on" : ""}`}>
                  <span className="dia-roman">{d.roman}</span>
                  <span className="dia-name">{d.name}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className="section-label">Progression</div>
      <div className="progression">
        {progression.length === 0 && <span className="muted small">Strum some chords…</span>}
        {progression.slice(-16).map((c, i) => (
          <span key={`${c.start}-${i}`} className="prog-chip" style={{ borderColor: pcColor(c.root, 50) }}>
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Markov matrix

export function MarkovMatrix({ frame }: { frame: AnalysisFrame | null }) {
  const est = frame?.key;
  if (!est) return <div className="empty">No data yet</div>;
  const P = est.transitions;
  const pi = est.stationary;
  const piMax = Math.max(...pi);
  const tonic = est.best?.root ?? -1;
  return (
    <div className="markov">
      <div className="matrix" style={{ gridTemplateColumns: `28px repeat(12, 1fr)` }}>
        <span />
        {Array.from({ length: 12 }, (_, j) => (
          <span key={j} className={`axis ${j === tonic ? "tonic" : ""}`}>{pcName(j)}</span>
        ))}
        {P.map((row, i) => (
          <Row key={i} i={i} row={row} tonic={tonic} />
        ))}
      </div>
      <div className="section-label">Stationary distribution π (long-run note weight)</div>
      <div className="stationary">
        {pi.map((v, i) => (
          <div key={i} className="st-col" title={`${pcName(i)}: ${pct(v)}`}>
            <div className="st-fill" style={{ height: pct(v / (piMax || 1)), background: pcColor(i, 55) }} />
            <span className={i === tonic ? "tonic" : ""}>{pcName(i)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ i, row, tonic }: { i: number; row: number[]; tonic: number }) {
  return (
    <>
      <span className={`axis ${i === tonic ? "tonic" : ""}`}>{pcName(i)}</span>
      {row.map((v, j) => (
        <span
          key={j}
          className="cell"
          title={`P(${pcName(j)} | ${pcName(i)}) = ${pct(v)}`}
          style={{ background: `rgba(94,234,212,${Math.min(1, v * 2.2)})` }}
        />
      ))}
    </>
  );
}

// ------------------------------------------------------------- fretboard

const FRETS = 15;
const INLAYS = [3, 5, 7, 9, 15];

export function Fretboard({ frame }: { frame: AnalysisFrame | null }) {
  const best = frame?.key.best;
  const scale = new Set(best ? scalePcs(best.root, best.scale) : []);
  const chord = frame?.chord?.quality ? new Set(chordPcs(frame.chord.root, frame.chord.quality)) : new Set<number>();
  const live = frame?.activeNote?.midi ?? frame?.pitch?.midi;
  const flats = best ? prefersFlats(best.root, best.scale) : false;

  const W = 1000, H = 170, left = 34, top = 16, bottom = 22;
  const fretX = (f: number) => left + (W - left - 8) * (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -FRETS / 12));
  const strY = (s: number) => top + ((5 - s) * (H - top - bottom)) / 5;

  const dots = [];
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= FRETS; f++) {
      const midi = STANDARD_TUNING[s] + f;
      const p = pc(midi);
      const isLive = live === midi;
      const inScale = scale.has(p);
      const inChord = chord.has(p);
      if (!isLive && !inScale && !inChord) continue;
      const x = f === 0 ? left - 14 : (fretX(f - 1) + fretX(f)) / 2;
      const y = strY(s);
      const isTonic = best && p === best.root;
      dots.push(
        <g key={`${s}-${f}`}>
          {isLive && <circle cx={x} cy={y} r={14} fill={pcColor(p, 60, 0.35)} className="pulse" />}
          <circle
            cx={x}
            cy={y}
            r={isLive ? 10 : 8}
            fill={isLive ? pcColor(p, 62) : inScale ? (isTonic ? "#fbbf24" : "rgba(94,234,212,0.22)") : "transparent"}
            stroke={inChord ? "#f472b6" : isTonic ? "#fbbf24" : "rgba(94,234,212,0.6)"}
            strokeWidth={inChord ? 2.5 : 1}
          />
          <text x={x} y={y + 3.5} textAnchor="middle" className={`fb-label ${isLive || isTonic ? "dark" : ""}`}>
            {pcName(p, flats)}
          </text>
        </g>,
      );
    }
  }

  return (
    <svg className="fretboard" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <rect x={left} y={top - 6} width={W - left - 8} height={H - top - bottom + 12} rx={4} fill="#1a1410" />
      {INLAYS.map((f) => (
        <circle key={f} cx={(fretX(f - 1) + fretX(f)) / 2} cy={(strY(2) + strY(3)) / 2} r={5} fill="rgba(255,255,255,0.12)" />
      ))}
      <circle cx={(fretX(11) + fretX(12)) / 2} cy={(strY(1) + strY(2)) / 2} r={5} fill="rgba(255,255,255,0.12)" />
      <circle cx={(fretX(11) + fretX(12)) / 2} cy={(strY(3) + strY(4)) / 2} r={5} fill="rgba(255,255,255,0.12)" />
      <rect x={left - 3} y={top - 6} width={5} height={H - top - bottom + 12} fill="#e5e7eb" />
      {Array.from({ length: FRETS }, (_, f) => (
        <g key={f}>
          <line x1={fretX(f + 1)} x2={fretX(f + 1)} y1={top - 6} y2={H - bottom + 6} stroke="#71717a" strokeWidth={2} />
          <text x={(fretX(f) + fretX(f + 1)) / 2} y={H - 4} textAnchor="middle" className="fb-fret">{f + 1}</text>
        </g>
      ))}
      {STANDARD_TUNING.map((_, s) => (
        <line key={s} x1={left} x2={W - 8} y1={strY(s)} y2={strY(s)} stroke="#a8a29e" strokeWidth={0.8 + (5 - s) * 0.35} />
      ))}
      {dots}
    </svg>
  );
}
