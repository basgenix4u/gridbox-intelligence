# Gridbox Intelligence — Master Task Board

> **Canonical board.** Supersedes the board embedded in `ARCHITECTURE-REVIEW.md §7`.
> Legend: `[ ]` Pending · `[~]` **In Progress — exactly one at any time** · `[x]` Completed
> Last updated: 2026-10-24 · Repo: [github.com/basgenix4u/gridbox-intelligence](https://github.com/basgenix4u/gridbox-intelligence)

## Decisions locked

| Ref | Decision |
|---|---|
| PRD | **Present.** `PRD.md` is the single source of truth (added 2026-10-18); this board tracks execution against it |
| Deliverable | **Gridbox Intelligence (the game)** |
| Architecture | **Option B** — full-stack leaderboard |
| Deploy | **Vercel + Neon** · API = **Hono** on Vercel Serverless Functions |
| Release scope | **One release containing P0 + P1** (no separate v1.1.0) |
| Rebalance | **Approved.** Combo tapering + kill-value rebalance. Existing local scores are **preserved and tagged** as legacy scoring, not deleted |
| Names | **Both** — long display name on the profile, 3-char initials in compact leaderboard rows → requires profanity filtering, moderation queue and report flow |
| Database (2026-10-24) | **Dedicated Neon project** `gridbox-intelligence` (`old-sun-52286414`, eu-west-2, PostgreSQL 17), isolated in a `gridbox` schema. Reached as the least-privilege `gridbox_app` role over Neon's pooled endpoint; migrations use the direct endpoint. Supersedes the earlier shared-`my-portfolio`-Supabase decision |
| Leaderboard shape (2026-10-24) | **Both** — daily board from `leaderboard_daily` + global best-run-per-player from `runs`. Schema already supports both; no new migration |
| Name policy (2026-10-24) | **Filter + report + admin clear.** Normalized wordlist filter (leet/unicode-folded, 2–16 chars) at write time; `POST /names/:id/report` feeds `name_reports`; owner clears the queue via a token-protected admin endpoint (`MODERATION_TOKEN`). Satisfies acceptance criterion 5 |
| Anti-cheat (2026-10-24) | **Two-tier.** Above harness p99 + 20% margin → `validity='suspect'` (hidden from boards, kept for analysis); only physically impossible runs (score above the theoretical maximum for their duration) → `validity='rejected'` |
| Initials policy (2026-10-24) | Same normalized wordlist applied to the 3-char initials string, plus a small blocklist of known 3-letter combinations |
| Local-score migration (2026-10-24) | **One-time, idempotent.** When a returning player sets their username after the upgrade, their legacy local score history is batch-uploaded (tagged `scoringVersion: 1`), deduped by client-supplied id, folded into profile totals, and a local flag prevents re-upload |

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
- [x] 2.7 Supabase: Drizzle schema in the `gridbox` schema + migrations (init + RLS), `bootstrap.sql`,
      `.env.example`, seed script — **applied and verified live**
- [x] 2.8 **Approved — Stage 2 environment signed off 2026-10-24.** Code, tooling, live deployment and the
      database all verified end-to-end in a fresh session (deps installed, typecheck/lint/test/build green).

### Supabase — resolved

The supplied token could not create a project (`POST /v1/projects` → 403), so per the user's
decision the game reuses the existing **`my-portfolio`** project (ref `yuiehpvsmqrjgjbdpqlb`,
eu-west-1). The hard requirement was *"don't let the update affect my portfolio's own"*, which
drove every choice below.

**Isolation.** `public` already contained an `audit_log` table plus ~80 rows of live content
(`projects` 8, `project_tech` 34, `social_links` 6 …). Everything the game owns therefore lives
in a dedicated **`gridbox`** schema: no name collisions, no `ALTER` of anyone else's tables, and
grants scoped to that one schema. Verified after migration: `public` still has 18 tables and
`audit_log` still has its 9 rows.

**Credentials.** The database password was never needed and was never reset — resetting it would
have broken the portfolio's existing connections. Instead the Supabase Management API's SQL
endpoint ran the privileged bootstrap (`db/bootstrap.sql`), creating a least-privilege
`gridbox_app` role (NOSUPERUSER / NOCREATEDB / NOREPLICATION / NOBYPASSRLS) with rights on
`gridbox` only.

**Connectivity.** Two findings that are not in the dashboard snippets:

- `db.<ref>.supabase.co` publishes an **AAAA record only** (IPv6 is Supabase's default; IPv4
  direct access is a paid add-on). Vercel's Lambdas egress over IPv4, so the pooler is the only
  route that works from production.
- The pooler for this project is **`aws-1-eu-west-1`**, not the commonly documented `aws-0-*`;
  the latter answers `tenant/user not found`.

Because the API connects as a plain `NOBYPASSRLS` role rather than `service_role`, the RLS
policies in `0001_rls.sql` are load-bearing rather than decorative.


## Stage 3 — Core hardening & backend

- [x] 3.1 `core/ports`: `Rng`, `KeyValueStore`, `Clock`, `AudioSink`, `Telemetry`, `Logger`
- [x] 3.2 `core/adapters`: seeded `mulberry32` RNG (enables F1 daily + F7 replay + deterministic tests),
      schema-versioned storage, WebAudio adapter, no-op telemetry — **deviation:** storage validation is
      hand-rolled, not Zod (Zod cost +88 kB on the client; see `scoring.ts` for the rationale)
- [x] 3.3 Error boundary + RAF watchdog + dev error overlay
      — `src/ui/components/ErrorBoundary.tsx` (recovery panel, focus management, DEV-only stack overlay, console
      logging, optional `onError` reporter) wired in `main.tsx`; pure watchdog core in `src/game/rafWatchdog.ts`
      (injectable clock/timers/visibility, 2.5 s stall window, arm/disarm re-opens the grace window) driven by
      the canvas frame loop; `useStallGuard` pauses the run and shows `StallNotice` (role=alert) with
      Resume / Main menu; auto-dismiss on recovery. Engine gained `pause()`/`resume()` methods, which also
      removed 4 pre-existing lint warnings. 26 new tests.
- [x] 3.4 Fix A3–A9 — **verified already complete 2026-10-24:** SSR guard (`detectTouch` typeof-window check),
      render-time side effects (refs written in effects, never during render), RAF teardown on resize
      (effect cleanup cancels the loop and removes listeners; resize only re-applies sizing), UUID ids
      (`createRunId` via `crypto.randomUUID` with fallback), font-metric stabilisation (`document.fonts.load`
      preloading in `GameCanvas`), storage validation (hand-rolled `parseEntry`/`parseScores` predicates in
      `scoring.ts` — Zod deliberately avoided on the client for the ~88 kB bundle cost, rationale in-file)
- [x] 3.5 Unit tests: engine rules, BFS distance fields, difficulty curves, combo/pulse logic, storage, `sanitizeName`
      — **verified complete 2026-10-24: 240 tests / 25 files passing.** ("shield" removed from this line — no
      shield exists in the game; it was a stale reference.)
- [x] 3.6 Integration tests: deterministic headless run to game-over via seeded RNG
      — `src/test/harness.ts` (the hardened, in-repo successor of the external balance harness: seeded game
      factory, fixed-step driver, run fingerprint, `runToGameOver` with the engine's death-beat handling,
      median/percentile), `src/test/bots.ts` (greedy skill-ceiling bot + random floor bot), and
      `src/game/headlessRun.test.ts` (8 tests: seed-identical replay, per-seed divergence, game-over
      termination with coherent stats, structural bounds, skill floor/ceiling gap, stable score-per-second
      distribution for the anti-cheat baseline). `engine.test.ts` refactored onto the shared harness.
- [x] 3.7 API: `POST /auth/anonymous`, `GET|PATCH /me`, `POST /runs/start`, `POST /runs/:id/submit`,
      `GET /leaderboard`, `GET /leaderboard/around`, `GET /leaderboard/daily`, `GET /healthz`, `GET /readyz`
      — commit `d2d30ea`. `src/shared/contracts.ts` (one Zod contract, client + server); hexagonal
      `server/ports/repositories.ts` with memory (test seam) + drizzle adapters; `server/auth.ts`
      (90-day session JWTs, 2-hour run-start tokens, sha256-hashed bearers, required-on-write /
      optional-on-read session middleware); services `players` / `runs` / `leaderboard` / `moderation`;
      routes `auth` / `me` / `runs` / `leaderboard` / `moderation` (+token-protected admin resolve);
      `db/migrations/0002` composite PK on `leaderboard_daily`. `src/shared/calibration.ts` holds the
      harness-measured p99 (253) with a drift guard in `src/game/headlessRun.test.ts`. Tests:
      `server/routes/api.test.ts` (25 end-to-end over memory repos), `server/names.test.ts`,
      `server/services/anticheat.test.ts`, `server/ratelimit.test.ts`, `src/shared/contracts.test.ts`
      → verify green: 0 errors / 10 pre-existing warnings, 357 tests / 36 files, build 295.20 kB.
      The endpoints 3.8–3.10 describe (attestation, two-tier flagging, rate limiting) shipped inside
      this task as the run service, `services/anticheat.ts` and `ratelimit.ts`; 3.9's filter + queue
      shipped as `server/names.ts` + `routes/moderation.ts`. Remaining for those rows: the
      database-backed integration pass (3.11) and the client wiring (Stage 4).
- [x] 3.8 Anti-cheat: envelope validation, run attestation (nonce + hash chain), statistical flagging → `audit_log`
      — commit `fc038e0`. Everything 3.7 shipped plus the wall-clock envelope
      (a run's claimed duration must fit the time that actually passed since the
      server issued it; 10s of slack so clock skew flags rather than rejects),
      an injectable clock end-to-end (`AppOptions.now` → token issuance), and
      `AuditRepository.list()` so flagged/rejected runs and moderation
      resolutions read back as a trail. `server/services/runs.test.ts` (23
      tests) covers utcDay/dailySeed, chain recomputation, token binding,
      replay 409, both verdict tiers with their audit entries, the timing
      cheat, and the stored-as-evidence rule for rejected runs.
- [x] 3.9 **Moderation**: display-name profanity filter, report endpoint, moderation queue view
      — filter, report endpoint and token-protected admin resolve shipped in
      `d2d30ea` (3.7): `server/names.ts` (leet/unicode-folded wordlist, word
      boundaries so "Scunthorpe" stays playable, single-letter-run collapse for
      the "f u c k" evasion, initials blocklist), `POST /v1/names/:id/report`,
      `GET /v1/admin/moderation`, `POST /v1/admin/moderation/:id`. Held names
      are excluded from every board at SQL level in the drizzle adapter and in
      memory for tests. 12 tests in `server/names.test.ts` + the moderation
      block of the API suite (report holds the name, clear restores it, uphold
      resets it, self-report and unknown player refused).
- [x] 3.10 Rate limiting (pluggable: in-memory dev / Upstash prod) + security headers + CORS allowlist
      — `server/ratelimit.ts` (fixed windows per key: auth 10/min, submit
      20/min, report 5/h, read 120/min; Upstash REST adapter, fail-open on
      backend errors) shipped in 3.7; `secureHeaders` on every response.
      Commit `33805a8` closes the last gap: the CORS allowlist **fails closed**
      — an environment that did not validate approves no cross-origin request
      instead of falling back to `*` — and production pins `ALLOWED_ORIGINS`
      (explicit origins, no wildcard) plus `AUTH_SECRET` via a superRefine, so
      `/readyz` reports the misconfiguration as degraded. Covered by
      `server/env.test.ts` (10 tests) and five CORS tests.
- [x] 3.11 API integration tests against a test database + shared contract types
      — commit `84bc548`. Shared contract types shipped with the API
      (`src/shared/contracts.ts`, 24 tests). The database half uses **PGlite**
      — Postgres compiled to WASM, in-process — booted by
      `server/adapters/testDatabase.ts`, which replays the project's own
      migration files so schema drift fails the suite first.
      `server/adapters/drizzleRepositories.test.ts` (25 tests) covers the SQL
      the memory fakes cannot: composite-key daily upsert, DISTINCT ON
      best-per-player, rank window function, held-name exclusion on both
      boards, unique token hash, FK cascade / set-null. `api.integration.test.ts`
      (6 tests) drives the whole stack over that database. The suite found two
      real driver bugs on day one — `db.execute()`'s result shape differs per
      driver, and the 23505 replay guard missed the SQLSTATE when the driver
      wraps the error — both fixed in the adapter.
- [x] 3.12 Legacy-score migration: tag existing local entries `scoringVersion: 1`, new entries `2`
      — commit `1152633`. The version fields existed but the upgrade was not
      durable: `loadScores` now detects a pre-versioning table and writes the
      tagged list back once (idempotent — the second load finds nothing to
      change), and `ScoreTable` labels a legacy-formula row with a small `v1`
      badge rather than hiding it. 5 new tests.
- [ ] 3.13 **Local-score migration (2026-10-24)**: one-time idempotent upload of a returning player's legacy
      local history when they set their username — batch endpoint, client-supplied ids for dedupe, entries
      tagged `scoringVersion: 1` + `migrated`, folded into profile totals (`totalRuns`, `bestScore`), local
      storage flag prevents re-upload; failures retry without duplicating
- [x] 3.14 Bug-fix pass; all tests green — commit `3cc331d`, **awaiting approval**
      — Two real defects found by probing the live deployment and re-reading the
        new adapters: (1) `/healthz` reported the *salvaged* environment — when the
        env fails validation, `readEnv` re-parses without the offending keys and
        `NODE_ENV` falls back to `development`, so a broken production deployment
        claimed to be development. It now reports the configured environment plus a
        `configured` flag. (2) the in-memory rate limiter never released a silent
        key, so a long-lived process accumulated one bucket per IP it had ever seen;
        expired buckets are swept every 1000 new keys. `.env.example` documents
        `MODERATION_TOKEN` (missing entirely) and the production invariants.
        **Live deployment state (2026-10-24):** the API is deployed and running this
        code, but the Vercel project has no `DATABASE_URL`, no `AUTH_SECRET` and no
        `ALLOWED_ORIGINS` — `/readyz` reports all three as degraded and the API
        cannot serve authenticated traffic. Env vars are a dashboard action.
        Migrations `0002` (leaderboard composite PK) and `0003` (legacy_scores) are
        generated and proven against PGlite but **not yet applied to the live
        database** — both are needed before the new endpoints can work there.

- [x] 3.15 **Production settled** (user-directed: fix production before any frontend work)
      — **Database moved to a dedicated Neon project** `gridbox-intelligence`
        (`old-sun-52286414`, eu-west-2, PostgreSQL 17, org `Alims`). The game had been
        sharing the `my-portfolio` Supabase project; it now has its own, reached as the
        least-privilege `gridbox_app` role over Neon's **pooled** endpoint. One-time
        bootstrap rewritten for Neon (`db/bootstrap.sql`): schema, `NOBYPASSRLS` role,
        scoped grants, `search_path`, and default privileges.
      — **All four migrations applied to the live database** (`0000`–`0003`): 4 rows in
        `gridbox.__drizzle_migrations`, `legacy_scores` present with its
        `(player_id, client_id)` unique constraint, `leaderboard_daily` carrying the
        composite primary key. `0001_rls.sql` was made portable first: its
        `service_role` / `anon` / `authenticated` policies are Supabase-only roles, so
        they are now created inside `DO` blocks that skip when the role is absent. The
        application-role policies — the load-bearing ones — are unchanged.
      — **`npm run db:migrate` prefers `DIRECT_URL`** over `DATABASE_URL` (DDL through a
        transaction-mode pooler is at best awkward, at worst silently split), falling
        back to `DATABASE_URL` as before.
      — **All four missing Vercel env vars set** on `gridbox-intelligence`
        (`DATABASE_URL` → Neon pooled, `AUTH_SECRET` 64-hex, `ALLOWED_ORIGINS` →
        `https://gridbox-intelligence.vercel.app`, `MODERATION_TOKEN` 48-hex), all typed
        `encrypted` and scoped to production/preview/development. Secrets were generated
        in this workspace and never printed.
      — Stale Supabase comments corrected across `server/env.ts`, `db/client.ts`,
        `db/schema.ts`, `drizzle.config.ts`, `drizzleRepositories.ts`, `.env.example`,
        `README.md`, `PRD.md §2.4` and the board; `docs/PRODUCT-TEARDOWN.md` carries a
        dated revision note rather than a rewrite.

## Stage 4 — Frontend, integration, accessibility

- [x] 4.0 **Palette UI + psychology engagement layer** (user-directed)
      — Design tokens from the user's 3-colour palette (Midnight Violet `#1f0322`, Dark Magenta
        `#8a1c7c`, Magenta Bloom `#da4167`), WCAG-checked scale, canvas world retinted;
        research synthesis in `docs/PSYCHOLOGY-DESIGN.md`; persistent profile + play-streaks;
        12 achievements with **endowed progress** + **goal-gradient** rails ("SO CLOSE",
        nearest-first); personal-best badge; one-more-run nudge on the death recap;
        player-sprite accent picker (5 presets); unlock toasts
- [x] 4.0b **Mobile responsive pass + mature palette polish** (user-directed)
      — Root-caused the mobile "overlaps / not fitted to scale": the decorative aurora layer
        extended past the viewport and expanded the document scroll area by 66–174px, so mobile
        browsers panned and shrank the whole layout. Contained it (`overflow: hidden`,
        in-viewport drift). Fluid `clamp()` type and touch targets (44px floor), safe-area
        insets, landscape panel widening, `table-fixed` score tables. Palette maturity pass:
        deep-rose button fills (bloom-600/700, white label 5.3:1+), hairline borders instead
        of gradient rims, calm veil labels with bloom reserved for accents, restrained glows.
        Verified: 320/375/390 portrait + 667/844 landscape + 768 tablet — zero horizontal
        overflow, zero clipped controls, overlay renders at every size
- [ ] 4.1 Composition root: replace direct engine coupling in `App.tsx` with `app/` providers + typed hooks
- [ ] 4.1b **API client + the legacy-migration trigger** — the typed client for the v1 contract
      (session, run start/submit, boards) and the call to
      `src/app/migrateLocalScores.ts` when a returning player sets their username
      (3.13 built the endpoint and the client module; nothing calls them yet)
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

### Stage 3/4 — palette + engagement layer

| Check | Result |
|---|---|
| Palette contrast audit | ✅ all text pairs ≥ 4.5:1, non-text ≥ 3:1 (ratios recorded in `index.css`) |
| UI + canvas rethemed | ✅ screenshots verified: menu, run, pause, scores, death recap |
| Psychology research | ✅ `docs/PSYCHOLOGY-DESIGN.md` — 8 cited sources, feature mapping, ethics constraints |
| Profile / streaks / achievements | ✅ pure domain on `KeyValueStore` port, hand-validated, 24 unit tests |
| `npx vitest run` | ✅ **240 tests / 25 files passing** |
| `npm run typecheck` / `eslint --quiet` / `prettier --check` | ✅ 0 / 0 / clean |
| `npm run build` | ✅ 290.10 kB (90.07 kB gzip) single file |
| Mobile viewport matrix | ✅ 6 sizes 320→768: `docW == viewportW` everywhere, no clipped controls (was 66–174px overflow) |

### Database — live

| Check | Result |
|---|---|
| Migrations applied | ✅ `0000_init` + `0001_rls` via the pooler |
| Tables in `gridbox` | ✅ `players`, `runs`, `name_reports`, `audit_log`, `leaderboard_daily` |
| RLS enabled + policies | ✅ all 5 tables, 12 policies |
| Enums | ✅ `run_mode`, `run_validity` |
| Migration bookkeeping | ✅ `gridbox.__drizzle_migrations` (nothing written to `public`) |
| Portfolio `public` schema | ✅ unchanged — 18 tables, `audit_log` 9 rows, `projects` 8 rows |
| `gridbox_app` privileges | ✅ non-superuser, no CREATEDB, rights on `gridbox` only |

### Live deployment

- Vercel project **gridbox-intelligence** (`prj_wJ9rt8VB2uMlCkgde2cdZwOE4Upn`) · auto-deploys from `main`
- **https://gridbox-intelligence.vercel.app**

| Request | Result |
|---|---|
| `GET /` | ✅ 200 · 274,616 bytes · `<title>Gridbox Intelligence</title>` |
| `GET /api/v1/healthz` | ✅ 200 · `{"status":"ok","environment":"production"}` |
| `GET /api/v1/readyz` | ✅ **200 · `{"status":"ready","database":"up"}`** |
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

**Note:** `eslint --max-warnings=0` is intentionally not yet the CI gate. The 14 outstanding warnings are 12
`react-hooks/immutability` findings quarantined to `src/app/App.tsx` (resolved by task 4.1) plus 2 `no-console`
findings in `src/core/adapters/consoleLogger.ts` (intentional: the logger adapter wraps console by design — will
be silenced with a scoped eslint-disable when the gate lands). CI switches to `--max-warnings=0` once 4.1 lands.

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

---

## Session log — 2026-10-24 (Stage 1 re-validation + decisions)

**Authentication.** GitHub PAT validated against the API (account `basgenix4u`); stored only in the git
credential store (excluded from snapshots/logs); never printed, echoed or committed. Clone + full
re-verification of the repository.

| Check | Result |
|---|---|
| `npm ci` (Node 20.20.2, matches `.nvmrc`) | ✅ clean install |
| `npm run typecheck` (app + node projects) | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors · 14 warnings (12 `react-hooks/immutability` in `App.tsx`, 2 `no-console` in `consoleLogger.ts`) |
| `npm run test` | ✅ **240 tests / 25 files passing** (matches PRD §2.6) |
| `npm run build` | ✅ 290.10 kB (90.07 kB gzip) single file (matches PRD) |
| Git state | ✅ `main` clean, level with `origin/main` |

**Board corrections applied this session:** 2.8 marked approved; 3.5 marked complete (verified — the stale
"shield" reference removed); exactly one `[~]` restored (3.3); PRD marked present in the decisions table.

**PRD §6 open questions — all four resolved and locked** (see Decisions locked table): leaderboard = both;
names = filter + report queue + token-protected admin clear; anti-cheat = two-tier flag/reject; initials =
same normalized filter + 3-letter blocklist.

**New requirement captured from the user:** one-time idempotent migration of each returning player's local
score history into the system when they set their username after the upgrade → tracked as task 3.13.
