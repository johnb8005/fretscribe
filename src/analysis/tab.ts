// Assigns each transcribed note a string + fret, like a guitarist would:
// stay near the current hand position, use open strings when they're handy,
// and avoid jumping around the neck.

import type { NoteEvent } from "../dsp/noteTracker";
import { STANDARD_TUNING } from "../theory/theory";

export interface TabPosition {
  /** 0 = low E … 5 = high e */
  string: number;
  fret: number;
}

export const MAX_FRET = 22;

export class TabMapper {
  private positions = new Map<number, TabPosition>();
  private hand = 3;
  private lastId = 0;

  constructor(private readonly tuning = STANDARD_TUNING) {}

  /** Cost of playing `fret` on `string` given the current hand position. */
  private cost(string: number, fret: number, prev: TabPosition | null): number {
    let c = fret === 0 ? 1.2 : Math.abs(fret - this.hand);
    if (fret > 12) c += (fret - 12) * 0.3; // high frets are less common
    if (fret > 0 && fret - this.hand > 3) c += 2; // beyond a 4-fret stretch
    if (prev) c += Math.abs(string - prev.string) * 0.25; // prefer neighbouring strings
    return c;
  }

  /** Assigns positions to any new notes (in order) and returns the lookup. */
  sync(notes: readonly NoteEvent[]): Map<number, TabPosition> {
    if (notes.length === 0) {
      this.positions.clear();
      this.lastId = 0;
      this.hand = 3;
      return this.positions;
    }
    let prev: TabPosition | null = null;
    for (const n of notes) {
      if (n.id <= this.lastId) {
        prev = this.positions.get(n.id) ?? prev;
        continue;
      }
      let best: TabPosition | null = null;
      let bestCost = Infinity;
      for (let s = 0; s < this.tuning.length; s++) {
        const fret = n.midi - this.tuning[s];
        if (fret < 0 || fret > MAX_FRET) continue;
        const c = this.cost(s, fret, prev);
        if (c < bestCost) {
          bestCost = c;
          best = { string: s, fret };
        }
      }
      if (best) {
        this.positions.set(n.id, best);
        if (best.fret > 0) this.hand = this.hand * 0.4 + best.fret * 0.6;
        prev = best;
      }
      this.lastId = n.id;
    }
    // Forget positions of notes that scrolled out of the history.
    if (this.positions.size > notes.length * 2) {
      const keep = new Set(notes.map((n) => n.id));
      for (const id of this.positions.keys()) if (!keep.has(id)) this.positions.delete(id);
    }
    return this.positions;
  }
}
