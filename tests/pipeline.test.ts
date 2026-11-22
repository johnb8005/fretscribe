import { describe, expect, test } from "bun:test";
import { render, run, SR } from "./synth";
import { YinDetector } from "../src/dsp/pitch";
import { midiToFreq, midiToName, pcName } from "../src/theory/theory";
import { STANDARD_TUNING } from "../src/theory/theory";

const keyName = (a: ReturnType<typeof run>) => {
  const b = a.keys.analyze().best!;
  return `${pcName(b.root)} ${b.scale.id}`;
};

describe("pitch", () => {
  test("YIN detects every open string and the 12th/22nd frets of high E", () => {
    const yin = new YinDetector(SR);
    for (const midi of [...STANDARD_TUNING, 76, 86]) {
      const audio = render([{ midis: [midi], dur: 0.6 }]);
      const frame = audio.subarray(Math.floor(0.25 * SR) - 8192, Math.floor(0.25 * SR));
      const r = yin.detect(frame)!;
      const cents = 1200 * Math.log2(r.freq / midiToFreq(midi));
      expect(Math.abs(cents)).toBeLessThan(15);
    }
  });
});

describe("notes", () => {
  test("transcribes a melody with a repeated note", () => {
    const melody = [52, 55, 57, 57, 59, 62, 64, 62];
    const a = run(render(melody.map((m) => ({ midis: [m], dur: 0.3 }))));
    expect(a.notes.map((n) => midiToName(n.midi))).toEqual(melody.map((m) => midiToName(m)));
  });
});

describe("notes (browser-like jittered frame timing)", () => {
  test("no ghost duplicates, repeated notes still split", () => {
    const melody = [57, 60, 62, 64, 64, 67, 69, 67, 64, 62, 60, 57];
    const a = run(render(melody.map((m) => ({ midis: [m], dur: 0.22 }))), undefined, true);
    expect(a.notes.map((n) => n.midi)).toEqual(melody);
  });
});

describe("keys", () => {
  test("C major scale + cadence → C major", () => {
    const seq = [48, 50, 52, 53, 55, 57, 59, 60, 59, 57, 55, 53, 52, 50, 48, 55, 59, 62, 60, 52, 55, 48];
    const a = run(render(seq.map((m) => ({ midis: [m], dur: 0.25 }))));
    expect(keyName(a)).toBe("C major");
  });

  test("A minor pentatonic lick → A minor pentatonic", () => {
    const seq = [57, 60, 62, 64, 67, 69, 67, 64, 62, 60, 57, 60, 57, 64, 62, 60, 57, 69, 67, 64, 57];
    const a = run(render(seq.map((m) => ({ midis: [m], dur: 0.22 }))));
    expect(keyName(a)).toBe("A minorPent");
  });

  test("E minor melody resolving to E → E minor (not G major)", () => {
    const seq = [52, 54, 55, 57, 59, 60, 62, 64, 62, 60, 59, 57, 55, 54, 52, 59, 55, 54, 52, 64, 59, 55, 52];
    const a = run(render(seq.map((m) => ({ midis: [m], dur: 0.25 }))));
    const k = keyName(a);
    expect(["E minor", "E harmonicMinor", "E dorian"]).toContain(k);
  });
});

describe("chords", () => {
  const G = [43, 47, 50, 55, 59, 67];
  const C = [48, 52, 55, 60, 64];
  const D = [50, 57, 62, 66];
  const Em = [40, 47, 52, 55, 59, 64];
  const Am = [45, 52, 57, 60, 64];
  const E = [40, 47, 52, 56, 59, 64];
  const F = [41, 48, 53, 57, 60, 65];

  test.each([
    ["G", G], ["C", C], ["D", D], ["Em", Em], ["Am", Am], ["E", E], ["F", F],
  ])("strummed %s is recognised", (name, voicing) => {
    let last = "";
    run(render([{ midis: voicing as number[], dur: 1.2 }]), (f) => {
      if (f.t > 0.4 && f.t < 1.1) last = f.chord?.name ?? "N.C.";
    });
    expect(last).toBe(name as string);
  });

  test("lick then Am–F–C–G: melody memory doesn't leak into chords", () => {
    const lick = [57, 60, 62, 64, 67, 69, 67, 64, 62, 60, 57, 64, 62, 60, 57].map((m) => ({ midis: [m], dur: 0.22 }));
    const a = run(render([...lick, ...[Am, F, C, G, Am, F, C, G].map((v) => ({ midis: v, dur: 1.0 }))]), undefined, true);
    const prog = a.progression.filter((c) => c.start > 3).map((c) => c.name);
    expect(prog).toEqual(["Am", "F", "C", "G", "Am", "F", "C", "G"]);
  });

  test("arpeggiated C major (one note at a time) implies C", () => {
    let last = "";
    const arp = [48, 52, 55, 60, 64, 60, 55, 52].map((m) => ({ midis: [m], dur: 0.2 }));
    run(render(arp), (f) => {
      if (f.t > 1.2 && f.t < 1.6) last = f.chord?.name ?? "N.C.";
    });
    expect(last).toBe("C");
  });

  test("progression G–Em–C–D is tracked", () => {
    const a = run(render([G, Em, C, D, G].map((v) => ({ midis: v, dur: 1.0 }))));
    expect(a.progression.map((c) => c.name)).toEqual(["G", "Em", "C", "D", "G"]);
  });
});

describe("robustness", () => {
  test("silence / hiss produces no notes and no chord", () => {
    const a = run(render([{ midis: [], dur: 2 }], 0.003));
    expect(a.notes.length).toBe(0);
    expect(a.progression.length).toBe(0);
  });

  test("fast 16th notes (120 ms) are all captured", () => {
    const seq = [64, 62, 60, 59, 57, 59, 60, 62, 64, 67];
    const a = run(render(seq.map((m) => ({ midis: [m], dur: 0.12 }))));
    expect(a.notes.map((n) => n.midi)).toEqual(seq);
  });

  test("quiet playing (-20 dB) still transcribes", () => {
    const seq = [45, 48, 50, 52];
    const audio = render(seq.map((m) => ({ midis: [m], dur: 0.4 })), 0.0002);
    for (let i = 0; i < audio.length; i++) audio[i] *= 0.1;
    const a = run(audio);
    expect(a.notes.map((n) => n.midi)).toEqual(seq);
  });

  test("dominant 7th voicing (G7) is recognised", () => {
    let last = "";
    run(render([{ midis: [43, 47, 50, 55, 59, 65], dur: 1.2 }]), (f) => {
      if (f.t > 0.4 && f.t < 1.1) last = f.chord?.name ?? "N.C.";
    });
    expect(last).toBe("G7");
  });

  test("analysis runs well under a 60 fps frame budget", () => {
    const audio = render([{ midis: [40, 47, 52, 56, 59, 64], dur: 3 }]);
    const t0 = performance.now();
    const a = run(audio);
    const frames = Math.floor(audio.length / 800);
    const ms = (performance.now() - t0) / frames;
    console.log(`  avg ${ms.toFixed(3)} ms / frame (${a.notes.length} notes)`);
    expect(ms).toBeLessThan(4);
  });
});
