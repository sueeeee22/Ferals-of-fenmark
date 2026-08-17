/**
 * The save panel: slots, transfer codes, and an honest warning when the browser
 * refuses to persist anything.
 *
 * This is an HTML overlay rather than a Scene inside the game. Two reasons, and
 * both are deliberate:
 *
 *  - The 160x144 screen is a Game Boy and should stay one. Slot management and
 *    a 30KB transfer code are web-era conveniences; putting them on the DMG
 *    screen would mean inventing a text-entry UI Gen 1 never had, in a font
 *    that is eight pixels tall.
 *  - The reducer is pure and is currently the thing that passes
 *    gauntlet:playthrough twelve runs out of twelve. Nothing here can regress
 *    that, because none of it touches `step()`.
 */

import { exportCode, importCode, type SaveFile } from './core/save.ts';
import type { GameState } from './core/game.ts';
import {
  SLOT_COUNT,
  activeSlot,
  allSlots,
  clearSlot,
  setActiveSlot,
  storageAvailable,
  type SlotInfo,
} from './saves.ts';

export interface SavePanelHooks {
  /** Current live state, for exporting. */
  getState(): GameState;
  /** Swap the running game to this save. */
  loadFile(file: SaveFile): void;
  /** Switch slots, which reloads whatever lives there (or starts fresh). */
  switchSlot(slot: number): void;
}

function describe(info: SlotInfo, isCurrent: boolean): string {
  const s = info.summary;
  if (s === null) {
    // "empty" on the slot you are actively playing reads as "your game is
    // gone". It is not - it just has not been written yet.
    return isCurrent ? 'playing now — nothing saved to this slot yet' : 'empty';
  }
  const minutes = Math.floor(s.frame / 60 / 60);
  const when = new Date(s.savedAt).toLocaleString();
  const badges = `${s.badges} badge${s.badges === 1 ? '' : 's'}`;
  const party = s.partySize === 0 ? 'no party' : `party of ${s.partySize}, lead Lv${s.leadLevel}`;
  return `${badges} · ${party} · ${minutes}m played · ${when}`;
}

export function createSavePanel(hooks: SavePanelHooks): { open(): void; close(): void } {
  const root = document.createElement('div');
  root.id = 'save-panel';
  root.hidden = true;

  const render = (): void => {
    const slots = allSlots();
    const current = activeSlot();
    const persistent = storageAvailable();

    root.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'sp-card';

    const head = document.createElement('div');
    head.className = 'sp-head';
    head.innerHTML = '<h2>Saves</h2>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sp-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => hide());
    head.append(close);
    card.append(head);

    if (!persistent) {
      const warn = document.createElement('p');
      warn.className = 'sp-warn';
      warn.textContent =
        'This browser is not letting the game store anything — private browsing, ' +
        'a full disk, or blocked site data. You can still play, but nothing will ' +
        'be here when you come back. Use "Copy transfer code" before you close the tab.';
      card.append(warn);
    }

    for (const info of slots) {
      const row = document.createElement('div');
      row.className = info.slot === current ? 'sp-slot sp-slot-active' : 'sp-slot';

      const label = document.createElement('div');
      label.className = 'sp-slot-label';
      label.innerHTML =
        `<strong>Slot ${info.slot + 1}${info.slot === current ? ' (playing)' : ''}</strong>` +
        `<span>${describe(info, info.slot === current)}</span>`;
      if (info.recoveredFrom !== null) {
        const note = document.createElement('span');
        note.className = 'sp-note';
        note.textContent =
          info.recoveredFrom === 'backup'
            ? 'recovered from backup — the main save was damaged'
            : 'recovered from autosave — newer than the last manual save';
        label.append(note);
      }
      row.append(label);

      const actions = document.createElement('div');
      actions.className = 'sp-actions';

      if (info.slot !== current) {
        const play = document.createElement('button');
        play.type = 'button';
        play.textContent = info.summary === null ? 'Start here' : 'Play this';
        play.addEventListener('click', () => {
          hooks.switchSlot(info.slot);
          render();
        });
        actions.append(play);
      }

      if (info.summary !== null) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'sp-danger';
        del.textContent = 'Erase';
        del.addEventListener('click', () => {
          // Deleting a save is the one irreversible thing a player can do here.
          if (!window.confirm(`Erase slot ${info.slot + 1}? This cannot be undone.`)) return;
          clearSlot(info.slot);
          if (info.slot === activeSlot()) hooks.switchSlot(info.slot);
          render();
        });
        actions.append(del);
      }

      row.append(actions);
      card.append(row);
    }

    // --- Transfer codes ---
    const transfer = document.createElement('div');
    transfer.className = 'sp-transfer';
    transfer.innerHTML =
      '<h3>Move a save between devices</h3>' +
      '<p>Nothing in a browser is permanent. A transfer code is your whole game as ' +
      'text — keep it somewhere safe, or paste it on another device to carry on there.</p>';

    const status = document.createElement('p');
    status.className = 'sp-status';
    status.setAttribute('role', 'status');

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy transfer code';
    copy.addEventListener('click', () => {
      const code = exportCode(hooks.getState());
      void navigator.clipboard
        .writeText(code)
        .then(() => {
          status.textContent = `Copied — ${code.length.toLocaleString()} characters.`;
          status.className = 'sp-status sp-ok';
        })
        .catch(() => {
          // Clipboard access can be refused. Never dead-end the player: show the
          // code so it can be selected and copied by hand.
          box.value = code;
          box.select();
          status.textContent = 'Clipboard blocked — the code is in the box, copy it manually.';
          status.className = 'sp-status sp-warn-text';
        });
    });

    const box = document.createElement('textarea');
    box.className = 'sp-code';
    box.placeholder = 'Paste a transfer code here…';
    box.spellcheck = false;

    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = 'Load from code';
    load.addEventListener('click', () => {
      const result = importCode(box.value);
      if (!result.ok) {
        status.textContent = result.reason;
        status.className = 'sp-status sp-bad';
        return;
      }
      if (!window.confirm(`Load this save into slot ${activeSlot() + 1}? It replaces what is there.`)) {
        return;
      }
      hooks.loadFile(result.file);
      status.textContent = 'Loaded.';
      status.className = 'sp-status sp-ok';
      render();
    });

    const buttons = document.createElement('div');
    buttons.className = 'sp-actions';
    buttons.append(copy, load);
    transfer.append(buttons, box, status);
    card.append(transfer);

    root.append(card);
  };

  const show = (): void => {
    render();
    root.hidden = false;
  };
  const hide = (): void => {
    root.hidden = true;
  };

  root.addEventListener('click', (e) => {
    if (e.target === root) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) hide();
  });

  document.body.append(root);
  return { open: show, close: hide };
}

export { SLOT_COUNT, setActiveSlot };
