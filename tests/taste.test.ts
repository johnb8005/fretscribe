import { describe, expect, test } from "bun:test";
import { DEMO_TUNE, arrange } from "../src/orchestra/arranger/arrange";
import { STYLE_BY_ID } from "../src/orchestra/arranger/styles";
import { TasteModel, seeded } from "../src/orchestra/taste/model";
import { Planner } from "../src/orchestra/taste/planner";

const romantic = STYLE_BY_ID.romantic;
const BAR = 16;

describe("taste model", () => {
  test("Thompson sampling converges on the option you keep liking", () => {
    const m = new TasteModel();
    const rng = seeded(7);
    let picksA = 0;
    for (let t = 0; t < 60; t++) {
      const s = m.sampler(rng);
      const pickA = s({ a: 1 }) > s({ b: 1 });
      m.update(pickA ? { a: 1 } : { b: 1 }, pickA ? 1 : -1);
      if (t >= 40 && pickA) picksA++;
    }
    expect(picksA).toBeGreaterThanOrEqual(18);
  });

  test("round-trips through JSON (persistence)", () => {
    const m = new TasteModel();
    m.label("x", "lush ninth chords");
    m.update({ x: 1 }, 1);
    m.ratings = 3;
    const back = TasteModel.fromJSON(JSON.parse(JSON.stringify(m)));
    expect(back.predict({ x: 1 })).toBeCloseTo(m.predict({ x: 1 }), 6);
    expect(back.summary()[0].label).toBe("lush ninth chords");
    expect(back.ratings).toBe(3);
  });
});

describe("planner", () => {
  test("a listener who loves up-and-down harp arpeggios gets them", () => {
    const model = new TasteModel();
    const rng = seeded(3);
    const picks: string[] = [];
    for (let round = 0; round < 40; round++) {
      const planner = new Planner(model, romantic, 0.6, rng);
      arrange(DEMO_TUNE, romantic, { planner });
      const harp = planner.choiceAt("part:harp", 1)!;
      picks.push(harp);
      planner.feedback(harp === "updown8" ? 1 : -1, BAR + 4);
    }
    const late = picks.slice(-12);
    expect(late.filter((p) => p === "updown8").length).toBeGreaterThanOrEqual(9);
  });

  test("a listener who dislikes the taiko gets it to rest", () => {
    const epic = STYLE_BY_ID.epic;
    const model = new TasteModel();
    const rng = seeded(11);
    let lastTacet = 0;
    for (let round = 0; round < 30; round++) {
      const planner = new Planner(model, epic, 0.5, rng);
      arrange(DEMO_TUNE, epic, { planner });
      const d = planner.choiceAt("part:drums", 0)!;
      if (round >= 20 && d === "tacet") lastTacet++;
      planner.feedback(d === "tacet" ? 0.5 : -1, 4);
    }
    expect(lastTacet).toBeGreaterThanOrEqual(7);
  });

  test("chord taste reshapes the harmonisation (you like the vi chord)", () => {
    const model = new TasteModel();
    const rng = seeded(5);
    const countVi = (p: Planner) => arrange(DEMO_TUNE, romantic, { planner: p }).chords.filter((c) => c.chord.degree === 5).length;
    const before = countVi(new Planner(model, romantic, 0, seeded(1)));
    for (let round = 0; round < 40; round++) {
      const planner = new Planner(model, romantic, 0.5, rng);
      const a = arrange(DEMO_TUNE, romantic, { planner });
      a.chords.forEach((slot) => planner.feedback(slot.chord.degree === 5 ? 1 : -0.3, slot.step + 2));
    }
    const after = countVi(new Planner(model, romantic, 0, seeded(1)));
    expect(after).toBeGreaterThan(before);
  });

  test("👎 re-decides from the next bar but leaves the past alone", () => {
    const model = new TasteModel();
    const planner = new Planner(model, romantic, 1, seeded(9));
    arrange(DEMO_TUNE, romantic, { planner });
    const past = planner.choiceAt("part:harp", 0);
    planner.feedback(-1, BAR + 3);
    planner.resample(2);
    arrange(DEMO_TUNE, romantic, { planner });
    expect(planner.choiceAt("part:harp", 0)).toBe(past);
    expect(planner.choiceAt("part:harp", 2)).toBeDefined();
  });

  test("feedback says what it credited, in plain words", () => {
    const planner = new Planner(new TasteModel(), romantic, 0.3, seeded(2));
    arrange(DEMO_TUNE, romantic, { planner });
    const credits = planner.feedback(1, 2);
    expect(credits.length).toBeGreaterThan(0);
    for (const c of credits) expect(c.label).not.toMatch(/^(tex|chord|play|color|dyn):/);
  });

  test("no taste learned → the arranger writes exactly what the style says", () => {
    const plain = arrange(DEMO_TUNE, romantic);
    const planner = new Planner(new TasteModel(), romantic, 0, seeded(4));
    const withPlanner = arrange(DEMO_TUNE, romantic, { planner });
    expect(withPlanner.chords.map((c) => c.chord.name)).toEqual(plain.chords.map((c) => c.chord.name));
  });
});
