// Engraves an arrangement as a full score with VexFlow (Bravura font bundled).

import {
  Accidental,
  Articulation,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice,
  type RenderContext,
} from "vexflow/bravura";
import { pc, pcName } from "../../theory/theory";
import { KIT, PATCH_BY_ID } from "../synth/patches";
import { harmonicKey, isMinorKey } from "../arranger/harmony";
import { STEPS_PER_BEAT, type Arrangement, type KeyInfo, type Part, type PartSpec, type QNote } from "../arranger/types";

const INK = "#231d19";
const LETTERS = ["c", "d", "e", "f", "g", "a", "b"];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const FLAT_MAJORS = [5, 10, 3, 8, 1];

export interface MeasureBox {
  bar: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  measures: MeasureBox[];
}

// ------------------------------------------------------------------ spelling

interface Spelling {
  /** Major key used for the signature, e.g. "Eb". */
  sig: string;
  /** Alteration per letter from the signature. */
  sigAlter: Record<string, number>;
  /** pitch class → [letter, alter] */
  spell: Map<number, [string, number]>;
  flats: boolean;
}

function spelling(key: KeyInfo): Spelling {
  const k = harmonicKey(key);
  const offset: Record<string, number> = { major: 0, minor: 3, dorian: -2, mixolydian: 5 };
  const sigRoot = pc(k.root + (offset[k.scale.id] ?? (isMinorKey(k) ? 3 : 0)));
  const flats = FLAT_MAJORS.includes(sigRoot);
  const sig = pcName(sigRoot, flats);
  const sigAlter: Record<string, number> = {};
  const spell = new Map<number, [string, number]>();
  const li = LETTERS.indexOf(sig[0].toLowerCase());
  const major = [0, 2, 4, 5, 7, 9, 11];
  for (let i = 0; i < 7; i++) {
    const letter = LETTERS[(li + i) % 7];
    const target = pc(sigRoot + major[i]);
    let alter = target - NATURAL[LETTERS.indexOf(letter)];
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    sigAlter[letter] = alter;
    spell.set(target, [letter, alter]);
  }
  // Raised leading tone in minor keys is spelled as a sharpened letter.
  if (isMinorKey(k)) {
    const lead = pc(k.root + 11);
    const seventh = pc(k.root + 10);
    const s = spell.get(seventh);
    if (s) spell.set(lead, [s[0], s[1] + 1]);
  }
  for (let p = 0; p < 12; p++) {
    if (spell.has(p)) continue;
    const name = pcName(p, flats);
    spell.set(p, [name[0].toLowerCase(), name.length > 1 ? (name[1] === "#" ? 1 : -1) : 0]);
  }
  return { sig, sigAlter, spell, flats };
}

function vfKey(midi: number, sp: Spelling): { key: string; letter: string; alter: number; octave: number } {
  const [letter, alter] = sp.spell.get(pc(midi))!;
  // Octave follows the letter (B# belongs to the octave below, Cb above).
  const octave = Math.floor((midi - alter) / 12) - 1;
  const acc = alter === 1 ? "#" : alter === -1 ? "b" : alter === 2 ? "##" : alter === -2 ? "bb" : "";
  return { key: `${letter}${acc}/${octave}`, letter, alter, octave };
}

const ACC = (a: number) => (a === 0 ? "n" : a === 1 ? "#" : a === -1 ? "b" : a === 2 ? "##" : "bb");

const KIT_POS: Record<number, string> = {
  [KIT.BASS_DRUM]: "f/4",
  [KIT.TAIKO_LOW]: "a/4",
  [KIT.TAIKO_HIGH]: "c/5",
  [KIT.BRUSH]: "c/5",
  [KIT.RIDE]: "f/5/x2",
  [KIT.SWELL]: "g/5/x2",
  [KIT.TRIANGLE]: "e/5/x2",
};

// ------------------------------------------------------------------ durations

const DUR: Record<number, [string, number]> = {
  16: ["w", 0], 12: ["h", 1], 8: ["h", 0], 6: ["q", 1], 4: ["q", 0], 3: ["8", 1], 2: ["8", 0], 1: ["16", 0],
};
const PIECES = [16, 12, 8, 6, 4, 3, 2, 1];

/** May a note of `x` steps start at bar position `pos`? (standard beaming/beat rules) */
function startsOk(x: number, pos: number, barSteps: number): boolean {
  switch (x) {
    case 1: return true;
    case 2: return pos % 2 === 0;
    case 3: case 4: case 6: return pos % STEPS_PER_BEAT === 0;
    case 8: return pos % 8 === 0;
    case 12: return pos === 0 || (barSteps % 8 === 0 && pos % 8 === 0);
    case 16: return pos === 0;
    default: return false;
  }
}

/** Split a length starting at bar position `pos` into notatable, beat-respecting pieces. */
export function pieces(pos: number, len: number, barSteps: number, dotted = true): number[] {
  const out: number[] = [];
  while (len > 0) {
    // In 4/4, keep the middle of the bar visible (no value straddles beat 3 unless it starts the bar).
    const half = barSteps === 16 ? 8 : Infinity;
    const p = PIECES.find((x) => (dotted || DUR[x][1] === 0) && x <= len && pos + x <= barSteps && startsOk(x, pos, barSteps) && !(pos > 0 && pos < half && pos + x > half)) ?? 1;
    out.push(p);
    pos += p;
    len -= p;
  }
  return out;
}

// ------------------------------------------------------------------ clefs

function clefFor(part: Part, patchId: string): "treble" | "bass" | "percussion" {
  const patch = PATCH_BY_ID[patchId];
  if (patch?.kit) return "percussion";
  const ms = part.notes.map((n) => n.midi).sort((a, b) => a - b);
  const median = ms.length ? ms[Math.floor(ms.length / 2)] : (part.spec.register[0] + part.spec.register[1]) / 2;
  // Start from the instrument's own clef; only switch when the part clearly lives elsewhere.
  const home = patch?.clef === "bass" ? "bass" : "treble";
  if (home === "treble" && median < 52) return "bass";
  if (home === "bass" && median > 64) return "treble";
  return home;
}

// ------------------------------------------------------------------ measure

interface Built {
  notes: StaveNote[];
  ties: StaveTie[];
  starts: Map<number, StaveNote>;
  accents: StaveNote[];
}

// SMuFL dynamic letters (Bravura).
const SMUFL: Record<string, string> = { p: "\uE520", m: "\uE521", f: "\uE522", s: "\uE524", z: "\uE525" };
export const dynamicGlyphs = (text: string) => [...text].map((c) => SMUFL[c] ?? c).join("");
const DYN_TEXT = ["pp", "p", "mp", "mf", "f", "ff"];

function buildMeasure(part: Part, clef: string, bar: number, barSteps: number, sp: Spelling): Built {
  const start = bar * barSteps;
  const end = start + barSteps;
  const inBar = part.notes.filter((n) => n.step < end && n.step + n.dur > start && n.step >= start);
  // Notes tied over from the previous bar are shown as a restruck note at the barline.
  const carried = part.notes.filter((n) => n.step < start && n.step + n.dur > start);
  const all: QNote[] = [...carried.map((n) => ({ ...n, step: start, dur: n.step + n.dur - start })), ...inBar];

  const onsets = [...new Set(all.map((n) => n.step))].sort((a, b) => a - b);
  const groups = onsets.map((s, i) => {
    const ns = all.filter((n) => n.step === s);
    const next = onsets[i + 1] ?? end;
    // Drum hits read better as "until the next hit" than as 16ths plus rests.
    const own = clef === "percussion" ? next - s : Math.max(...ns.map((n) => n.dur));
    const len = Math.min(own, next - s, end - s);
    return { step: s, len, midis: [...new Set(ns.map((n) => n.midi))].sort((a, b) => a - b), accent: ns.some((n) => n.accent) };
  });

  const notes: StaveNote[] = [];
  const ties: StaveTie[] = [];
  const starts = new Map<number, StaveNote>();
  const accents: StaveNote[] = [];
  const restKey = clef === "bass" ? "d/3" : "b/4";
  const accState = new Map<string, number>();

  const rest = (pos: number, len: number) => {
    if (len === barSteps) {
      notes.push(new StaveNote({ keys: [restKey], duration: "wr", clef, alignCenter: true }));
      return;
    }
    // Copyists don't dot rests.
    for (const p of pieces(pos - start, len, barSteps, false)) {
      const [d, dots] = DUR[p];
      const n = new StaveNote({ keys: [restKey], duration: d + "r", clef });
      if (dots) Dot.buildAndAttach([n], { all: true });
      notes.push(n);
    }
  };

  let cursor = start;
  for (const g of groups) {
    if (g.step > cursor) rest(cursor, g.step - cursor);
    const keyed = clef === "percussion"
      ? g.midis.map((m) => ({ key: KIT_POS[m] ?? "c/5", letter: "", alter: 0, octave: 0 }))
      : g.midis.map((m) => vfKey(m, sp));
    let prev: StaveNote | null = null;
    let pos = g.step;
    for (const p of pieces(g.step - start, g.len, barSteps)) {
      const [d, dots] = DUR[p];
      const n = new StaveNote({ keys: keyed.map((k) => k.key), duration: d, clef, autoStem: true });
      if (clef !== "percussion" && !prev) {
        keyed.forEach((k, i) => {
          const id = `${k.letter}${k.octave}`;
          const current = accState.get(id) ?? sp.sigAlter[k.letter] ?? 0;
          if (current !== k.alter) {
            n.addModifier(new Accidental(ACC(k.alter)), i);
            accState.set(id, k.alter);
          }
        });
      }
      if (dots) Dot.buildAndAttach([n], { all: true });
      if (prev) ties.push(new StaveTie({ firstNote: prev, lastNote: n, firstIndexes: keyed.map((_, i) => i), lastIndexes: keyed.map((_, i) => i) }));
      if (!prev) {
        starts.set(pos, n);
        if (g.accent) {
          n.addModifier(new Articulation("a>"), 0);
          accents.push(n);
        }
      }
      notes.push(n);
      prev = n;
      pos += p;
    }
    cursor = g.step + g.len;
  }
  if (cursor < end) rest(cursor, end - cursor);
  return { notes, ties, starts, accents };
}

// ------------------------------------------------------------------ dynamics

function drawDynamics(ctx: RenderContext, stave: Stave, part: Part, bar: number, firstShown: boolean, accents: StaveNote[], notes: StaveNote[]) {
  const lv = part.levels;
  if (!lv || part.spec.role === "swell") return;
  // Sit under the lowest notehead (ledger lines included), but stay clear of the next staff.
  let lowest = stave.getYForLine(4);
  for (const n of notes) if (!n.isRest()) lowest = Math.max(lowest, ...n.getYs());
  const y = Math.min(stave.getYForLine(4) + 44, Math.max(stave.getYForLine(4) + 30, lowest + 24));
  const x0 = stave.getNoteStartX();
  const x1 = stave.getNoteEndX();
  ctx.save();
  ctx.setFont("Bravura", 26);
  const level = lv[bar];
  const markAt = firstShown || bar === 0 || lv[bar - 1] !== level;
  let markEnd = x0;
  if (markAt && level !== undefined) {
    const text = dynamicGlyphs(DYN_TEXT[level]);
    ctx.fillText(text, x0 + 2, y);
    markEnd = x0 + 6 + ctx.measureText(text).width;
  }
  for (const n of accents) ctx.fillText(dynamicGlyphs("sfz"), n.getAbsoluteX() - 6, y + (markAt ? 14 : 0));
  // Hairpin across the bar toward the next bar's level.
  const next = lv[bar + 1];
  if (next !== undefined && level !== undefined && next !== level) {
    const a = Math.max(markEnd + 8, x0 + (x1 - x0) * 0.35);
    const b = x1 - 8;
    const mid = y - 5;
    const open = 5;
    ctx.setLineWidth(1.1);
    ctx.beginPath();
    if (next > level) {
      ctx.moveTo(b, mid - open); ctx.lineTo(a, mid); ctx.lineTo(b, mid + open);
    } else {
      ctx.moveTo(a, mid - open); ctx.lineTo(b, mid); ctx.lineTo(a, mid + open);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ score

export interface EngraveOptions {
  width: number;
  /** Only engrave the last N bars (live view). */
  lastBars?: number;
  /** Instrument actually assigned to a part (mixer overrides). */
  patchOf?: (spec: PartSpec) => string;
  /** Metronome mark printed above the first system. */
  tempo?: { term: string; bpm: number; swing?: boolean };
}

const NAME_W = 124;
const STAVE_H = 102;
const CHORD_ROW = 30;
const SYSTEM_GAP = 26;

export function engrave(el: HTMLElement, arr: Arrangement, opts: EngraveOptions): Layout {
  el.innerHTML = "";
  const barSteps = arr.beatsPerBar * STEPS_PER_BEAT;
  const bars = Math.max(1, Math.ceil(arr.totalSteps / barSteps));
  const usable = opts.width - NAME_W - 16;
  const perSystem = Math.max(1, Math.min(opts.lastBars ?? 99, Math.floor(usable / 230)));
  const firstBar = opts.lastBars ? Math.max(0, bars - perSystem) : 0;
  const systems = Math.ceil((bars - firstBar) / perSystem);
  const parts = arr.parts.filter((p) => p.notes.length > 0 || p.spec.role === "melody");
  const patchOf = opts.patchOf ?? ((spec: PartSpec) => spec.patch);
  const clefs = parts.map((p) => clefFor(p, patchOf(p.spec)));
  const sp = spelling(arr.key);
  const keySpec = sp.sig;
  const sysH = CHORD_ROW + parts.length * STAVE_H + SYSTEM_GAP;
  const top = opts.tempo ? 34 : 0;
  const height = top + systems * sysH + 10;

  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(opts.width, height);
  const ctx = renderer.getContext() as RenderContext;
  ctx.setFillStyle(INK);
  ctx.setStrokeStyle(INK);

  if (opts.tempo) {
    // e.g.  Andante  ♩ = 84
    ctx.save();
    ctx.setFont("Barlow Condensed", 19, "700");
    const term = opts.tempo.term + (opts.tempo.swing ? ", swung" : "");
    ctx.fillText(term, NAME_W, 26);
    const tw = ctx.measureText(term).width;
    ctx.setFont("Bravura", 24);
    ctx.fillText("\uECA5", NAME_W + tw + 14, 27);
    ctx.setFont("Barlow", 15, "500");
    ctx.fillText(`= ${Math.round(opts.tempo.bpm)}`, NAME_W + tw + 30, 26);
    ctx.restore();
  }

  const measures: MeasureBox[] = [];
  const extraFirst = 64;
  const measureW = (usable - extraFirst) / perSystem;

  for (let s = 0; s < systems; s++) {
    const y0 = top + s * sysH + CHORD_ROW;
    const sysFirst = firstBar + s * perSystem;
    const sysBars = Math.min(perSystem, bars - sysFirst);
    const topStaves: Stave[] = [];
    const bottomStaves: Stave[] = [];

    parts.forEach((part, pi) => {
      const y = y0 + pi * STAVE_H;
      let x = NAME_W;
      ctx.save();
      ctx.setFont("Barlow Condensed", 13, "600");
      ctx.fillText(part.spec.label, 8, y + 44);
      ctx.setFont("Barlow", 10, "400");
      ctx.setFillStyle("rgba(35,29,25,0.55)");
      ctx.fillText(PATCH_BY_ID[patchOf(part.spec)]?.name ?? "", 8, y + 57);
      ctx.restore();

      for (let b = 0; b < sysBars; b++) {
        const bar = sysFirst + b;
        const w = measureW + (b === 0 ? extraFirst : 0);
        const stave = new Stave(x, y, w);
        if (b === 0) {
          stave.addClef(clefs[pi]);
          if (clefs[pi] !== "percussion") stave.addKeySignature(keySpec);
          if (bar === 0 || s === 0) stave.addTimeSignature(`${arr.beatsPerBar}/4`);
        }
        stave.setContext(ctx).draw();
        if (b === 0 && pi === 0) topStaves.push(stave);
        if (b === 0 && pi === parts.length - 1) bottomStaves.push(stave);

        const built = buildMeasure(part, clefs[pi], bar, barSteps, sp);
        const voice = new Voice({ numBeats: arr.beatsPerBar, beatValue: 4 }).setMode(Voice.Mode.SOFT);
        voice.addTickables(built.notes);
        const beams = clefs[pi] === "percussion" ? [] : Beam.generateBeams(built.notes.filter((n) => !n.isRest()), { groups: [new Fraction(1, 4)] });
        new Formatter().joinVoices([voice]).format([voice], Math.max(40, stave.getNoteEndX() - stave.getNoteStartX() - 10));
        voice.draw(ctx, stave);
        beams.forEach((bm) => bm.setContext(ctx).draw());
        built.ties.forEach((t) => t.setContext(ctx).draw());
        drawDynamics(ctx, stave, part, bar, b === 0 && s === 0, built.accents, built.notes);

        // Chord symbols above the top stave, aligned to the melody where possible.
        if (pi === 0) {
          for (const slot of arr.chords) {
            if (slot.step < bar * barSteps || slot.step >= (bar + 1) * barSteps) continue;
            const anchor = built.starts.get(slot.step);
            const frac = (slot.step - bar * barSteps) / barSteps;
            const cx = anchor ? anchor.getAbsoluteX() : stave.getNoteStartX() + frac * (stave.getNoteEndX() - stave.getNoteStartX());
            ctx.save();
            ctx.setFont("Barlow Condensed", 16, "700");
            ctx.fillText(slot.chord.name, cx, y - 4);
            ctx.restore();
          }
          measures.push({ bar, x: stave.getX(), y: y0 - CHORD_ROW + 6, w, h: parts.length * STAVE_H + CHORD_ROW - 6 });
        }
        x += w;
      }
    });

    if (topStaves[0] && bottomStaves[0]) {
      new StaveConnector(topStaves[0], bottomStaves[0]).setType("bracket").setContext(ctx).draw();
      new StaveConnector(topStaves[0], bottomStaves[0]).setType("singleLeft").setContext(ctx).draw();
    }
  }
  return { width: opts.width, height, measures };
}
