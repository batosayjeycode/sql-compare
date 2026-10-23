# Performance, accessibility, offline and security (M7)

## Performance

**Budgets (PLAN §3, acceptance criterion 13).** `e2e/performance.spec.ts` checks these on desktop Chromium; CI allows twice the time, since its runners are slower than a mid-range laptop.

| Input              | Budget (engine time, worker)       | Measured               |
| ------------------ | ---------------------------------- | ---------------------- |
| Two 500-line files | < 200 ms                           | ~55 ms                 |
| Two 10k-line files | < 3 s, no main-thread task > 50 ms | ~470 ms, no long tasks |

The engine time is shown in the status pill ("Up to date · 42 ms").

**What changed in M7:**

- **Linear statement bucketing.** The normalizer assigned tokens to statements and terminators with nested loops (O(tokens × statements)). It now does this in one pass, which made the 10k-line compare about 3× faster.
- **Shared caches.** Statements that are identical on both sides are parsed once, and normalized and verified once, through a parse memo and an outcome cache keyed by statement text.
- **Narrower L3 dry run.** The dry run that produces the "may be structural" hints only normalizes statements that have semantic differences.
- **Formatting in its own worker.** Pretty-printing a 10k-line file took about 0.8 s on the main thread. The Formatted and Normalized views show the unformatted SQL, already read-only, until the formatted text arrives.
- **Smaller main bundle.** The comparison engine, the parsers and `sql-formatter` are no longer in the main bundle. They load in the workers, or on demand as a fallback. The core package is marked `sideEffects: false`.
- **Paged list.** The differences list renders 200 entries at a time. Navigating with `n`/`p`/`F7` loads more pages as needed.

**Remaining cost.** Switching a 10k-line file to the Formatted or Normalized view blocks the main thread once for about 120 ms, while CodeMirror replaces the document and re-diffs it.

**Bundle.** The initial JS is about 210 KB gzipped (budget 400 KB, checked by `npm run size`). The rest loads later:

- the engine worker (the PostgreSQL parser is WASM)
- the MySQL parser (about 68 KB gzipped)
- the formatter worker

## Lighthouse

`npm run lighthouse` runs Lighthouse on the production build, mobile and desktop, and fails below 90 for Performance, Accessibility or Best Practices. CI runs it after the E2E tests.

|                                    | Performance | Accessibility | Best Practices | SEO |
| ---------------------------------- | ----------- | ------------- | -------------- | --- |
| Mobile (simulated slow 4G, 4× CPU) | 93          | 100           | 100            | 100 |
| Desktop                            | 100         | 100           | 100            | 100 |

**What made the difference:**

- **First paint:** a static shell in `index.html` paints before the app script runs.
- **No layout shift (CLS 0):** the Latin font files are preloaded.
- **Landmarks:** the `<main>` landmark is kept on small screens.
- **SEO:** a `robots.txt` was added.

## Accessibility

- **Automated checks:** axe runs in the E2E suite for the empty state, diffs in both themes, the color-blind palette in both themes, long files, open panels, the formatted view, the differences panel, and every mobile tab. There are no serious or critical violations.
- **Keyboard:** everything is reachable:
  - Tabs follow the ARIA tabs pattern (arrow keys, Home and End).
  - The panel separator resizes with the arrow keys.
  - `n`/`p` and `F7`/`Shift+F7` navigate between differences.
  - The scroll containers are focusable.
- **Never color-only:**
  - every category has an icon (⚠ ≡ ¶)
  - severity is spelled out
  - the gutters show `+`/`−` and class icons
  - deleted text is struck through
- **Color-blind-safe palette (◐ in the toolbar):** Okabe–Ito colors, so added (blue) and removed (orange) are told apart without red/green.
- **Light theme:** darker category colors keep text readable (WCAG AA).
- **Reduced motion:** with `prefers-reduced-motion`, animations and the animated counts are turned off.

## Small screens (< 900 px, PLAN §4.3)

- **Tabs:** Left | Right | Diff | Summary. Left and Right are full-width editors for one side, with that side's highlights. The Summary tab shows a badge with the semantic count.
- **Diff tab:** inline by default; side-by-side is still available.
- **Bottom bar:** filters and Prev / Next stay fixed at the bottom of the screen.
- **From the Summary tab:** choosing a difference switches to the Diff tab and scrolls to it.

## Offline (PWA)

The build writes `sw.js` (`vite.pwa.ts`), which precaches:

- the app shell and both workers
- both parsers, including `libpg-query.wasm`
- the Latin font files

Other font subsets are cached the first time they're used. Pages are fetched from the network when it's available and fall back to the cached shell when it isn't. Hashed assets are served from the cache first.

- **Updates:** a new version installs in the background, and the user is offered **Reload** instead of having the page swapped under them.
- **Install:** the web app manifest includes regular and maskable icons, so the app can be installed.
- **Icons:** `scripts/generate-icons.mjs` renders them from `favicon.svg`.

`e2e/pwa.spec.ts` loads the app once, goes offline, reloads, and runs a comparison on both dialects plus the formatter.

## Security and privacy

- **Content Security Policy:**

  ```
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
  ```

  - `'wasm-unsafe-eval'` is needed for the PostgreSQL parser (WebAssembly). There is no `unsafe-eval` and no inline script.
  - Inline styles are allowed because CodeMirror injects its theme as `<style>` elements.
  - The build adds the policy as a `<meta>` tag. Cloudflare Pages also sends it as a header (`public/_headers`), together with `frame-ancestors 'none'`, `nosniff`, `no-referrer` and caching rules.
  - A unit test keeps the header and the meta tag in sync.

- **No third-party requests:** the fonts are self-hosted, so nothing loads from Google Fonts any more. The E2E suite checks that a full session makes no requests to other origins and causes no CSP violations.

## Browser support

The E2E suite runs on Chromium, Firefox, WebKit and a mobile Chromium profile. Locally, Chromium, mobile and Firefox pass. Playwright's WebKit build for macOS 14 can't start (`Unknown setting: PushAPIEnabled`), so WebKit runs in CI (Ubuntu) only.
