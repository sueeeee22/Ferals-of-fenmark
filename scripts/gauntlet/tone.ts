/**
 * gauntlet:tone — everything about the writing that a machine can decide.
 *
 * The expensive judgement (is it funny, is it horny, does the joke land at the
 * end of the line) belongs to a human critic and is recorded in TONE_REPORT.md.
 * This gate exists so that no critic's attention is ever spent on something a
 * regex could have caught: a key that renders as a placeholder mid-battle, a
 * line the 8x8 font cannot draw, a box that overruns the window, or a sentence
 * lifted straight out of a children's script.
 *
 * The last section reads TONE_REPORT.md and fails if the critic recorded a
 * hard-line violation that was never resolved.
 *
 * Exit 0 or nothing advances.
 */
import { readFileSync } from 'node:fs';
import { DIALOGUE } from '../../src/data/dialogue.gen.ts';
import { TRAINERS } from '../../src/data/trainers.gen.ts';
import { MAPS } from '../../src/data/maps.gen.ts';

const ROOT = new URL('../..', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Report plumbing
// ---------------------------------------------------------------------------

let failures = 0;
let warnings = 0;

function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

function warn(msg: string): void {
  warnings++;
  console.error(`  WARN  ${msg}`);
}

function section(title: string): { done: () => void } {
  console.log(`\n--- ${title} ---`);
  const start = failures;
  return {
    done: () => {
      const delta = failures - start;
      console.log(delta === 0 ? '  ok' : `  ${delta} problem(s) in this section`);
    },
  };
}

/** Trim a line for a one-line report row. */
function snip(line: string, max = 64): string {
  return line.length <= max ? line : `${line.slice(0, max - 3)}...`;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** One text box. The window draws three rows of ~36 columns. */
const MAX_LINE = 108;

/**
 * The 8x8 font sheet. Anything outside this draws as a blank cell, so a curly
 * quote or an em dash from a word processor is a silent hole in the sentence.
 */
const ALLOWED = /^[A-Za-z0-9 .,!?'"\-:;/()]*$/;
const ALLOWED_CHAR = /[A-Za-z0-9 .,!?'"\-:;/()]/;

/** Below this, a line is far more likely to be a stub than a beat. */
const SHORT_LINE = 15;

/**
 * The narrative spine. Every one of these is reachable from the reducer, the
 * map tables or a service screen; deleting one leaves a hole in the game that
 * only shows up when a player walks into it.
 */
const REQUIRED_KEYS: readonly string[] = [
  'intro',
  'starter_offer', 'starter_winter', 'starter_baloo', 'starter_plato',
  'rival_intro',
  'rival_1', 'rival_1_defeat', 'rival_2', 'rival_2_defeat', 'rival_3', 'rival_3_defeat',
  'rival_4', 'rival_4_defeat', 'rival_5', 'rival_5_defeat',
  'rival_final', 'rival_final_defeat',
  'gym1_intro', 'gym1_defeat', 'gym1_after',
  'gym2_intro', 'gym2_defeat', 'gym2_after',
  'gym3_intro', 'gym3_defeat', 'gym3_after',
  'gym4_intro', 'gym4_defeat', 'gym4_after',
  'gym5_intro', 'gym5_defeat', 'gym5_after',
  'gym6_intro', 'gym6_defeat', 'gym6_after',
  'gym7_intro', 'gym7_defeat', 'gym7_after',
  'gym8_intro', 'gym8_defeat', 'gym8_after',
  'elite_1', 'elite_1_defeat', 'elite_2', 'elite_2_defeat',
  'elite_3', 'elite_3_defeat', 'elite_4', 'elite_4_defeat',
  'champion_intro', 'champion_defeat', 'hall_of_fame',
  'lodge_heal', 'shop_greet', 'shop_buy', 'shop_leave', 'blackout',
  'catch_success', 'catch_fail', 'box_full', 'evolve', 'badge_get',
  'sign_1', 'sign_2', 'sign_3', 'sign_4', 'sign_5', 'sign_6',
  'npc_gossip_1', 'npc_gossip_2', 'npc_gossip_3', 'npc_gossip_4',
  'npc_gossip_5', 'npc_gossip_6', 'npc_gossip_7', 'npc_gossip_8',
  'npc_gossip_9', 'npc_gossip_10', 'npc_gossip_11', 'npc_gossip_12',
];

/**
 * Phrases that only ever appear in a children's monster-catching script. Some
 * are the literal tells from TONE.md; the rest were collected by reading all
 * 325 boxes and asking, for each cliche, whether a dangerous adult mid-agenda
 * would ever say it out loud. None of them survive contact with House Brack.
 *
 * Matching is case-insensitive on the raw text. Keep the entries short so a
 * rephrasing does not slip past: "the power of" catches every noun after it.
 */
const BANNED_PHRASES: readonly string[] = [
  // TONE.md's own named failures.
  'trained hard', 'train hard', 'believe in', 'friendship', 'never give up',
  'you can do it', 'the power of', 'our bond', 'gotta', "let's go!",
  // The same script with the serial numbers filed off.
  'best friend', 'true friend', 'trust in', 'deep down', 'heart of a',
  'with all my heart', 'give it your all', 'do your best', 'i choose you',
  'special bond', 'we make a great team', 'together we', 'you and me',
  'my precious', 'so cute', 'adorable', 'super effective!',
  'i knew you could', 'proud of you', 'you did it!', 'that was amazing!',
  'dreams come true', 'follow your dream', 'one day i will be', 'the very best',
  'no matter what', 'stronger together', 'the bond between',
  // Explaining the bit, which TONE.md bans outright.
  'that was inappropriate', 'if you know what i mean', 'no pun intended',
  'awkward!', 'just saying', 'anyway, moving on',
  // Stage directions doing the joke's job.
  '(sarcastically)', '(sarcastic)', '(winks)', '(laughs)', '(nervously)',
  '(awkward pause)', '*wink*',
  // Vagueness where TONE.md demands a name and an injury.
  'a nobleman', 'a certain someone', 'some guy', 'a mysterious stranger',
];

/** Anything here is scaffolding somebody forgot to replace. */
const PLACEHOLDERS: readonly string[] = [
  '...', '..', 'tbd', 'todo', 'fixme', 'xxx', 'placeholder', 'lorem ipsum',
  'write me', 'wip', 'n/a', 'text here', 'insert', '???',
];

console.log('\n=== GAUNTLET 7: TONE ===\n');
console.log(`  ${Object.keys(DIALOGUE).length} keys in the dialogue table`);

// ---------------------------------------------------------------------------
// 1. Shape: every required key exists, non-empty, all strings non-empty
// ---------------------------------------------------------------------------

{
  const s = section('shape');

  for (const key of REQUIRED_KEYS) {
    const lines = DIALOGUE[key];
    if (lines === undefined) {
      fail(`required key '${key}' is missing from DIALOGUE`);
      continue;
    }
    if (!Array.isArray(lines)) {
      fail(`'${key}' is not an array of text boxes`);
      continue;
    }
    if (lines.length === 0) fail(`'${key}' is an empty array - it would render as nothing`);
  }

  for (const [key, lines] of Object.entries(DIALOGUE)) {
    if (lines.length === 0) {
      fail(`'${key}' has no text boxes`);
      continue;
    }
    for (const [i, line] of lines.entries()) {
      if (typeof line !== 'string') {
        fail(`'${key}'[${i}] is not a string`);
        continue;
      }
      if (line.trim().length === 0) fail(`'${key}'[${i}] is blank`);
    }
  }

  s.done();
}

// ---------------------------------------------------------------------------
// 2. The font and the window
// ---------------------------------------------------------------------------

{
  const s = section(`font and box width (max ${MAX_LINE} chars)`);
  let longest = 0;

  for (const [key, lines] of Object.entries(DIALOGUE)) {
    for (const [i, line] of lines.entries()) {
      if (line.length > longest) longest = line.length;
      if (line.length > MAX_LINE) {
        fail(`'${key}'[${i}] is ${line.length} chars (max ${MAX_LINE}): ${snip(line)}`);
      }
      if (!ALLOWED.test(line)) {
        const bad = [...line].filter((c) => !ALLOWED_CHAR.test(c));
        const shown = [...new Set(bad)]
          .map((c) => `'${c}' (U+${c.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') ?? '????'})`)
          .join(', ');
        fail(`'${key}'[${i}] uses characters the font cannot draw: ${shown}`);
      }
    }
  }

  console.log(`  longest box: ${longest} chars`);
  s.done();
}

// ---------------------------------------------------------------------------
// 3. Copy-paste tells
// ---------------------------------------------------------------------------

{
  const s = section('duplicate lines across keys');
  const seen = new Map<string, string[]>();

  for (const [key, lines] of Object.entries(DIALOGUE)) {
    for (const line of lines) {
      const norm = line.trim().toLowerCase();
      const owners = seen.get(norm);
      if (owners === undefined) seen.set(norm, [key]);
      else owners.push(key);
    }
  }

  for (const [line, owners] of seen) {
    if (owners.length > 1) {
      fail(`line appears in ${owners.join(', ')}: ${snip(line)}`);
    }
  }

  s.done();
}

// ---------------------------------------------------------------------------
// 4. Placeholders and stubs
// ---------------------------------------------------------------------------

{
  const s = section('placeholders and stubs');
  const shortLines: string[] = [];

  for (const [key, lines] of Object.entries(DIALOGUE)) {
    for (const [i, line] of lines.entries()) {
      const norm = line.trim().toLowerCase();
      if (PLACEHOLDERS.includes(norm)) {
        fail(`'${key}'[${i}] is a placeholder: "${line}"`);
      }
      if (line.trim().length < SHORT_LINE) shortLines.push(`'${key}'[${i}] "${line}"`);
    }

    // A key whose every box is tiny is a stub. A single short box inside a
    // longer block is a beat ("TABITHA: Dara.") and deliberately not failed -
    // this gate refuses to delete craft to satisfy its own regex, so short
    // boxes are listed below for the critic instead.
    if (lines.every((l) => l.trim().length < SHORT_LINE)) {
      fail(`'${key}' is all short boxes - probable stub: ${lines.map((l) => `"${l}"`).join(' ')}`);
    }
  }

  if (shortLines.length > 0) {
    console.log(`  ${shortLines.length} short box(es) - deliberate beats, check by eye:`);
    for (const row of shortLines) console.log(`    ${row}`);
  }

  s.done();
}

// ---------------------------------------------------------------------------
// 5. Banned phrases - the actual Pokemon script, leaking in
// ---------------------------------------------------------------------------

{
  const s = section('banned phrases');

  for (const [key, lines] of Object.entries(DIALOGUE)) {
    for (const [i, line] of lines.entries()) {
      const hay = line.toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        if (hay.includes(phrase)) {
          fail(`'${key}'[${i}] contains banned phrase "${phrase}": ${snip(line)}`);
        }
      }
    }
  }

  s.done();
}

// ---------------------------------------------------------------------------
// 6. Reachability - a missing key renders as a placeholder mid-scene
// ---------------------------------------------------------------------------

/**
 * Mirrors interactWithNpc() in src/core/game.ts. A battle npc that carries a
 * team never speaks its own `dialogue` field - the reducer uses the trainer's
 * introKey instead - but it does speak `<dialogue>_after` once its flag is set.
 * Checking the literal base key for those npcs would demand nine keys the game
 * can never reach; checking what the reducer actually looks up finds the bugs.
 */
const BATTLE_KINDS: ReadonlySet<string> = new Set(['trainer', 'rival', 'leader']);

{
  const s = section('every referenced key resolves');

  for (const [id, def] of Object.entries(TRAINERS)) {
    if (DIALOGUE[def.introKey] === undefined) {
      fail(`trainer '${id}' introKey '${def.introKey}' has no dialogue - renders as a placeholder`);
    }
    if (DIALOGUE[def.defeatKey] === undefined) {
      fail(`trainer '${id}' defeatKey '${def.defeatKey}' has no dialogue - renders as a placeholder`);
    }
  }

  const shadowed: string[] = [];

  for (const map of Object.values(MAPS)) {
    for (const npc of map.npcs) {
      const where = `${map.id}/${npc.id}`;
      const battle = BATTLE_KINDS.has(npc.kind);

      if (battle && npc.team !== undefined) {
        // Base key is unreachable here; the trainer's introKey is checked above.
        if (DIALOGUE[npc.dialogue] === undefined) shadowed.push(`${where} -> '${npc.dialogue}'`);
      } else if (DIALOGUE[npc.dialogue] === undefined) {
        fail(`${where} dialogue '${npc.dialogue}' has no entry - renders as a placeholder`);
      }

      // Every battle npc with a flag gets talked to again after it is beaten.
      if (battle && npc.flag !== undefined) {
        const after = `${npc.dialogue}_after`;
        if (DIALOGUE[after] === undefined) {
          fail(`${where} needs '${after}' for the post-defeat line - renders as a placeholder`);
        }
      }
    }
  }

  if (shadowed.length > 0) {
    console.log(`  ${shadowed.length} base key(s) shadowed by a trainer introKey (unreachable, not a bug):`);
    for (const row of [...new Set(shadowed)]) console.log(`    ${row}`);
  }

  s.done();
}

// ---------------------------------------------------------------------------
// 7. Orphans - written, paid for, never seen
// ---------------------------------------------------------------------------

{
  section('orphaned keys (advisory)');

  const referenced = new Set<string>();
  for (const def of Object.values(TRAINERS)) {
    referenced.add(def.introKey);
    referenced.add(def.defeatKey);
  }
  for (const map of Object.values(MAPS)) {
    for (const npc of map.npcs) {
      referenced.add(npc.dialogue);
      referenced.add(`${npc.dialogue}_after`);
    }
  }
  // Keys the reducer and the service screens look up by literal.
  for (const key of [
    'intro', 'starter_offer', 'starter_winter', 'starter_baloo', 'starter_plato',
    'hall_of_fame', 'blackout', 'shop_buy', 'shop_leave',
    'catch_success', 'catch_fail', 'box_full', 'evolve', 'badge_get',
    'sign_1', 'sign_2', 'sign_3', 'sign_4', 'sign_5', 'sign_6',
  ]) {
    referenced.add(key);
  }

  const orphans = Object.keys(DIALOGUE).filter((k) => !referenced.has(k));
  if (orphans.length > 0) {
    warn(`${orphans.length} key(s) written but never referenced: ${orphans.join(', ')}`);
  } else {
    console.log('  ok');
  }
}

// ---------------------------------------------------------------------------
// 8. The critic's report
// ---------------------------------------------------------------------------

/**
 * The three hard lines from TONE.md cannot be checked by a regex - a machine
 * cannot tell an adult from a description of one. What a machine can do is
 * refuse to pass while the critic's report still records an open violation.
 */
const HARD_LINE_OPEN = /^\s*(?:[-*]\s*)?(?:HARD-?LINE|HARD LINE)[^\n]*\bUNRESOLVED\b/im;

{
  const s = section('TONE_REPORT.md');
  let report: string | null = null;
  try {
    report = readFileSync(`${ROOT}TONE_REPORT.md`, 'utf8');
  } catch {
    fail('TONE_REPORT.md is missing - the writing has not been graded');
  }

  if (report !== null) {
    if (report.trim().length < 400) {
      fail('TONE_REPORT.md is too short to be a real grading pass');
    }
    if (HARD_LINE_OPEN.test(report)) {
      const line = report.split('\n').find((l) => HARD_LINE_OPEN.test(l))?.trim() ?? '';
      fail(`TONE_REPORT.md records an unresolved hard-line violation: ${snip(line, 90)}`);
    }
    if (!/HARD-LINE 1[\s\S]*HARD-LINE 2[\s\S]*HARD-LINE 3/i.test(report)) {
      fail('TONE_REPORT.md does not rule on all three hard lines (expects HARD-LINE 1/2/3)');
    }
  }

  s.done();
}

// ---------------------------------------------------------------------------

const boxes = Object.values(DIALOGUE).reduce((n, lines) => n + lines.length, 0);
const chars = Object.values(DIALOGUE)
  .flatMap((lines) => [...lines])
  .reduce((n, line) => n + line.length, 0);

console.log('\n  corpus:');
console.log(`    keys       ${Object.keys(DIALOGUE).length}`);
console.log(`    text boxes ${boxes}`);
console.log(`    characters ${chars}`);
console.log(`    mean box   ${boxes === 0 ? 0 : Math.round(chars / boxes)} chars`);

console.log(
  failures === 0
    ? `\nGAUNTLET 7 PASS${warnings > 0 ? ` (${warnings} warning(s))` : ''}\n`
    : `\nGAUNTLET 7 FAIL - ${failures} problem(s), ${warnings} warning(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
