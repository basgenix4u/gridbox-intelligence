/**
 * Composition root (task 4.1).
 *
 * This file used to be the application: it constructed the engine and the
 * synth, held every piece of state, owned the global input listeners, folded
 * runs into the profile and rendered the whole tree. It is now the wiring.
 *
 * The rule this file follows: **it may hold the phase machine and nothing
 * else.** The phase is genuinely app-level state — every other concern has a
 * hook that owns it and exposes verbs:
 *
 *   `useEngine`        the Game + Synth instances and their imperative controls
 *   `useLocalScores`   the local high-score table
 *   `useProfile`       persistent profile, achievements, toast queue
 *   `useMute`          the mute preference and its persistence
 *   `useInputBindings` global keyboard + lifecycle listeners
 *   `useStallGuard`    the canvas watchdog
 *   `useVerifiedRun`   the server-side run lifecycle (start → attest → submit)
 *
 * `App` composes those and decides what is on screen. When a concern grows a
 * second consumer it moves into its own hook, not back in here.
 *
 * The refs that mirror state for imperative listeners are written from effects,
 * never during render — writing during render is unsafe under concurrent
 * rendering.
 */

import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RunStats } from "../game/types.js";
import type { AchievementProgress } from "../game/achievements.js";
import { CURRENT_SCORING_VERSION, loadName, saveName, type ScoreEntry } from "../game/scoring.js";
import { applyAccent } from "../game/constants.js";
import { AchievementToast } from "../ui/components/AchievementToast.js";
import { GameCanvas } from "../ui/components/GameCanvas.js";
import { TouchControls, TOUCH_H, TOUCH_W } from "../ui/components/TouchControls.js";
import { StartScreen } from "../ui/components/StartScreen.js";
import { PauseScreen } from "../ui/components/PauseScreen.js";
import { GameOverScreen } from "../ui/components/GameOverScreen.js";
import { ScoresPanel } from "../ui/components/ScoresPanel.js";
import { StallNotice } from "../ui/components/StallNotice.js";
import { useStallGuard } from "./useStallGuard.js";
import { useEngine } from "./useEngine.js";
import { useLocalScores } from "./useLocalScores.js";
import { useProfile } from "./useProfile.js";
import { useMute } from "./useMute.js";
import { useInputBindings, type MenuView, type Phase } from "./useInputBindings.js";
import { createRunId } from "./runId.js";
import { createApiClient, type GameApiClient } from "./apiClient.js";
import { useLeaderboard, type BoardScope } from "./useLeaderboard.js";
import { useSession } from "./useSession.js";
import { LeaderboardPanel } from "../ui/components/LeaderboardPanel.js";
import type { RunMode } from "../shared/contracts.js";

/** How long after game over a restart keypress is ignored, so the keypress that
 *  ended the run cannot also start the next one. */
const RESTART_GUARD_MS = 600;

interface LastRun {
  stats: RunStats;
  entryId: string | null;
  rank: number;
  newBest: boolean;
  nudge: AchievementProgress | null;
}

export default function App(): ReactElement {
  const { muted, toggleMute } = useMute();
  // The API client is created once for the app's lifetime; `useSession` and
  // `useLeaderboard` share it so they share the token too.
  const [client] = useState<GameApiClient>(() => createApiClient());
  // The session supplies the token the board is fetched with, and the player id
  // that decides which row is "you". It never blocks play — see useSession.
  const session = useSession({ client });
  const engine = useEngine(muted);
  const stall = useStallGuard(engine.game);
  const scores = useLocalScores();
  const profile = useProfile();

  const [phase, setPhase] = useState<Phase>("menu");
  const [menuView, setMenuView] = useState<MenuView>("main");
  // The board's scope and mode are UI state, not hook state: the hook re-fetches
  // when they change, and the panel renders from them.
  const [boardScope, setBoardScope] = useState<BoardScope>("daily");
  const [boardMode, setBoardMode] = useState<RunMode>("endless");
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [name, setName] = useState(loadName);
  const [pulseReady, setPulseReady] = useState(false);
  const [pausedScore, setPausedScore] = useState(0);

  // Mirrors for the imperative listeners. Written from effects only.
  const phaseRef = useRef(phase);
  const menuViewRef = useRef(menuView);
  const lastRunRef = useRef(lastRun);
  const gameOverAt = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    menuViewRef.current = menuView;
  }, [menuView]);
  useEffect(() => {
    lastRunRef.current = lastRun;
  }, [lastRun]);

  // Player-sprite accent follows the profile and persists across sessions.
  useEffect(() => {
    applyAccent(profile.profile.accent);
  }, [profile.profile.accent]);

  const startRun = useCallback(() => {
    engine.startRun(scores.best ?? 0);
    setPulseReady(false);
    setPhase("playing");
  }, [engine, scores.best]);

  const pause = useCallback(() => {
    // The guard is app policy: blurring mid-menu must not pause a game that is
    // not running. The engine's own `pause()` is unconditional.
    if (phaseRef.current !== "playing") return;
    engine.pause();
    setPausedScore(engine.game.score);
    setPhase("paused");
  }, [engine]);

  const resume = useCallback(() => {
    engine.resume();
    setPhase("playing");
  }, [engine]);

  const toMenu = useCallback(() => {
    engine.toAttract();
    setPulseReady(false);
    setMenuView("main");
    setPhase("menu");
  }, [engine]);

  // engine → react. Registered once; the hook reads the latest closure.
  useEffect(() => {
    engine.setCallbacks({
      onGameOver: (stats) => {
        const entry: ScoreEntry = {
          id: createRunId(),
          name: loadName(),
          score: stats.score,
          level: stats.level,
          chips: stats.chips,
          maxCombo: stats.maxCombo,
          date: Date.now(),
          scoringVersion: CURRENT_SCORING_VERSION,
        };
        const { entryId, rank } = scores.record(entry);

        // Meta-progression: fold the run in, claim what unlocked, queue the
        // celebrations.
        const { newBest, nudge } = profile.record(stats);
        setLastRun({ stats, entryId, rank, newBest, nudge });

        gameOverAt.current = performance.now();
        engine.uiBlip();
        engine.synth.gameOver();
        setPhase("gameover");
      },
      onChargeReady: setPulseReady,
    });
  }, [engine, scores, profile]);

  useInputBindings(engine.game, {
    getPhase: () => phaseRef.current,
    getMenuView: () => menuViewRef.current,
    onStartRun: startRun,
    onPause: pause,
    onResume: resume,
    onMenu: toMenu,
    onToggleMute: toggleMute,
    onShowScores: () => setMenuView("scores"),
    onHideScores: () => setMenuView("main"),
    onPulse: () => engine.game.inputPulse(),
    setHeld: (dir, held) => engine.game.setHeld(dir, held),
    clearHeld: () => engine.game.clearHeld(),
    canRestart: () => performance.now() - gameOverAt.current > RESTART_GUARD_MS,
  });

  const onNameChange = useCallback(
    (next: string) => {
      setName(next);
      saveName(next);
      const entryId = lastRunRef.current?.entryId;
      if (entryId) scores.renameEntry(entryId, next);
    },
    [scores],
  );

  const onAccent = useCallback(
    (id: string) => {
      engine.uiBlip();
      applyAccent(id);
      profile.setAccent(id);
    },
    [engine, profile],
  );

  // Only fetch once a session exists — without a token the board is anonymous
  // and the request would be rejected. `isOnline` comes straight from the
  // browser so `offline` can be told apart from a server failure.
  const isOnline = useCallback(() => (typeof navigator === "undefined" ? true : navigator.onLine), []);
  const board = useLeaderboard({
    client,
    scope: boardScope,
    mode: boardMode,
    enabled: true,
    isOnline,
  });

  const touchPortrait = engine.isTouch && !engine.isLandscape;
  const touchLandscape = engine.isTouch && engine.isLandscape;

  return (
    <div
      className="bg-scene flex h-full w-full items-center justify-center"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={`flex items-center justify-center ${
          touchLandscape ? "flex-row gap-5" : "flex-col gap-2"
        }`}
      >
        <GameCanvas
          game={engine.game}
          reserveBottom={touchPortrait ? TOUCH_H : engine.isTouch ? 0 : 36}
          reserveRight={touchLandscape ? TOUCH_W : 0}
          onUnlockAudio={engine.unlockAudio}
          watchActive={phase === "playing"}
          onStall={stall.onStall}
          onStallRecover={stall.onStallRecover}
        />
        {engine.isTouch ? (
          <TouchControls
            game={engine.game}
            pulseReady={pulseReady}
            landscape={engine.isLandscape}
            onPause={pause}
            onUnlockAudio={engine.unlockAudio}
          />
        ) : (
          <div className="flex h-7 items-center gap-x-4 text-[11px] font-semibold tracking-[0.18em] text-veil-300">
            <span>
              <span className="kbd">WASD</span> MOVE
            </span>
            <span>
              <span className="kbd">SPACE</span> PULSE
            </span>
            <span>
              <span className="kbd">P</span> PAUSE
            </span>
            <span>
              <span className="kbd">M</span> {muted ? "UNMUTE" : "MUTE"}
            </span>
          </div>
        )}
      </div>

      {phase === "menu" &&
        (menuView === "main" ? (
          <StartScreen
            onPlay={startRun}
            onScores={() => {
              engine.unlockAudio();
              engine.uiBlip();
              setMenuView("scores");
            }}
            onLeaderboard={() => {
              engine.unlockAudio();
              engine.uiBlip();
              setMenuView("board");
            }}
            muted={muted}
            onToggleMute={toggleMute}
            best={scores.best}
            isTouch={engine.isTouch}
            profile={profile.profile}
            nearest={profile.nearest(3)}
            onAccent={onAccent}
          />
        ) : menuView === "board" ? (
          <LeaderboardPanel
            board={board}
            onScope={setBoardScope}
            onMode={setBoardMode}
            you={session.player?.id ?? null}
            onBack={() => {
              engine.uiBlip();
              setMenuView("main");
            }}
          />
        ) : (
          <ScoresPanel
            scores={scores.scores}
            onBack={() => {
              engine.uiBlip();
              setMenuView("main");
            }}
            onClear={scores.clear}
          />
        ))}

      {phase === "paused" && (
        <PauseScreen
          onResume={resume}
          onRestart={startRun}
          onMenu={toMenu}
          muted={muted}
          onToggleMute={toggleMute}
          isTouch={engine.isTouch}
          score={pausedScore}
        />
      )}

      {phase === "gameover" && lastRun && (
        <GameOverScreen
          stats={lastRun.stats}
          rank={lastRun.rank}
          entryId={lastRun.entryId}
          name={name}
          onNameChange={onNameChange}
          scores={scores.scores}
          onRestart={startRun}
          onMenu={toMenu}
          muted={muted}
          onToggleMute={toggleMute}
          isTouch={engine.isTouch}
          newBest={lastRun.newBest}
          nudge={lastRun.nudge}
        />
      )}

      {stall.stalled && (
        <StallNotice
          onResume={stall.resume}
          onMenu={() => {
            stall.resume();
            toMenu();
          }}
        />
      )}

      {profile.toast && (
        <AchievementToast achievement={profile.toast} onDone={profile.dismissToast} />
      )}
    </div>
  );
}
