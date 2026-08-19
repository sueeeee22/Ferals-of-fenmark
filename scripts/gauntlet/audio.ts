/**
 * GAUNTLET 9: AUDIO.
 *
 * Renders every song and every sound effect through the real chip into an
 * OfflineAudioContext, then MEASURES the samples that come out.
 *
 * This gate exists because of a pattern that has bitten this project
 * repeatedly: the automated checks read the game's DATA, and the player
 * experiences its OUTPUT. Note patterns that parse perfectly, in the right key,
 * on the right beat, will happily render total silence if an envelope is wrong,
 * a bus is unconnected, or a wave table sums to zero — and every data-level
 * check would still pass. So this one listens.
 *
 * What it asserts, per song:
 *   - it is audible at all (RMS above the floor)
 *   - it does not clip (peak within range)
 *   - it is not a drone (the level actually varies across the loop, which is
 *     what tells a piece of music apart from a stuck oscillator)
 *   - it has bass AND treble (a spectrum check catches a whole channel silently
 *     failing to play — the bug that would otherwise be "the drums are missing"
 *     three weeks later)
 *
 * Run: npx tsx scripts/gauntlet/audio.ts
 */
import { launchBrowser } from '../../tests/browser.ts';
import { createServer, type ViteDevServer } from 'vite';

interface Measured {
  readonly name: string;
  readonly rms: number;
  readonly peak: number;
  /** Spread of per-100ms loudness. Flat means it is not music. */
  readonly variation: number;
  /** Share of total energy below and above the split. */
  readonly low: number;
  readonly high: number;
}

interface Effect {
  readonly name: string;
  readonly rms: number;
  readonly peak: number;
  /** Seconds until the tail drops below audibility. */
  readonly dur: number;
}

interface Report {
  readonly songs: readonly Measured[];
  readonly effects: readonly Effect[];
}

interface Tap {
  readonly contexts: number;
  readonly oscillators: number;
  readonly buffers: number;
  readonly state: string;
}

/**
 * Installed before the game's own scripts run. Counts what the game asks the
 * audio hardware for, without the game knowing it is being watched — no test
 * hook in `src/`, and nothing to leave switched on in production.
 */
const TAP = `
window.__tap = { contexts: 0, oscillators: 0, buffers: 0, state: 'none' };
const Real = window.AudioContext;
window.AudioContext = function (...args) {
  const ctx = new Real(...args);
  window.__tap.contexts++;
  const osc = ctx.createOscillator.bind(ctx);
  const buf = ctx.createBufferSource.bind(ctx);
  ctx.createOscillator = () => { window.__tap.oscillators++; window.__tap.state = ctx.state; return osc(); };
  ctx.createBufferSource = () => { window.__tap.buffers++; window.__tap.state = ctx.state; return buf(); };
  return ctx;
};
window.AudioContext.prototype = Real.prototype;
`;

/**
 * Rendered inside the page. Imports the REAL modules through vite, drives them
 * with the REAL Player and Sfx, and returns measurements of the actual samples.
 */
const ANALYSIS = `
import { Apu } from '/src/audio/apu.ts';
import { Player } from '/src/audio/song.ts';
import { Sfx } from '/src/audio/sfx.ts';
import { LATIN_SONGS } from '/src/audio/latin.ts';
import { BATTLE_SONGS } from '/src/audio/battle.ts';

const SR = 44100;
const SECONDS = 8;

function measure(d) {
  let sum = 0, peak = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const rms = Math.sqrt(sum / d.length);

  const win = 4410;
  const levels = [];
  for (let i = 0; i + win < d.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += d[i + j] * d[i + j];
    levels.push(Math.sqrt(s / win));
  }
  const mean = levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length);
  const variation = Math.sqrt(levels.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, levels.length));

  // One-pole lowpass splits bass from the rest. Enough to prove that no whole
  // channel has quietly stopped sounding.
  let lp = 0, lowSum = 0, highSum = 0;
  const a = 0.04;
  for (let i = 0; i < d.length; i++) {
    lp += a * (d[i] - lp);
    lowSum += lp * lp;
    highSum += (d[i] - lp) * (d[i] - lp);
  }
  const total = lowSum + highSum || 1;
  return { rms, peak, variation, low: lowSum / total, high: highSum / total };
}

const songs = [];
for (const song of [...LATIN_SONGS, ...BATTLE_SONGS]) {
  const ctx = new OfflineAudioContext(1, SR * SECONDS, SR);
  const player = new Player(new Apu(ctx));
  player.renderAll(song, SECONDS);
  const buf = await ctx.startRendering();
  songs.push({ name: song.name, ...measure(buf.getChannelData(0)) });
}

const NAMES = [
  'cursor', 'confirm', 'cancel', 'text', 'hit_weak', 'hit', 'hit_hard',
  'hit_crit', 'super', 'resist', 'immune', 'miss', 'faint', 'heal',
  'stat_up', 'stat_down', 'status', 'levelup', 'snare_throw', 'snare_land',
  'wobble', 'snare_click', 'snare_break', 'encounter', 'door', 'ledge',
  'bump', 'save', 'badge', 'flee', 'menu',
];
const effects = [];
for (const name of NAMES) {
  const ctx = new OfflineAudioContext(1, SR, SR);
  new Sfx(new Apu(ctx)).play(name);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let sum = 0, peak = 0, last = 0;
  for (let i = 0; i < d.length; i++) {
    sum += d[i] * d[i];
    if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
    if (Math.abs(d[i]) > 0.004) last = i;
  }
  effects.push({ name, rms: Math.sqrt(sum / d.length), peak, dur: last / SR });
}

window.__fenmarkAudio = { songs, effects };
`;

const RMS_FLOOR = 0.01;
const PEAK_CEILING = 1.0;
/**
 * The line below which an effect cannot be heard over the music.
 *
 * Not an arbitrary "is it zero" check: the first run of this gate measured the
 * songs peaking around 0.4 and the menu blip at 0.013, which is technically
 * sound and practically silence. This floor is set where an effect is actually
 * audible against a playing track.
 */
const SFX_FLOOR = 0.02;

let failures = 0;

function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

async function main(): Promise<void> {
  console.log('\n=== GAUNTLET 9: AUDIO ===\n');

  let server: ViteDevServer | null = null;
  const browser = await launchBrowser();
  try {
    // Served from the root, not the GitHub Pages subpath: the injected module
    // imports by absolute path and would 404 against the default base.
    server = await createServer({ base: '/', server: { port: 5199 }, logLevel: 'error' });
    await server.listen();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => {
      errors.push(String(e));
      console.error(`  [page error] ${String(e)}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`  [console] ${m.text()}`);
    });
    await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded' });

    // The browser-side work travels as TEXT rather than as a `page.evaluate`
    // callback. Vite's "/src/..." specifiers cannot be resolved by tsc, and
    // suppressing the type checker is banned outright by gauntlet:types — so
    // the analysis is injected as a module and its results collected after.
    await page.addScriptTag({ type: 'module', content: ANALYSIS });
    await page.waitForFunction('window.__fenmarkAudio !== undefined', undefined, { timeout: 120000 });
    const result = await page.evaluate(
      () => (window as unknown as { __fenmarkAudio: Report }).__fenmarkAudio,
    );

    console.log('  songs:');
    console.log('    NAME                 RMS    PEAK   VARY   LOW    HIGH');
    for (const m of result.songs) {
      console.log(
        `    ${m.name.padEnd(20)} ${m.rms.toFixed(3)}  ${m.peak.toFixed(3)}  ` +
        `${m.variation.toFixed(3)}  ${(m.low * 100).toFixed(0).padStart(3)}%  ${(m.high * 100).toFixed(0).padStart(3)}%`,
      );
      if (m.rms < RMS_FLOOR) fail(`${m.name} is inaudible (rms ${m.rms.toFixed(4)})`);
      if (m.peak > PEAK_CEILING) fail(`${m.name} clips (peak ${m.peak.toFixed(3)})`);
      if (m.variation < 0.004) fail(`${m.name} has no dynamics - a drone, not music`);
      if (m.low < 0.02) fail(`${m.name} has no bass - a channel is not sounding`);
      if (m.high < 0.02) fail(`${m.name} has no treble - a channel is not sounding`);
    }

    console.log('\n  effects:');
    let quiet = 0;
    let longest = { name: '', dur: 0 };
    for (const e of result.effects) {
      if (e.peak < SFX_FLOOR) {
        fail(`sfx "${e.name}" peaks at ${e.peak.toFixed(4)} - inaudible under the music`);
        quiet++;
      }
      if (e.peak > PEAK_CEILING) fail(`sfx "${e.name}" clips (peak ${e.peak.toFixed(2)})`);
      // A sound that outlasts the message it describes stacks during a flurry.
      if (e.dur > 0.75) fail(`sfx "${e.name}" runs ${e.dur.toFixed(2)}s - too long to sit under battle text`);
      if (e.dur > longest.dur) longest = { name: e.name, dur: e.dur };
    }
    for (const e of [...result.effects].sort((a, b) => a.peak - b.peak).slice(0, 6)) {
      console.log(`    quietest: ${e.name.padEnd(12)} peak ${e.peak.toFixed(4)}  rms ${e.rms.toFixed(4)}`);
    }
    console.log(`    ${result.effects.length} effects rendered, ${quiet} silent`);
    console.log(`    longest: ${longest.name} at ${longest.dur.toFixed(2)}s`);

    await page.close();

    // --- Does the GAME actually make any of this happen? -------------------
    //
    // Everything above proves the chip and the songs work. It says nothing
    // about whether anything calls them — the exact gap that has let this
    // project ship an invisible sprite and a truncated text box with every
    // gate green. So: load the real game, press real keys, and count the
    // oscillators it creates.
    const live = await browser.newPage();
    const liveErrors: string[] = [];
    live.on('pageerror', (e) => liveErrors.push(String(e)));
    await live.addInitScript(TAP);
    await live.goto('http://127.0.0.1:5199/', { waitUntil: 'load' });
    await live.waitForTimeout(700);

    const before = await live.evaluate(
      () => (window as unknown as { __tap: Tap }).__tap.oscillators,
    );

    // Title -> intro. The first keypress is also what unlocks audio.
    for (let i = 0; i < 12; i++) {
      await live.keyboard.down('KeyZ');
      await live.waitForTimeout(70);
      await live.keyboard.up('KeyZ');
      await live.waitForTimeout(130);
    }
    await live.waitForTimeout(1500);

    const tap = await live.evaluate(() => (window as unknown as { __tap: Tap }).__tap);
    console.log('\n  the game, driven by real key presses:');
    console.log(`    audio contexts created ... ${tap.contexts}`);
    console.log(`    context state ............ ${tap.state}`);
    console.log(`    oscillators created ...... ${tap.oscillators} (${tap.oscillators - before} after input)`);
    console.log(`    noise sources created .... ${tap.buffers}`);

    if (tap.contexts === 0) fail('the game never created an audio context — nothing is wired up');
    if (tap.state !== 'running') fail(`audio context is "${tap.state}", not running`);
    if (tap.oscillators - before < 20) {
      fail(`only ${tap.oscillators - before} oscillators after 12 key presses — the music is not playing`);
    }
    if (tap.buffers === 0) fail('no noise sources — the percussion channel is silent');
    if (liveErrors.length > 0) fail(`page errors: ${liveErrors.slice(0, 3).join(' | ')}`);

    await live.close();

    if (errors.length > 0) fail(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close();
    await server?.close();
  }

  console.log(
    failures === 0 ? '\nGAUNTLET 9 PASS\n' : `\nGAUNTLET 9 FAIL — ${failures} problem(s)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
