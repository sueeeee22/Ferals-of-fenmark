/**
 * Everything that can sit in the bag, and what a shop charges for it.
 *
 * Prices are Gen 1's own (a Poke Ball was 200, a Potion 300, a Great Ball 600,
 * a Super Potion 700, an Ultra Ball 1200), because the trainer prize money was
 * tuned against the same game and the two only make sense together.
 *
 * The better stock arrives with badges, the way Gen 1's marts got better town
 * by town. Every shop in Fenmark is the same shop - what changes is how much
 * the quartermaster thinks you can be trusted with.
 */

export interface ItemDef {
  readonly id: string;
  /**
   * What the bag and the shop call it. Twelve characters at most: the lists
   * put a count or a price on the same row, and a longer name runs into it.
   * `gauntlet:schema` does not know about items, so this limit is held here.
   */
  readonly name: string;
  readonly price: number;
  /** Badges needed before a shop will sell it. */
  readonly minBadges: number;
}

export const ITEM_NAME_COLS = 12;

/** The most of one thing the bag will hold. */
export const STACK_MAX = 99;

export const ITEMS: readonly ItemDef[] = [
  { id: 'snare', name: 'Snare', price: 200, minBadges: 0 },
  { id: 'poultice', name: 'Poultice', price: 300, minBadges: 0 },
  { id: 'good_snare', name: 'Good snare', price: 600, minBadges: 2 },
  { id: 'strong_poultice', name: 'Big poultice', price: 700, minBadges: 3 },
  { id: 'great_snare', name: 'Great snare', price: 1200, minBadges: 5 },
];

export function itemDef(id: string): ItemDef | null {
  return ITEMS.find((i) => i.id === id) ?? null;
}

/** The name to draw. An item nobody has defined still gets something readable. */
export function itemName(id: string): string {
  const def = itemDef(id);
  if (def) return def.name;
  const plain = id.replace(/_/g, ' ');
  return plain.length > ITEM_NAME_COLS ? plain.slice(0, ITEM_NAME_COLS) : plain;
}

/** What a shop has on the shelf for a player with this many badges. */
export function shopStock(badges: number): readonly ItemDef[] {
  return ITEMS.filter((i) => badges >= i.minBadges);
}

export function isSnare(id: string): boolean {
  return id === 'snare' || id === 'good_snare' || id === 'great_snare';
}

export function isPoultice(id: string): boolean {
  return id === 'poultice' || id === 'strong_poultice';
}

/** How much health a poultice gives back. */
export function poulticeHeal(id: string): number {
  return id === 'strong_poultice' ? 120 : 40;
}
