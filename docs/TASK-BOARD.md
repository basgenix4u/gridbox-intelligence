# Gridbox Intelligence — Master Task Board

> **Canonical board.** Supersedes the board embedded in `ARCHITECTURE-REVIEW.md §7`.
> Legend: `[ ]` Pending · `[~]` **In Progress — exactly one at any time** · `[x]` Completed
> Last updated: 2026-10-10 · Repo: [github.com/basgenix4u/gridbox-intelligence](https://github.com/basgenix4u/gridbox-intelligence)

**Decisions locked:** no PRD (spec is derived) · deliverable = the game · architecture = Option B
(full-stack) · deploy = **Vercel + Supabase** · API = **Hono** on Vercel Functions.

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
- [~] 1.9 **Await approval of product teardown, feature scope and release plan**

## Stage 2 — Environment & tooling *(target v0.1.0)*

- [ ] 2.1 Restructure to `core/ game/ ui/ app/`; add `tsconfig.node.json`, `@/*` path aliases
- [ ] 2.2 ESLint 9 flat config (typescript-eslint strict) + Prettier + EditorConfig + `.nvmrc`
- [ ] 2.3 Vitest (node + jsdom projects) with coverage thresholds; Playwright + `@axe-core/playwright`
- [ ] 2.4 husky + lint-staged pre-commit; commitlint (Conventional Commits)
- [ ] 2.5 Scripts: `dev build preview typecheck lint format test test:coverage test:e2e test:a11y verify`
- [ ] 2.6 Serverless scaffold: `api/[[...route]].ts` (Hono) + `vercel.json` + `/healthz` smoke test
- [ ] 2.7 Supabase: schema migration (`players`, `runs`, `audit_log`, views, RLS), `.env.example`, local seed
- [ ] 2.8 Verify environment end-to-end; **await approval**

## Stage 3 — Core hardening & backend *(target v0.1.0)*

- [ ] 3.1 `core/ports`: `Rng`, `Storage`, `Clock`, `Audio`, `Telemetry`, `Logger`
- [ ] 3.2 `core/adapters`: seeded `mulberry32` RNG (enables F1/F7 + replayable tests), schema-versioned Zod storage, WebAudio, no-op telemetry
- [ ] 3.3 Error boundary + RAF watchdog + dev error overlay
- [ ] 3.4 Fix A3–A9: SSR guard, render-time side effects, RAF teardown on resize, UUID ids, font-metric stabilisation, storage validation
- [ ] 3.5 Unit tests: engine rules, BFS distance fields, difficulty curves, combo/pulse/shield logic, storage, `sanitizeName`
- [ ] 3.6 Integration tests: deterministic headless run to game-over via seeded RNG (reuse the balance harness)
- [ ] 3.7 API: `POST /auth/anonymous`, `GET|PATCH /me`, `POST /runs/start`, `POST /runs/:id/submit`, `GET /leaderboard`, `GET /leaderboard/around`, `GET /daily`, `GET /healthz`, `GET /readyz`
- [ ] 3.8 Anti-cheat: envelope validation, run attestation (nonce + hash chain), statistical flagging → `audit_log`
- [ ] 3.9 Rate limiting (Upstash Redis) + security headers (Helmet/CSP) + CORS allowlist
- [ ] 3.10 API tests (integration, against a test database) + contract types shared with the client
- [ ] 3.11 Bug-fix pass; all tests green; **await approval**

## Stage 4 — Frontend, integration, accessibility *(target v0.2.0 → v1.0.0)*

- [ ] 4.1 Composition root: replace direct engine coupling in `App.tsx` with `app/` providers + typed hooks
- [ ] 4.2 Loading / error / empty / offline states; retry + exponential backoff for leaderboard sync
- [ ] 4.3 **F2** combo rebalance (tapering window, decay to ×4) + **F3** score rebalance (kill values, graze reward)
- [ ] 4.4 **U4** persistent pulse-charge meter · **U5** persistent combo meter with drain bar · **U8** non-shaking score readout · **U11** stronger spawn telegraph
- [ ] 4.5 **U1** accessible canvas (live-region HUD mirror) · **U2** modal dialog semantics + focus trap · **U10** scoped `user-select`
- [ ] 4.6 **U3** shape/pattern enemy tiers + colour-blind mode · **U6** contrast pass + `prefers-contrast` theme
- [ ] 4.7 **U7/F14** settings screen (sound, haptics, motion, contrast, colour-blind, difficulty)
- [ ] 4.8 **F6** global + daily leaderboard UI (scope switcher, rank, percentile, "you are here" slice)
- [ ] 4.9 **F1** daily seeded challenge · **F13** persistent profile · **U14** name in settings
- [ ] 4.10 **U9** 44×44 touch targets, D-pad/pause separation · **U12** boot skeleton · **U17** full reduced-motion
- [ ] 4.11 **U19** self-host fonts · **U20** PWA (manifest, icons, service worker, offline shell)
- [ ] 4.12 Responsive pass: 320 px → 4K, portrait/landscape, safe-area insets, mid-tier mobile profiling
- [ ] 4.13 a11y: axe in CI + manual NVDA/VoiceOver passes; Lighthouse a11y ≥ 95
- [ ] 4.14 Zero `tsc` errors, zero lint errors, build green; **await approval**

## Stage 5 — Production readiness & release *(target v1.0.0)*

- [ ] 5.1 Multi-stage Dockerfile + nginx (security headers, brotli/gzip, cache policy) + compose
- [ ] 5.2 CI (`ci.yml`): lint → typecheck → unit(coverage gate) → build → E2E + axe → Lighthouse budgets → `npm audit`
- [ ] 5.3 CD (`release.yml`): Vercel preview per PR, production on tag; env/secrets via Vercel + GitHub Actions
- [ ] 5.4 Supabase: production project, migrations pipeline, RLS policies, backup/restore runbook
- [ ] 5.5 Docs: README, ARCHITECTURE, DEPLOYMENT, SECURITY, ACCESSIBILITY, API, CONTRIBUTING, CHANGELOG
- [ ] 5.6 Repo hygiene: issue/PR templates, labels, milestones, branch protection, CODEOWNERS, Dependabot
- [ ] 5.7 `v1.0.0` tag + GitHub Release with assets; final verification report

---

## Backlog · deferred beyond v1.0.0

- [ ] **v1.1.0** F4 run modifiers · F5 achievements · F8 share card · F12 Zen/Hardcore modes · F15 onboarding · F16 death recap · F17 stats screen · U13 attract backdrop · U15 music · U16 haptics · U18 keyboard help
- [ ] **v1.2.0** F7 ghost replay + server-side replay verification · F9 power-ups · F10 new archetypes · F11 boss · F18 i18n · U21–U24

---

## Verification log

| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | ✅ 0 errors |
| `vite build` | ✅ 271.45 kB / 84.74 kB gzip single file |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Dangerous sinks (`innerHTML`/`eval`/`document.write`) | ✅ none |
| PAT exposure in tracked files / `.git/config` | ✅ none (verified by `git grep`) |
| Baseline pushed | ✅ `6b87f5e` (import) → `d75894f` (architecture review) |
| Headless balance harness | ✅ 550 simulated runs across two bots |
