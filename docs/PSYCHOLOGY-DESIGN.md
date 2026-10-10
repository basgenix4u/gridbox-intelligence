# Psychology & Engagement Design

Why Gridbox Intelligence is built the way it is. Every mechanic in §3 traces to a
finding in §1–§2, and every finding is cited so the reasoning can be checked.

---

## 1. What the research says about motivation

**Self-determination theory (Przybylski, Rigby & Ryan, 2010, _Review of General
Psychology_).** Game engagement and the desire to play again are driven by three
psychological needs: **autonomy** (choice), **competence** (mastery, effective
action) and **relatedness** (connection). Content — including violence — was not a
consistent motivator; what predicted enjoyment, immersion and return intent was
whether play satisfied those needs. *[1]*

**Yee's Daedalus Project (2006, 2007).** Motives split into achievement, social
and immersion components. In the MMO samples, female players weighted socialising
and immersion more; achievement remained strong for everyone. *[2]*

**Quantic Foundry (2016, 14,000+ player sample).** Female players scored higher on
**Design** (expression & customisation), **Fantasy**, **Story** and **Completion**
(collecting, finishing); male players on Competition, Challenge, Excitement,
Strategy. The largest difference (Competition, d ≈ .33) still implies **87 %
overlap** between the groups — and **age explains about 3× more variance than
gender**. The authors' warning is explicit: stereotypes persist in the face of
weak empirical differences. *[3]*

**Gaming Motivation Inventory (Király et al., 2022).** Female players scored higher
on **Mastery** and **Immersion/Escapism**; gender effects were small overall. *[4]*

**VMQ validation study (2026).** Across 232 highly engaged players, the only
significant gender difference was **Customisation** (women higher, d = .44);
behavioural intensity (play frequency, session length) predicted motivation better
than demographics did. *[5]*

**Synthesis.** Do **not** design "a game for women". The honest, evidence-based
take is: gender differences in play motivation are small and stereotype-prone;
design for the motives that reliably drive engagement **for everyone**, with a
slight emphasis on the ones elevated in female-typed samples — customisation,
completion/collection, immersion, mastery and competence support — and never on
coercive competition.

## 2. Retention mechanics with real effect sizes

| Mechanism | Evidence | How it works |
|---|---|---|
| **Goal-gradient effect** | Hull (1932); Kivetz, Urminsky & Zheng (2006), café loyalty cards *[6]* | Effort accelerates as a *visible* goal nears. Works on proportional distance, not absolute effort. |
| **Endowed progress** | Nunes & Dreze (2006), car-wash field experiment: **34 % vs 19 % completion** when the goal card started pre-stamped *[7]* | Crediting artificial head-start progress increases completion even though required effort is identical. |
| **Zeigarnik effect** | Zeigarnik (1927); modern replications mixed *[6]* | Incomplete tasks stay mentally accessible. Use as a *supporting* cue only — the replication record is weak. |
| **Loss aversion** | Kahneman & Tversky (1979) | A streak at risk motivates more than an equivalent reward. Must be framed gently, never coercively. |
| **Flow / DDA** | Csikszentmihalyi (1990); Hunicke & Chapman (Hamlet) *[8]* | Engagement peaks where challenge ≈ skill. Boredom below the channel, anxiety above it. |
| **SDT competence feedback** | [1] | Concrete, proximal feedback ("personal best", "2 more chips") supports competence without lowering challenge. |

## 3. Feature mapping

| Feature | Mechanic | Research |
|---|---|---|
| Achievement rails sorted by **proximity** ("nearly done" first) | Goal-gradient | [6] |
| Multi-step achievements **start pre-credited** (25/100 chips, 2/10 runs) | Endowed progress | [7] |
| "One more run" nudge citing the nearest unlock | Goal-gradient + Zeigarnik (supporting) | [6] |
| Streak counter with loss-adjacent but kind framing | Loss aversion | — |
| Personal-best / new-best callouts, near-miss recap lines | SDT competence | [1] |
| Player **accent customisation** (5 presets incl. colour-blind-safe options) | Customisation / Design motive | [3][5] |
| Threat-tier flavour text, narrative framing ("harvest", "connection lost") | Immersion / Fantasy | [2][3][4] |
| Level pacing curve in-run (existing) | Flow channel | [8] |
| Opt-in presentation only: nothing blocks play, no timers pressure purchases | Autonomy; dark-pattern avoidance | [1] |

## 4. Ethics and non-goals

- **No dark patterns.** No fake urgency, no paywalls, no coercive monetisation
  (there is nothing to buy). Streaks never block play and never shame: missing a
  day resets a counter, nothing else.
- **No "pink it and shrink it".** The brand palette (Midnight Violet / Dark
  Magenta / Magenta Bloom) is the game's identity for all players. Self-expression
  lives in the player sprite, where it belongs.
- **Challenge is not flattened.** Competence support is feedback, not rubber-banding
  that plays the game for you. The empirically tuned difficulty curve stands.

## 5. Backlog levers (post-v1.0.0)

- Social relatedness: shared daily seed (F1), friend challenge links, ghost
  replays (F7).
- Optional assist mode after repeated sub-level-3 deaths (DDA-lite, player-visible
  and opt-out — covert manipulation is a dark pattern).
- Completion collections: chip archive, enemy codex with lore entries.

---

## References

1. Przybylski, A. K., Rigby, C. S., & Ryan, R. M. (2010). A motivational model of
   video game engagement. _Review of General Psychology, 14_(2), 154–166.
2. Yee, N. (2006/2007). Motivations of play in online games. _CyberPsychology &
   Behavior_; Daedalus Project archives.
3. Quantic Foundry (2016). Gender differences in gaming motivations align with
   stereotypes, but small compared to age. (14,000+ gamers.)
4. Király, O., et al. (2022). The Gaming Motivation Inventory (GMI). _Journal of
   Behavioral Addictions_ / PMC9872527.
5. Gaming motivations and sustained user engagement among highly engaged players
   (2026). _Quaternary Science & Behavioural Studies / VMQ validation_ (n = 232).
6. Kivetz, R., Urminsky, O., & Zheng, Y. (2006). The goal-gradient hypothesis
   resurrected. _Journal of Marketing Research, 43_(1). Zeigarnik, B. (1927).
   On finished and unfinished tasks. _Psychologische Forschung, 9_.
7. Nunes, J. C., & Dreze, X. (2006). The endowed progress effect. _Journal of
   Consumer Research, 32_(4), 504–512.
8. Csikszentmihalyi, M. (1990). _Flow: The Psychology of Optimal Experience._;
   Hunicke, R. & Chapman, V. AI for dynamic difficulty adjustment in games.
