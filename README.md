# Fretscribe 🎸🎻

[![CI](https://github.com/johnb8005/fretscribe/actions/workflows/ci.yml/badge.svg)](https://github.com/johnb8005/fretscribe/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/johnb8005/fretscribe)](https://github.com/johnb8005/fretscribe/releases/latest)

Two modes:

- **Guitar:** play, and it writes the notes as tab in real time. You also see the waveform and
  spectrum, plus the scale and most likely chord, inferred with music theory and Markov models.
- **Orchestra:** hum or whistle a tune, and an orchestra plays it back in the style and ensemble
  you choose. A full score is engraved as you sing, and it learns your taste from 👍/👎.

**Open it:** https://johnb8005.github.io/fretscribe/ (Chrome or Edge recommended; allow the microphone)

Bun · React 19 · TypeScript · Tailwind v4 · Web Audio · VexFlow. Everything runs in the browser:
pitch tracking, synthesis, engraving and the learning. There is no server.

## Run locally

```bash
bun install
bun run dev          # http://localhost:1420
bun test             # 75 tests on synthetic guitar and humming audio
bun run build        # static site in dist/
```

The microphone needs a secure page: `localhost` in development, HTTPS (GitHub Pages) when deployed.

**Tips:** an audio interface (DI) beats a laptop mic for guitar. Use headphones in Orchestra mode.
Echo cancellation, noise suppression and AGC are turned off for guitar, because they wreck the tone.

## Orchestra mode

1. Pick a style (Epic film, Romantic symphony, Baroque chamber, Impressionist, Minimalist,
   Fairy-tale waltz, Noir jazz) and an ensemble (full orchestra, chamber orchestra, string
   quartet, wind quintet, brass quintet, solo piano).
2. Press **Record**, wait for the one-bar count-in, then hum or whistle. Use headphones so the
   orchestra doesn't leak into the mic.
3. While you sing, the accompaniment follows you: it picks each chord from what you just sang,
   and its loudness follows yours. The lead instrument doubles your voice live.
4. Press **Stop**. The take is quantised and re-harmonised with the whole melody known, and the
   full score appears. Press **Play**, switch styles or ensembles, swap instruments and tweak
   the mix.

Or press **Try the demo tune** to hear *Ode to Joy* without singing.

**Metre and tempo:** pick 2/4, 3/4, 4/4, 5/4 or compound 6/8, 9/8 or 12/8 (clicks on dotted
quarters, 8ths beamed in threes). Choose an Italian tempo term or turn the knob; each follows
the other.

**Score:** engraved with VexFlow and the Bravura font, both bundled. It shows key and time
signatures, a tempo mark (e.g. *Andante* ♩ = 88), chord symbols, beams, ties, accidentals,
dynamics (pp to ff) with hairpins, and sfz accents.

**Stage:** a seating plan of the orchestra. Each section lights up as it plays, brighter when
louder. Click a section to mute it.

**Synthesis, not samples or MIDI:** every instrument is built in Web Audio (`src/orchestra/synth/patches.ts`):

- Strings are detuned sawtooth stacks with filter envelopes, body resonances and delayed vibrato.
- Brass gets a filter "blat" and a pitch scoop; the muted trumpet uses a harmon-mute formant.
- Flute is triangle plus breath noise. Clarinet, oboe and bassoon use custom harmonic spectra.
- The choir is formant-filtered sawtooths. Harp, harpsichord and piano are plucked/struck subtractive voices.
- Celesta, glockenspiel and marimba use FM.
- Timpani use membrane partials, plus there are taiko, a suspended-cymbal swell, brushes, an FM ride and a triangle.

Everything runs through a generated concert-hall impulse response, a ping-pong echo, warmth/air
EQ, a glue compressor and a limiter.

**How it decides:**

- **Pitch:** YIN pitch tracking tuned for voice: wide range, sticky notes through vibrato,
  adaptive tuning for a singer who's sharp or flat, and onsets back-dated for legato glides.
- **Key:** the Markov key model plus a cadence and downbeat prior. Melodies end on the tonic,
  and downbeats sit on tonic-chord notes.
- **Chords:** a functional-harmony Markov chain (ii→V→I, IV→V, vi→IV…) re-weighted per style.
  Chosen greedily while you sing, then by Viterbi over the whole take.
- **Dynamics:** come from your sung loudness, the shape of each phrase, and the climax in the last phrase.

## Learning your taste (bandit)

Press **More like this** / **Not this** (or the L/D keys) any time while you hum or listen.

- **What it chooses.** For each part, phrase by phrase, it picks a texture: arpeggio shape,
  ostinato, two- or four-voice harmony, pulse pattern, or resting. It also picks the chord colour
  (triads, 7ths, 9ths), how loud to play, and which chord moves to favour. The chord bonus feeds
  the Markov chord model.
- **How it chooses.** Thompson sampling on a Bayesian linear model over human-readable features
  (`src/orchestra/taste/`). Uncertain options get tried, liked ones win.
- **Credit.** A reaction goes to what was sounding. Textures and colour get full credit; chords
  get credit decaying over about a bar.
- **Response.** A 👎 re-decides everything from the next bar, so you hear the change at once.
- **Implicit signals.** Muting a part is a mild 👎; letting a take play to the end is a mild 👍.
- **Exploration.** *Adventurous* sets how much it explores. At 0 it plays its best guess.
- **Your taste panel.** Shows what it has learned ("harp in broken chords", "the move ii → V").
  The model is saved in your browser, and "Forget my taste" resets it.

## CI and versioning

`.github/workflows/ci.yml` runs `bun test`, the typecheck and the build on every push and pull
request. When that passes on `main`, the release job tags the commit, deploys the site to GitHub
Pages and publishes a release with the static site zipped. The version comes from
[conventional commits](https://www.conventionalcommits.org) since the last tag:

| Commit message | Bump |
|---|---|
| `feat: …` | minor (0.1.0 → 0.2.0) |
| `fix: …`, anything else | patch (0.1.0 → 0.1.1) |
| `feat!: …` or a `BREAKING CHANGE` footer | major (0.1.0 → 1.0.0) |

The first release takes the version in `package.json` (0.1.0). CI stamps the version into
`package.json` at build time, so nothing needs to be bumped by hand.

## What's on screen

The look is taken from the instrument itself: a rosewood board, bone and ink, an amber jewel lamp for
whatever is sounding, red for chord tones, and mother-of-pearl for scale notes.

- **Tab staff (the hero):** what you play is written as guitar tab on bone paper, in real time, with
  chord names lettered above it like a lead sheet. String and fret are chosen the way a player would:
  near the current hand position, using open strings when they're handy.
- **Playing:** the current note, its frequency, and an LED tuner strip.
- **Waveform and spectrum:** a pitch-triggered scope, and a log-frequency spectrum marked at the open strings.
- **Scale:** the best match, how likely it is, its notes, and the runners-up.
- **Chord:** the current chord and its Roman numeral, the chords in the key, and the recent progression.
- **On the neck:** a fretboard showing the scale, the current chord tones, and the note sounding now.
- **How it's deciding:** the learned Markov transition matrix, its stationary distribution, and the live chroma.

Gain and Gate are amp-style knobs: drag, scroll, or use the arrow keys, and double-click to reset.
Styling is Tailwind CSS v4, with theme tokens in `src/styles.css`. Fonts (Barlow and Barlow Condensed)
are bundled, so the app works offline.

## How it works

```
mic ─▶ Web Audio (8192-sample window, ~60 fps)
        ├─ YIN pitch detector ──▶ NoteTracker (stability + onset latch) ──▶ notes
        │                                                     │
        │                                    ┌────────────────┘
        │                                    ▼
        │                          KeyDetector (Markov)  ──▶ key / scale
        │                                    │ key-aware transition matrix
        └─ Hann FFT ─▶ peak chroma ──────────┴─▶ ChordHMM (forward algorithm) ──▶ chord
                 (harmonic suppression)   + recent-note memory (arpeggios)
```

**Pitch → notes** (`src/dsp/pitch.ts`, `noteTracker.ts`): YIN with parabolic interpolation, 70 Hz–1.4 kHz.
A note is written after 3 stable frames; a short-window RMS jump arms an onset so re-picking the
same note splits it, but only if the pitch is confirmed *after* the onset (prevents ghost duplicates).

**Chroma** (`src/dsp/spectral.ts`): spectral peaks → pitch classes. Peaks that are the 3rd, 5th, 7th, 9th…
harmonic of a lower peak are attenuated; otherwise every major chord looks like a maj7 (harmonic 7 = ♭7,
harmonic 15 = maj7, …).

**Scale** (`src/theory/markov.ts → KeyDetector`), across 12 roots × 8 scales
(major, minor, dorian, mixolydian, harmonic minor, major/minor pentatonic, blues):
1. Every new note updates a decaying 12×12 transition count matrix `T[i][j]` and a duration histogram.
2. The row-normalised matrix `P` is a Markov chain; its stationary distribution `π` (power iteration on the
   lazy chain ½I+½P) is the long-run weight of each pitch class.
3. Profile = histogram ⊕ π, Pearson-correlated with each scale's tonal-hierarchy template
   (tonic > 5th > 3rd > other scale tones > outside).
4. Each scale also has a **theory Markov model** `M_s` (in-scale targets, stepwise motion favoured,
   gravity to the tonic, leading-tone / 2nd / 5th resolutions, chromatic passing tones resolve by step).
   The average log-likelihood `Σ T[i][j]·log M_s[i][j] / ΣT` measures how well your *movement*, not just
   your note set, fits that scale — this is what separates C major from A minor on the same 7 notes.
5. `score = 5·r + 2.5·LL + log(prior)` → softmax (sharper as evidence grows).

**Chord** (`ChordHMM`): hidden Markov model over 12 roots × 9 qualities (maj, m, 7, maj7, m7, sus2, sus4,
dim, 5) + N.C.
- Emission: cosine(chroma, template) minus penalties for missing chord tones and unexplained energy.
- Transition matrix (rebuilt whenever the key changes): high self-transition, root motion weighted by the
  circle of fifths (up a 4th ≫ up a 5th > steps/thirds > tritone), diatonic chords of the detected key
  favoured, tonic and dominant boosted.
- Forward algorithm → posterior; a chord must lead for 120 ms to display and 350 ms to enter the progression.

## Layout

```
src/
  audio/engine.ts        getUserMedia → AnalyserNode → Analyzer (rAF loop)
  analysis/pipeline.ts   pure-TS pipeline (testable without a browser)
  analysis/tab.ts        picks a string + fret for each note
  dsp/                   fft, YIN, chroma/spectrum, note tracker
  theory/                theory.ts (scales, chords, spelling), markov.ts (key + chord models)
  components/            tab staff, scope, spectrum, panels, knobs and footswitch
tests/                   Karplus–Strong synth + pipeline tests
```

## Tuning knobs

All in code, all commented: `DEFAULT_TRACKER` (gate, clarity, stable frames, onset ratio),
`KeyDetector.decay` (memory ≈ 60 notes), `ChordHMM.stay / k / missingPenalty / seventhThreshold`,
`Analyzer.chordHold / progressionHold`.
