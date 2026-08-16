/**
 * The shell: boots the reducer + renderer, runs the fixed-timestep loop, and
 * maps keyboard/touch input to `Buttons`. Everything game-shaped lives in
 * `src/core`; everything drawing-shaped lives in `src/render`. This file is
 * just the glue that makes them run in a browser tab at 60fps.
 */
import './style.css';
import { createScreen } from './render/gb.ts';
import { draw } from './render/draw.ts';
import { content, usingPlaceholder } from './game/content.ts';
import {
  newGame, step, chooseStarter, STARTERS,
  type Buttons, type ButtonName, type GameState,
} from './core/game.ts';
import { SAVE_KEY, serialize, deserialize, restore, type SaveStore } from './core/save.ts';

if (Object.values(usingPlaceholder).some(Boolean)) {
  console.info('[content] placeholder data in use for:', usingPlaceholder);
}

// ---------------------------------------------------------------------------
// Save storage — localStorage, degrading to "no persistence" rather than
// throwing if it is unavailable (private browsing, storage quota, etc).
// ---------------------------------------------------------------------------

function localStorageStore(): SaveStore {
  return {
    read(): string | null {
      try {
        return window.localStorage.getItem(SAVE_KEY);
      } catch {
        return null;
      }
    },
    write(data: string): void {
      try {
        window.localStorage.setItem(SAVE_KEY, data);
      } catch {
        /* storage unavailable — play on without persistence */
      }
    },
    clear(): void {
      try {
        window.localStorage.removeItem(SAVE_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

const store = localStorageStore();

function loadInitialState(): GameState {
  const raw = store.read();
  if (raw) {
    const file = deserialize(raw);
    if (file) return restore(file);
  }
  return newGame(Date.now());
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
    pickerPrev = buttons;
    return;
  }
  state = step(content, state, buttons);
  if (state.saveRequested) store.write(serialize(state));
}

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

  draw(screen.ctx, content, state, starterCursor);
  screen.present();
}

requestAnimationFrame(frame);
