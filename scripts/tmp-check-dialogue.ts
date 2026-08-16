import { DIALOGUE, getDialogue } from '../src/data/dialogue.gen.ts';

const ALLOWED = /^[A-Za-z0-9 .,!?'":;/()-]*$/;
const required: string[] = ['intro', 'starter_offer', 'starter_winter', 'starter_baloo', 'starter_plato'];
required.push('rival_intro', 'rival_final', 'rival_final_defeat');
for (let i = 1; i <= 5; i++) { required.push(`rival_${i}`, `rival_${i}_defeat`); }
for (let i = 1; i <= 8; i++) { required.push(`gym${i}_intro`, `gym${i}_defeat`, `gym${i}_after`); }
for (let i = 1; i <= 4; i++) { required.push(`elite_${i}`, `elite_${i}_defeat`); }
required.push('champion_intro', 'champion_defeat', 'hall_of_fame');
required.push('lodge_heal', 'shop_greet', 'shop_buy', 'shop_leave', 'blackout');
for (let i = 1; i <= 12; i++) { required.push(`npc_gossip_${i}`); }
for (let i = 1; i <= 6; i++) { required.push(`sign_${i}`); }
required.push('catch_success', 'catch_fail', 'box_full', 'evolve', 'badge_get');

const errs: string[] = [];
for (const k of required) {
  if (!(k in DIALOGUE)) errs.push(`MISSING KEY: ${k}`);
}
let lineCount = 0;
let maxLen = 0;
for (const [k, v] of Object.entries(DIALOGUE)) {
  if (!Array.isArray(v) || v.length === 0) { errs.push(`EMPTY: ${k}`); continue; }
  v.forEach((s, i) => {
    lineCount++;
    if (typeof s !== 'string') { errs.push(`NOT STRING: ${k}[${i}]`); return; }
    if (s.length === 0) errs.push(`BLANK: ${k}[${i}]`);
    if (s.length > 108) errs.push(`LONG (${s.length}): ${k}[${i}] ${s}`);
    maxLen = Math.max(maxLen, s.length);
    if (!ALLOWED.test(s)) {
      const bad = [...s].filter((c) => !ALLOWED.test(c)).join('');
      errs.push(`CHARS [${bad}]: ${k}[${i}] ${s}`);
    }
    for (const w of s.split(' ')) {
      if (w.length > 18) errs.push(`WORD ${w.length}: ${k}[${i}] "${w}"`);
    }
  });
}
const ph = getDialogue('definitely_not_a_key');
if (ph.length !== 1) errs.push('placeholder shape wrong');
const extras = Object.keys(DIALOGUE).filter((k) => !required.includes(k));
console.log(`keys=${Object.keys(DIALOGUE).length} lines=${lineCount} maxLen=${maxLen} required=${required.length}`);
if (extras.length) console.log('extra keys:', extras.join(', '));
if (errs.length) { console.log('\n' + errs.join('\n')); process.exit(1); }
console.log('ALL CHECKS PASS');
