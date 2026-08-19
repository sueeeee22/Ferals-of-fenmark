/**
 * Fights, and the jingles either side of them. Gen 1's idiom, not the
 * overworld's — the moment a battle starts, the Latin stops and the Game Boy
 * takes over. That contrast is the point: you always know which mode you are in
 * before you have finished reading the first box.
 *
 * What makes Gen 1 battle music sound the way it does, and what is copied here:
 *
 *  - A CONSTANT DRIVING EIGHTH-NOTE BASS. It never rests. Everything urgent on
 *    that hardware was urgent because the bass would not stop.
 *  - CHROMATIC DESCENTS in the lead. Half-step slides downward read as danger
 *    in a way a minor scale does not.
 *  - THE INTRO STING. Two bars of unaccompanied fanfare before the loop starts,
 *    which is why the wild-battle theme is instantly recognisable from its first
 *    half second.
 *  - NOISE ON EVERY OFFBEAT, never on the beat, so the drums push rather than
 *    plod.
 */

import type { Song } from './song.ts';

function rep(n: number, bar: string): string[] {
  return Array.from({ length: n }, () => bar);
}

/** Straight eighths on the noise channel, offbeat-accented. */
const DRIVE = 'h . s . h . s . h . s . h . s .';
const DRIVE_FILL = 'h . s . h . s . h . s . s s s s';

// ---------------------------------------------------------------------------
// Wild battle — Dm, fast, panicky
// ---------------------------------------------------------------------------

export const BATTLE_WILD: Song = {
  name: 'battle_wild',
  bpm: 152,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.17, decay: 0.1,
      bars: [
        'D5 . C#5 . C5 . B4 . Bb4 . A4 . . . A4 .',
        'D5 . E5 . F5 ~ . . E5 . D5 . C#5 ~ . .',
        'D5 . C#5 . C5 . B4 . Bb4 . A4 . G4 . F4 .',
        'E4 . A4 . D5 ~ . . C#5 . D5 . E5 ~ . .',
      ],
    },
    {
      kind: 'pulse2', duty: 0, vol: 0.085, decay: 0.07,
      bars: [
        'F4 . F4 . F4 . F4 . F4 . F4 . F4 . F4 .',
        'A4 . A4 . A4 . A4 . G4 . G4 . G4 . G4 .',
        'F4 . F4 . F4 . F4 . F4 . F4 . F4 . F4 .',
        'A4 . A4 . A4 . G#4 . A4 . A4 . B4 . C#5 .',
      ],
    },
    // The engine. Eighths, no rests, ever.
    {
      kind: 'wave', table: 'bass', vol: 0.36,
      bars: [
        'D2 . D2 . D2 . D2 . D2 . D2 . D2 . D2 .',
        'Bb1 . Bb1 . Bb1 . Bb1 . G1 . G1 . G1 . G1 .',
        'D2 . D2 . D2 . D2 . D2 . D2 . D2 . D2 .',
        'A1 . A1 . A1 . A1 . A1 . A1 . A1 . A1 .',
      ],
    },
    { kind: 'noise', vol: 0.9, bars: [DRIVE, DRIVE, DRIVE, DRIVE_FILL] },
  ],
};

// ---------------------------------------------------------------------------
// Trainer battle — Am, more swagger than panic
// ---------------------------------------------------------------------------

export const BATTLE_TRAINER: Song = {
  name: 'battle_trainer',
  bpm: 160,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.17, decay: 0.12,
      bars: [
        'A4 . . . E5 . . . D5 . C5 . B4 . A4 .',
        'C5 . . . G5 . . . F5 . E5 . D5 . C5 .',
        'B4 . . . F5 . . . E5 . D5 . C5 . B4 .',
        'A4 . B4 . C5 . D5 . E5 ~ ~ . . . . .',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.08, decay: 0.06,
      bars: [
        'A3 . E4 . A3 . E4 . A3 . E4 . A3 . E4 .',
        'C4 . G4 . C4 . G4 . C4 . G4 . C4 . G4 .',
        'B3 . F4 . B3 . F4 . B3 . F4 . B3 . F4 .',
        'A3 . E4 . A3 . E4 . E4 . E4 . E4 . E4 .',
      ],
    },
    {
      kind: 'wave', table: 'bass', vol: 0.36,
      bars: [
        'A1 . A1 . A1 . A1 . A1 . A1 . A1 . A1 .',
        'F1 . F1 . F1 . F1 . F1 . F1 . F1 . F1 .',
        'G1 . G1 . G1 . G1 . G1 . G1 . G1 . G1 .',
        'E1 . E1 . E1 . E1 . E1 . E1 . E2 . E1 .',
      ],
    },
    { kind: 'noise', vol: 0.9, bars: [DRIVE, DRIVE, DRIVE, DRIVE_FILL] },
  ],
};

// ---------------------------------------------------------------------------
// Gym leader — Cm, heavier, and it does not resolve
// ---------------------------------------------------------------------------

export const BATTLE_GYM: Song = {
  name: 'battle_gym',
  bpm: 168,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.18, decay: 0.13, vibrato: 12,
      bars: [
        'C5 ~ . . Eb5 . D5 . C5 . B4 . C5 ~ . .',
        'G5 ~ . . F5 . Eb5 . D5 . C5 . B4 ~ . .',
        'Ab5 . G5 . F5 . Eb5 . D5 . Eb5 . F5 . G5 .',
        'Ab5 ~ ~ . G5 ~ ~ . F5 . Eb5 . D5 . . .',
      ],
    },
    {
      kind: 'pulse2', duty: 0, vol: 0.09, decay: 0.06,
      bars: [
        'G4 . G4 . G4 . G4 . G4 . G4 . G4 . G4 .',
        'Eb4 . Eb4 . Eb4 . Eb4 . D4 . D4 . D4 . D4 .',
        'C5 . C5 . C5 . C5 . Bb4 . Bb4 . Bb4 . Bb4 .',
        'Ab4 . Ab4 . G4 . G4 . F4 . F4 . G4 . G4 .',
      ],
    },
    {
      kind: 'wave', table: 'brass', vol: 0.34,
      bars: [
        'C2 . C2 . C2 . C2 . C2 . C2 . C2 . C2 .',
        'Ab1 . Ab1 . Ab1 . Ab1 . G1 . G1 . G1 . G1 .',
        'F1 . F1 . F1 . F1 . F1 . F1 . F1 . F1 .',
        'Ab1 . Ab1 . G1 . G1 . F1 . F1 . G1 . G1 .',
      ],
    },
    { kind: 'noise', vol: 1, bars: [DRIVE, DRIVE, DRIVE, DRIVE_FILL] },
  ],
};

// ---------------------------------------------------------------------------
// Champion — the last fight, and it should feel like it
// ---------------------------------------------------------------------------

export const BATTLE_CHAMPION: Song = {
  name: 'battle_champion',
  bpm: 174,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.19, decay: 0.14, vibrato: 16,
      bars: [
        'E5 . F5 . G5 ~ . . F5 . E5 . D5 ~ . .',
        'C5 . D5 . E5 ~ . . D5 . C5 . B4 ~ . .',
        'A5 ~ . . G5 . F5 . E5 . D5 . C5 . B4 .',
        'A4 . C5 . E5 . A5 ~ ~ ~ . . . . . .',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.1, decay: 0.06,
      bars: [
        'A4 . E4 . A4 . E4 . A4 . E4 . A4 . E4 .',
        'G4 . D4 . G4 . D4 . G4 . D4 . G4 . D4 .',
        'F4 . C4 . F4 . C4 . E4 . B3 . E4 . B3 .',
        'A4 . E4 . A4 . E4 . A4 . A4 . A4 . A4 .',
      ],
    },
    {
      kind: 'wave', table: 'brass', vol: 0.38,
      bars: [
        'A1 . A1 . A1 . A1 . A1 . A1 . A1 . A1 .',
        'G1 . G1 . G1 . G1 . G1 . G1 . G1 . G1 .',
        'F1 . F1 . F1 . F1 . E1 . E1 . E1 . E1 .',
        'A1 . A1 . A1 . A1 . A1 . E2 . A2 . A1 .',
      ],
    },
    { kind: 'noise', vol: 1, bars: [DRIVE, DRIVE_FILL, DRIVE, DRIVE_FILL] },
  ],
};

// ---------------------------------------------------------------------------
// Jingles. `once: true` — they play through and hand the channel back.
// ---------------------------------------------------------------------------

/** The rising figure after you win. Two bars, and then the overworld returns. */
export const FANFARE_VICTORY: Song = {
  name: 'fanfare_victory',
  bpm: 150,
  stepsPerBar: 16,
  bars: 2,
  once: true,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.2, decay: 0.16,
      bars: [
        'C5 . E5 . G5 . C6 ~ . . G5 . C6 ~ ~ ~',
        'A5 . G5 . E5 . C5 . G5 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.1, decay: 0.12,
      bars: [
        'E4 . G4 . C5 . E5 ~ . . C5 . E5 ~ ~ ~',
        'C5 . B4 . G4 . E4 . C5 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'wave', table: 'brass', vol: 0.34,
      bars: [
        'C2 . C2 . C2 . C2 ~ . . G1 . C2 ~ ~ ~',
        'F1 . F1 . G1 . G1 . C2 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    { kind: 'noise', vol: 0.8, bars: ['s . s . s . x ~ . . s . x ~ ~ ~', 's . s . s . s . x ~ ~ ~ ~ ~ ~ ~'] },
  ],
};

/** Level up. One bar, bright, gone before you can get bored of it. */
export const JINGLE_LEVEL: Song = {
  name: 'jingle_level',
  bpm: 150,
  stepsPerBar: 16,
  bars: 1,
  once: true,
  parts: [
    { kind: 'pulse1', duty: 2, vol: 0.2, decay: 0.12, bars: ['G4 . C5 . E5 . G5 ~ ~ . . . . . . .'] },
    { kind: 'pulse2', duty: 1, vol: 0.09, decay: 0.1, bars: ['C4 . E4 . G4 . C5 ~ ~ . . . . . . .'] },
  ],
};

/** The snare holds. Gen 1's catch jingle is the one everybody can hum. */
export const JINGLE_CAUGHT: Song = {
  name: 'jingle_caught',
  bpm: 144,
  stepsPerBar: 16,
  bars: 2,
  once: true,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.2, decay: 0.18,
      bars: [
        'E5 . . . G5 . . . C6 ~ ~ ~ . . . .',
        'A5 . G5 . E5 . G5 . C6 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.1, decay: 0.14,
      bars: [
        'C5 . . . E5 . . . G5 ~ ~ ~ . . . .',
        'F5 . E5 . C5 . E5 . G5 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'wave', table: 'bass', vol: 0.3,
      bars: [
        'C2 . . . C2 . . . C2 ~ ~ ~ . . . .',
        'F1 . F1 . C2 . C2 . C2 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
  ],
};

/** Evolution. Slower and a little uncanny — something is happening to your animal. */
export const JINGLE_EVOLVE: Song = {
  name: 'jingle_evolve',
  bpm: 120,
  stepsPerBar: 16,
  bars: 2,
  once: true,
  parts: [
    {
      kind: 'pulse1', duty: 1, vol: 0.18, decay: 0.2, vibrato: 40,
      bars: [
        'C5 . D5 . E5 . F#5 . G#5 . A#5 . C6 ~ ~ ~',
        'F6 ~ ~ ~ . . . . C6 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'wave', table: 'organ', vol: 0.28,
      bars: [
        'C3 ~ ~ ~ ~ ~ ~ ~ C3 ~ ~ ~ ~ ~ ~ ~',
        'F2 ~ ~ ~ ~ ~ ~ ~ C3 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
  ],
};

/** Blackout. Descending, and it does not land anywhere good. */
export const JINGLE_DEFEAT: Song = {
  name: 'jingle_defeat',
  bpm: 100,
  stepsPerBar: 16,
  bars: 2,
  once: true,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.17, decay: 0.26,
      bars: [
        'C5 ~ . . B4 ~ . . Bb4 ~ . . A4 ~ . .',
        'Ab4 ~ . . G4 ~ . . Eb4 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'wave', table: 'bass', vol: 0.3,
      bars: [
        'C2 ~ ~ ~ ~ ~ ~ ~ A1 ~ ~ ~ ~ ~ ~ ~',
        'Ab1 ~ ~ ~ ~ ~ ~ ~ C1 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
  ],
};

/** The Hall of Fame. The only unhurried thing in the game. */
export const FANFARE_CHAMPION: Song = {
  name: 'fanfare_champion',
  bpm: 96,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.19, decay: 0.4, vibrato: 20,
      bars: [
        'C5 ~ ~ . E5 ~ ~ . G5 ~ ~ ~ ~ ~ ~ ~',
        'A5 ~ ~ . G5 ~ ~ . E5 ~ ~ ~ ~ ~ ~ ~',
        'F5 ~ ~ . G5 ~ ~ . A5 ~ ~ ~ ~ ~ ~ ~',
        'G5 ~ ~ ~ ~ ~ ~ ~ C6 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.08, decay: 0.2,
      bars: [
        'C4 . E4 . G4 . E4 . C4 . E4 . G4 . E4 .',
        'A3 . C4 . E4 . C4 . A3 . C4 . E4 . C4 .',
        'F3 . A3 . C4 . A3 . F3 . A3 . C4 . A3 .',
        'G3 . B3 . D4 . B3 . C4 . E4 . G4 . C5 .',
      ],
    },
    {
      kind: 'wave', table: 'pluck', vol: 0.3,
      bars: [
        'C2 ~ ~ ~ ~ ~ ~ ~ C2 ~ ~ ~ ~ ~ ~ ~',
        'A1 ~ ~ ~ ~ ~ ~ ~ A1 ~ ~ ~ ~ ~ ~ ~',
        'F1 ~ ~ ~ ~ ~ ~ ~ F1 ~ ~ ~ ~ ~ ~ ~',
        'G1 ~ ~ ~ ~ ~ ~ ~ C2 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    { kind: 'noise', vol: 0.5, bars: rep(4, '. . . h . . . h . . . h . . . h') },
  ],
};

/** The title screen. Latin, because the game is, but stately about it. */
export const TITLE: Song = {
  name: 'title',
  bpm: 104,
  stepsPerBar: 16,
  bars: 4,
  parts: [
    {
      kind: 'pulse1', duty: 2, vol: 0.17, decay: 0.28, vibrato: 18,
      bars: [
        '. . . . A4 ~ ~ . C5 ~ . . E5 ~ ~ ~',
        '. . . . D5 ~ ~ . C5 ~ . . A4 ~ ~ ~',
        '. . . . G4 ~ ~ . B4 ~ . . D5 ~ ~ ~',
        'E5 ~ ~ ~ ~ ~ . . A4 ~ ~ ~ ~ ~ ~ ~',
      ],
    },
    {
      kind: 'pulse2', duty: 1, vol: 0.08, decay: 0.1,
      bars: [
        '. . A4 . E4 . A4 . . . C5 . E4 . A4 .',
        '. . F4 . C4 . F4 . . . A4 . C4 . F4 .',
        '. . G4 . D4 . G4 . . . B4 . D4 . G4 .',
        '. . E4 . B3 . E4 . . . A4 . E4 . A4 .',
      ],
    },
    {
      kind: 'wave', table: 'bass', vol: 0.34,
      bars: [
        '. . . . . . A2 ~ . . . . F2 ~ ~ ~',
        '. . . . . . C3 ~ . . . . G2 ~ ~ ~',
        '. . . . . . D3 ~ . . . . E2 ~ ~ ~',
        '. . . . . . B2 ~ . . . . A2 ~ ~ ~',
      ],
    },
    { kind: 'noise', vol: 0.8, bars: ['c . . . . . c . . . . . c . . .', '. . . . c . . . c . . . . . . .', 'c . . . . . c . . . . . c . . .', '. . . . c . . . c . . . . . x .'] },
  ],
};

export const BATTLE_SONGS: readonly Song[] = [
  BATTLE_WILD, BATTLE_TRAINER, BATTLE_GYM, BATTLE_CHAMPION,
  FANFARE_VICTORY, FANFARE_CHAMPION, TITLE,
  JINGLE_LEVEL, JINGLE_CAUGHT, JINGLE_EVOLVE, JINGLE_DEFEAT,
];
