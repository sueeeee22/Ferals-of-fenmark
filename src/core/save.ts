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

// ---------------------------------------------------------------------------
// Transfer codes.
//
// A browser save lives in one origin, in one browser, on one device, and a
// player who clears site data loses it. Gen 1 had the same problem with a dying
// CR2032 and no answer for it; we can do better without a backend. A transfer
// code is the whole save as text, so a player can move a game between devices,
// keep a backup, or hand a run to someone else.
//
// These are deliberately pure string functions so the gauntlet can round-trip
// them in Node without a browser.
// ---------------------------------------------------------------------------

const CODE_PREFIX = 'FENMARK1:';

/** UTF-8 safe base64. `btoa` alone mangles any name outside latin1. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * A cheap checksum over the payload. This is not security — a player who edits
 * their own save is only cheating themselves, and there is no server to lie to.
 * It exists so that a code truncated by a chat client or a line-wrapping email
 * fails with "this code is incomplete" instead of loading a half-parsed save.
 */
function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

/** The save as a single line of text, safe to paste anywhere. */
export function exportCode(state: GameState): string {
  const payload = toBase64(serialize(state));
  return `${CODE_PREFIX}${checksum(payload)}:${payload}`;
}

export type ImportResult =
  | { readonly ok: true; readonly file: SaveFile }
  | { readonly ok: false; readonly reason: string };

/** Parse a transfer code. Every failure gets a message a player can act on. */
export function importCode(code: string): ImportResult {
  const trimmed = code.trim().replace(/\s+/g, '');
  if (trimmed === '') return { ok: false, reason: 'Nothing pasted.' };
  if (!trimmed.startsWith(CODE_PREFIX)) {
    return { ok: false, reason: 'That is not a Fenmark transfer code.' };
  }
  const rest = trimmed.slice(CODE_PREFIX.length);
  const split = rest.indexOf(':');
  if (split < 0) return { ok: false, reason: 'This code is malformed.' };
  const sum = rest.slice(0, split);
  const payload = rest.slice(split + 1);
  if (checksum(payload) !== sum) {
    return { ok: false, reason: 'This code is incomplete or was altered in transit.' };
  }
  let json: string;
  try {
    json = fromBase64(payload);
  } catch {
    return { ok: false, reason: 'This code is not readable.' };
  }
  const file = deserialize(json);
  if (!file) return { ok: false, reason: 'This code is from an incompatible version.' };
  return { ok: true, file };
}

// ---------------------------------------------------------------------------
// Save summaries, for a slot list that means something to a player.
// ---------------------------------------------------------------------------

export interface SaveSummary {
  readonly savedAt: number;
  readonly badges: number;
  readonly partySize: number;
  readonly leadLevel: number;
  readonly mapId: string;
  /** In-game frames, at 60fps. */
  readonly frame: number;
}

export function summarize(file: SaveFile): SaveSummary {
  return {
    savedAt: file.savedAt,
    badges: file.player.badges.length,
    partySize: file.player.party.length,
    leadLevel: file.player.party.reduce((best, f) => Math.max(best, f.level), 0),
    mapId: file.player.mapId,
    frame: file.frame,
  };
}
