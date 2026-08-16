/**
 * Assembles the `Content` object the reducer needs, from the generated tables.
 *
 * Every gauntlet that drives the real game goes through here, so there is one
 * place that knows how the data layer is wired, and one clean failure message
 * when it has not been generated yet.
 *
 * Imports are dynamic and routed through a variable specifier deliberately:
 * a literal specifier makes `tsc` fail with TS2307 when the generated file is
 * absent, which would mean the type gauntlet could never pass on a fresh clone.
 */
import type { Species, Move } from '../../src/core/creature.ts';
import type { Content, TrainerDef } from '../../src/core/game.ts';
import type { GameMap } from '../../src/core/world.ts';
import { effectivenessAgainst, type FeralType, TYPES } from '../../src/core/types.ts';

export interface GymTown {
  readonly town: string;
  readonly gymMap: string;
}

export interface LoadedContent {
  readonly content: Content;
  readonly species: Readonly<Record<string, Species>>;
  readonly speciesList: readonly Species[];
  readonly moves: Readonly<Record<string, Move>>;
  readonly moveList: readonly Move[];
  readonly trainers: Readonly<Record<string, TrainerDef>>;
  readonly gymOrder: readonly string[];
  readonly eliteOrder: readonly string[];
  readonly gymTowns: readonly GymTown[];
  readonly gymLevels: readonly number[];
  effectiveness(a: string, d: string): number;
}

async function tryImport(specifier: string): Promise<Record<string, unknown> | null> {
  const path = specifier;
  try {
    const mod: unknown = await import(path);
    if (typeof mod === 'object' && mod !== null) return mod as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export async function loadContent(): Promise<LoadedContent | null> {
  const sp = await tryImport('../../src/data/species.gen.ts');
  const mv = await tryImport('../../src/data/moves.gen.ts');
  const mp = await tryImport('../../src/data/maps.gen.ts');
  const tr = await tryImport('../../src/data/trainers.gen.ts');
  const dl = await tryImport('../../src/data/dialogue.gen.ts');

  if (!sp || !mv || !mp || !tr) return null;

  const speciesRec = sp['SPECIES'];
  const speciesArr = sp['SPECIES_LIST'];
  const moveRec = mv['MOVES'];
  const moveArr = mv['MOVE_LIST'];
  const mapRec = mp['MAPS'];
  const trainerRec = tr['TRAINERS'];

  if (!isRecord(speciesRec) || !Array.isArray(speciesArr)) return null;
  if (!isRecord(moveRec) || !Array.isArray(moveArr)) return null;
  if (!isRecord(mapRec) || !isRecord(trainerRec)) return null;

  const species = speciesRec as Readonly<Record<string, Species>>;
  const speciesList = speciesArr as readonly Species[];
  const moves = moveRec as Readonly<Record<string, Move>>;
  const moveList = moveArr as readonly Move[];
  const maps = mapRec as Readonly<Record<string, GameMap>>;
  const trainers = trainerRec as Readonly<Record<string, TrainerDef>>;

  const dialogueRec = dl && isRecord(dl['DIALOGUE']) ? (dl['DIALOGUE']) : {};

  const content: Content = {
    world: {
      map(id: string): GameMap {
        const m = maps[id];
        if (!m) throw new Error(`unknown map: ${id}`);
        return m;
      },
    },
    dex: {
      species(id: string): Species {
        const s = species[id];
        if (!s) throw new Error(`unknown species: ${id}`);
        return s;
      },
      move(id: string): Move {
        const m = moves[id];
        if (!m) throw new Error(`unknown move: ${id}`);
        return m;
      },
    },
    dialogue(key: string): readonly string[] {
      const v = dialogueRec[key];
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
      // A missing key must never crash a run; the tone gauntlet reports them.
      return ['...'];
    },
    trainer(id: string): TrainerDef {
      const t = trainers[id];
      if (!t) throw new Error(`unknown trainer: ${id}`);
      return t;
    },
  };

  const gymOrder = readStringArray(tr['GYM_ORDER']) ?? [];
  const eliteOrder = readStringArray(tr['ELITE_ORDER']) ?? [];

  // Derive the town/gym-map pair and the intended level for each gym from the
  // generated data, so this loader never carries a second copy of the spine.
  const gymTowns: GymTown[] = [];
  const gymLevels: number[] = [];
  for (const gymId of gymOrder) {
    const def = trainers[gymId];
    const gymMap = Object.keys(maps).find((k) =>
      maps[k]?.npcs.some((n) => n.team === gymId),
    );
    const town = gymMap?.replace(/_gym$/, '') ?? '';
    gymTowns.push({ town, gymMap: gymMap ?? '' });
    gymLevels.push(def ? Math.max(...def.team.map((m) => m.level)) : 10);
  }

  const isType = (s: string): s is FeralType => (TYPES as readonly string[]).includes(s);

  return {
    content,
    species,
    speciesList,
    moves,
    moveList,
    trainers,
    gymOrder,
    eliteOrder,
    gymTowns,
    gymLevels,
    effectiveness(a: string, d: string): number {
      if (!isType(a) || !isType(d)) return 1;
      return effectivenessAgainst(a, d);
    },
  };
}

function readStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === 'string')) return null;
  return v;
}
