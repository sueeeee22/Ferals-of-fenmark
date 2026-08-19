/**
 * The shell: boots the reducer + renderer, runs the fixed-timestep loop, and
 * maps keyboard/touch input to `Buttons`. Everything game-shaped lives in
 * `src/core`; everything drawing-shaped lives in `src/render`. This file is
 * just the glue that makes them run in a browser tab at 60fps.
 */
import './style.css';
import { createScreen } from './render/gb.ts';
import { draw, setFrameAlpha, drawnPlayerPos } from './render/draw.ts';
import { content, usingPlaceholder } from './game/content.ts';
import {
  newGame, step, chooseStarter, STARTERS,
  type Buttons, type ButtonName, type GameState,
} from './core/game.ts';
import { serialize, restore, type SaveFile } from './core/save.ts';
import { activeSlot, loadSlot, setActiveSlot, slotStore } from './saves.ts';
import { createSavePanel } from './save-ui.ts';
import { createAudio } from './audio/index.ts';

if (Object.values(usingPlaceholder).some(Boolean)) {
  console.info('[content] placeholder data in use for:', usingPlaceholder);
}

// ---------------------------------------------------------------------------
// Save storage. `src/saves.ts` owns the slots, the backup-on-write and the
// autosave; this file only decides WHEN to call it. Nothing here can throw:
// a browser that refuses to persist gets a playable game and a warning in the
// save panel, not a crash.
// ---------------------------------------------------------------------------

let slot = activeSlot();
const store = slotStore(() => slot);

function loadInitialState(): GameState {
  const loaded = loadSlot(slot);
  return loaded === null ? newGame(Date.now()) : restore(loaded.file);
}

let state = loadInitialState();

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (!canvas) throw new Error('main: #screen canvas is missing from index.html');
const screen = createScreen(canvas);

window.addEventListener('resize', () => screen.resize());
window.addEventListener('orientationchange', () => {
  screen.resize();
  setTimeout(() => screen.resize(), 60);
});

// ---------------------------------------------------------------------------
// Sound.
//
// Every browser refuses to start audio until the player has interacted with the
// page, so nothing is created here — `unlock()` builds the audio context on the
// first real keypress or tap, and does nothing at all until then. A tab that
// never gets a press stays silent instead of logging an autoplay error.
// ---------------------------------------------------------------------------

const audio = createAudio(content);

const soundButton = document.querySelector<HTMLButtonElement>('#sound-button');

function paintSoundButton(): void {
  if (!soundButton) return;
  soundButton.textContent = audio.enabled ? 'SOUND ON' : 'SOUND OFF';
  soundButton.setAttribute('aria-pressed', audio.enabled ? 'true' : 'false');
}

soundButton?.addEventListener('click', () => {
  audio.setEnabled(!audio.enabled);
  paintSoundButton();
});
paintSoundButton();

// ---------------------------------------------------------------------------
// Input — keyboard and on-screen touch controls both just add/remove names
// from `held`; `currentButtons()` snapshots it into the `Buttons` the reducer
// expects.
// ---------------------------------------------------------------------------

const BUTTON_NAMES: ReadonlySet<string> = new Set<ButtonName>([
  'up', 'down', 'left', 'right', 'a', 'b', 'start', 'select',
]);

function isButtonName(s: string | undefined): s is ButtonName {
  return s !== undefined && BUTTON_NAMES.has(s);
}

const held = new Set<ButtonName>();

function currentButtons(): Buttons {
  return {
    up: held.has('up'),
    down: held.has('down'),
    left: held.has('left'),
    right: held.has('right'),
    a: held.has('a'),
    b: held.has('b'),
    start: held.has('start'),
    select: held.has('select'),
  };
}

const KEY_MAP: Readonly<Record<string, ButtonName>> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyZ: 'a', KeyJ: 'a',
  KeyX: 'b', KeyK: 'b',
  Enter: 'start', NumpadEnter: 'start',
  ShiftLeft: 'select', ShiftRight: 'select',
};

window.addEventListener('keydown', (e) => {
  const btn = KEY_MAP[e.code];
  if (!btn) return;
  audio.unlock();
  held.add(btn);
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  const btn = KEY_MAP[e.code];
  if (!btn) return;
  held.delete(btn);
  e.preventDefault();
});
// A held key stops registering if focus leaves the page mid-press (alt-tab,
// a touch scroll) — drop everything rather than leave a phantom d-pad input.
window.addEventListener('blur', () => held.clear());

function bindTouchButton(el: Element, name: ButtonName): void {
  const press = (e: Event): void => {
    audio.unlock();
    held.add(name);
    e.preventDefault();
  };
  const release = (e: Event): void => {
    held.delete(name);
    e.preventDefault();
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
}

for (const el of document.querySelectorAll<HTMLElement>('[data-button]')) {
  const name = el.dataset['button'];
  if (isButtonName(name)) bindTouchButton(el, name);
}

// ---------------------------------------------------------------------------
// The starter picker — game.ts deliberately hands this one interaction to the
// shell (see its `chooseStarter`/`starterPick` comment) rather than modelling
// it as a Scene. `starterCursor` is local, ephemeral UI state; core play is
// paused (no `step()` calls) for the one or two seconds this is on screen.
// ---------------------------------------------------------------------------

let starterCursor = 0;
let pickerPrev: Buttons = currentButtons();

function inStarterPicker(s: GameState): boolean {
  return s.player.starter === '' && s.scene.kind === 'overworld';
}

function advance(buttons: Buttons): void {
  if (inStarterPicker(state)) {
    if (buttons.left && !pickerPrev.left) {
      starterCursor = (starterCursor + STARTERS.length - 1) % STARTERS.length;
    }
    if (buttons.right && !pickerPrev.right) {
      starterCursor = (starterCursor + 1) % STARTERS.length;
    }
    if (buttons.a && !pickerPrev.a) {
      const picked = STARTERS[starterCursor];
      if (picked) chooseStarter(content, state, picked);
    }
    audio.observe(state);
    pickerPrev = buttons;
    return;
  }
  state = step(content, state, buttons);

  // Read-only observation hook for scripts/shots.ts and gauntlet:visual. It
  // exposes what the game is currently showing so a screenshot run can tell a
  // battle from a menu. It deliberately offers no way to SET anything: a
  // screenshot suite that can stage its own scenes proves nothing about the game.
  (
    window as unknown as {
      __fenmark: { scene: string; map: string; x: number; y: number; frame: number };
    }
  ).__fenmark = {
    scene: state.scene.kind,
    map: state.player.mapId,
    x: state.player.x,
    y: state.player.y,
    frame: state.frame,
  };
  // Sound reads the state the same way the renderer does, once per simulation
  // tick rather than once per painted frame - an event that lasts a single tick
  // would otherwise be missed on a slow frame, or played twice on a fast one.
  audio.observe(state);

  if (state.saveRequested) store.write(serialize(state));
  maybeAutosave();
}

// ---------------------------------------------------------------------------
// Autosave.
//
// A Game Boy could assume the player chose to stop. A tab cannot: it gets
// closed, backgrounded until the OS reclaims it, or reloaded by accident. The
// autosave lives on its own key and never overwrites a deliberate save, so the
// worst it can do is offer a NEWER state than the one the player last wrote.
//
// Only written from the overworld: mid-battle and mid-dialogue states collapse
// on restore anyway (see save.ts), so autosaving there would quietly rewind the
// player to the start of the fight and look like a bug.
// ---------------------------------------------------------------------------

const AUTOSAVE_EVERY = 60 * 30; // frames — every 30 seconds
let lastAutosave = 0;

function autosaveable(s: GameState): boolean {
  return s.scene.kind === 'overworld' && s.player.starter !== '';
}

function maybeAutosave(): void {
  if (!autosaveable(state)) return;
  if (state.frame - lastAutosave < AUTOSAVE_EVERY) return;
  lastAutosave = state.frame;
  store.autosave(serialize(state));
}

/** Last-moment autosave. `visibilitychange` is the only one phones reliably fire. */
function autosaveNow(): void {
  if (autosaveable(state)) store.autosave(serialize(state));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosaveNow();
});
window.addEventListener('pagehide', autosaveNow);

// ---------------------------------------------------------------------------
// Save panel — slots and transfer codes, outside the DMG screen.
// ---------------------------------------------------------------------------

const panel = createSavePanel({
  getState: () => state,
  loadFile: (file: SaveFile) => {
    state = restore(file);
    lastAutosave = state.frame;
    store.write(serialize(state));
  },
  switchSlot: (next: number) => {
    // Preserve the outgoing slot before leaving it, or switching away loses
    // whatever happened since the last manual save.
    autosaveNow();
    slot = next;
    setActiveSlot(next);
    state = loadInitialState();
    lastAutosave = state.frame;
  },
});

const savesButton = document.querySelector<HTMLButtonElement>('#saves-button');
savesButton?.addEventListener('click', () => panel.open());

// ---------------------------------------------------------------------------
// Fixed-timestep loop: simulate at exactly 1/60s per tick, render once per
// animation frame. Falling behind (a backgrounded tab) drops extra ticks
// instead of spiralling to catch up.
// ---------------------------------------------------------------------------

const STEP_MS = 1000 / 60;
const MAX_CATCHUP_TICKS = 5;

let accumulator = 0;
let lastTime = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);

  const delta = Math.min(250, now - lastTime);
  lastTime = now;
  accumulator += delta;

  let ticks = 0;
  while (accumulator >= STEP_MS && ticks < MAX_CATCHUP_TICKS) {
    advance(currentButtons());
    accumulator -= STEP_MS;
    ticks++;
  }
  if (ticks === MAX_CATCHUP_TICKS) accumulator = 0;

  // How far into the NEXT simulation tick this painted frame sits. Without it a
  // frame that ran no tick redraws the previous position and the walk visibly
  // stutters; the display refresh and the fixed timestep never line up exactly.
  setFrameAlpha(accumulator / STEP_MS);
  draw(screen.ctx, content, state, starterCursor);

  // Publish what was actually drawn, and how many simulation ticks this painted
  // frame consumed. Both are read-only diagnostics for measuring smoothness
  // from outside; nothing in the game reads them.
  const hook = (window as unknown as { __fenmark?: Record<string, unknown> }).__fenmark;
  if (hook) {
    const p = drawnPlayerPos();
    hook['px'] = p.x;
    hook['py'] = p.y;
    hook['ticks'] = ticks;
  }
  screen.present();
}

requestAnimationFrame(frame);
