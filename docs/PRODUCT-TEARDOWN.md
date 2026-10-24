# Gridbox Intelligence — Product Teardown, Balance Analysis & Opportunity Backlog

> **Stage 1 extension (deliverable pending your approval).**
> Prepared by: Principal PM · Lead Architect · Senior Full-Stack Eng · DevOps/SRE · UI/UX Designer · UI/UX Engineer · QA Automation
> Date: 2026-10-10 · Repo: [github.com/basgenix4u/gridbox-intelligence](https://github.com/basgenix4u/gridbox-intelligence)

> **Revision 2026-10-24 — hosting change.** Q4 originally read "Vercel +
> Supabase". Production moved to **Vercel + Neon**: the game now runs in its own
> Neon project (`gridbox-intelligence`, `old-sun-52286414`, eu-west-2, PostgreSQL
> 17) instead of a shared Supabase project. The dedicated `gridbox` schema, the
> least-privilege `gridbox_app` role and the RLS design described below are
> unchanged; only the host changed. Sections §8 and §9 below are left as written
> for history — where they say "Supabase", read "Neon". `PRD.md` §2.4 and
> `.env.example` carry the current values.

---

## 0. Decisions resolved (supersedes §5 and §8 of `ARCHITECTURE-REVIEW.md`)

| Ref | Question | Decision |
|---|---|---|
| **Q1** | PRD missing | **Infer.** No PRD will be supplied. This document, plus `ARCHITECTURE-REVIEW.md`, becomes the derived spec and is the single source of truth unless you override it. |
| **Q2** | Portfolio site vs. game | **The game.** "Portfolio website" was boilerplate. Gridbox Intelligence is the deliverable. |
| **Q3** | Architecture | **Option B** — full-stack leaderboard. |
| **Q4** | Deploy target | **Vercel (app + serverless API) + Supabase (Postgres).** |

**Consequence:** the API layer changes from standalone Fastify to **Hono on Vercel Serverless
Functions**. Rationale: Fastify is designed for a long-running Node process; on Vercel it needs a
`serverless-http` shim and adds cold-start weight. Hono is ~14 kB, edge-compatible, strongly typed,
natively supported on Vercel, and unit-testable without a server. See §6.

---

## 1. Executive summary

Gridbox Intelligence is a **9×9 grid arcade survival-scorer** with unusually strong game feel for its
size (3,575 LOC). The mechanics are sound and the risk/reward loop genuinely works — I proved this by
running the real engine headless in Node under two scripted bots (§3).

But the data exposes three product problems that cap its ceiling:

1. **The combo system is not a skill differentiator.** It saturates at the ×8 cap in **100 % of
   skilled runs**. It is a constant multiplier wearing a skill-expression costume.
2. **Score is ~90 % chip income.** Kills and pulses contribute under 10 %, so the richer mechanics
   (four AI archetypes, predictive ORACLE, positioning) barely affect the number on the leaderboard.
3. **Runs are short and structurally identical.** Median skilled run is **20 s**; every run has the
   same board size, the same four enemies, the same escalation curve. There is no reason to come back
   tomorrow rather than today.

All three are fixable, and the fixes are mostly **cheap** — they ride on work we must do anyway
(seeded RNG, a storage port, a server). **The single highest-leverage addition is a Daily Seeded
Challenge** (§5, F1): it becomes nearly free once seeded RNG lands in Stage 3, and it is the only
mechanic in the backlog that reliably creates a *habit*.

---

## 2. What the game actually is

### 2.1 Product identity

| | |
|---|---|
| **Genre** | Grid arcade / survival scorer (Pac-Man lineage crossed with a roguelite escalation curve) |
| **Pitch** | *Harvest data chips. Outsmart the machines. Pulse to purge them.* |
| **Fantasy** | You are a process inside a hostile machine grid, harvesting data while the grid's defences wake up |
| **Session** | 15–40 s per run; endless; score-chasing |
| **Platform** | Mobile-first (D-pad + swipe + haptics), desktop keyboard parity |
| **Art direction** | Cyber-terminal: Orbitron/Rajdhani, neon cyan/amber on near-black #05070d, bloom, scanline vignette |
| **Audio** | 100 % procedural WebAudio — zero assets, instant load |

### 2.2 Core loop

```
                    ┌──────────────────────────────┐
   START RUN  ───►  │ 3 chips on a 9×9 mirrored,   │
                    │ fully-connected board        │
                    └──────────┬───────────────────┘
                               │ collect chip → +10 × combo
                               │ combo → next tier (cap ×8)
                               │ +1 pulse charge (cap 5)
                               ▼
                    ┌──────────────────────────────┐
      7 chips ────► │ LEVEL UP                     │
                    │  spawn faster · move faster  │
                    │  new archetype unlocks       │
                    └──────────┬───────────────────┘
                               │
       PULSE ◄── 5 charges ────┤ purge 5×5 (radius 2)
       (bonus 100/kill ≥2)     │
                               │
                    ┌──────────▼───────────────────┐
      ENEMY HIT ──► │ lose shield · combo→1        │
                    │ 1.5 s invuln · hitstop       │
                    └──────────┬───────────────────┘
                               │ 3 shields lost
                               ▼
                        SYSTEM BREACHED → initials → leaderboard
```

### 2.3 Mechanics reference (verified against source)

| Mechanic | Value | Source |
|---|---|---|
| Board | 9 × 9, mirrored wall pairs (4–5), connectivity-verified, centre 3×3 kept clear | `engine.ts:274` |
| Player step cooldown | 70 ms; hold-repeat 170 ms then 115 ms | `constants.ts` |
| Chips on board | 3, respawn immediately on pickup | `constants.ts` |
| Chip value | `10 × combo`; combo increments **after** scoring | `engine.ts:789` |
| Combo window | 2 200 ms, cap ×8, resets to ×1 on being hit | `constants.ts` |
| Level up | every 7 chips (`1 + floor(chips/7)`) | `engine.ts:814` |
| Pulse | costs 5 charges, Chebyshev radius 2 (5×5), clears enemies **and** un-spawned spawners | `engine.ts:889` |
| Multi-kill bonus | `100 × (n−1)` for n ≥ 2 | `engine.ts:889` |
| Shields | 3; on hit → 1.5 s invuln, hitstop 70 ms, slow-mo to 0.3× | `engine.ts:830` |
| Kill scores | DRONE 50 · HUNTER 75 · MIND 100 · ORACLE 150 | `constants.ts` |
| Enemy unlock levels | DRONE 1 · HUNTER 2 · MIND 3 · ORACLE 5 | `constants.ts` |
| Spawn telegraph | 850 ms visible warning before an enemy materialises | `constants.ts` |
| Tick period | `max(260, 640 − (level−1) × 42)` ms × archetype speed | `constants.ts` |
| Max concurrent enemies | `min(8, 1 + level)` | `constants.ts` |
| Spawn interval | `max(1000, 2800 − (level−1) × 220)` ms | `constants.ts` |
| Attract mode | Autopilot demo runs behind the menu (capped at level 3) | `engine.ts:681` |

### 2.4 Enemy archetypes

| | Behaviour | Threat model |
|---|---|---|
| **DRONE** (green) | Random walk with weak bias toward you | Noise; blocks corridors accidentally |
| **HUNTER** (orange) | Greedy straight-line chase, no pathfinding | Punishes open sightlines; wall-exploitable |
| **MIND** (violet) | BFS distance-field pathfinding | Cannot be wall-exploited; relentless |
| **ORACLE** (rose) | BFS toward your **predicted** position (450 ms look-ahead) | Punishes predictable movement; the skill test |

The ORACLE is the standout design: it forces players to be *unpredictable*, which is a genuinely
elegant way to create depth from a 4-direction input.

### 2.5 What the game does well — protect these

1. **Zero-friction onboarding.** "Collect the glowing thing, press space when it's charged." No tutorial needed to be *functional*.
2. **Exceptional juice for the size.** Hitstop, trauma shake, squash/stretch, motion ghosts, particle bursts, expansion rings, floating score popups, procedural audio that pitches with your combo. This is what makes 20-second runs feel good.
3. **Real risk/reward.** Proven empirically — see §3.3: aggressive play scores 130× more and dies sooner.
4. **Attract mode on the menu.** The menu is alive instead of a static splash.
5. **Escalation has *texture*, not just speed.** Unlocking a new archetype changes *how* you must play, not just how fast you must react.
6. **Telegraphed spawns (850 ms).** Deaths feel fair — the game tells you before it hurts you.
7. **Zero assets.** 271 kB single file, instant load, works offline.

---

## 3. Empirical balance analysis

I built a Node harness that imports the **real** `Game` engine with a stubbed canvas and drives it
with two scripted bots at a fixed 60 fps tick. This is measurement, not opinion.
*(Harness lives outside the repo; a hardened version becomes the Stage 3 integration test.)*

### 3.1 Skill ceiling vs. skill floor

| Metric (150 runs each) | Greedy bot (skilled-ish) | Random bot (floor) |
|---|---|---|
| Score — median | **5 180** | 40 |
| Score — p90 | 7 225 | 300 |
| Score — max | 10 915 | 700 |
| Level — median | **10** | 1 |
| Level — max | 17 | 2 |
| Survival — median | 20.2 s | 24.9 s |
| Kills — median | 6 | 0 |
| Max combo — median | **8 (cap)** | 3 |

### 3.2 Distribution of skilled runs (400 runs)

```
Level reached      runs
  4 –  6            20   ▍
  7 – 10           215   ████████████████████   (median = 10)
 11 – 15           157   ███████████████
 16+                 8   ▍

Score   p50 5 200   p90 7 680   max 12 780
Survival p50 19.9 s  p90 26.5 s
```

### 3.3 Findings

**F-A — The risk/reward loop is real. ✅ Keep.**
The random bot survives *longer* (24.9 s vs 20.2 s) while scoring **130× less**. Playing safe is
viable and scores nothing; scoring requires walking into danger. That is exactly the tension a
survival-scorer wants. Do not "fix" this.

**F-B — Combo saturates. 🔴 Highest-priority balance bug.**
`maxCombo = 8` (the cap) in **100 % of skilled runs** — mean 8.00, max 8. With 3 chips always on a
9×9 board, the average hop is ~4 cells ≈ 280 ms, far inside the 2 200 ms window. The combo reaches
its ceiling within the first ~8 chips (≈3 s) and stays there for the remaining 17 s.
→ *The headline skill mechanic carries zero information. It is a constant ×8, not a skill curve.*

**F-C — Score is ~90 % chip income. 🟠**
Decomposed from a median run (63 chips, 6.5 kills): chip income ≈ 4 760, kill income ≈ 490 → kills
are ~9 % of score. Enemy archetypes, the ORACLE prediction, pulse positioning and multi-kill bonuses
— the most interesting systems — are almost invisible in the final number.
→ *Players are rewarded for the boring action and barely rewarded for the interesting one.*

**F-D — Runs are short and structurally identical. 🟠**
Median 20 s; p90 26.5 s. Every run: same 9×9, same 4 archetypes, same deterministic difficulty
curve, only the wall layout changes. Session-to-session variety is *cosmetic*, not *structural*.
→ *Nothing distinguishes "today's session" from "yesterday's". Retention has no hook.*

**F-E — Difficulty is a pure function of chips collected. 🟡 (design note)**
Level = `1 + floor(chips/7)`, so a *passive* player stays at level 1 with ≤2 enemies indefinitely
(that is why the random bot survives longer). This is fine for a score-chaser but means there is no
survival pressure independent of greed. Worth an optional mode, not a fix.

**F-G — Difficulty ceiling arrives fast. 🟡**
By level 8 the curve is at its floor on every axis: tick 260 ms, spawn 1 000 ms, 8 enemies, ORACLE
weight 0.4. Beyond level ~8 the game stops escalating in kind and only escalates in density.
→ *Levels 12+ are a slog rather than a new challenge. A boss/ modifier cadence would fix this.*

---

## 4. Product assessment

| Dimension | Verdict | Note |
|---|---|---|
| Core loop | 🟢 Strong | Tight, legible, 10-second learn |
| Game feel / juice | 🟢 Excellent | Best-in-class for this size; Do Not Touch |
| Difficulty curve | 🟡 | Good to level 8, flat after (F-G) |
| Skill expression | 🟠 | Real (F-A) but only in *positioning*, not in *score* (F-B, F-C) |
| Variety / replayability | 🔴 | Structurally identical every run (F-D) |
| Meta-progression | 🔴 | None — nothing carries between runs |
| Onboarding | 🟡 | Functional but a wall of text; no in-game teaching |
| Accessibility | 🟠 | Better than most hobby games; canvas invisible to AT (see §7) |
| Social / competition | 🔴 | Local-only, forgeable leaderboard |
| Monetisation | ⚪ | None. Recommend **keeping it clean** (no ads/IAP) |

---

## 5. Feature backlog

Effort: **S** ≤ 1 day · **M** 1–3 days · **L** 3–7 days · (solo senior dev, including tests)
Priority: **P0** = ship in v1.0.0 · **P1** = v1.1.0 · **P2** = v1.2.0+

### Retention & depth

| ID | Feature | Why | Effort | Pri |
|---|---|---|---|---|
| **F1** | **Daily Seeded Challenge** — one board + spawn sequence per UTC day, everyone plays the same run, separate daily leaderboard | The only mechanic here that reliably builds a *habit*. Nearly free once seeded RNG exists (Stage 3.2). Wordle effect, and it gives the global leaderboard a reason to be checked daily | **S** (after RNG) | **P0** |
| **F2** | **Combo rebalance** — shrink the window as the combo rises (2 200 → 900 ms at ×8), show a draining meter, decay to ×4 (not ×1) on a hit | Directly fixes F-B: turns a constant into a skill curve. Small change, large effect on the skill gap | **S** | **P0** |
| **F3** | **Rebalance score weights** — raise kill values ~3× (150/225/300/450), add a near-miss "GRAZE" reward, scale chip value down with level | Fixes F-C: makes the interesting systems matter on the leaderboard and rewards high-skill play | **S** | **P0** |
| **F4** | **Run modifiers every 3 levels** — e.g. *Surge* (chips 2× for 10 s), *Blackout* (fog of war), *Maze Shift* (walls re-roll), *Swarm* (spawn burst) | Fixes F-D and F-G: gives levels 12+ a *new* challenge instead of more density | **M** | **P1** |
| **F5** | **Achievements / challenges** — "Purge 3 ORACLEs in one pulse", "Reach level 12 untouched", lifetime counters with unlockable palettes | Cheap retention layer; gives long-tail players a goal after they plateau | **M** | **P1** |
| **F6** | **Global leaderboard** (already in scope, Option B) — global / daily / weekly scopes, rank + percentile | Competition is the point of a score-chaser | **L** | **P0** |
| **F7** | **Ghost replay** — record input + seed, replay the #1 run as a translucent ghost | Turns the leaderboard from a table into a *spectacle*; also the strongest anti-cheat signal we can get | **L** | **P2** |
| **F8** | **Share card** — Vercel OG image of your run (score, level, seed) for social posting | Free organic growth loop | **S** | **P1** |
| **F9** | **Power-ups** — SLOW, MAGNET, PHASE, EXTRA SHIELD as rare chip drops | Adds decision density; risk of diluting the clean loop, so gate behind playtesting | **M** | **P2** |
| **F10** | **New archetypes** — MIMIC (copies your last move), SWARM (splits), TURRET (static, fires along a row) | Extends the escalation runway past level 8 | **M** | **P2** |
| **F11** | **Boss every 5 levels** | Fixes F-G ceiling; high effort, high payoff | **L** | **P2** |
| **F12** | **Endless-vs-Zen modes** — Zen = no enemies, practice; Hardcore = 1 shield | Broadens the audience; Zen also doubles as the a11y "slow mode" | **S** | **P1** |

### Player-facing systems

| ID | Feature | Why | Effort | Pri |
|---|---|---|---|---|
| **F13** | **Persistent player profile** — name, lifetime stats, best score, favourite archetype | Currently your name only exists if you make the local top 10 | **S** | **P0** |
| **F14** | **Settings screen** — SFX/music volume, haptics, reduced motion, colour-blind shape mode, high contrast, difficulty | Consolidates the lone mute icon; required for the a11y work in §7 | **S** | **P0** |
| **F15** | **First-run onboarding** — directional hint to the nearest chip, "PULSE READY" prompt, ghost-hand demo for the first 2 runs | Replaces the text wall; teaches by doing | **M** | **P1** |
| **F16** | **Death recap** — what hit you, from where, shields-remaining animation | Deaths currently end abruptly with no explanation of the mistake | **S** | **P1** |
| **F17** | **Statistics / profile screen** — runs, best, average, total chips, time played, level histogram | Gives progression-oriented players a reason to keep going | **S** | **P1** |
| **F18** | **i18n scaffolding** — extract all hardcoded copy to a typed resource bundle | All copy is English-literal today; extraction later is painful | **M** | **P2** |

---

## 6. UI/UX improvement backlog

### Current state — honest assessment

**Strong:** cohesive cyber-terminal identity · excellent typography pairing (Orbitron display /
Rajdhani body) · genuine juice on every interaction · mobile handled thoughtfully (D-pad, swipe,
haptics, landscape layout) · keyboard parity · attract-mode menu · clean empty state
("The grid awaits.") · sensible `autoFocus` on the primary action of every overlay.

**Weak:** the canvas is unreadable by assistive tech · critical state (pulse charge, combo) is shown
only as *transient popups*, so it is invisible most of the time · colour is the only enemy
differentiator · no settings surface · no teaching · overlays are not real dialogs.

### P0 — ship in v1.0.0

| ID | Improvement | Rationale | Effort |
|---|---|---|---|
| **U1** | **Accessible canvas** — `role="img"` + descriptive `aria-label`, plus an `aria-live="polite"` region mirroring score / level / shields / combo / pulse state | Currently a screen-reader user cannot read the score, let alone play. Blocker (E1) | **S** |
| **U2** | **Real modal dialogs** — `role="dialog"` + `aria-modal` + focus trap + focus restore + `Esc` to close, on all 4 overlays | Focus currently escapes to background content (E2) | **S** |
| **U3** | **Shape/pattern enemy tiers + colour-blind mode** — give each archetype a distinct glyph (circle / triangle / diamond / hex) — on by default, not a buried toggle | WCAG 1.4.1 (E3). Also speeds up board reading for *everyone* at 260 ms tick speeds | **M** |
| **U4** | **Persistent pulse-charge meter** — 5 pips in the HUD, filling as you collect | **Desktop players currently have no way to see their pulse charge** except a 850 ms popup that appears once. This is a real usability defect, not a nice-to-have | **S** |
| **U5** | **Persistent combo meter with a draining timer bar** | Makes the combo window *legible* → a prerequisite for F2 to work. Also fixes "I can't tell I'm at max" | **S** |
| **U6** | **Contrast pass + high-contrast theme** — raise body text from `slate-500` (≈4.0:1) to ≥4.5:1; ship a `prefers-contrast` theme | WCAG 1.4.3 (E4) | **S** |
| **U7** | **Settings screen** (see F14) with sound, haptics, motion, contrast, colour-blind, difficulty | Discoverability; no room left on the start screen for more icon buttons | **M** |
| **U8** | **Non-shaking score readout** — keep the score outside the trauma/shake transform, cap concurrent popups (≤4) and stagger them | At high combo the shake + popup storm makes the score hard to read precisely when it matters most | **S** |
| **U9** | **44×44 minimum touch targets** on the D-pad and pause; increase separation between Pause and PULSE | WCAG 2.5.5 (E6); Pause sits adjacent to PULSE and is mis-tapped mid-run | **S** |
| **U10** | **Scope `user-select: none`** to the canvas and controls | Global suppression breaks text selection and some assistive tech (E5) | **S** |

### P1 — v1.1.0

| ID | Improvement | Rationale |
|---|---|---|
| **U11** | **Strengthen the spawn telegraph** — countdown ring + distinct per-archetype audio sting | 850 ms is easy to miss under shake + particles on a phone |
| **U12** | **Boot skeleton inlined in `index.html`** | Single-file bundle means a blank screen until ~271 kB parses |
| **U13** | **Promote the attract-mode demo** — blur/dim it behind a semi-transparent menu so it reads as a live backdrop | Currently the overlays hide the most impressive thing on screen |
| **U14** | **Persistent player name in settings** (see F13) | Today you can only set initials if you make the top 10 |
| **U15** | **Adaptive music bed** (procedural, still zero-asset) | Only SFX exist; a music layer is the biggest remaining "feel" upgrade |
| **U16** | **Richer haptics** — distinct patterns per event (chip / hit / pulse / level) | Currently binary |
| **U17** | **Extend `prefers-reduced-motion`** to shake, flash and hitstop, not just particles | Currently only partially honoured |
| **U18** | **Full keyboard help in an accessible dialog** | The inline hint row is decorative to AT (E7) |
| **U19** | **Self-host Orbitron + Rajdhani (woff2, `font-display: swap`, preload)** | Removes a render-blocking third-party request, fixes SRI exposure (B-A08), unlocks offline PWA |
| **U20** | **PWA: manifest, icons, service worker, offline shell** | The `mobile-web-app-capable` meta tags already *promise* an installable app that does not exist |

### P2 — v1.2.0+

| ID | Improvement |
|---|---|
| **U21** | Unlockable palette / theme selector |
| **U22** | Replay viewer UI (pairs with F7) |
| **U23** | Share-card composer UI (pairs with F8) |
| **U24** | Localisation surface + language picker (pairs with F18) |

---

## 7. Accessibility target

**Target: WCAG 2.2 Level AA**, verified by `axe-core` in CI plus manual keyboard/AT passes.

| Area | Target |
|---|---|
| Canvas | `role="img"` + live-region HUD mirror (U1) |
| Dialogs | Focus trap, restore, `Esc`, `aria-modal` (U2) |
| Colour | Never the sole carrier of meaning (U3); ≥3:1 non-text contrast |
| Text | ≥4.5:1 body, ≥3:1 large text (U6) |
| Motion | Full `prefers-reduced-motion` coverage including shake/flash/hitstop (U17) |
| Contrast | `prefers-contrast` high-contrast theme (U6) |
| Touch | ≥44×44 CSS px targets (U9) |
| Keyboard | Every action reachable; visible focus; help discoverable (U18) |
| Screen reader | Full playability audit with NVDA + VoiceOver |

**Honest note:** a real-time 60 fps reaction game can never be fully playable by every user. The
goal is (a) full *legibility* — every player can read state and results — and (b) *maximum
playability* via Zen/slow modes and the new difficulty options.

---

## 8. Revised target architecture — Vercel + Supabase

```
┌────────────────────────────────────────────────────────────────────────┐
│  Vercel Edge Network                                                    │
│                                                                         │
│   ┌──────────────────────────────┐   ┌───────────────────────────────┐  │
│   │  Static SPA (Vite build)     │   │  Serverless Function          │  │
│   │  dist/ — single-file bundle  │──►│  api/[[...route]].ts          │  │
│   │  CDN-cached, immutable       │   │  Hono · Zod · jose            │  │
│   │                              │   │  Node 20 runtime              │  │
│   └──────────────────────────────┘   └──────────┬────────────────────┘  │
│                                                  │                      │
└──────────────────────────────────────────────────┼──────────────────────┘
                             HTTPS JSON            │ TCP 6543 (pgbouncer)
                             Bearer JWT            │ sslmode=require
                                                   ▼
                                    ┌────────────────────────────────┐
                                    │  Supabase Postgres             │
                                    │   players · runs · audit_log   │
                                    │   views: daily/weekly boards   │
                                    │   RLS on (defence in depth)    │
                                    └────────────────────────────────┘
                                                   ▲
                                    ┌──────────────┴─────────────────┐
                                    │  Upstash Redis — rate limiting │
                                    │  (serverless has no shared mem)│
                                    └────────────────────────────────┘
```

### Decisions and rationale

| Choice | Why |
|---|---|
| **Hono** (not Fastify) on Vercel Functions | ~14 kB, edge-compatible, first-class Vercel support, no `serverless-http` shim, trivially unit-testable. Fastify wants a long-lived process |
| **Drizzle ORM** over the Supabase **pooler** (port 6543) | Typed schema in TS, migration files in git, no codegen step, works over pgbouncer |
| **Server-only DB access** | The anon/service keys never reach the browser. All reads/writes go through our API, so validation and rate limiting cannot be bypassed |
| **Self-issued anon JWT (`jose`, HS256)** | No passwords, no email, no PII. Supabase Auth is a later optional upgrade |
| **Upstash Redis** for rate limits | Vercel Functions share no memory; in-process counters reset on every cold start |
| **RLS enabled anyway** | Defence in depth — if the service role ever leaks, the policies are the second lock |

---

## 9. Database schema (Supabase Postgres)

```sql
-- ---------------------------------------------------------------- players
create table players (
  id              uuid primary key default gen_random_uuid(),
  anon_token_hash text not null unique,          -- sha256 of the issued JWT, never the JWT
  display_name    text not null default 'YOU'
                  check (display_name ~ '^[A-Z0-9]{1,3}$'),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  total_runs      int          not null default 0,
  best_score      int          not null default 0
);

-- ---------------------------------------------------------------- runs
create type run_mode    as enum ('endless', 'daily', 'zen', 'hardcore');
create type run_validity as enum ('ok', 'suspect', 'rejected');

create table runs (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references players(id) on delete cascade,
  mode           run_mode     not null default 'endless',
  seed           bigint       not null,          -- enables replay + daily
  day            date         not null default (now() at time zone 'utc')::date,
  score          int          not null check (score >= 0),
  level          int          not null check (level >= 1),
  chips          int          not null check (chips >= 0),
  max_combo      int          not null check (max_combo between 1 and 64),
  kills          int          not null check (kills >= 0),
  duration_ms    int          not null check (duration_ms >= 0),
  client_version text         not null,
  attestation    jsonb,                          -- hash chain + timing telemetry
  validity       run_validity not null default 'ok',
  submitted_at   timestamptz  not null default now()
);

create index runs_global_idx  on runs (score desc)              where validity = 'ok';
create index runs_mode_idx    on runs (mode, score desc)        where validity = 'ok';
create index runs_daily_idx   on runs (day, mode, score desc)   where validity = 'ok';
create index runs_player_idx  on runs (player_id, submitted_at desc);

-- ---------------------------------------------------------------- views
create view leaderboard_daily as
  select rank() over (partition by day, mode order by score desc) as rank, *
  from runs where validity = 'ok';

-- ---------------------------------------------------------------- audit
create table audit_log (
  id     bigserial primary key,
  actor  text,          -- player id or 'system'
  action text not null,
  meta   jsonb,
  at     timestamptz not null default now()
);

alter table players enable row level security;
alter table runs    enable row level security;
-- No anon policies: every request is server-side with the service role.
```

---

## 10. API contracts (v1)

Base: `https://<host>/api/v1` · JSON · `Authorization: Bearer <jwt>` where noted.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/healthz` | — | Liveness: `{ status: "ok", version, commit }` |
| `GET` | `/readyz` | — | Readiness: checks DB round-trip |
| `POST` | `/auth/anonymous` | — | Body `{}` → `{ token, playerId, displayName }`. Idempotent per device id |
| `GET` | `/me` | Bearer | `{ playerId, displayName, bestScore, totalRuns, rank, percentile }` |
| `PATCH` | `/me` | Bearer | Body `{ displayName }` (validated `^[A-Z0-9]{1,3}$`) |
| `POST` | `/runs/start` | Bearer | Body `{ mode, seed, clientVersion }` → `{ runId, nonce }`. Issues the run attestation nonce |
| `POST` | `/runs/:id/submit` | Bearer | Body = run result + attestation → `{ rank, percentile, personalBest, dailyRank }` |
| `GET` | `/leaderboard` | — | Query `?scope=global\|daily\|weekly&mode=endless&limit=1..100&cursor=` → `{ entries[], nextCursor, updatedAt }` |
| `GET` | `/leaderboard/around` | Bearer | Scores immediately above/below the caller — the "you are here" slice |
| `GET` | `/daily` | — | `{ day, seed, topScore, entries[] }` — today's seeded challenge |

**Conventions:** all requests validated with **Zod**; errors use
`{ error: { code, message, details? } }` with correct status codes; `Idempotency-Key` supported on
submissions; `Cache-Control: s-maxage=30, stale-while-revalidate=60` on leaderboard reads.

### Rate limits (Upstash)

| Scope | Limit |
|---|---|
| `POST /auth/anonymous` | 10 / hour / IP |
| `POST /runs/:id/submit` | 30 / hour / player, 5 / minute / player |
| `GET /leaderboard` | 120 / minute / IP |
| `PATCH /me` | 20 / hour / player |

---

## 11. Anti-cheat strategy — honest scope

**A client-authoritative game cannot be made cheat-proof.** Anyone who controls the client can
eventually forge a score. Our goal is to **raise the cost, detect anomalies, and keep the board
clean** — not to claim impossibility.

Four layers, cheapest first:

1. **Envelope validation.** Reject or flag submissions that violate physics derived from §3:
   max sustainable rate ≈ 4 chips/s, max chip value 80, kill values fixed, minimum plausible
   duration per level. Catches naive tampering and most scripted farms.
2. **Run attestation.** `POST /runs/start` issues a nonce; the client maintains a hash chain over
   state snapshots (score, chips, level, tick) and returns it with the submission. The server
   verifies internal consistency, monotonicity and timing plausibility. Not replay-verified (too
   expensive now) — but it defeats simple "edit the final number" attacks.
3. **Statistical flagging.** Compare against the measured distribution (§3.2: skilled p90 ≈ 7 680,
   max ≈ 12 780). Beyond ~3σ → `validity='suspect'`, hidden from public boards pending review, and
   written to `audit_log`.
4. **Server-side replay (v1.2+, F7).** With a seeded RNG and recorded inputs, the server can
   *recompute* the run. This is the only true verification. It is why F1/F7 and seeded RNG are
   architecturally coupled to the anti-cheat story rather than being "just features".

---

## 12. Release plan

| Version | Theme | Contents |
|---|---|---|
| **v0.1.0** | *Foundation* (Stage 2–3) | Tooling, tests, CI, seeded RNG, storage port, error boundary, bug fixes. No gameplay change |
| **v0.2.0** | *HUD & accessibility* (Stage 4) | U1–U10, dialog semantics, contrast, self-hosted fonts, PWA |
| **v1.0.0** | *Public launch* (Stage 4–5) | F1 Daily Challenge, F2 combo rebalance, F3 score rebalance, F6 global leaderboard on Vercel + Supabase, F13 profile, F14 settings, Docker, CI/CD, full docs |
| **v1.1.0** | *Depth* | F4 modifiers, F5 achievements, F8 share card, F12 modes, F15 onboarding, F16 death recap, F17 stats, U11–U20 |
| **v1.2.0** | *Spectacle* | F7 ghost replay + server-side verification, F9 power-ups, F10 archetypes, F18 i18n |

---

## 13. Open questions for you

1. **Feature scope for v1.0.0** — do you want the P0 set only, or should I pull F4/F5 into v1.0.0?
2. **Combo rebalance (F2)** changes how the game *feels* and will lower absolute scores. Confirm you
   want the balance change rather than a straight leaderboard launch.
3. **Leaderboard display names** — keep 3-character arcade initials, or allow longer display names
   (needs profanity filtering)?
4. **Supabase project** — do you already have one I should target, or should I build everything
   against a local/`DATABASE_URL` config and hand you setup instructions?

The authoritative task board lives in **[`docs/TASK-BOARD.md`](./TASK-BOARD.md)**.
