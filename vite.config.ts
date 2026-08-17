import { defineConfig } from 'vite';

/**
 * The game is a static site with no backend, so "deploying" is just copying
 * `dist/` somewhere. The only thing that varies between hosts is the PATH the
 * site is served from, and getting that wrong is the classic way to ship a page
 * that loads a blank screen and a 404 for its own script.
 *
 * GitHub Pages serves a project site from a SUBPATH — `/Ferals-of-fenmark/` —
 * so every asset URL has to be prefixed. A root-hosted target (Firebase
 * Hosting, a custom domain, `npm run preview`) needs `/` instead.
 *
 * `BASE_PATH` selects it. The default is the GitHub Pages subpath because that
 * is where the shareable link lives; the deploy workflow sets it explicitly
 * anyway, so the default only matters for a local `npm run build`.
 */
const base = process.env['BASE_PATH'] ?? '/Ferals-of-fenmark/';

export default defineConfig({
  base,
  build: {
    // The generated content tables are large and highly compressible. Reporting
    // the compressed size keeps `npm run ship` honest about what a player on a
    // phone actually downloads.
    reportCompressedSize: true,
    // A creature-collector is one screen and one loop; there is nothing to lazy
    // load, and a single request beats a waterfall on a slow connection.
    chunkSizeWarningLimit: 700,
  },
});
