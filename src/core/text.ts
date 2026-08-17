/**
 * Text layout for the DMG text box.
 *
 * This lives in core rather than render because PAGINATION IS GAME STATE, not
 * drawing: "the box is full, press A for the rest" is a thing the reducer has to
 * know about, in exactly the way Gen 1 did. Keeping it here also means the
 * gauntlets can assert on it in Node without a canvas.
 *
 * The bug this exists to prevent: the box draws two rows, `wrapText` happily
 * returned six, and the other four were silently dropped. 95.7% of the script
 * was affected - every line longer than about thirty-six characters lost its
 * tail, and because the typewriter kept counting the invisible characters it
 * looked like the game was skipping text when you pressed A.
 */

/** Rows the DMG box shows at once. Gen 1 shows two; so do we. */
export const ROWS_PER_PAGE = 2;

/** Characters per row at the 8px font inside the standard box. */
export const CHARS_PER_ROW = 18;

/**
 * Greedy word wrap. A word longer than a row is HARD SPLIT across rows rather
 * than truncated - the old version sliced it and threw the remainder away,
 * which turned a long name into a lie.
 */
export function wrapText(text: string, maxChars: number = CHARS_PER_ROW): string[] {
  const rows: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    let w = word;
    // A word that cannot fit on a row of its own is chopped into row-sized
    // pieces; every piece survives.
    while (w.length > maxChars) {
      if (cur.length > 0) {
        rows.push(cur);
        cur = '';
      }
      rows.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (w.length === 0) continue;
    const candidate = cur.length === 0 ? w : `${cur} ${w}`;
    if (candidate.length <= maxChars) {
      cur = candidate;
    } else {
      if (cur.length > 0) rows.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0 || rows.length === 0) rows.push(cur);
  return rows;
}

/**
 * One authored line becomes N boxes of `ROWS_PER_PAGE` rows. Always at least
 * one page, so an empty string still renders an empty box rather than nothing.
 */
export function paginate(
  text: string,
  maxChars: number = CHARS_PER_ROW,
  rowsPerPage: number = ROWS_PER_PAGE,
): string[][] {
  const rows = wrapText(text, maxChars);
  const pages: string[][] = [];
  for (let i = 0; i < rows.length; i += rowsPerPage) {
    pages.push(rows.slice(i, i + rowsPerPage));
  }
  return pages.length > 0 ? pages : [['']];
}

/**
 * How many typewriter characters a page holds. Rows are joined by a single
 * separator so the reveal walks from one row to the next continuously, which is
 * why this is +1 per row and then -1 - the renderer counts the same way, and
 * the two MUST agree or the prompt appears while text is still hidden.
 */
export function pageLength(rows: readonly string[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((n, r) => n + r.length + 1, 0) - 1;
}
