# Gridbox Intelligence — Stage 1: Architecture Review & Validation

> **Stage 1 deliverable (awaiting approval before Stage 2).**
> Prepared by the Software Factory team: Principal PM · Lead Architect · Senior Full-Stack Eng · DevOps/SRE · UI/UX · QA Automation.
> Date: 2026-10-10 · Repo: [github.com/basgenix4u/gridbox-intelligence](https://github.com/basgenix4u/gridbox-intelligence)

---

## 1. Executive summary

The supplied zip is **not** a project-portfolio website. It is **Gridbox Intelligence**, a complete
client-only arcade game (React 19 + Vite 7 + TypeScript strict + Tailwind v4) totalling **3,575 LOC
across 26 files**.

Good news: **the code is genuinely high quality and it already builds.** `tsc --noEmit` passes with
zero errors, `vite build` produces a single 271 kB (84.7 kB gzip) HTML file, and `npm audit` reports
**0 production vulnerabilities**. The game core is framework-free, allocation-conscious, and
surprisingly sophisticated (BFS distance-field AI with a predictive "ORACLE" enemy, pre-rendered
sprite caches, pooled particles, procedural WebAudio with zero assets).

The bad news is that "production-ready" is far away — not because the game is bad, but because the
project has **no tests, no linting, no CI, no container, no documentation, no release process, and an
incomplete accessibility story**. There is also **no backend, no database and no auth** anywhere in
the codebase, which conflicts with large parts of the brief.

**Two blockers must be resolved before Stage 2** (see §8):

1. **The PRD is missing.** The Google Doc you linked contains only your GitHub PAT — no PRD text.
2. **Scope mismatch.** Brief says "project portfolio website"; the artifact is an arcade game. The
   brief's backend/DB/auth/API requirements need an explicit decision.

---

## 2. What we received and verified

| Item | Status |
|---|---|
| Zip downloaded and extracted | ✅ 26 files |
| `npm install` (non-interactive) | ✅ 95 packages, 0 vulnerabilities |
| `tsc --noEmit` (strict) | ✅ **0 errors** |
| `vite build` | ✅ `dist/index.html` — 271.45 kB (84.74 kB gzip), 1.33 s |
| `npm audit --omit=dev` | ✅ **0 vulnerabilities** |
| Dangerous sinks (`innerHTML` / `eval` / `document.write` / `Function`) | ✅ **none found** |
| Git initialised, repo created, baseline pushed | ✅ `basgenix4u/gridbox-intelligence` @ `6b87f5e` |
| GitHub PAT validated | ✅ account `basgenix4u` (Abdulbasit Abdulalim) |

### Baseline commit

```
6b87f5e  chore: import Gridbox Intelligence baseline   (27 files)
ceddf82  Initial commit                                 (MIT licence, GitHub)
```

---

## 3. Architecture as-is

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (single-file bundle, dist/index.html — 271 kB)         │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  React 19 layer — src/App.tsx + src/components/*          │  │
│  │  Phase machine: menu | playing | paused | gameover         │  │
│  │  Overlays: Start · Pause · GameOver · ScoresPanel · D-pad  │  │
│  └───────────────┬───────────────────────────────────────────┘  │
│                  │ direct method calls (no framework boundary)  │
│  ┌───────────────▼───────────────────────────────────────────┐  │
│  │  Game core — src/game/*  (ZERO React imports)             │  │
│  │   engine.ts 956 · render.ts 469 · audio.ts 156            │  │
│  │   sprites.ts 114 · particles.ts 115 · ai.ts 69            │  │
│  │   constants.ts 95 · types.ts 109 · draw.ts 52             │  │
│  │                                                            │  │
│  │   RAF loop → game.update(dt) → renderGame(game, ctx)      │  │
│  └───────────────┬───────────────────────────────────────────┘  │
│                  │                                              │
│  ┌───────────────▼───────────────────────────────────────────┐  │
│  │  Persistence: localStorage ONLY                           │  │
│  │   gridbox-intelligence.scores.v1  (top-10 leaderboard)    │  │
│  │   gridbox-intelligence.name       (3-char initials)       │  │
│  │   gridbox-intelligence.muted      (audio flag)            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
        │                                    ▲
        │ Google Fonts (render-blocking)     │ NO backend, NO API,
        ▼                                    │ NO DB, NO auth, NO network calls
   fonts.googleapis.com
```

### What the design gets right (keep these)

| Strength | Why it matters |
|---|---|
| Game core is React-free | Sim is unit-testable in Node with **no jsdom**, no canvas mock |
| Typed arrays, pre-allocated (`Uint8Array`, `Int16Array`, `Int32Array`) | Zero per-frame allocation → no GC hitches at 60 fps |
| Multi-source BFS distance fields (`ai.ts`) | Clean, single-pass, reusable for all 4 enemy archetypes |
| ORACLE enemy pathfinds to a **predicted** player cell | Genuinely good AI design, not just "chase" |
| Offscreen sprite cache (`sprites.ts`): static grid layer, vignette, radial glows | Avoids re-rasterising gradients every frame |
| Pooled particle system | Bounded memory, no churn |
| Procedural WebAudio synth | **Zero audio assets** → tiny bundle, no loading states |
| `vite-plugin-singlefile` | One HTML file → deploy to any static host, offline-capable |
| `prefers-reduced-motion` honoured, DPR clamped to 2 | Real consideration for low-end/motion-sensitive users |
| localStorage wrapped in try/catch | Survives Safari private mode |
| `sanitizeName()` allowlist `[^A-Z0-9]` + 3-char cap | XSS surface is effectively nil |
| Visible `:focus-visible` rings, `aria-label` on icon buttons | Better a11y baseline than most hobby games |

---

## 4. Gap analysis — current vs. production-ready

Severity: 🔴 blocker · 🟠 high · 🟡 medium · 🔵 low

### A. Correctness & robustness

| # | Finding | Location | Sev | Proposed fix |
|---|---|---|---|---|
| A1 | **Zero tests.** 0 test files for 3,575 LOC | project-wide | 🔴 | Vitest unit + integration; target ≥80% on `src/game`, ≥70% overall |
| A2 | **No error boundary.** A throw inside `renderGame`/`update` white-screens the app and silently kills the RAF loop | `App.tsx` | 🔴 | `<ErrorBoundary>` + RAF watchdog that restarts the loop and reports |
| A3 | `window.innerWidth` read in `useState` initialiser → crashes in any non-DOM environment, blocks prerender/SEO | `App.tsx:88` | 🟠 | Guard with `typeof window`, move into effect |
| A4 | `readMuted()` performs `localStorage` I/O **during render** (side effect in render body) | `App.tsx:53` | 🟠 | Lazy `useState` + effect, or storage port |
| A5 | Resize effect depends on `reserveBottom`/`reserveRight` → **tears down + rebuilds the RAF loop and canvas context** on every orientation change | `GameCanvas.tsx:39-64` | 🟠 | Split sizing (effect) from loop (mount-once effect) |
| A6 | Unseeded `Math.random()` → runs are **not reproducible**; blocks golden/snapshot tests, replays, daily-seed mode | 18 sites | 🟠 | Inject seeded PRNG (`mulberry32`) through a port |
| A7 | `loadScores()` validates only `score`; hand-edited entries with bad `name`/`date` reach `formatDate()` → "Invalid Date" | `highscores.ts:29-41` | 🟡 | Zod schema + **schema versioning** on the storage key |
| A8 | Score-entry id is `Date.now() + Math.random()` → collision-prone | `App.tsx:148` | 🔵 | `crypto.randomUUID()` with fallback |
| A9 | `document.fonts.load()` fire-and-forget → canvas HUD metrics shift after font swap | `GameCanvas.tsx:53-56` | 🔵 | Await fonts, then force one resize/redraw |

### B. Security (OWASP Top 10 — 2021 mapping)

| Category | Verdict | Notes / action |
|---|---|---|
| A01 Broken access control | ⚪ N/A | No auth today. Becomes live if Option B is chosen. |
| A02 Cryptographic failures | ⚪ N/A | No secrets, no crypto. |
| A03 Injection | ✅ **Pass** | No SQL, no `innerHTML`, no `eval`. Initials allowlisted. |
| A04 Insecure design | 🟠 | **Leaderboard is client-authoritative** — editable from devtools. Acceptable for a local table; a design decision is required for any global table. |
| A05 Security misconfiguration | 🟠 | **No CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`.** Single-file build inlines all JS → CSP needs hash/nonce or deliberate `'unsafe-inline'`. |
| A06 Vulnerable components | ✅ **Pass (today)** | `npm audit` = 0. Needs to be **enforced** in CI (`npm audit --audit-level=high`) or it will regress. |
| A07 Auth failures | ⚪ N/A | No auth. |
| A08 Software/data integrity | 🟠 | Google Fonts `<link>` with **no SRI**, third-party render-blocking request. Fix = self-host fonts (also unlocks offline PWA). |
| A09 Logging failures | 🟠 | **Zero error reporting.** A production crash is invisible to us. Add pluggable telemetry port (default no-op). |
| A10 SSRF | ⚪ N/A | No server-side requests. |

**Credential handling note:** your PAT was received and is stored in a `0600` file **outside** the
workspace. It is **not** in `.git/config`, not in any tracked file, not in logs (verified:
`grep -c github_pat .git/config` → `0`). **Recommendation: rotate this PAT once the project ships** —
it lives in plaintext in a Google Doc, which is a shared-link exposure.

### C. Performance

| # | Finding | Sev | Action |
|---|---|---|---|
| C1 | Google Fonts is render-blocking third-party | 🟠 | Self-host `Orbitron`/`Rajdhani` woff2, `font-display: swap`, preload |
| C2 | No frame-budget measurement | 🟠 | Playwright perf trace + Lighthouse CI budget on 4× CPU throttle |
| C3 | 271 kB single file (84.7 kB gzip) — acceptable, but unmeasured | 🟡 | Keep singlefile; add a size-limit guard so it can't silently balloon |
| C4 | No profiling pass on mid-tier mobile | 🟡 | Manual pass + automated long-task detection |

### D. Delivery & operations — **the largest gap**

| Missing | Impact |
|---|---|
| ESLint 9 (flat config) + typescript-eslint strict | No enforced standards; no way to gate `main` |
| Prettier | Inconsistent formatting across future contributors |
| Vitest + coverage thresholds | Cannot prove correctness |
| Playwright (E2E + a11y via `@axe-core/playwright`) | No regression safety net |
| GitHub Actions CI | **Nothing gates `main`** |
| Dockerfile / compose / nginx | Not containerisable, no reproducible runtime |
| PWA manifest + icons + service worker | Half-finished: `mobile-web-app-capable` meta tags promise an installable app that does not exist |
| README, ARCHITECTURE, DEPLOYMENT, CONTRIBUTING, SECURITY, CHANGELOG | Undocumented — cannot be handed to another engineer |
| Issue/PR templates, labels, branch protection, CODEOWNERS | No contribution or release hygiene |
| Release/tag process, Dependabot | No versioned releases; deps will silently rot |

### E. Accessibility — better than most, **not complete**

**Passing today:** `:focus-visible` rings · `aria-label` on icon-only buttons · `aria-hidden` on
decorative SVGs · semantic `<button>` elements · labelled 3-char `<input>` · `prefers-reduced-motion`
honoured.

| # | Finding | Sev | Action |
|---|---|---|---|
| E1 | **Canvas is a black box to assistive tech** — no text alternative, no live region for score/level/lives. A screen-reader user cannot read the score, let alone play | 🔴 | `role="img"` + `aria-label`, plus an `aria-live="polite"` region mirroring HUD state, plus an offscreen text-mode game state summary |
| E2 | Overlays are **not `role="dialog"`**, not focus-trapped, no `aria-modal` → focus escapes to background | 🟠 | Proper modal dialog semantics + focus trap + restore-on-close |
| E3 | 4 enemy types differentiated **by colour only** → WCAG 1.4.1 "Use of Color" risk | 🟠 | Add distinct shape/pattern/glyph per tier; verify contrast ≥3:1 for non-text |
| E4 | No `prefers-contrast` support; `slate-500` on dark panels needs a contrast audit | 🟡 | Contract audit with axe; add high-contrast theme |
| E5 | Global `user-select: none` + `overflow: hidden` breaks text selection and some AT | 🟡 | Scope to canvas/controls only |
| E6 | D-pad target sizes unverified against 44×44 CSS px | 🟡 | Measure + fix (WCAG 2.5.5) |
| E7 | Keyboard help exists but is not discoverable to AT | 🔵 | Move into an accessible "Controls" dialog |

---

## 5. Proposed target architecture

### Option A — "Client-only, hardened" *(recommended; zero infra, no scope creep)*

Keeps the single-file, deploy-anywhere property. Introduces a clean layering so the game core is
testable and swappable.

```
src/
  core/     ports (interfaces) + adapters  → the ONLY place that touches the outside world
    ports/      rng.ts  storage.ts  clock.ts  audio.ts  telemetry.ts
    adapters/   seededRng.ts  localStorageAdapter.ts  webAudioAdapter.ts  noopTelemetry.ts
  game/     pure domain: engine, ai, render, sprites, particles   (unchanged layering, hardened)
  ui/       presentational React components
  app/      composition root: providers, hooks, phase machine, DI wiring
```

Key moves: **inject a seeded PRNG** (deterministic runs → real tests, replays, daily-seed mode),
**schema-versioned storage port** (Zod-validated), **error boundary + RAF watchdog**, **accessible
canvas**, **high-contrast/shape mode**, **self-hosted fonts**, **PWA**, full **CI/CD + Docker +
docs**.

### Option B — "Full-stack: global leaderboard" *(only if you want the backend the brief describes)*

Everything in Option A **plus**:

```
┌──────────────┐   HTTPS/JSON    ┌──────────────────────────────────────┐
│  SPA (Vite)  │ ──────────────► │  Node 20 + Fastify + TypeScript      │
│              │                 │   Zod validation · Helmet · CORS     │
│  Zustand     │                 │   JWT anon sessions · rate limiting  │
└──────────────┘                 │   Drizzle ORM  →  PostgreSQL         │
                                 │   /healthz · /readyz · /metrics      │
                                 └──────────────────────────────────────┘
```

- **Schema:** `players(id, anon_token, display_name, created_at)` ·
  `runs(id, player_id, seed, score, level, chips, max_combo, kills, duration_ms, client_version, submitted_at, validity)` ·
  `leaderboard_daily` (materialised view) · `audit_log(id, actor, action, meta, at)`
- **API:** `POST /v1/auth/anonymous` · `GET /v1/me` · `POST /v1/runs` ·
  `GET /v1/leaderboard?scope=global|daily|weekly&limit=1..100&cursor=` · `GET /v1/runs/:id` ·
  `GET /healthz` · `GET /readyz`
- **Anti-cheat:** server-side envelope validation (score vs. level × chips × duration),
  signed run payloads, anomaly flagging into `audit_log`, per-IP + per-token rate limits.
- **Infra:** multi-stage Docker → GHCR, compose for local, Actions CI/CD, Fly.io / Render.

> ⚠️ Option B adds a database, secrets management, rate limiting, and a real auth surface —
> meaningfully more work and ongoing cost. It should be chosen deliberately, not by default.

---

## 6. Proposed folder structure

```
gridbox-intelligence/
├─ .github/
│  ├─ workflows/{ci.yml, release.yml, lighthouse.yml, dependabot.yml}
│  ├─ ISSUE_TEMPLATE/{bug_report.yml, feature_request.yml}
│  ├─ PULL_REQUEST_TEMPLATE.md  └─ labels.yml
├─ docs/
│  ├─ ARCHITECTURE-REVIEW.md (this file) · ARCHITECTURE.md · API.md
│  ├─ DEPLOYMENT.md · SECURITY.md · ACCESSIBILITY.md
│  └─ CONTRIBUTING.md · CHANGELOG.md
├─ public/{manifest.webmanifest, icons/*, fonts/*}
├─ src/
│  ├─ core/{ports/,adapters/,errors/}
│  ├─ game/                 # unchanged public layout, hardened internals
│  ├─ ui/{components/,styles/}
│  ├─ app/{providers/,hooks/,App.tsx,main.tsx}
│  └─ test/{setup.ts,factories/}
├─ tests/{unit/,integration/,e2e/,a11y/}
├─ docker/{Dockerfile,nginx.conf,compose.yml}
├─ scripts/{release.sh}
├─ .env.example · .editorconfig · .nvmrc
├─ eslint.config.js · .prettierrc · vitest.config.ts · playwright.config.ts
└─ package.json · tsconfig.json · tsconfig.node.json
```

---

## 7. Master task board

Legend: `[ ]` Pending · `[~]` **In Progress (exactly one)** · `[x]` Completed

### Stage 1 — Review, validate, propose *(this document)*

- [x] 1.1 Download and extract supplied zip; inventory codebase (26 files / 3,575 LOC)
- [x] 1.2 Verify environment: `npm install`, `tsc --noEmit`, `vite build`, `npm audit`
- [x] 1.3 Validate GitHub PAT (account `basgenix4u`), configure Git credentials securely
- [x] 1.4 Create repo `basgenix4u/gridbox-intelligence` (public, MIT) and push baseline
- [x] 1.5 Deep audit: correctness, OWASP Top 10, performance, a11y (WCAG 2.2 AA), delivery
- [x] 1.6 Propose architecture (Options A/B), schema, API contracts, folder structure
- [~] 1.7 **Obtain the PRD + architecture approval (BLOCKED — see §8)**
- [ ] 1.8 Publish approved task board to GitHub Issues + Project

### Stage 2 — Environment & tooling

- [ ] 2.1 Restructure to `core/ game/ ui/ app/`; add `tsconfig.node.json`, path aliases
- [ ] 2.2 ESLint 9 flat config (typescript-eslint strict) + Prettier + EditorConfig + `.nvmrc`
- [ ] 2.3 Vitest (jsdom + node envs) + coverage thresholds; Playwright + `@axe-core/playwright`
- [ ] 2.4 husky + lint-staged pre-commit; `commitlint` (Conventional Commits)
- [ ] 2.5 Scripts: `dev build preview typecheck lint format test test:coverage test:e2e verify`
- [ ] 2.6 Smoke test: `/healthz` equivalent + first green unit test
- [ ] 2.7 Verify environment end-to-end; **await approval**

### Stage 3 — Core hardening (the "backend" of a client-only app)

- [ ] 3.1 `core/ports`: `Rng`, `Storage`, `Clock`, `Audio`, `Telemetry`, `Logger`
- [ ] 3.2 `core/adapters`: seeded `mulberry32` RNG, schema-versioned Zod storage, WebAudio, no-op telemetry
- [ ] 3.3 Error boundary + RAF watchdog + dev error overlay
- [ ] 3.4 Fix A3–A9 (SSR guard, render side effects, RAF teardown, id generation, font metrics)
- [ ] 3.5 Unit tests: engine rules, BFS fields, difficulty curves, combo/pulse/lives, storage, sanitizeName
- [ ] 3.6 Integration tests: headless deterministic run to game-over via seeded RNG
- [ ] 3.7 **(Option B only)** Fastify API + Drizzle + Postgres, auth, rate limiting, anti-cheat, API tests
- [ ] 3.8 Bug-fix pass; all tests green; **await approval**

### Stage 4 — Frontend, integration, accessibility

- [ ] 4.1 Replace direct engine coupling with `app/` composition root + typed hooks
- [ ] 4.2 Loading / error / empty / offline states; retry & backoff for leaderboard (Option B)
- [ ] 4.3 A11y: canvas live region, modal dialogs + focus trap, shape/pattern enemy tiers,
      high-contrast theme, `prefers-contrast`, 44×44 targets, unscoped `user-select`
- [ ] 4.4 Responsive pass: portrait/landscape, safe-area insets, 320 px → 4K, reduced-motion
- [ ] 4.5 PWA: manifest, icons, service worker, self-hosted fonts, offline shell
- [ ] 4.6 Security headers + CSP; axe + Playwright E2E; Lighthouse ≥95 a11y
- [ ] 4.7 Zero `tsc` errors, zero lint errors, build green; **await approval**

### Stage 5 — Production readiness & release

- [ ] 5.1 Multi-stage Dockerfile + nginx (headers, gzip/brotli, cache policy) + compose
- [ ] 5.2 CI: lint → typecheck → test(cov) → build → E2E+a11y → Lighthouse budget → audit → deploy
- [ ] 5.3 CD: GitHub Pages / Fly.io; environment config; `.env.example`; secrets in Actions
- [ ] 5.4 Docs: README, ARCHITECTURE, DEPLOYMENT, SECURITY, ACCESSIBILITY, CONTRIBUTING, CHANGELOG, API
- [ ] 5.5 Repo hygiene: issue/PR templates, labels, milestones, branch protection, CODEOWNERS, Dependabot
- [ ] 5.6 `v1.0.0` tag + GitHub Release with assets; final verification report

---

## 8. Blocking questions (must be answered before Stage 2)

| # | Question | Why it blocks |
|---|---|---|
| **Q1** | **The PRD is missing.** The Google Doc at the link you sent contains only your GitHub PAT — there is no PRD text. Please re-share the PRD (paste it, or a Doc that is set to "anyone with the link → Viewer"). | Your brief states the PRD is the single source of truth. Without it I would be inventing requirements. |
| **Q2** | **Scope:** the brief describes a *project portfolio website*; the zip is *Gridbox Intelligence*, an arcade game. Which is the deliverable — the game, a portfolio site, or a portfolio site that showcases the game? | Determines the entire product surface. |
| **Q3** | **Backend:** Option A (client-only, hardened, zero infra) or Option B (add Fastify + Postgres global leaderboard, auth, anti-cheat)? | Option B roughly doubles the work and adds hosting cost. |
| **Q4** | **Deploy target:** GitHub Pages (free, static — Option A only), Vercel/Netlify, Fly.io/Render (needed for Option B), or self-hosted Docker? | Drives CI/CD, Dockerfile and hosting config. |

---

## 9. Immediate recommendation

Do **not** start Stage 2 until Q1 and Q2 are answered. Q3 and Q4 can be answered in parallel
(Option A + GitHub Pages is the sensible default if you are unsure).

*Everything already delivered is safe and reversible: the repo exists, the untouched baseline is
committed and pushed, and the current build is running live in your preview pane.*
