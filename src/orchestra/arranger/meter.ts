// Time signatures. Internally a bar is measured in 16th steps; the beat you
// count (and the metronome clicks) is a quarter in simple metres and a dotted
// quarter in compound ones (6/8, 9/8, 12/8).

import { STEPS_PER_BEAT, type StyleDef } from "./types";

export type TimeSig = [number, number];

export const TIME_SIGS: TimeSig[] = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 8], [9, 8], [12, 8]];

export const isCompound = ([n, d]: TimeSig) => d === 8 && n % 3 === 0;

export function sigOf(style: StyleDef): TimeSig {
  return style.timeSig ?? [style.beatsPerBar, 4];
}

/** 16th steps per counted beat (4 for ♩, 6 for ♩.). */
export function pulseSteps(style: StyleDef): number {
  const sig = sigOf(style);
  return isCompound(sig) ? 6 : (STEPS_PER_BEAT * 4) / sig[1];
}

export function barSteps(style: StyleDef): number {
  return style.beatsPerBar * STEPS_PER_BEAT;
}

export function pulsesPerBar(style: StyleDef): number {
  return barSteps(style) / pulseSteps(style);
}

/** The style re-barred in another metre (same id, so mixer tweaks survive). */
export function withMeter(style: StyleDef, sig: TimeSig | null): StyleDef {
  if (!sig) return style;
  const [n, d] = sig;
  const quarters = (n * 4) / d;
  // Keep the harmonic rhythm's proportion of the bar (a chord per bar stays a chord per bar).
  const ratio = style.harmonicRhythm / style.beatsPerBar;
  const hr = Math.max(isCompound(sig) ? 1.5 : 1, Math.round(ratio * quarters * 2) / 2);
  return {
    ...style,
    beatsPerBar: quarters,
    timeSig: sig,
    harmonicRhythm: hr,
    swing: isCompound(sig) ? 0 : style.swing, // compound time is already "swung"
  };
}
