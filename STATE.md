# STATE.md

**Rewritten after every phase. Written for a fresh context with no memory of this project.**
If you are that reader: read this file, then `PLAN.md` §0 (the reducer architecture), then
`MANIFEST.md`. Do not read source files that `MANIFEST.md` already summarises.

---

## Resume command

```bash
cd /home/user/Ferals-of-fenmark
npm install          # node_modules is not committed
npm run gauntlet     # see exactly where you are
```

Branch: `claude/ferals-fenmark-rpg-ga42yt`. Push there, never elsewhere.

---

## Where we are

**Phase 0 — tooling and gauntlet harnesses. IN PROGRESS.**

Founding documents are written and are authoritative:
- `PLAN.md` — architecture. The reducer decision in §0 is load-bearing for gauntlets 3 and 5.
- `TONE.md` — the voice. Every dialogue line is graded against it. Three hard lines are absolute.
- `STATE.md` — this file.

---

## Gauntlet status

| # | Gauntlet | Status |
|---|----------|--------|
| 1 | `gauntlet:types` | not written |
| 2 | `gauntlet:schema` | not written |
| 3 | `gauntlet:sim` | not written |
| 4 | `gauntlet:curve` | not written |
| 5 | `gauntlet:playthrough` | not written |
| 6 | `gauntlet:visual` | not written |
| 7 | `gauntlet:tone` | not written |
| 8 | `gauntlet:ship` | not written |

`npm run gauntlet` runs all eight. That command exiting 0 is the only definition of finished.

---

## What's next, in order

1. Phase 0: eslint + tsx, write all eight gauntlet harnesses as **failing** stubs, wire npm scripts.
2. Phase 1: `src/core/rng.ts`, `src/core/types.ts` (12×12 chart), damage math.
3. Phase 2: battle engine, validated by `gauntlet:sim` before any UI exists.

---

## Blocked

Nothing.

---

## Notes for the next reader

- The scaffold shipped a Vite demo page (`src/main.ts`, `src/counter.ts`, `src/assets/*`) and a
  working Firebase/Firestore config. The demo page gets replaced; the Firebase config is good
  and should be kept — see `src/firebase.ts` and `firestore.rules`.
- Playwright must launch via `tests/browser.ts` (`launchBrowser()`), which points at the
  preinstalled `/opt/pw-browsers/chromium`. Never call `chromium.launch()` directly and never
  run `playwright install`.
- `git config user.email` is the CI default; commits are fine as-is.
