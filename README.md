# SQL Compare

Compare two SQL queries or files side by side, entirely in your browser. Every difference is labelled as **formatting**, **structural** (proven equivalent), or **potential semantic**.

- **Private:** nothing leaves your browser. There are no uploads, no analytics and no third-party requests, and after the first visit it works offline (installable PWA).
- **Explained:** every difference has a description ("JOIN `orders` changed from INNER to LEFT"), a severity and its clause. Structural differences name the normalization rule that proves them equivalent.
- **PostgreSQL and MySQL:** both are parsed by real parsers in a Web Worker. A Generic mode offers formatting and a token diff.

See [PLAN.md](./PLAN.md) for scope, architecture and milestones, and [docs/](./docs) for how each part works.

## Using it

- Paste or drop SQL (or `.sql` files) on both sides. The comparison runs as you type.
- **View:** Original (editable), Formatted, or Normalized (what's left after the active rules). Highlights follow the view.
- **Mode:** side-by-side or inline. **Filters:** Semantic / Structural / Formatting (formatting is hidden by default).
- **Differences panel:** grouped by statement and clause. Click an entry to jump to it. Export the report as Markdown, HTML or JSON.
- **Normalize:** L2 by default. **Aggressive (L3)** also proves safe reorderings (AND/OR, `=`, IN lists, GROUP BY, …). Each rule can be turned off.
- **Small screens:** Left / Right / Diff / Summary tabs, with navigation at the bottom.

| Key                               | Action                                       |
| --------------------------------- | -------------------------------------------- |
| `n` / `p`                         | Next / previous difference (when not typing) |
| `F7` / `Shift+F7`                 | Next / previous difference (anywhere)        |
| Arrow keys on the panel separator | Resize the differences panel                 |

## Structure

```
packages/core   # framework-agnostic comparison engine (no DOM)
apps/web        # Vite + React UI
```

## Scripts

| Command                                                       | Description                                              |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `npm install`                                                 | Install all workspaces                                   |
| `npm run dev`                                                 | Start the web app dev server                             |
| `npm test`                                                    | Unit/component tests (Vitest, all workspaces)            |
| `npm run test:e2e`                                            | Playwright E2E (run `npx playwright install` once first) |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks                                            |
| `npm run build`                                               | Production build (`apps/web/dist`)                       |
| `npm run size`                                                | Initial JS budget check (< 400 KB gzipped)               |
| `npm run lighthouse`                                          | Lighthouse (mobile and desktop) on the build, ≥ 90       |

Requires Node ≥ 20.

## Deploying

`apps/web/dist` is a static site. On Cloudflare Pages, `public/_headers` sends the Content-Security-Policy and the caching rules. On other hosts, send the same headers; the policy is also in a `<meta>` tag. Don't cache `sw.js` and `index.html`; files in `/assets/` are immutable.
