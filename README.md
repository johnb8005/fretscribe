# Fretscribe 🎸

Realtime guitar transcriber: plug in (or mic up) your guitar and watch the notes being
written, the waveform and spectrum moving, and the **scale** and **most likely chord**
inferred live using music theory + Markov models.

Tauri v2 · Bun · React 19 · TypeScript. All DSP runs in TypeScript inside the webview (Web Audio);
Rust is only the native shell (window + microphone permission).

## Run

Prerequisites: [Rust](https://rustup.rs), [Bun](https://bun.sh), and the
[Tauri system deps](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
bun install
bun tauri dev        # desktop app
bun tauri build      # installer / .app / .deb in src-tauri/target/release/bundle

bun run dev          # same UI in a browser at http://localhost:1420 (handy for hacking)
bun test             # 23 tests on synthetic Karplus-Strong guitar audio
```

**Microphone permission**
- macOS: first launch shows a prompt (`Info.plist` + entitlement included). In `tauri dev` the prompt is
  attributed to your terminal app — allow it under *System Settings → Privacy & Security → Microphone*.
- Windows: *Settings → Privacy → Microphone → Let desktop apps access your microphone*.
- Linux: WebKitGTK blocks `getUserMedia` by default; `src-tauri/src/lib.rs` enables media streams and
  auto-grants the request. Needs GStreamer (`gstreamer1.0-plugins-good`, `gstreamer1.0-pulseaudio` or PipeWire).

**Tips:** an audio interface (DI) beats a laptop mic. Raise **Gain** until the level bar moves a lot on
picking; raise **Gate** if room noise produces phantom notes. Echo cancellation / noise suppression / AGC are
disabled on purpose — they wreck guitar tone.

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
src-tauri/               Tauri v2 shell, Info.plist, entitlements, Linux mic grant
tests/                   Karplus–Strong synth + pipeline tests
```

## Tuning knobs

All in code, all commented: `DEFAULT_TRACKER` (gate, clarity, stable frames, onset ratio),
`KeyDetector.decay` (memory ≈ 60 notes), `ChordHMM.stay / k / missingPenalty / seventhThreshold`,
`Analyzer.chordHold / progressionHold`.
