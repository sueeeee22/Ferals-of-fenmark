/**
 * The overworld: Latin dance music for four chip voices.
 *
 * Everything is written on a sixteen-step grid, one bar per string, so the
 * rhythms below are the real ones and can be checked against a percussion book
 * rather than taken on trust. Step numbering used throughout:
 *
 *     1   e   &   a   2   e   &   a   3   e   &   a   4   e   &   a
 *     0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
 *
 * TWO THINGS THAT MATTER MORE THAN THE NOTES:
 *
 *  - The clave is not decoration. Son clave 3-2 spans TWO bars and everything
 *    else is written against it. Get it backwards and a salsa musician can hear
 *    it from the next room.
 *  - The tumbao bass does not play on beat one. It plays the "and of 2" and
 *    beat 4, and the beat-4 note belongs to the NEXT bar's chord. That
 *    anticipation is the entire engine of the style; a bass on the downbeat
 *    turns salsa into a polka immediately.
 *
 * The chip had one noise channel and Game Boy composers interleaved their whole
 * kit onto it. These tracks allow two percussion parts — a timekeeper and a kit
 * — because Latin percussion is a conversation between two players and flattening
 * it to one loses the genre. Everything else stays inside the hardware's four.
 */

import type { Song } from './song.ts';

/** Repeat one bar `n` times. Keeps a one-bar clave under a four-bar melody readable. */
function rep(n: number, bar: string): string[] {
  return Array.from({ length: n }, () => bar);
}

// ---------------------------------------------------------------------------
// Rhythm vocabulary — written once, quoted by the songs below.
// ---------------------------------------------------------------------------

/** Son clave, 3 side: beats 1, the "and" of 2, and 4. */
const CLAVE_3 = 'c . . . . . c . . . . . c . . .';
/** Son clave, 2 side: beats 2 and 3. */
const CLAVE_2 = '. . . . c . . . c . . . . . . .';

/** Cáscara — the timekeeping stroke played on the shell of the timbales. */
const CASCARA_3 = 'r . r . . r . r . . r . r . r .';
const CASCARA_2 = 'r . r . r . . r . . r . r . r .';

/**
 * Conga marcha: a slap on 2, and the pair of open tones on the "and-a" of 4
 * that pull the bar over into the next one.
 */
const MARCHA = '. . h . T . . . . . h . . . t t';

/** Güira derecho: long-short-short, once per beat. The pulse of bachata. */
const GUIRA = 'G . g g G . g g G . g g G . g g';

/** Dembow. Kick on all four, snare on the "a" of 1, "&" of 2, "a" of 3, "&" of 4. */
const DEMBOW = 'k . . s k . s . k . . s k . s .';

// ---------------------------------------------------------------------------
// Salsa — Cm, son montuno, clave 3-2
// ---------------------------------------------------------------------------

export const SALSA: Song = {
  name: 'salsa',
  bpm: 97,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    // Lead. Enters on the second time round, so the groove establishes itself
    // first — which is how a horn section actually behaves.
    {
      kind: 'pulse1', duty: 2, vol: 0.16, decay: 0.22, vibrato: 22, enterAfter: 1,
      bars: [
        '. . G4 . Bb4 . C5 ~ . . Bb4 . G4 . . .',
        '. . F4 . Ab4 . C5 ~ . . Ab4 . F4 . . .',
        '. . D5 . C5 . Bb4 ~ . . G4 . B4 . . .',
        '. . C5 ~ ~ . G4 . Eb4 . . . . . . .',
      ],
    },
    // Montuno. Offbeat by construction: nothing on 1 or 3, which is what gives
    // the piano its push against the bass.
    {
      kind: 'pulse2', duty: 1, vol: 0.11, decay: 0.1,
      bars: [
        '. . C5 . Eb5 . G4 . . . C5 . Eb5 . G4 .',
        '. . C5 . F5 . Ab4 . . . C5 . F5 . Ab4 .',
        '. . B4 . D5 . G4 . . . B4 . D5 . F5 .',
        '. . C5 . Eb5 . G4 . . . Eb5 . C5 . G4 .',
      ],
    },
    // Tumbao. No downbeat anywhere; beat 4 always belongs to the next chord.
    {
      kind: 'wave', table: 'bass', vol: 0.34,
      bars: [
        '. . . . . . G2 ~ . . . . F2 ~ ~ ~',
        '. . . . . . C3 ~ . . . . G2 ~ ~ ~',
        '. . . . . . D3 ~ . . . . C3 ~ ~ ~',
        '. . . . . . G2 ~ . . . . C3 ~ ~ ~',
      ],
    },
    { kind: 'noise', vol: 0.9, bars: [CLAVE_3, CLAVE_2, CLAVE_3, CLAVE_2] },
    { kind: 'noise', vol: 0.85, bars: [CASCARA_3, CASCARA_2, MARCHA, MARCHA] },
  ],
};

// ---------------------------------------------------------------------------
// Bachata — Am, derecho
// ---------------------------------------------------------------------------

export const BACHATA: Song = {
  name: 'bachata',
  bpm: 127,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    // The requinto line: bachata's lead guitar, all arpeggio and no chords.
    {
      kind: 'pulse1', duty: 1, vol: 0.15, decay: 0.13, vibrato: 18, enterAfter: 1,
      bars: [
        'A4 . C5 . E5 . C5 . A4 . E5 . C5 . B4 .',
        'F4 . A4 . C5 . A4 . F4 . C5 . A4 . G4 .',
        'G4 . B4 . D5 . B4 . G4 . D5 . B4 . A4 .',
        'E4 . G#4 . B4 . E5 . D5 . B4 . G#4 . E4 .',
      ],
    },
    // Rhythm guitar. Sits under the lead, thinner and quieter.
    {
      kind: 'pulse2', duty: 0, vol: 0.075, decay: 0.09,
      bars: [
        '. . E4 . A4 . E4 . . . E4 . A4 . E4 .',
        '. . C4 . F4 . C4 . . . C4 . F4 . C4 .',
        '. . D4 . G4 . D4 . . . D4 . G4 . D4 .',
        '. . B3 . E4 . B3 . . . B3 . E4 . G#4 .',
      ],
    },
    // Bass. Root on 1 and 3, and the pickup on the "a" of 4 that hands the bar
    // to the next chord — the small lurch that makes bachata feel like dancing.
    {
      kind: 'wave', table: 'bass', vol: 0.33,
      bars: [
        'A2 ~ ~ . . . . . A2 ~ ~ . . . . C3',
        'F2 ~ ~ . . . . . F2 ~ ~ . . . . E3',
        'G2 ~ ~ . . . . . G2 ~ ~ . . . . B2',
        'E2 ~ ~ . . . . . E2 ~ ~ . . . . G#2',
      ],
    },
    { kind: 'noise', vol: 1, bars: rep(4, GUIRA) },
    // Bongo martillo, with the golpe — the open slap that lands on 4 and tells
    // the dancers a new phrase is starting.
    {
      kind: 'noise', vol: 0.9,
      bars: [
        '. . b . . . b . . . b . . . b .',
        '. . b . . . b . . . b . . . b .',
        '. . b . . . b . . . b . . . b .',
        '. . b . . . b . . . b . T . T .',
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Reggaeton — Fm, dembow
// ---------------------------------------------------------------------------

export const REGGAETON: Song = {
  name: 'reggaeton',
  bpm: 94,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    // Hook. Short, plucked, repetitive on purpose — the genre is built on a
    // phrase you can sing back after one hearing.
    {
      kind: 'pulse1', duty: 1, vol: 0.16, decay: 0.14,
      bars: [
        'F4 . Ab4 . C5 . Ab4 . F4 . . . C5 . Bb4 .',
        'Db4 . F4 . Ab4 . F4 . Db4 . . . Ab4 . G4 .',
        'Ab4 . C5 . Eb5 . C5 . Ab4 . . . Eb5 . Db5 .',
        'Eb4 . G4 . Bb4 . G4 . Eb4 . . . Bb4 . C5 .',
      ],
    },
    // Pad stabs on the offbeat. Thin, so the dembow stays the loudest thing.
    {
      kind: 'pulse2', duty: 2, vol: 0.06, decay: 0.16,
      bars: [
        '. . . . Ab3 ~ . . . . . . Ab3 ~ . .',
        '. . . . F3 ~ . . . . . . F3 ~ . .',
        '. . . . C4 ~ . . . . . . C4 ~ . .',
        '. . . . Bb3 ~ . . . . . . Bb3 ~ . .',
      ],
    },
    // Sub bass, following the kick and holding through the bar.
    {
      kind: 'wave', table: 'sub', vol: 0.4,
      bars: [
        'F1 ~ ~ ~ ~ ~ ~ ~ F1 ~ ~ ~ ~ ~ ~ ~',
        'Db1 ~ ~ ~ ~ ~ ~ ~ Db1 ~ ~ ~ ~ ~ ~ ~',
        'Ab1 ~ ~ ~ ~ ~ ~ ~ Ab1 ~ ~ ~ ~ ~ ~ ~',
        'Eb1 ~ ~ ~ ~ ~ ~ ~ Eb1 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    { kind: 'noise', vol: 1, bars: rep(4, DEMBOW) },
    {
      kind: 'noise', vol: 0.7,
      bars: [
        'h . h . h . h . h . h . h . h .',
        'h . h . h . h . h . h . h . h .',
        'h . h . h . h . h . h . h . h .',
        'h . h . h . h . h . h . h . H .',
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Samba — Dm, 2/4 written two bars to the line
// ---------------------------------------------------------------------------

export const SAMBA: Song = {
  name: 'samba',
  bpm: 102,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.15, decay: 0.16, vibrato: 14, enterAfter: 1,
      bars: [
        '. . D5 . F5 . E5 . . D5 . C5 . A4 . .',
        '. . B4 . D5 . C5 . . B4 . A4 . G4 . .',
        '. . C5 . E5 . G5 . . E5 . C5 . G4 . .',
        '. . A4 . C#5 . E5 . . C#5 . A4 . E4 . .',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.08, decay: 0.08,
      bars: [
        '. . A4 . . D5 . . . . A4 . . F4 . .',
        '. . G4 . . B4 . . . . G4 . . D4 . .',
        '. . G4 . . C5 . . . . G4 . . E4 . .',
        '. . E4 . . A4 . . . . E4 . . C#4 . .',
      ],
    },
    // Samba bass anticipates constantly: the "a" of every second beat pulls
    // into the next surdo hit.
    {
      kind: 'wave', table: 'bass', vol: 0.34,
      bars: [
        'D2 . . A2 D3 ~ . . D2 . . A2 D3 ~ . .',
        'G2 . . D3 G3 ~ . . G2 . . D3 G3 ~ . .',
        'C2 . . G2 C3 ~ . . C2 . . G2 C3 ~ . .',
        'A1 . . E2 A2 ~ . . A1 . . E2 A2 ~ . .',
      ],
    },
    // Surdo. The quiet stroke on 1 and the heavy one on 2, twice a line —
    // the heartbeat everyone in the bateria follows.
    { kind: 'noise', vol: 1, bars: rep(4, 'k . . . K ~ . . k . . . K ~ . .') },
    // Tamborim across the top, with the agogô bell answering.
    {
      kind: 'noise', vol: 0.8,
      bars: [
        'm . m m . m m . m . m m . m m .',
        'm . m m . m m . a . A . a . A .',
        'm . m m . m m . m . m m . m m .',
        'm . m m . m m . a . A . A . a .',
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Cumbia — Dm
// ---------------------------------------------------------------------------

export const CUMBIA: Song = {
  name: 'cumbia',
  bpm: 91,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    // Accordion. Duty 1 with heavy vibrato is about as close as a square wave
    // gets to reeds, and cumbia without an accordion is just a rhythm.
    {
      kind: 'pulse1', duty: 1, vol: 0.16, decay: 0.2, vibrato: 30, enterAfter: 1,
      bars: [
        '. . A4 . D5 ~ . . F5 . E5 . D5 ~ . .',
        '. . A4 . C5 ~ . . E5 . D5 . C5 ~ . .',
        '. . G4 . Bb4 ~ . . D5 . C5 . Bb4 ~ . .',
        '. . E4 . A4 ~ . . C#5 . B4 . A4 ~ . .',
      ],
    },
    {
      kind: 'pulse2', duty: 0, vol: 0.07, decay: 0.1,
      bars: [
        '. . . . D4 . F4 . . . . . A4 . F4 .',
        '. . . . C4 . E4 . . . . . G4 . E4 .',
        '. . . . Bb3 . D4 . . . . . F4 . D4 .',
        '. . . . A3 . C#4 . . . . . E4 . C#4 .',
      ],
    },
    // The cumbia lurch: root on 1, then the answer on the "and" of 2. Even
    // spacing kills it stone dead.
    {
      kind: 'wave', table: 'bass', vol: 0.35,
      bars: [
        'D2 ~ ~ . . . A2 ~ D2 ~ ~ . . . A2 ~',
        'A1 ~ ~ . . . E2 ~ A1 ~ ~ . . . E2 ~',
        'Bb1 ~ ~ . . . F2 ~ Bb1 ~ ~ . . . F2 ~',
        'A1 ~ ~ . . . E2 ~ A1 ~ ~ . . . C#2 ~',
      ],
    },
    // Llamador and alegre: the low call on the offbeat, the answer after it.
    { kind: 'noise', vol: 1, bars: rep(4, 'k . . . t . . . k . . . t . T .') },
    // Guacharaca — the scrape that never stops.
    { kind: 'noise', vol: 0.75, bars: rep(4, 'G . g . G . g . G . g . G . g g') },
  ],
};

// ---------------------------------------------------------------------------
// Merengue — C, fast and rude
// ---------------------------------------------------------------------------

export const MERENGUE: Song = {
  name: 'merengue',
  bpm: 142,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.15, decay: 0.11,
      bars: [
        'C5 . E5 . G5 . E5 . C5 . G4 . C5 . D5 .',
        'B4 . D5 . F5 . D5 . B4 . G4 . B4 . C5 .',
        'C5 . E5 . G5 . C6 . G5 . E5 . C5 . B4 .',
        'D5 . F5 . G5 . F5 . D5 . B4 . G4 . . .',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.08, decay: 0.07,
      bars: [
        'E4 . G4 . E4 . G4 . E4 . G4 . E4 . G4 .',
        'D4 . F4 . D4 . F4 . D4 . F4 . D4 . F4 .',
        'E4 . G4 . E4 . G4 . E4 . G4 . E4 . G4 .',
        'F4 . G4 . F4 . G4 . D4 . G4 . B3 . D4 .',
      ],
    },
    // Merengue bass is relentless and mostly on the beat — the one Latin style
    // where the downbeat is not being avoided.
    {
      kind: 'wave', table: 'bass', vol: 0.33,
      bars: [
        'C2 . C2 . G2 . G2 . C2 . C2 . E2 . G2 .',
        'G1 . G1 . D2 . D2 . G1 . G1 . B1 . D2 .',
        'C2 . C2 . G2 . G2 . C2 . E2 . G2 . C3 .',
        'G1 . B1 . D2 . F2 . G1 . G1 . G1 . G1 .',
      ],
    },
    // Tambora.
    { kind: 'noise', vol: 1, bars: rep(4, 'd . . d d . d . d . . d d . d d') },
    // Güira, flat out.
    { kind: 'noise', vol: 0.7, bars: rep(4, 'G g g g G g g g G g g g G g g g') },
  ],
};

// ---------------------------------------------------------------------------
// Home — Fenmark. A slow bachata: this is the first music anyone hears.
// ---------------------------------------------------------------------------

export const HOME: Song = {
  name: 'home',
  bpm: 108,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 1, vol: 0.14, decay: 0.3, vibrato: 16,
      bars: [
        '. . . . C5 ~ ~ . A4 ~ . . E4 ~ ~ .',
        '. . . . D5 ~ ~ . C5 ~ . . A4 ~ ~ .',
        '. . . . E5 ~ ~ . D5 ~ . . C5 ~ ~ .',
        '. . . . B4 ~ ~ ~ ~ . . . . . . .',
      ],
    },
    {
      kind: 'pulse2', duty: 0, vol: 0.07, decay: 0.14,
      bars: [
        '. . A4 . E4 . A4 . . . A4 . E4 . C5 .',
        '. . F4 . C4 . F4 . . . F4 . C4 . A4 .',
        '. . G4 . D4 . G4 . . . G4 . D4 . B4 .',
        '. . E4 . B3 . E4 . . . G#4 . B4 . E4 .',
      ],
    },
    {
      kind: 'wave', table: 'pluck', vol: 0.3,
      bars: [
        'A2 ~ ~ . . . . . A2 ~ ~ . . . . C3',
        'F2 ~ ~ . . . . . F2 ~ ~ . . . . A2',
        'G2 ~ ~ . . . . . G2 ~ ~ . . . . B2',
        'E2 ~ ~ . . . . . E2 ~ ~ . . . . E2',
      ],
    },
    { kind: 'noise', vol: 0.65, bars: rep(4, 'G . g g G . g g G . g g G . g g') },
    { kind: 'noise', vol: 0.6, bars: rep(4, '. . b . . . b . . . b . . . b .') },
  ],
};

// ---------------------------------------------------------------------------
// Indoor — a bolero. Sparse on purpose: this plays under conversation.
// ---------------------------------------------------------------------------

export const INDOOR: Song = {
  name: 'indoor',
  bpm: 88,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 1, vol: 0.1, decay: 0.4, vibrato: 12,
      bars: [
        '. . . . . . . . E4 ~ ~ ~ . . . .',
        '. . . . . . . . F4 ~ ~ ~ . . . .',
        '. . . . . . . . G4 ~ ~ . E4 ~ . .',
        '. . . . . . . . E4 ~ ~ ~ ~ ~ . .',
      ],
    },
    {
      kind: 'pulse2', duty: 0, vol: 0.055, decay: 0.2,
      bars: [
        'A3 . C4 . E4 . C4 . A3 . C4 . E4 . C4 .',
        'F3 . A3 . C4 . A3 . F3 . A3 . C4 . A3 .',
        'G3 . B3 . D4 . B3 . G3 . B3 . D4 . B3 .',
        'E3 . G#3 . B3 . G#3 . E3 . B3 . G#3 . E3 .',
      ],
    },
    {
      kind: 'wave', table: 'pluck', vol: 0.24,
      bars: [
        'A2 ~ ~ ~ . . . . E2 ~ ~ ~ . . . .',
        'F2 ~ ~ ~ . . . . C2 ~ ~ ~ . . . .',
        'G2 ~ ~ ~ . . . . D2 ~ ~ ~ . . . .',
        'E2 ~ ~ ~ . . . . B1 ~ ~ ~ . . . .',
      ],
    },
    // Bolero clave, softly. Nothing else — a shop does not need a bateria.
    { kind: 'noise', vol: 0.5, bars: [CLAVE_3, CLAVE_2, CLAVE_3, CLAVE_2] },
  ],
};

export const LATIN_SONGS: readonly Song[] = [
  SALSA, BACHATA, REGGAETON, SAMBA, CUMBIA, MERENGUE, HOME, INDOOR,
];
