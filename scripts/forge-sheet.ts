/**
 * Renders the sprite contact sheet: every creature in the roster, at once, at
 * real pixel scale, so a critic can look at all of them and name the ones that
 * do not read as their animal.
 *
 * Emits:
 *   public/forge-sheet.png   the contact sheet
 *   forge.html               the browsable version, with names and animals
 *
 * Run: npm run forge:sheet
 */
import { writeFileSync } from 'node:fs';
import { encodePng } from './png.ts';
import { spriteFor, SPRITE_SIZE, DMG_PALETTE, type Pixels } from '../src/render/forge.ts';
import type { Family, Stage } from '../src/core/creature.ts';

interface Entry {
  id: string;
  name: string;
  animal: string;
  family: Family;
  stage: Stage;
  seed: number;
  legendary: boolean;
}

async function loadEntries(): Promise<Entry[]> {
  // Prefer the generated species table; fall back to the roster so the sheet is
  // usable before statlines exist, and to a starter-only smoke set before that.
  try {
    const mod: unknown = await import('../src/data/species.gen.ts');
    if (typeof mod === 'object' && mod !== null && 'SPECIES_LIST' in mod) {
      const list = (mod as { SPECIES_LIST: readonly Entry[] }).SPECIES_LIST;
      return list.map((s) => ({
        id: s.id, name: s.name, animal: s.animal, family: s.family,
        stage: s.stage, seed: (s as unknown as { spriteSeed: number }).spriteSeed,
        legendary: s.legendary ?? false,
      }));
    }
  } catch {
    /* not generated yet */
  }
  try {
    const mod: unknown = await import('./gen/roster.ts');
    if (typeof mod === 'object' && mod !== null && 'ROSTER' in mod) {
      const list = (mod as { ROSTER: readonly (Entry & { dexEntry: string })[] }).ROSTER;
      let h = 0x811c9dc5;
      return list.map((e) => {
        h = 0x811c9dc5;
        for (const ch of `sprite:${e.id}`) {
          h ^= ch.charCodeAt(0);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return {
          id: e.id, name: e.name, animal: e.animal, family: e.family,
          stage: e.stage, seed: h >>> 0, legendary: e.legendary ?? false,
        };
      });
    }
  } catch {
    /* not authored yet */
  }

  const smoke: ReadonlyArray<readonly [string, Family, Stage]> = [
    ['winter_pup', 'canid', 'pup'], ['winter_adult', 'canid', 'adult'], ['winter_apex', 'canid', 'apex'],
    ['baloo_pup', 'canid', 'pup'], ['baloo_adult', 'canid', 'adult'], ['baloo_apex', 'canid', 'apex'],
    ['plato_pup', 'felid', 'pup'], ['plato_adult', 'felid', 'adult'], ['plato_apex', 'felid', 'apex'],
    ['smoke_bear', 'ursid', 'adult'], ['smoke_eagle', 'bird', 'adult'], ['smoke_otter', 'mustelid', 'adult'],
    ['smoke_rat', 'rodent', 'adult'], ['smoke_deer', 'ungulate', 'adult'], ['smoke_lizard', 'reptile', 'adult'],
  ];
  return smoke.map(([id, family, stage], i) => ({
    id, name: id, animal: family, family, stage, seed: 1000 + i * 7919, legendary: false,
  }));
}

const entries = await loadEntries();

// --- Contact sheet ---------------------------------------------------------

const SCALE = 2;
const CELL = SPRITE_SIZE * SCALE + 6;
const COLS = Math.min(16, Math.ceil(Math.sqrt(entries.length * 1.4)));
const ROWS = Math.ceil(entries.length / COLS);
const W = COLS * CELL;
const H = ROWS * CELL;

const rgba = new Uint8Array(W * H * 4);
// Fill with the lightest DMG shade so sprites sit on the same ground the game uses.
const bg = DMG_PALETTE[0] ?? [224, 248, 208];
for (let i = 0; i < W * H; i++) {
  rgba[i * 4] = bg[0];
  rgba[i * 4 + 1] = bg[1];
  rgba[i * 4 + 2] = bg[2];
  rgba[i * 4 + 3] = 255;
}

function blit(px: Pixels, ox: number, oy: number): void {
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const idx = px[y * SPRITE_SIZE + x] ?? 0;
      if (idx === 0) continue;
      const c = DMG_PALETTE[idx] ?? [0, 0, 0];
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const dx = ox + x * SCALE + sx;
          const dy = oy + y * SCALE + sy;
          if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
          const o = (dy * W + dx) * 4;
          rgba[o] = c[0];
          rgba[o + 1] = c[1];
          rgba[o + 2] = c[2];
          rgba[o + 3] = 255;
        }
      }
    }
  }
}

const cards: string[] = [];
for (const [i, e] of entries.entries()) {
  const px = spriteFor(e.id, e.family, e.stage, e.seed, e.legendary);
  blit(px, (i % COLS) * CELL + 3, Math.floor(i / COLS) * CELL + 3);

  // Per-sprite data URI for forge.html, so the page is standalone.
  const one = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE * 4);
  for (let p = 0; p < SPRITE_SIZE * SPRITE_SIZE; p++) {
    const idx = px[p] ?? 0;
    const c = DMG_PALETTE[idx] ?? [0, 0, 0];
    one[p * 4] = c[0];
    one[p * 4 + 1] = c[1];
    one[p * 4 + 2] = c[2];
    one[p * 4 + 3] = idx === 0 ? 0 : 255;
  }
  const uri = `data:image/png;base64,${encodePng(SPRITE_SIZE, SPRITE_SIZE, one).toString('base64')}`;
  cards.push(
    `<figure class="c${e.legendary ? ' leg' : ''}"><img src="${uri}" alt="${e.name}">` +
      `<figcaption><b>${e.name}</b><span>${e.animal}</span>` +
      `<em>${e.family} · ${e.stage}</em></figcaption></figure>`,
  );
}

writeFileSync(new URL('../public/forge-sheet.png', import.meta.url).pathname, encodePng(W, H, rgba));

writeFileSync(
  new URL('../forge.html', import.meta.url).pathname,
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ferals of Fenmark — Sprite Forge Contact Sheet</title>
<style>
  :root { --bg:#0f1410; --card:#182018; --ink:#e0f8d0; --dim:#88c070; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--ink);
         font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
  h1 { font-size:18px; margin:0 0 4px; letter-spacing:.08em; text-transform:uppercase; }
  p.sub { color:var(--dim); margin:0 0 20px; }
  .grid { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); }
  .c { margin:0; background:var(--card); border:1px solid #2a3a2a; border-radius:6px;
       padding:8px; text-align:center; }
  .c.leg { border-color:#c8a13a; }
  .c img { width:112px; height:112px; image-rendering:pixelated;
           background:#e0f8d0; border-radius:3px; }
  figcaption { display:flex; flex-direction:column; gap:1px; margin-top:6px; }
  figcaption b { font-size:12px; }
  figcaption span { color:var(--dim); font-size:11px; }
  figcaption em { color:#5a7a52; font-size:10px; font-style:normal; }
</style></head><body>
<h1>Sprite Forge — Contact Sheet</h1>
<p class="sub">${entries.length} creatures · ${SPRITE_SIZE}×${SPRITE_SIZE} · DMG 4-shade palette · every sprite procedurally generated from its species seed</p>
<div class="grid">${cards.join('\n')}</div>
</body></html>`,
);

console.log(`contact sheet: ${entries.length} sprites -> public/forge-sheet.png (${W}x${H}) + forge.html`);
