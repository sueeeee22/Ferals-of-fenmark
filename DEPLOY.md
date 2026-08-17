# DEPLOY.md

How **Ferals of Fenmark** gets from this repository to a link you can send someone.

The game is a static site. There is no server, no database, no login, and no
running cost — the whole thing is an HTML file, one JavaScript bundle and one
stylesheet, about **77 KB gzipped**. Everything else, including all 153 creatures
and 52 maps, is generated at build time and baked into that bundle.

---

## The link

```
https://sueeeee22.github.io/Ferals-of-fenmark/
```

It will 404 until you do the one-time setup below. After that it updates itself
on every push.

---

## One-time setup (about thirty seconds, once)

You have to do this part — it is a repository setting and cannot be done from
code.

> **This step cannot be automated — it was tried.** Setting `enablement: true` on
> `actions/configure-pages` is supposed to switch Pages on via the API and remove
> the manual click. On this repository it fails with *"Create Pages site failed:
> Resource not accessible by integration"* — the workflow token is not allowed to
> create the Pages site. The workflow is therefore left at the default, where the
> failure message is the actionable one. Somebody has to do step 1 below by hand,
> once.
>
> **And the other catch.** This repository is **private**, and GitHub Pages on a
> private repository requires a paid plan (Pro, Team or Enterprise). On a free
> account the Pages option will be greyed out or the deploy will fail with a
> permissions error. Two ways past it:
>
> - **Make the repository public** — free, works immediately. Everything becomes
>   readable: the code, the dialogue, the design docs. For a game you want people
>   to play, that is usually fine, but it is your call and it is not reversible in
>   the sense that anything already fetched stays fetched.
> - **GitHub Pro** — a few dollars a month, keeps the repository private, Pages
>   works as described below.
>
> Nothing else about the setup changes either way.

1. Go to **Settings → Pages** in this repository:
   <https://github.com/sueeeee22/Ferals-of-fenmark/settings/pages>
2. Under **Source**, choose **GitHub Actions**.
3. That is the whole setup. There is nothing to install, no account to create,
   no billing to enable.

Then trigger the first deploy, either by pushing any change to a watched branch
or by running the workflow by hand: **Actions → Deploy to GitHub Pages → Run
workflow**.

The deploy takes about a minute. When it finishes, the link above is live.

> **Note on branches.** `.github/workflows/deploy-pages.yml` publishes from
> `main` and from `claude/ferals-fenmark-rpg-ga42yt`. Whichever one pushes last
> is what is live — there is only one Pages site per repository. Once the work
> is merged, drop the feature branch from that `branches:` list so only `main`
> can publish.

---

## What happens on a push

`.github/workflows/deploy-pages.yml` runs:

1. `npm ci`
2. `npm run ship` — builds, then **verifies the build is publishable** (see below)
3. uploads `dist/` and deploys it to Pages

If step 2 fails, nothing is published. A broken build cannot replace a working
site.

---

## Verifying before you push

```bash
npm run ship
```

This runs gauntlet 8, which does more than compile. It serves the real `dist/`
over HTTP **from the same `/Ferals-of-fenmark/` subpath GitHub Pages uses**,
opens it in a real browser, and checks:

- every request returns 200 — no asset 404s under the subpath
- the game actually boots (the frame loop runs, not just "the script parsed")
- the canvas is drawing more than one colour, so a renderer crash cannot pass
- keyboard input reaches the reducer
- **a save survives a genuine page reload**
- the save panel opens and lists its slots
- the console is clean
- the page stays inside a 250 KB gzipped budget

The subpath part matters more than it sounds. The single most common way to
ship a blank page on GitHub Pages is an asset URL starting with `/`, which
resolves to the domain root and 404s. That is checked twice — once by reading
the built HTML, once by actually serving it.

---

## Saves

Saves live in the player's own browser, in `localStorage`. No account, no
server, nothing to configure — the player opens the link and plays.

Three slots, listed under the **SAVES** button in the top-right corner.

**What is protected against what:**

| Risk | What happens |
|---|---|
| Player closes the tab without saving | An autosave runs every 30 seconds in the overworld, and again when the tab is hidden or closed. It is stored separately and never overwrites a deliberate save — the worst it can do is offer a *newer* state. |
| A save is written half-way and corrupts | Every write demotes the previous good save to a backup first. A corrupt primary falls back to the backup automatically, and the panel says so. |
| Storage is unavailable (private browsing, full disk, blocked) | The game still runs. The panel shows a plain warning that nothing will persist, and points at transfer codes. |
| Player clears site data, or wants to play on their phone instead | **Transfer codes.** The panel copies the entire save to the clipboard as one line of text. Paste it on another device to carry on there. A truncated or edited code is rejected with a reason rather than loading a broken game. |

Saves are versioned (`SAVE_VERSION` in `src/core/save.ts`). A save from a newer
version is refused rather than half-read; older versions pass through `migrate()`.

### What this does *not* do

Saves are per-browser. Two people on the same computer using the same browser
profile share the same three slots, and there is no cloud backup — clearing site
data with no transfer code saved loses the run. Fixing that properly needs
accounts, which is the Firebase path below.

---

## The Firebase path, if you ever want cloud saves

Not wired up, deliberately — it was not needed to get a shareable link, and it
costs an account, a console, and a login this project does not otherwise
require. The groundwork is committed and still valid:

- `firestore.rules` — deny-by-default; a player can read and write only their
  own document, enforced by `request.auth.uid`
- `firebase.json`, `.firebaserc`, `firestore.indexes.json`
- `src/firebase.ts` — config from env vars, with a clear error when unset
- `.github/workflows/deploy-firestore.yml` — deploys rules from CI, so the
  repository is the source of truth rather than the console
- `.env.example`

To turn it on you would: create a Firebase project, enable **Anonymous**
sign-in, fill in `.env.local` from the console, call `signInAnonymously()`
before touching Firestore, and mirror the save document on write. Keep
`localStorage` as the source of truth so a Firebase outage can never block
play — that constraint is the whole reason the current save layer is
self-sufficient.

Everything needed fits comfortably in the free Spark tier. Nothing here requires
Blaze.

---

## Local development

```bash
npm install
npm run dev                 # http://localhost:5173
npm run build               # writes dist/
BASE_PATH=/ npm run preview # serve dist/ from the root instead of the subpath
```

`BASE_PATH` controls the asset prefix. It defaults to `/Ferals-of-fenmark/` for
Pages; set it to `/` for a root-hosted target such as Firebase Hosting or a
custom domain.

---

## Troubleshooting

**The link 404s.** Pages is not switched on yet, or the first deploy has not
run. Settings → Pages → Source: GitHub Actions, then Actions → Run workflow.

**The deploy job fails with a permissions or "Pages not enabled" error, and the
build job was green.** That is the private-repository plan limit at the top of
this page, not a problem with the build.

**The deploy job fails on a missing browser.** `gauntlet:ship` drives the built
site in a real Chromium, so CI installs one (`npx playwright install --with-deps
chromium`). If you copy this workflow somewhere else, take that step with it.

**The page loads but is blank, and the console shows 404s for `/assets/...`.**
The build ran with the wrong base path. CI sets `BASE_PATH` from the repository
name; if you renamed the repository, the URL changed with it.

**The deploy job fails at "Build and verify".** That is gauntlet 8 refusing to
publish something broken. Run `npm run ship` locally — it prints the same
report, and the failing line names the problem.

**A player says their save vanished.** Ask whether they cleared site data or
were in private browsing. Then tell them about the SAVES button: a transfer code
is the only thing that survives either.
