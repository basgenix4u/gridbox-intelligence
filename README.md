# Gridbox Intelligence

A fast grid arcade game. Harvest data chips on a 9×9 board, outsmart machines that
learn how you move, and spend chips on a pulse that clears the space around you.

**Live:** <https://gridbox-intelligence.vercel.app>

**Source of truth for what is built:** [PRD.md](./PRD.md)

> This README describes what is **built today**. Everything planned lives in the PRD
> under *"Not built yet"*, and it stays there until it ships.

---

## The game

You are the operator of a grid. Chips spawn on it. Machines spawn on it too, and they
get better every level.

| Rule | Value | Where it lives |
|---|---|---|
| Board | 9 × 9 | `src/game/constants.ts` |
| Chips on the board | 3, +7 per level | `CHIPS_ON_BOARD`, `CHIPS_PER_LEVEL` |
| Pulse | costs 5 chips, clears a 5 × 5 area | `PULSE_COST`, `PULSE_RADIUS` |
| Combo window | 2 200 ms, up to ×8 | `COMBO_WINDOW`, `MAX_COMBO` |
| Lives | 3 | `START_LIVES` |
| Invulnerability after a hit | 1 500 ms | `INVULN_MS` |
| Spawn telegraph | 850 ms before a machine appears | `SPAWN_TELEGRAPH` |
| Level pace | tick period 640 ms → 260 ms, max 8 machines, spawn every 2 800 ms → 1 000 ms | `levelPeriod`, `levelMaxEnemies`, `levelSpawnEvery` |

### The four machines

| Machine | Unlock | Behaviour | Score |
|---|---|---|---|
| `DRONE` | level 1 | "Wanders with a vague interest in you." | 50 |
| `HUNTER` | level 2 | "Chases in straight lines. Walls confuse it." | 75 |
| `MIND` | level 3 | "Pathfinds around every wall." | 100 |
| `ORACLE` | level 5 | "Predicts where you will move next." | 150 |

`MIND` and `ORACLE` are the interesting ones. The board is searched with a
breadth-first flood fill (`bfs()` in `src/game/ai.ts`) to produce a step-distance
field, so `MIND` walks around walls rather than into them, and `ORACLE` reads the
player's next move for 450 ms after a step (`PRED_WINDOW`).

### Around the game

- **12 achievements**, each with a progress rail that shows how close you are
  (`src/game/achievements.ts`).
- **5 player-sprite accents** — Bloom, Orchid, Ember, Jade, Frost. Jade and Frost
  double as colour-vision-safe alternatives to the pink default.
- **A persistent profile**: play streaks, personal best, unlock state — all in
  `localStorage` behind a versioned store (`src/game/profile.ts`).
- **A run recap** with a one-more-run nudge, and a pause screen.
- **Touch controls** with a 44 px minimum target, safe-area insets and a landscape
  layout, so it plays on a phone.

---

## Stack

| Layer | Choice |
|---|---|
| Client | React 19 + TypeScript 5.9, Vite 7, Tailwind CSS 4 |
| Canvas | Custom renderer — `src/game/render.ts`, `draw.ts`, `sprites.ts` |
| Audio | Web Audio through an `AudioSink` port (`src/core/ports/audio.ts`) |
| API | Hono 4 on a Vercel Serverless Function (`api/index.ts` → `server/app.ts`) |
| Database | PostgreSQL via Drizzle ORM, in a dedicated `gridbox` schema, RLS enabled |
| Validation | Zod 4 |
| Tests | Vitest 4 (node + jsdom), Playwright + `@axe-core/playwright` |
| Tooling | ESLint 9 flat config, Prettier 3, husky + lint-staged, commitlint (Conventional Commits) |

### The architecture in one paragraph

Everything that touches the outside world is a **port** (`src/core/ports/`): `Rng`,
`KeyValueStore`, `Clock`, `AudioSink`, `Telemetry`, `Logger`. Each has an
**adapter** in `src/core/adapters/` — a seeded `mulberry32` RNG, a schema-versioned
`localStorage` store, a Web Audio sink, a system clock, a console logger, a
no-op telemetry sink, and an in-memory store for tests. That is what makes the game
deterministic under test and replayable from a seed, and it is why the game code
never imports a browser API directly.

---

## Getting started

```bash
git clone https://github.com/basgenix4u/gridbox-intelligence.git
cd gridbox-intelligence
npm ci
cp .env.example .env.local   # only needed for the API / database
npm run dev                  # Vite dev server
```

Requires Node ≥ 20.19.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run verify` | typecheck → lint → test → build |
| `npm run typecheck` | `tsc --noEmit` for the app and the node config |
| `npm run lint` | ESLint (strict config) |
| `npm run test` | Vitest run |
| `npm run test:coverage` | Vitest with V8 coverage |
| `npm run test:e2e` | Playwright |
| `npm run test:a11y` | Playwright, accessibility-tagged specs only |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:seed` | Drizzle migrations and seed |
| `npm run db:studio` | Drizzle Studio |

### Tests

**25 test files, 240 cases**, covering the engine rules, the BFS distance field, the
difficulty curve, combo and scoring, the seeded RNG, storage versioning, the
profile and achievements, the canvas renderer, every screen component, and the
Hono API's routing and error shape.

```bash
npm run verify
```

---

## Configuration

`.env.example` lists what the API needs. The client game needs nothing — it runs
entirely in the browser until the server features ship (see the PRD).

## Deployment

- **Client:** Vite build → Vercel.
- **API:** `api/index.ts` is a single Vercel Serverless Function; `vercel.json`
  rewrites `/api/v1/*` onto it, and the function strips the `/api` prefix before
  dispatching to Hono. `/api/v1/healthz` and `/api/v1/readyz` are live.
- **Database:** a dedicated `gridbox` schema on Neon, applied with Drizzle
  migrations, with row-level security enforced by a least-privilege
  `gridbox_app` role. The runtime uses Neon's pooled endpoint; migrations use the
  direct one.

---

## Documentation

| Document | What it is for |
|---|---|
| [PRD.md](./PRD.md) | **The source of truth.** What is built, what is not, and why. |
| [docs/PRODUCT-TEARDOWN.md](./docs/PRODUCT-TEARDOWN.md) | Mechanics reference, headless balance analysis, feature and UI backlogs, release plan |
| [docs/PSYCHOLOGY-DESIGN.md](./docs/PSYCHOLOGY-DESIGN.md) | The engagement layer: streaks, progress rails, nudge timing, and the research behind them |
| [docs/TASK-BOARD.md](./docs/TASK-BOARD.md) | The canonical work board, stage by stage |

## Licence

MIT.
