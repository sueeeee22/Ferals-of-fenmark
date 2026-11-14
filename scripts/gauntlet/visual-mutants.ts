/**
 * Does `gauntlet:visual` actually catch anything?
 *
 * A gate that has only ever been seen passing proves nothing. This puts six old
 * bugs BACK, one at a time - the ones a player actually reported while every
 * data-level test was green - builds the game with each, and requires the gate
 * to go red for the right reason.
 *
 * Nothing in the working tree is touched. Each mutant is built from a copy of
 * the source in a temporary folder, and the gate is pointed at that build.
 *
 * Run: npm run gauntlet:visual:mutants        (about three minutes)
 *      npm run gauntlet:visual:mutants -- cut-off-text bars-ahead-of-text
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RULES, type Rule } from '../visual/checks.ts';
import { ROOT } from '../visual/stage.ts';

interface Edit {
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

interface Mutant {
  readonly id: string;
  /** What a player would have seen. */
  readonly bug: string;
  readonly edits: readonly Edit[];
  /** The rule that has to fail. */
  readonly rule: Rule;
  /** The last checkpoint the tour needs to reach to see it; omitted = whole tour. */
  readonly until?: string;
}

const DRAW = 'src/render/draw.ts';
const GB = 'src/render/gb.ts';
const GAME = 'src/core/game.ts';

/**
 * The six bugs a player actually hit. Deliberately a short list: each one is a
 * report that came back from playing the game, not a thing a test thought of.
 */
const MUTANTS: readonly Mutant[] = [
  {
    id: 'invisible-sprite',
    bug: 'the player vanished whenever she faced right',
    rule: 'actors',
    until: 'overworld-town',
    edits: [{
      file: GB,
      find: '  const left = Math.max(0, Math.min(x0, x1));\n  const right = Math.min(TS - 1, Math.max(x0, x1));',
      replace: '  const left = Math.max(0, x0);\n  const right = Math.min(TS - 1, x1);',
    }],
  },
  {
    id: 'cut-off-text',
    bug: 'names in battle were cut to four letters ("Wint")',
    rule: 'words',
    until: 'battle-wild',
    edits: [{
      file: DRAW,
      find: '  gb.drawText(ctx, nameX, box.y + 4, nameLabel(f.name), 3);',
      replace: '  gb.drawText(ctx, nameX, box.y + 4, nameLabel(f.name).slice(0, 4), 3);',
    }],
  },
  {
    id: 'bars-ahead-of-text',
    bug: 'both health bars emptied before the game had said who hit whom',
    rule: 'sync',
    until: 'battle-aftermath',
    edits: [{
      file: DRAW,
      find: '  const enemy = scene.shown.enemy;\n  const player = scene.shown.player;',
      replace:
        '  const enemy = { ...scene.shown.enemy, hp: activeOf(battle.enemy).hp };\n' +
        '  const player = { ...scene.shown.player, hp: activeOf(battle.player).hp };',
    }],
  },
  {
    id: 'wrong-scene-label',
    bug: 'a checkpoint was not the scene its name claims (SAVE silently did nothing)',
    rule: 'label',
    edits: [{ file: GAME, find: "    if (choice === 'SAVE') {", replace: "    if (choice === 'SAVE' && state.frame < 0) {" }],
  },
  {
    id: 'identical-starters',
    bug: 'Winter and Baloo were the same picture',
    rule: 'starters',
    until: 'starter-plato',
    edits: [{
      file: DRAW,
      find: '  const sp = content.dex.species(speciesId);\n  const px = spriteFor(',
      replace: "  const sp = content.dex.species(speciesId === 'baloo_pup' ? 'winter_pup' : speciesId);\n  const px = spriteFor(",
    }],
  },
  {
    id: 'blank-screen',
    bug: 'the game ran but the screen stayed blank',
    rule: 'colours',
    until: 'title',
    edits: [{
      file: GB,
      find: '    displayCtx.drawImage(logical, 0, 0, LOGICAL_W, LOGICAL_H, offX, offY, LOGICAL_W * scale, LOGICAL_H * scale);',
      replace: '    void logical;',
    }],
  },
];

// ---------------------------------------------------------------------------

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const chosen = only.length === 0 ? MUTANTS : MUTANTS.filter((m) => only.includes(m.id));

console.log('\n=== GAUNTLET 6, TESTED: does the visual gate catch the bugs it is for? ===\n');

const work = mkdtempSync(join(tmpdir(), 'fenmark-mutants-'));
for (const name of ['src', 'public']) cpSync(join(ROOT, name), join(work, name), { recursive: true });
for (const name of ['index.html', 'vite.config.ts', 'tsconfig.json', 'package.json']) cpSync(join(ROOT, name), join(work, name));
symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');

function buildMutant(): string | null {
  const run = spawnSync('npx', ['vite', 'build'], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, BASE_PATH: '/Ferals-of-fenmark/' },
  });
  return run.status === 0 ? null : (run.stderr || run.stdout || 'no output').trim().split('\n').slice(-6).join('\n');
}

function runGate(until: string | undefined): { code: number; out: string } {
  const run = spawnSync('npx', ['tsx', 'scripts/gauntlet/visual.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      VISUAL_DIST: join(work, 'dist'),
      VISUAL_NO_WRITE: '1',
      ...(until === undefined ? {} : { VISUAL_UNTIL: until }),
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: run.status ?? 1, out: `${run.stdout}${run.stderr}` };
}

let survived = 0;
let broken = 0;
try {
  for (const m of chosen) {
    const t0 = Date.now();
    // Apply to pristine source, so one mutant never inherits another.
    const touched = new Map<string, string>();
    let problem: string | null = null;
    for (const e of m.edits) {
      const pristine = readFileSync(join(ROOT, e.file), 'utf8');
      const current = touched.get(e.file) ?? pristine;
      if (current.split(e.find).length !== 2) {
        problem = `the text to change was found ${current.split(e.find).length - 1} times in ${e.file}, not once - the source has moved on and this mutant needs updating`;
        break;
      }
      touched.set(e.file, current.replace(e.find, e.replace));
    }
    if (problem === null) {
      for (const [file, text] of touched) writeFileSync(join(work, file), text);
      problem = buildMutant();
      if (problem !== null) problem = `it does not build:\n${problem}`;
    }

    let verdict: string;
    if (problem !== null) {
      broken++;
      verdict = `BROKEN MUTANT\n      ${problem.split('\n').join('\n      ')}`;
    } else {
      const { code, out } = runGate(m.until);
      const line = out.split('\n').find((l) => l.includes(`${RULES[m.rule]} ... FAIL`));
      if (code !== 0 && line !== undefined) {
        const at = out.split('\n').indexOf(line);
        const why = (out.split('\n')[at + 1] ?? '').trim();
        verdict = `caught  (${((Date.now() - t0) / 1000).toFixed(0)}s)\n      ${why.slice(0, 230)}`;
      } else {
        survived++;
        verdict = `NOT CAUGHT - the gate ${code === 0 ? 'passed' : `failed, but not on "${RULES[m.rule]}"`}`;
      }
    }
    console.log(`  ${m.id}: ${m.bug}\n    ... ${verdict}\n`);

    for (const file of touched.keys()) cpSync(join(ROOT, file), join(work, file));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (survived === 0 && broken === 0) {
  console.log(`ALL ${chosen.length} REINTRODUCED BUGS CAUGHT\n`);
  process.exit(0);
}
console.log(`${survived} bug(s) got past the gate, ${broken} mutant(s) need updating\n`);
process.exit(1);
