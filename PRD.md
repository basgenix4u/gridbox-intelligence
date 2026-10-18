# Gridbox Intelligence — Product Requirements

**Status:** in development · **Last updated:** 2026-10-18 · **Owner:** Abdulbasit Abdulalim
**Live:** <https://gridbox-intelligence.vercel.app> · **Repository:** `basgenix4u/gridbox-intelligence`

---

## 0. The rule this document follows

> **This document describes what is built. Everything else is in the section headed
> "Not built yet", and it stays there until it is.**

Every claim below was checked against the code in this repository — a source file, a
migration, a test, or a passing command. Where the product's ambition is larger than
the code, the ambition is in §8, not here.

---

## 1. What it is

A single-player grid arcade game with a leaderboard. The player harvests data chips
from a 9 × 9 board while four kinds of machine hunt them. Machines get smarter as
levels rise; the player spends chips on a pulse that clears a 5 × 5 area. The game
runs entirely in the browser and persists progress locally.

The product brief, the mechanics reference, the balance analysis and the engagement
research are in [`docs/PRODUCT-TEARDOWN.md`](./docs/PRODUCT-TEARDOWN.md) and
[`docs/PSYCHOLOGY-DESIGN.md`](./docs/PSYCHOLOGY-DESIGN.md).

---

## 2. What is built

### 2.1 The game

| Area | State |
|---|---|
| Board and rules | 9 × 9 board, 3 chips (+7/level), pulse cost 5 / radius 2, combo window 2 200 ms to ×8, 3 lives, 1 500 ms invulnerability, 850 ms spawn telegraph — `src/game/constants.ts` |
| Level pacing | Tick period 640 ms → 260 ms, up to 8 machines, spawn every 2 800 ms → 1 000 ms, per-level kind weights — `src/game/constants.ts` |
| Machines | `DRONE` (level 1), `HUNTER` (2), `MIND` (3), `ORACLE` (5) — `src/game/constants.ts` |
| Pathfinding | Breadth-first step-distance field over the board, used by `MIND` and `ORACLE` (450 ms prediction window) — `src/game/ai.ts` |
| Engine | Fixed-step loop, input handling, spawn scheduling, collisions — `src/game/engine.ts` |
| Scoring | Kill values, graze reward, combo, scoring version tagging — `src/game/scoring.ts` |
| Rendering | Custom canvas renderer, sprite drawing, particle effects — `src/game/render.ts`, `draw.ts`, `sprites.ts` |
| Achievements | 12, each with a progress rail — `src/game/achievements.ts` |
| Profile | Play streaks, personal best, unlock state, persisted — `src/game/profile.ts` |
| Interface | Start screen, canvas, scores panel, touch controls, pause screen, game-over screen, achievement toast, progress rail — `src/ui/` |
| Customisation | 5 player-sprite accents: Bloom, Orchid, Ember, Jade, Frost (`applyAccent`) |
| Audio | Web Audio through the `AudioSink` port; silent adapter in tests — `src/core/adapters/webAudio.ts`, `silentAudio.ts` |
| Mobile | 44 px minimum touch targets, safe-area insets, landscape layout, fluid `clamp()` type, no horizontal overflow at 320–390 px portrait, 667/844 landscape and 768 tablet |

### 2.2 Architecture

The game is written against **ports**, not against the browser:

| Port | Adapter (production) | Adapter (test) |
|---|---|---|
| `Rng` | seeded `mulberry32` | seeded `mulberry32` (deterministic) |
| `KeyValueStore` | schema-versioned `localStorage` | in-memory |
| `Clock` | system clock | fake clock |
| `AudioSink` | Web Audio | silent |
| `Logger` | console logger | console logger |
| `Telemetry` | no-op | no-op |

Consequences that are real today: a run can be replayed from a seed; the difficulty
curve, the combo rules and the scoring are all unit-testable without a browser; and
the balance analysis in the teardown could be run headless.

### 2.3 The API

A Hono application in `server/app.ts`, exposed as a single Vercel Serverless
Function (`api/index.ts`). `vercel.json` rewrites `/api/v1/*` onto the function,
which strips the `/api` prefix before dispatch.

Live endpoints:

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/v1/healthz` | Liveness, with the process start time |
| `GET` | `/api/v1/readyz` | Readiness, including a database check |

The application also sets secure headers, restricts CORS to `ALLOWED_ORIGINS`, tags
every response with a request id, and returns a structured error body with a
matching `x-request-id` header. The 404 for an unknown route is handled centrally.

### 2.4 The database

A dedicated `gridbox` schema in the Supabase project `my-portfolio`
(`yuiehpvsmqrjgjbdpqlb`, eu-west-1) — deliberately separate from the portfolio's
own `public` schema so no table, row or grant of the portfolio is touched.

| Table | Purpose |
|---|---|
| `gridbox.players` | Anonymous player identity and display name |
| `gridbox.runs` | Submitted runs and their scores |
| `gridbox.leaderboard_daily` | The daily board |
| `gridbox.name_reports` | Display-name reports awaiting moderation |
| `gridbox.audit_log` | Anti-cheat and moderation trail |

Row-level security is enabled on all five. The API connects as `gridbox_app` — a
least-privilege role (`NOSUPERUSER / NOCREATEDB / NOREPLICATION / NOBYPASSRLS`) with
rights on the `gridbox` schema only — so the RLS policies are load-bearing, not
decorative. Two read paths are exposed publicly: `runs` and `leaderboard_daily`.

Connectivity note, because it is not obvious: the database publishes an AAAA record
only, and Vercel's Lambdas egress over IPv4, so **the pooler is the only working
route** — and for this project the pooler is `aws-1-eu-west-1`, not the more commonly
documented `aws-0-*`.

### 2.5 The toolchain

ESLint 9 flat config (type-checked, `typescript-eslint` strict), Prettier 3,
EditorConfig, `.nvmrc`, husky + lint-staged pre-commit, commitlint with Conventional
Commits, Vitest 4 across node and jsdom projects with coverage thresholds,
Playwright with `@axe-core/playwright`, and a `verify` script that runs
typecheck → lint → test → build.

### 2.6 Tests

**25 test files, 240 cases.** They cover the engine rules, the BFS distance field,
the difficulty curve, combo and scoring, the seeded RNG, storage versioning, the
profile, the achievements, the renderer, every screen component, and the API's
routing, error shape and health endpoints.

---

## 3. Decisions that are locked

| Ref | Decision |
|---|---|
| Deliverable | The game — Gridbox Intelligence |
| Architecture | Option B: full-stack, with a leaderboard |
| Deploy | Vercel (client + API) and Supabase (PostgreSQL) |
| Release scope | One release containing P0 + P1 |
| Rebalance | Approved. Combo tapering and kill-value rebalance. **Existing local scores are preserved and tagged as legacy scoring, not deleted** |
| Display names | Both — a long name on the profile, 3-character initials in compact leaderboard rows. This requires profanity filtering, a moderation queue and a report flow |
| Database | Reuses the `my-portfolio` Supabase project, isolated in a dedicated `gridbox` schema. The portfolio's tables, data and credentials are untouched |

---

## 4. Acceptance criteria for v1

A release is v1 when all of the following are true:

1. `npm run verify` passes: typecheck, lint, tests and build are clean.
2. The game is playable with keyboard and touch, on a phone-sized viewport, with no
   horizontal overflow and no clipped control.
3. A run can be submitted and appears on the daily leaderboard.
4. A submitted run cannot be replayed, and an implausible run is flagged rather
   than silently accepted.
5. A display name that is reported is held for moderation and does not reach the
   leaderboard until a human clears it.
6. The API rejects a request with an origin outside `ALLOWED_ORIGINS`, and rate
   limits apply per client.
7. The accessibility pass passes: `npm run test:a11y` is green and the game is
   playable without a mouse.
8. The README and this document describe the same product, and everything deferred
   is in §8.

---

## 5. Not built yet

Everything in this section is planned and **not** in the running product. It is
quoted from the canonical board, [`docs/TASK-BOARD.md`](./docs/TASK-BOARD.md), so
that the two never drift.

### 5.1 Core hardening

- Error boundary, requestAnimationFrame watchdog and a development error overlay.
- The A3–A9 fix list: SSR guard, render-time side effects, RAF teardown on resize,
  UUID ids, font-metric stabilisation, storage validation.
- A deterministic headless run to game-over that reuses the balance harness.

### 5.2 The server features

- `POST /auth/anonymous`, `GET|PATCH /me`
- `POST /runs/start`, `POST /runs/:id/submit`
- `GET /leaderboard`, `GET /leaderboard/around`, `GET /daily`
- Anti-cheat: envelope validation, run attestation (nonce plus hash chain),
  statistical flagging into `audit_log`
- Moderation: display-name profanity filter, report endpoint, moderation queue view
- Rate limiting (in-memory in development, Upstash in production), security headers
  and a CORS allowlist
- API integration tests against a test database, with shared contract types
- Legacy-score migration: tag existing local entries `scoringVersion: 1`, new
  entries `2`

### 5.3 Frontend and integration

- A composition root that replaces direct engine coupling in `App.tsx` with
  providers and typed hooks
- Loading, error, empty and offline states, with retry and exponential backoff for
  leaderboard sync
- The F2 combo rebalance (tapering window, decay to ×4) and the F3 score rebalance
  (kill values, graze reward)

---

## 6. Open questions

1. **Leaderboard shape** — global, daily, or both? The schema has
   `leaderboard_daily`; a global table would be a second migration.
2. **Display-name policy** — what is rejected, and who clears the queue? The board
   assumes an owner or moderator, not the player.
3. **Anti-cheat threshold** — which statistical signals flag a run? The teardown's
   balance harness gives the distribution to set the bar against.
4. **Name policy for the score table** — the 3-character initial form needs its own
   profanity filter, which is a different rule from the long name.
