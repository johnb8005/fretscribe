import { describe, expect, test } from "bun:test";
import { DEMO_TUNE, arrange, quantize, voiceChord } from "../src/orchestra/arranger/arrange";
import { STYLES, STYLE_BY_ID } from "../src/orchestra/arranger/styles";
import { harmonize, keyFromMelody, nextChord, slotEvidence, vocabulary } from "../src/orchestra/arranger/harmony";
import { PATCH_BY_ID } from "../src/orchestra/synth/patches";
import { pc, pcName } from "../src/theory/theory";

const romantic = STYLE_BY_ID.romantic;

describe("harmony", () => {
  test("Ode to Joy is in C major", () => {
    const k = keyFromMelody(DEMO_TUNE);
    expect(`${pcName(k.root)} ${k.scale.id}`).toBe("C major");
  });

  test("starts and ends on the tonic, with a half cadence (V) closing the first phrase", () => {
    const a = arrange(DEMO_TUNE, STYLE_BY_ID.epic);
    const names = a.chords.map((c) => c.chord.roman);
    expect(names[0]).toBe("I");
    expect(names[names.length - 1]).toBe("I");
    expect(names[3]).toBe("V");
  });

  test("downbeat melody notes are mostly chord tones", () => {
    for (const style of STYLES) {
      const a = arrange(DEMO_TUNE, style);
      let ok = 0, total = 0;
      for (const slot of a.chords) {
        const n = DEMO_TUNE.find((m) => m.step <= slot.step && m.step + m.dur > slot.step);
        if (!n) continue;
        total++;
        if ([...slot.chord.tones, ...slot.chord.colors].includes(pc(n.midi))) ok++;
      }
      expect(ok / total).toBeGreaterThanOrEqual(0.6);
    }
  });

  test("minor melody gets a major dominant in classical styles", () => {
    // A harmonic-minor-ish tune: A C E D C B A … G# A
    const notes = [57, 60, 64, 62, 60, 59, 57, 64, 65, 64, 62, 60, 59, 56, 57].map((midi, i) => ({ midi, step: i * 4, dur: 4, vel: 0.8 }));
    const k = keyFromMelody(notes);
    expect(pcName(k.root)).toBe("A");
    const v = vocabulary(k, romantic);
    expect(v[4].name).toBe("E7");
    expect(v[0].name).toBe("Am7");
  });

  test("online chord choice follows what was just sung", () => {
    const k = keyFromMelody(DEMO_TUNE);
    const ev = slotEvidence([{ midi: 67, step: 0, dur: 4, vel: 1 }, { midi: 62, step: 4, dur: 4, vel: 1 }], 0, 16, 16);
    expect(nextChord(null, ev, k, STYLE_BY_ID.epic).roman).toBe("V");
  });
});

describe("arrangement", () => {
  test.each(STYLES.map((s) => [s.name, s.id]))("%s: every part is playable and in bounds", (_, id) => {
    const style = STYLE_BY_ID[id as string];
    const a = arrange(DEMO_TUNE, style);
    expect(a.parts.length).toBe(style.parts.length);
    expect(a.totalSteps % (style.beatsPerBar * 4)).toBe(0);
    for (const part of a.parts) {
      const patch = PATCH_BY_ID[part.spec.patch];
      expect(patch).toBeDefined();
      expect(part.notes.length).toBeGreaterThan(0);
      for (const n of part.notes) {
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step + n.dur).toBeLessThanOrEqual(a.totalSteps + 1);
        expect(n.vel).toBeGreaterThan(0);
        if (!patch.kit) {
          expect(n.midi).toBeGreaterThanOrEqual(patch.range[0] - 12);
          expect(n.midi).toBeLessThanOrEqual(patch.range[1] + 12);
        }
      }
    }
  });

  test("melody is moved into the lead instrument's register, keeping its contour", () => {
    const a = arrange(DEMO_TUNE.map((n) => ({ ...n, midi: n.midi - 12 })), STYLE_BY_ID.romantic);
    const mel = a.parts.find((p) => p.spec.role === "melody")!;
    const diffs = mel.notes.map((n, i) => n.midi - (DEMO_TUNE[i].midi - 12));
    expect(new Set(diffs).size).toBe(1);
    expect(diffs[0] % 12).toBe(0);
    expect(mel.notes[0].midi).toBeGreaterThanOrEqual(62);
  });

  test("pad voicings move smoothly", () => {
    let prev: number[] | null = null;
    let worst = 0;
    for (const chord of [[0, 4, 7], [5, 9, 0], [7, 11, 2], [0, 4, 7]]) {
      const v = voiceChord(chord, 3, [55, 76], prev);
      if (prev) worst = Math.max(worst, ...v.map((m, i) => Math.abs(m - prev![i])));
      prev = v;
    }
    expect(worst).toBeLessThanOrEqual(5);
  });

  test("waltz bars are three beats", () => {
    const a = arrange(DEMO_TUNE, STYLE_BY_ID.waltz);
    expect(a.chords[1].step).toBe(12);
    const pah = a.parts.find((p) => p.spec.role === "oompah")!;
    expect(new Set(pah.notes.map((n) => n.step % 12))).toEqual(new Set([4, 8]));
  });
});

describe("quantize", () => {
  test("snaps sung timings to an 8th-note grid and removes overlaps", () => {
    const beat = 0.6; // 100 bpm
    const q = quantize(
      [
        { midi: 60, start: 1.03, end: 1.62 },
        { midi: 62, start: 1.58, end: 2.25 },
        { midi: 64, start: 2.2, end: 2.31 },
      ],
      1.0, 100, 2,
    );
    expect(q.map((n) => [n.midi, n.step, n.dur])).toEqual([[60, 0, 4], [62, 4, 4], [64, 8, 2]]);
    expect(beat).toBe(0.6);
  });
});

describe("harmonize", () => {
  test("produces one chord per harmonic-rhythm slot", () => {
    const k = keyFromMelody(DEMO_TUNE);
    const slots = harmonize(DEMO_TUNE, 128, k, STYLE_BY_ID.baroque);
    expect(slots.length).toBe(16);
    expect(slots.every((s) => s.dur === 8)).toBe(true);
  });
});

describe("notation", () => {
  // engrave.ts imports VexFlow (DOM); test the pure splitter via a dynamic import guard.
  test("durations split on beats like a copyist would", async () => {
    const { pieces } = await import("../src/orchestra/score/engrave");
    expect(pieces(0, 4, 16)).toEqual([4]);
    expect(pieces(2, 4, 16)).toEqual([2, 2]); // off-beat quarter → 8th tied to 8th
    expect(pieces(0, 6, 16)).toEqual([6]); // dotted quarter
    expect(pieces(4, 8, 16)).toEqual([4, 4]); // half note across the middle → two quarters
    expect(pieces(0, 16, 16)).toEqual([16]);
    expect(pieces(0, 12, 12)).toEqual([12]); // dotted half fills a 3/4 bar
    expect(pieces(2, 6, 16)).toEqual([2, 4]);
  });
});

describe("key of a take stopped mid-phrase", () => {
  test("Ode to Joy + half of the next phrase is still C major", () => {
    const more = DEMO_TUNE.slice(0, 8).map((n) => ({ ...n, step: n.step + 128 }));
    expect(pcName(keyFromMelody([...DEMO_TUNE, ...more]).root)).toBe("C");
  });
});

test("a real hummed take captured in the browser (stopped mid-phrase) is C major", () => {
  const take = [[52, 0, 4], [52, 4, 4], [53, 8, 4], [55, 12, 4], [55, 16, 4], [53, 20, 4], [52, 24, 4], [50, 28, 4], [48, 32, 4], [48, 36, 4], [50, 40, 4], [52, 44, 4], [52, 48, 6], [50, 54, 2], [50, 56, 8], [52, 64, 4], [52, 68, 4], [53, 72, 4], [55, 76, 4], [55, 80, 4], [53, 84, 4], [52, 88, 4], [50, 92, 6]].map(([midi, step, dur]) => ({ midi, step, dur, vel: 0.8 }));
  expect(pcName(keyFromMelody(take).root)).toBe("C");
});

test("only swung styles use chromatic approach notes in the walking bass", () => {
  const chromaticCount = (id: string) => {
    const a = arrange(DEMO_TUNE, STYLE_BY_ID[id]);
    const bass = a.parts.find((p) => p.spec.role === "walk")!;
    const k = a.key;
    const scale = new Set(k.scale.intervals.map((i) => (k.root + i) % 12));
    return bass.notes.filter((n) => !scale.has(pc(n.midi))).length;
  };
  expect(chromaticCount("baroque")).toBe(0);
  expect(chromaticCount("noir")).toBeGreaterThan(0);
});

test("rests are never dotted", async () => {
  const { pieces } = await import("../src/orchestra/score/engrave");
  expect(pieces(4, 8, 12, false)).toEqual([4, 4]);
});

describe("dynamics", () => {
  test("phrases swell, the last phrase is the climax, and the tune sits above the accompaniment", () => {
    const a = arrange(DEMO_TUNE, STYLE_BY_ID.romantic);
    const d = a.dynamics!;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(d.slice(4))).toBeGreaterThan(mean(d.slice(0, 4)));
    expect(d[2]).toBeGreaterThan(d[0]); // phrase leans toward bar 3
    const mel = a.parts.find((p) => p.spec.role === "melody")!.levels!;
    const pad = a.parts.find((p) => p.spec.role === "pad")!.levels!;
    expect(mel.every((l, i) => l >= pad[i])).toBe(true);
  });

  test("singing a bar louder raises the orchestra there", () => {
    const loud = DEMO_TUNE.map((n) => ({ ...n, vel: n.step >= 32 && n.step < 48 ? 1 : 0.5 }));
    const d = arrange(loud, STYLE_BY_ID.romantic).dynamics!;
    expect(d[2]).toBeGreaterThan(d[1]);
    expect(d[2]).toBeGreaterThan(d[4] - 1);
  });

  test("a sudden sung accent becomes sfz, and epic drums hit the climax sfz", () => {
    const acc = DEMO_TUNE.map((n, i) => ({ ...n, vel: i === 5 ? 1 : 0.55 }));
    const a = arrange(acc, STYLE_BY_ID.epic);
    expect(a.parts.find((p) => p.spec.role === "melody")!.notes[5].accent).toBe(true);
    expect(a.parts.find((p) => p.spec.role === "perc")!.notes.some((n) => n.accent)).toBe(true);
  });

  test("quiet styles stay quiet", () => {
    const imp = arrange(DEMO_TUNE, STYLE_BY_ID.impressionist).dynamics!;
    const epic = arrange(DEMO_TUNE, STYLE_BY_ID.epic).dynamics!;
    expect(Math.max(...imp)).toBeLessThan(Math.max(...epic));
  });
});

describe("formations", () => {
  const { FORMATIONS, FORMATION_BY_ID, applyFormation } = require("../src/orchestra/arranger/formations");

  test.each(FORMATIONS.map((f: { id: string }) => [f.id]))("%s works with every style", (fid) => {
    for (const style of STYLES) {
      const s = applyFormation(style, FORMATION_BY_ID[fid as string]);
      expect(s.parts.some((p: { role: string }) => p.role === "melody")).toBe(true);
      const a = arrange(DEMO_TUNE, s);
      for (const part of a.parts) expect(PATCH_BY_ID[part.spec.patch]).toBeDefined();
    }
  });

  test("a string quartet gets the style's figures on the right players", () => {
    const q = applyFormation(STYLE_BY_ID.epic, FORMATION_BY_ID.quartet);
    const by = Object.fromEntries(q.parts.map((p: { id: string; role: string }) => [p.id, p.role]));
    expect(by).toEqual({ vln1: "melody", vln2: "ostinato", vla: "pad", vc: "bass" });
    const a = arrange(DEMO_TUNE, q);
    const viola = a.parts.find((p) => p.spec.id === "vla")!;
    const perStep = new Map<number, number>();
    viola.notes.forEach((n) => perStep.set(n.step, (perStep.get(n.step) ?? 0) + 1));
    expect(Math.max(...perStep.values())).toBeLessThanOrEqual(2); // double-stops at most
  });

  test("solo piano is three staves of piano", () => {
    const p = applyFormation(STYLE_BY_ID.waltz, FORMATION_BY_ID.piano);
    expect(p.parts.map((x: { patch: string }) => x.patch)).toEqual(["piano", "piano", "piano"]);
  });
});

test("tempo terms follow the metronome mark both ways", () => {
  const { TEMPO_TERMS, termFor } = require("../src/orchestra/arranger/tempo");
  expect(termFor(84).name).toBe("Andante");
  expect(termFor(72).name).toBe("Adagio");
  expect(termFor(140).name).toBe("Allegro");
  for (const t of TEMPO_TERMS) expect(termFor(t.bpm).name).toBe(t.name);
});

describe("stage", () => {
  const { SECTIONS, sectionsFor } = require("../src/orchestra/stage/sections");
  const { FORMATIONS, applyFormation } = require("../src/orchestra/arranger/formations");
  const ids = new Set(SECTIONS.map((s: { id: string }) => s.id));

  test("every part of every style and ensemble has a seat on stage", () => {
    for (const f of FORMATIONS) for (const style of STYLES) {
      for (const p of applyFormation(style, f).parts) {
        const secs = sectionsFor(p, p.patch);
        expect(secs.length).toBeGreaterThan(0);
        for (const s of secs) expect(ids.has(s)).toBe(true);
      }
    }
  });

  test("romantic strings sit where they should", () => {
    const parts = STYLE_BY_ID.romantic.parts;
    const at = (id: string) => sectionsFor(parts.find((p) => p.id === id)!, parts.find((p) => p.id === id)!.patch);
    expect(at("melody")).toEqual(["vln1"]);
    expect(at("counter")).toEqual(["vc"]);
    expect(at("bass")).toEqual(["vc", "cb"]);
    expect(at("harp")).toEqual(["harp"]);
  });
});

describe("metre", () => {
  const { withMeter, pulseSteps, pulsesPerBar } = require("../src/orchestra/arranger/meter");
  test("6/8 bars are 12 steps counted in two dotted-quarter beats", () => {
    const s = withMeter(STYLE_BY_ID.romantic, [6, 8]);
    expect(s.beatsPerBar * 4).toBe(12);
    expect(pulseSteps(s)).toBe(6);
    expect(pulsesPerBar(s)).toBe(2);
    const a = arrange(DEMO_TUNE, s);
    expect(a.totalSteps % 12).toBe(0);
    expect(a.chords[1].step).toBe(12); // still a chord per bar
  });
  test("5/4 keeps quarter beats", () => {
    const s = withMeter(STYLE_BY_ID.epic, [5, 4]);
    expect(pulsesPerBar(s)).toBe(5);
    expect(arrange(DEMO_TUNE, s).totalSteps % 20).toBe(0);
  });
  test("compound beats are notated as dotted quarters, never quarters across the beat", async () => {
    const { pieces } = await import("../src/orchestra/score/engrave");
    expect(pieces(0, 6, 12, true, true)).toEqual([6]);
    expect(pieces(4, 4, 12, true, true)).toEqual([2, 2]); // crosses the beat → tied 8ths
    expect(pieces(0, 12, 12, true, true)).toEqual([12]);
  });
});
