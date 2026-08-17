/**
 * Save storage for the browser.
 *
 * This lives OUTSIDE `src/core` on purpose: the core reducer is pure and may
 * not touch `localStorage` (gauntlet:types enforces it). The reducer only ever
 * raises a `saveRequested` flag; deciding where those bytes land is the shell's
 * job, and this is the shell.
 *
 * Three things a cartridge did not have to worry about, which a web build does:
 *
 *  1. **The tab just closes.** Nobody gets a "would you like to save?" prompt
 *     from a crashed browser or a phone reclaiming memory. So there is an
 *     autosave, written to its own key so it can never overwrite the save a
 *     player deliberately made.
 *  2. **Storage can be corrupt, full, or switched off.** Every write keeps the
 *     previous good value as a backup, so a half-written or truncated save
 *     costs the last few minutes rather than the whole run.
 *  3. **Site data gets cleared.** Nothing in a browser is permanent, which is
 *     why `exportCode` exists in core — see the save panel.
 */

import {
  SAVE_KEY,
  deserialize,
  summarize,
  type SaveFile,
  type SaveStore,
  type SaveSummary,
} from './core/save.ts';

export const SLOT_COUNT = 3;

/** Slot 0 keeps the original key, so a save made before slots existed survives. */
function primaryKey(slot: number): string {
  return slot === 0 ? SAVE_KEY : `${SAVE_KEY}.slot${slot}`;
}

function backupKey(slot: number): string {
  return `${primaryKey(slot)}.bak`;
}

function autosaveKey(slot: number): string {
  return `${primaryKey(slot)}.auto`;
}

const ACTIVE_SLOT_KEY = 'fenmark.activeSlot';

// --- Raw localStorage access, which is allowed to be missing entirely --------

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Private browsing, a full quota, or storage disabled by policy. The game
    // stays playable; it just will not persist. Never throw from a save.
    return false;
  }
}

function drop(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** True when writes actually stick. The save panel tells the player if not. */
export function storageAvailable(): boolean {
  const probe = 'fenmark.probe';
  if (!put(probe, '1')) return false;
  const ok = get(probe) === '1';
  drop(probe);
  return ok;
}

// --- Reading, with recovery -------------------------------------------------

export interface LoadedSave {
  readonly file: SaveFile;
  /** The exact text this came from, so the caller never re-serialises to reload. */
  readonly raw: string;
  /** The primary was unreadable and this came from the backup or the autosave. */
  readonly recoveredFrom: 'backup' | 'autosave' | null;
}

interface RawSave {
  readonly file: SaveFile;
  readonly raw: string;
}

function readKey(key: string): RawSave | null {
  const raw = get(key);
  if (raw === null) return null;
  const file = deserialize(raw);
  return file === null ? null : { file, raw };
}

/**
 * Best available save for a slot.
 *
 * Order is deliberate. The manual save wins over its backup, and both win over
 * the autosave UNLESS the autosave is strictly newer — a player who saved an
 * hour ago and then played for another hour wants the hour, and the autosave is
 * the only record of it.
 */
export function loadSlot(slot: number): LoadedSave | null {
  const primary = readKey(primaryKey(slot));
  const backup = primary === null ? readKey(backupKey(slot)) : null;
  const manual = primary ?? backup;
  const auto = readKey(autosaveKey(slot));

  if (manual === null) {
    return auto === null ? null : { ...auto, recoveredFrom: 'autosave' };
  }
  if (auto !== null && auto.file.savedAt > manual.file.savedAt) {
    return { ...auto, recoveredFrom: 'autosave' };
  }
  return { ...manual, recoveredFrom: primary === null ? 'backup' : null };
}

export interface SlotInfo {
  readonly slot: number;
  readonly summary: SaveSummary | null;
  readonly recoveredFrom: 'backup' | 'autosave' | null;
}

export function slotInfo(slot: number): SlotInfo {
  const loaded = loadSlot(slot);
  return {
    slot,
    summary: loaded === null ? null : summarize(loaded.file),
    recoveredFrom: loaded?.recoveredFrom ?? null,
  };
}

export function allSlots(): readonly SlotInfo[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => slotInfo(i));
}

// --- Writing ----------------------------------------------------------------

/**
 * Promote the current primary to backup, then write the new save.
 *
 * The order matters: if the write fails halfway, the backup still holds a
 * complete previous save. Writing the new value first and then copying it to
 * the backup would give two copies of the same corruption.
 */
function writeWithBackup(slot: number, data: string): boolean {
  const current = get(primaryKey(slot));
  // Only demote a primary we can actually still read. Copying a corrupt primary
  // into the backup would destroy the last good save.
  if (current !== null && deserialize(current) !== null) {
    put(backupKey(slot), current);
  }
  return put(primaryKey(slot), data);
}

export function activeSlot(): number {
  const raw = get(ACTIVE_SLOT_KEY);
  const n = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT ? n : 0;
}

export function setActiveSlot(slot: number): void {
  if (slot >= 0 && slot < SLOT_COUNT) put(ACTIVE_SLOT_KEY, String(slot));
}

export function clearSlot(slot: number): void {
  drop(primaryKey(slot));
  drop(backupKey(slot));
  drop(autosaveKey(slot));
}

/**
 * The store handed to the game loop. `write` is the player's own save; the
 * autosave goes through `autosave` so the two can never clobber each other.
 */
export function slotStore(getSlot: () => number): SaveStore & { autosave(data: string): void } {
  return {
    read(): string | null {
      // Deliberately the RECOVERED text, not the primary key: if the primary is
      // corrupt, the whole point is that the player gets the backup instead.
      return loadSlot(getSlot())?.raw ?? null;
    },
    write(data: string): void {
      writeWithBackup(getSlot(), data);
      // A deliberate save supersedes the autosave; leaving a newer autosave
      // around would silently resurrect a state the player just overwrote.
      drop(autosaveKey(getSlot()));
    },
    clear(): void {
      clearSlot(getSlot());
    },
    autosave(data: string): void {
      put(autosaveKey(getSlot()), data);
    },
  };
}
