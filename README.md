# SQL Compare

Compare two SQL queries or files side by side, entirely in your browser. Every difference is labelled as **formatting**, **structural** (proven equivalent), or **potential semantic**.

See [PLAN.md](./PLAN.md) for scope, architecture, and milestones.

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

Requires Node ≥ 20.
