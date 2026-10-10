# Gridbox Intelligence — Master Task Board

> **Canonical board.** Supersedes the board embedded in `ARCHITECTURE-REVIEW.md §7`.
> Legend: `[ ]` Pending · `[~]` **In Progress — exactly one at any time** · `[x]` Completed
> Last updated: 2026-10-10 · Repo: [github.com/basgenix4u/gridbox-intelligence](https://github.com/basgenix4u/gridbox-intelligence)

## Decisions locked

| Ref | Decision |
|---|---|
| PRD | **Absent — inferred.** `ARCHITECTURE-REVIEW.md` + `PRODUCT-TEARDOWN.md` are the derived spec |
| Deliverable | **Gridbox Intelligence (the game)** |
| Architecture | **Option B** — full-stack leaderboard |
| Deploy | **Vercel + Supabase** · API = **Hono** on Vercel Serverless Functions |
| Release scope | **One release containing P0 + P1** (no separate v1.1.0) |
| Rebalance | **Approved.** Combo tapering + kill-value rebalance. Existing local scores are **preserved and tagged** as legacy scoring, not deleted |
| Names | **Both** — long display name on the profile, 3-char initials in compact leaderboard rows → requires profanity filtering, moderation queue and report flow |
| Supabase | **Blocked — see "Supabase blocker" below.** All code is config-driven via `DATABASE_URL`, so stages 3.1–3.6 are unblocked |

---

## Stage 1 — Review, validate, propose, discover

- [x] 1.1 Download and extract supplied zip; inventory codebase (26 files / 3,575 LOC)
- [x] 1.2 Verify environment: `npm install`, `tsc --noEmit`, `vite build`, `npm audit` (0 vulns)
- [x] 1.3 Validate GitHub PAT (account `basgenix4u`), configure Git credentials securely
- [x] 1.4 Create repo `basgenix4u/gridbox-intelligence` (public, MIT) and push untouched baseline
- [x] 1.5 Audit correctness, OWASP Top 10, performance, delivery/ops, WCAG 2.2 AA
- [x] 1.6 Propose architecture, schema, API contracts, folder structure
- [x] 1.7 Resolve blocking questions (PRD absent · scope = game · Option B · Vercel + Supabase)
- [x] 1.8 Deep product teardown: mechanics reference, headless balance analysis (550 bot runs),
      feature backlog, UI/UX backlog, accessibility target, release plan
- [x] 1.9 **Approved** — teardown, feature scope (P0+P1), rebalance, naming, Supabase

## Stage 2 — Environment & tooling

- [x] 2.1 Restructure to `core/ game/ ui/ app/`; add `tsconfig.node.json`, `@/*` path aliases
- [x] 2.2 Install and configure ESLint 9 flat config (typescript-eslint strict) + Prettier + EditorConfig + `.nvmrc`
- [x] 2.3 Vitest (node + jsdom projects) with coverage thresholds; Playwright + `@axe-core/playwright`
- [x] 2.4 husky + lint-staged pre-commit; commitlint (Conventional Commits)
- [x] 2.5 Scripts: `dev build preview typecheck lint format test test:coverage test:e2e test:a11y verify`
- [x] 2.6 Serverless scaffold: `api/index.ts` (Hono) + `vercel.json` rewrite + live `/healthz` smoke test
- [x] 2.7 Supabase: Drizzle schema + generated migrations (init + RLS), `.env.example`, seed script
- [~] 2.8 **Await approval of the Stage 2 environment (verified end-to-end)**
      — Code, tooling and live deployment are done and verified. The one open item is the
        database choice below; it does **not** block Stage 3 tasks 3.1–3.6.

### Supabase blocker

The supplied Supabase token is read-only for project administration: `POST /v1/projects`
returns **403 Forbidden**, `GET /v1/organizations` returns `[]`, and
`GET /v1/organizations/{id}/members` returns 403. It can read the existing `my-portfolio`
project (ref `yuiehpvsmqrjgjbdpqlb`, eu-west-1, healthy) but **cannot create a new project**.

Options — needs a user decision:

- [ ] **(a)** Reuse the existing `my-portfolio` project (add the game tables alongside its current tables)
- [ ] **(b)** User creates a project in the Supabase dashboard and supplies `DATABASE_URL` (pooler, 6543) + `DIRECT_URL` (5432)
- [ ] **(c)** Supply a Supabase token with project-creation scope, and the project is created automatically

Until one is chosen, `/readyz` correctly reports `503 · database: not-configured`.

## Stage 3 — Core hardening & backend

- [ ] 3.1 `core/ports`: `Rng`, `KeyValueStore`, `Clock`, `AudioSink`, `Telemetry`, `Logger`
- [ ] 3.2 `core/adapters`: seeded `mulberry32` RNG (enables F1 daily + F7 replay + deterministic tests),
      schema-versioned Zod storage, WebAudio adapter, no-op telemetry
- [ ] 3.3 Error boundary + RAF watchdog + dev error overlay
- [ ] 3.4 Fix A3–A9: SSR guard, render-time side effects, RAF teardown on resize, UUID ids,
      font-metric stabilisation, storage validation
- [ ] 3.5 Unit tests: engine rules, BFS distance fields, difficulty curves, combo/pulse/shield logic, storage, `sanitizeName`
- [ ] 3.6 Integration tests: deterministic headless run to game-over via seeded RNG (reuse the balance harness)
- [ ] 3.7 API: `POST /auth/anonymous`, `GET|PATCH /me`, `POST /runs/start`, `POST /runs/:id/submit`,
      `GET /leaderboard`, `GET /leaderboard/around`, `GET /daily`, `GET /healthz`, `GET /readyz`
- [ ] 3.8 Anti-cheat: envelope validation, run attestation (nonce + hash chain), statistical flagging → `audit_log`
- [ ] 3.9 **Moderation**: display-name profanity filter, report endpoint, moderation queue view
- [ ] 3.10 Rate limiting (pluggable: in-memory dev / Upstash prod) + security headers + CORS allowlist
- [ ] 3.11 API integration tests against a test database + shared contract types
- [ ] 3.12 Legacy-score migration: tag existing local entries `scoringVersion: 1`, new entries `2`
- [ ] 3.13 Bug-fix pass; all tests green; **await approval**

## Stage 4 — Frontend, integration, accessibility

- [ ] 4.1 Composition root: replace direct engine coupling in `App.tsx` with `app/` providers + typed hooks
- [ ] 4.2 Loading / error / empty / offline states; retry + exponential backoff for leaderboard sync
- [ ] 4.3 **F2** combo rebalance (tapering window, decay to ×4) + **F3** score rebalance (kill values, graze reward)
- [ ] 4.4 **U3** shape/pattern enemy tiers + colour-blind mode · **U6** contrast pass + `prefers-contrast` theme
- [ ] 4.5 **U1** accessible canvas (live-region HUD mirror) · **U2** modal dialog semantics + focus trap · **U10** scoped `user-select`
- [ ] 4.6 **U4** persistent pulse-charge meter · **U5** persistent combo meter with drain bar ·
      **U8** non-shaking score readout · **U11** stronger spawn telegraph
- [ ] 4.7 **U7/F14** settings screen (sound, haptics, motion, contrast, colour-blind, difficulty)
- [ ] 4.8 **F6** global + daily leaderboard UI (scope switcher, rank, percentile, "you are here" slice)
- [ ] 4.9 **F1** daily seeded challenge · **F13** persistent profile · **U14** display name in settings
- [ ] 4.10 **F15** first-run onboarding · **F16** death recap · **F17** statistics screen
- [ ] 4.11 **F4** run modifiers every 3 levels · **F5** achievements · **F12** Zen/Hardcore modes
- [ ] 4.12 **F8** share card (Vercel OG image)
- [ ] 4.13 **U9** 44×44 touch targets · **U12** boot skeleton · **U13** attract backdrop ·
      **U15** music bed · **U16** haptics · **U17** full reduced-motion · **U18** keyboard help dialog
- [ ] 4.14 **U19** self-host fonts · **U20** PWA (manifest, icons, service worker, offline shell)
- [ ] 4.15 Responsive pass: 320 px → 4K, portrait/landscape, safe-area insets, mid-tier mobile profiling
- [ ] 4.16 a11y: axe in CI + manual NVDA/VoiceOver passes; Lighthouse a11y ≥ 95
- [ ] 4.17 Zero `tsc` errors, zero lint errors, build green; **await approval**

## Stage 5 — Production readiness & release

- [ ] 5.1 Multi-stage Dockerfile + nginx (security headers, brotli/gzip, cache policy) + compose
- [ ] 5.2 CI (`ci.yml`): lint → typecheck → unit(coverage gate) → build → E2E + axe → Lighthouse budgets → `npm audit`
- [ ] 5.3 CD (`release.yml`): Vercel preview per PR, production on tag; secrets via Vercel + GitHub Actions
- [ ] 5.4 Supabase: apply migrations to the user's project, verify RLS policies, backup/restore runbook
- [ ] 5.5 Docs: README, ARCHITECTURE, DEPLOYMENT, SECURITY, ACCESSIBILITY, API, CONTRIBUTING, CHANGELOG
- [ ] 5.6 Repo hygiene: issue/PR templates, labels, milestones, branch protection, CODEOWNERS, Dependabot
- [ ] 5.7 `v1.0.0` tag + GitHub Release with assets; final verification report

---

## Backlog · deferred beyond v1.0.0

- [ ] **v1.2.0** F7 ghost replay + server-side replay verification · F9 power-ups · F10 new archetypes · F11 boss · F18 i18n · U21–U24


## Stage 2 verification

| Check | Result |
|---|---|
| `npm run typecheck` (app + node projects) | ✅ 0 errors |
| `npm run lint` (errors) | ✅ 0 |
| `npx vitest run` | ✅ **199 tests / 20 files passing** |
| Coverage (statements / branches / functions / lines) | ✅ **70.8 % / 62.9 % / 67.8 % / 72.6 %** |
| `npm run build` | ✅ 274.62 kB (85.88 kB gzip) single file |
| `npx prettier --check .` | ✅ clean |
| husky pre-commit (lint-staged) + commit-msg (commitlint) | ✅ installed and verified |
| Generated migrations | ✅ `0000_init.sql`, `0001_rls.sql` |
| `npx vitest run` (final, after API fixes) | ✅ **206 tests / 21 files passing** |

### Live deployment

- Vercel project **gridbox-intelligence** (`prj_wJ9rt8VB2uMlCkgde2cdZwOE4Upn`) · auto-deploys from `main`
- **https://gridbox-intelligence.vercel.app**

| Request | Result |
|---|---|
| `GET /` | ✅ 200 · 274,616 bytes · `<title>Gridbox Intelligence</title>` |
| `GET /api/v1/healthz` | ✅ 200 · `{"status":"ok","environment":"production"}` |
| `GET /api/v1/readyz` | ✅ 503 · `{"status":"degraded","database":"not-configured"}` — correct pending DB |
| `GET /api/v1/nope` | ✅ 404 · structured error body with `requestId` |

**Three deployment defects found and fixed** (all verified against the live deployment,
not just locally):

1. `api/[[...route]].ts` never matched — dynamic filename segments are a Next.js feature;
   with `framework: "vite"` Vercel maps filenames to routes literally. → Single function
   `api/index.ts` + `vercel.json` rewrite of `/api/v1/*`, with the `/api` prefix stripped
   before Hono dispatch.
2. Hono routes were declared as `/v1/*` but Vercel invokes with the full path
   `/api/v1/*`. → `createApp({ basePath })`, mounted at `/api`.
3. `ERR_MODULE_NOT_FOUND` for `/var/task/server/app` — `"type": "module"` makes Vercel emit
   real ESM and trace by specifier, so extensionless relative imports were neither bundled
   nor copied. → Explicit `.js` extensions across the server graph (`api`, `server`, `db`).

**Note:** `eslint --max-warnings=0` is intentionally not yet the CI gate. The 12 outstanding warnings are
the `react-hooks/immutability` findings quarantined to `src/app/App.tsx`, which are resolved by task 4.1.
CI switches to `--max-warnings=0` once that lands.

---

## Verification log

| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | ✅ 0 errors |
| `vite build` | ✅ 271.45 kB / 84.74 kB gzip single file |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Dangerous sinks (`innerHTML`/`eval`/`document.write`) | ✅ none |
| PAT exposure in tracked files / `.git/config` | ✅ none (verified by `git grep`) |
| Headless balance harness | ✅ 550 simulated runs across two bots |
| Baseline pushed | ✅ `6b87f5e` (import) → `d75894f` (review) → `c2a301a` (teardown) |
