import { describe, expect, test } from "bun:test";
import { run } from "./synth";
import { hum, ODE_TO_JOY } from "./voice";
import { VOICE_OPTIONS } from "../src/analysis/pipeline";

describe("voice input", () => {
  const melody = ODE_TO_JOY.map((n) => n.midi);

  test("hummed Ode to Joy (35¢ flat, vibrato, glides) is transcribed exactly", () => {
    const a = run(hum(ODE_TO_JOY, { octave: -1 }), undefined, true, VOICE_OPTIONS);
    expect(a.notes.map((n) => n.midi)).toEqual(melody.map((m) => m - 12));
  });

  test("whistled (pure tone, 2 octaves up) works too", () => {
    const a = run(hum(ODE_TO_JOY, { whistle: true, octave: 1, detuneCents: 20 }), undefined, true, VOICE_OPTIONS);
    expect(a.notes.map((n) => n.midi)).toEqual(melody.map((m) => m + 12));
  });

  test("voice options skip the chord pipeline", () => {
    let frames = 0;
    run(hum(ODE_TO_JOY.slice(0, 3)), (f) => {
      frames++;
      expect(f.chords.length).toBe(0);
    }, false, VOICE_OPTIONS);
    expect(frames).toBeGreaterThan(10);
  });
});

describe("voice timing", () => {
  test("sung onsets (incl. legato glides) are dated within 80 ms", () => {
    const bpm = 100, beat = 60 / bpm;
    const a = run(hum(ODE_TO_JOY, { bpm, octave: -1 }), undefined, true, VOICE_OPTIONS);
    let t = 0.2;
    const truth = ODE_TO_JOY.map((n) => { const s = t; t += n.beats * beat; return s; });
    const errs = a.notes.map((n, i) => Math.abs(n.start - truth[i]));
    expect(Math.max(...errs)).toBeLessThan(0.08);
  });
});
