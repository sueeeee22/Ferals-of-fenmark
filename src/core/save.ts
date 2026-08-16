/**
 * Save / load / migrate.
 *
 * Because the reducer is pure and every scene is serializable, a save is just
 * the GameState. No separate save format to drift out of sync with the game.
 *
 * Transient scenes (dialogue mid-typewriter, a battle in progress) are collapsed
 * back to the overworld on save, exactly like Gen 1 — you cannot save mid-battle,
 * and restoring into one would be a source of unreachable states.
 */

import type { GameState, PlayerState } from './game.ts';
import { NO_BUTTONS } from './game.ts';
import type { RngState } from './rng.ts';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'fenmark.save.v1';

export interface SaveFile {
  readonly version: number;
  readonly savedAt: number;
  readonly rngState: RngState;
  readonly player: PlayerState;
  readonly frame: number;
}

export function serialize(state: GameState): string {
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    rngState: state.rngState,
    player: state.player,
    frame: state.frame,
  };
  return JSON.stringify(file);
}

/** Narrowing without `any`: every field is checked before it is trusted. */
function isSaveFile(v: unknown): v is SaveFile {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o['version'] !== 'number') return false;
  if (typeof o['frame'] !== 'number') return false;
  const rng = o['rngState'];
  if (typeof rng !== 'object' || rng === null) return false;
  const r = rng as Record<string, unknown>;
  for (const k of ['a', 'b', 'c', 'd']) if (typeof r[k] !== 'number') return false;
  const p = o['player'];
  if (typeof p !== 'object' || p === null) return false;
  const pl = p as Record<string, unknown>;
  if (typeof pl['mapId'] !== 'string') return false;
  if (typeof pl['x'] !== 'number' || typeof pl['y'] !== 'number') return false;
  if (!Array.isArray(pl['party'])) return false;
  if (!Array.isArray(pl['flags'])) return false;
  return true;
}

export function deserialize(json: string): SaveFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isSaveFile(parsed)) return null;
  return migrate(parsed);
}

/** Future versions land here. Returning null rejects a save we cannot honour. */
function migrate(file: SaveFile): SaveFile | null {
  if (file.version === SAVE_VERSION) return file;
  if (file.version > SAVE_VERSION) return null;
  return { ...file, version: SAVE_VERSION };
}

/** Rebuild a playable state from a save. Always resumes standing in the overworld. */
export function restore(file: SaveFile): GameState {
  return {
    frame: file.frame,
    rngState: file.rngState,
    scene: {
      kind: 'overworld',
      walk: { progress: 0, dir: file.player.facing, hop: false, fromX: file.player.x, fromY: file.player.y },
    },
    player: file.player,
    prev: NO_BUTTONS,
    saveRequested: false,
    lastText: '',
  };
}

// ---------------------------------------------------------------------------
// Storage adapters. localStorage is the only required one — the game is fully
// playable offline with no backend. Firebase is a layer on top, never a blocker.
// ---------------------------------------------------------------------------

export interface SaveStore {
  read(): string | null;
  write(data: string): void;
  clear(): void;
}

export function memoryStore(): SaveStore {
  let data: string | null = null;
  return {
    read: () => data,
    write: (d) => {
      data = d;
    },
    clear: () => {
      data = null;
    },
  };
}
