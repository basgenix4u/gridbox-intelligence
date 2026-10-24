import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "@/game/engine";
import { Synth } from "@/core/adapters/webAudio";
import { applyAccent } from "@/game/constants";
import type { Dir, RunStats } from "@/game/types";
import {
  CURRENT_SCORING_VERSION,
  addScore,
  clearScores,
  loadName,
  loadScores,
  saveName,
  updateName,
  type ScoreEntry,
} from "@/game/scoring";
import {
  ACHIEVEMENTS,
  markUnlocked,
  nearest,
  newlyUnlocked,
  type AchievementDef,
  type AchievementProgress,
} from "@/game/achievements";
import { loadProfile, recordRun, saveProfile, type Profile } from "@/game/profile";
import { AchievementToast } from "@/ui/components/AchievementToast";
import { GameCanvas } from "@/ui/components/GameCanvas";
import { TouchControls, TOUCH_H, TOUCH_W } from "@/ui/components/TouchControls";
import { StartScreen } from "@/ui/components/StartScreen";
import { PauseScreen } from "@/ui/components/PauseScreen";
import { GameOverScreen } from "@/ui/components/GameOverScreen";
import { ScoresPanel } from "@/ui/components/ScoresPanel";
import { StallNotice } from "@/ui/components/StallNotice";
import { useStallGuard } from "./useStallGuard";

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a] as const));

type Phase = "menu" | "playing" | "paused" | "gameover";
const MUTE_KEY = "gridbox-intelligence.muted";

function keyToDir(code: string): Dir | null {
  switch (code) {
    case "ArrowUp":
    case "KeyW":
      return 0;
    case "ArrowRight":
    case "KeyD":
      return 1;
    case "ArrowDown":
    case "KeyS":
      return 2;
    case "ArrowLeft":
    case "KeyA":
      return 3;
    default:
      return null;
  }
}

function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;
  return coarse || "ontouchstart" in window;
}

/** Collision-resistant run id. Falls back where `randomUUID` is unavailable. */
function createRunId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

interface LastRun {
  stats: RunStats;
  entryId: string | null;
  rank: number;
  newBest: boolean;
  nudge: AchievementProgress | null;
}

export default function App(): ReactElement {
  const [synth] = useState(() => new Synth());
  const [game] = useState(() => new Game(synth));
  const stall = useStallGuard(game);
  const [phase, setPhase] = useState<Phase>("menu");
  const [menuView, setMenuView] = useState<"main" | "scores">("main");
  const [scores, setScores] = useState<ScoreEntry[]>(() => loadScores());
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [toast, setToast] = useState<AchievementDef | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [name, setName] = useState(() => loadName());
  const [muted, setMuted] = useState(readMuted);
  const [isTouch, setIsTouch] = useState(detectTouch);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  const [pulseReady, setPulseReady] = useState(false);
  const [pausedScore, setPausedScore] = useState(0);

  const phaseRef = useRef(phase);
  const menuViewRef = useRef(menuView);
  const scoresRef = useRef(scores);
  const profileRef = useRef(profile);
  const toastQueueRef = useRef<AchievementDef[]>([]);
  const gameOverAt = useRef(0);

  // Refs mirror state for use inside imperative listeners. They must be
  // written from an effect, never during render — writing during render is
  // unsafe under concurrent rendering and breaks the React Compiler.
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    menuViewRef.current = menuView;
  }, [menuView]);
  useEffect(() => {
    scoresRef.current = scores;
  }, [scores]);
  useEffect(() => {
    profileRef.current = profile;
    saveProfile(profile);
  }, [profile]);

  // Player-sprite accent follows the profile and persists across sessions.
  useEffect(() => {
    applyAccent(profile.accent);
  }, [profile.accent]);

  // Claim any achievement whose goal is already met (e.g. profile restored on
  // a new device) without firing toasts — celebrations belong to live moments.
  useEffect(() => {
    const pending = newlyUnlocked(profileRef.current);
    if (pending.length > 0) {
      setProfile((p) => markUnlocked(p, pending));
    }
  }, []);

  useEffect(() => {
    synth.muted = muted;
  }, [synth, muted]);

  useEffect(() => {
    game.isTouch = isTouch;
  }, [game, isTouch]);

  useEffect(() => {
    game.reducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
  }, [game]);

  const unlockAudio = useCallback(() => synth.unlock(), [synth]);

  const startRun = useCallback(() => {
    synth.unlock();
    synth.ui();
    game.bestScore = scoresRef.current.length ? scoresRef.current[0].score : 0;
    game.startRun();
    setPulseReady(false);
    setPhase("playing");
  }, [game, synth]);

  const pause = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    game.pause();
    setPausedScore(game.score);
    setPhase("paused");
  }, [game]);

  const resume = useCallback(() => {
    synth.unlock();
    game.resume();
    setPhase("playing");
  }, [game, synth]);

  const toMenu = useCallback(() => {
    synth.ui();
    game.resume();
    game.startAttract();
    setPulseReady(false);
    setMenuView("main");
    setPhase("menu");
  }, [game, synth]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const v = !m;
      try {
        localStorage.setItem(MUTE_KEY, v ? "1" : "0");
      } catch {
        /* ignore */
      }
      return v;
    });
  }, []);

  // engine → react callbacks
  useEffect(() => {
    game.callbacks = {
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
        const { list, rank } = addScore(entry);
        setScores(list);

        // Meta-progression: fold the run into the persistent profile, claim
        // whatever just unlocked, and queue celebrations.
        const { profile: next, newBest } = recordRun(profileRef.current, stats, Date.now());
        const unlockedIds = newlyUnlocked(next);
        const claimed = markUnlocked(next, unlockedIds);
        profileRef.current = claimed;
        setProfile(claimed);
        const defs = unlockedIds
          .map((id) => ACHIEVEMENT_BY_ID.get(id))
          .filter((d): d is AchievementDef => d !== undefined);
        if (defs.length > 0) {
          setToast(defs[0]);
          toastQueueRef.current = defs.slice(1);
        }
        const nudge = nearest(claimed, 1)[0] ?? null;
        setLastRun({ stats, entryId: rank > 0 ? entry.id : null, rank, newBest, nudge });

        gameOverAt.current = performance.now();
        synth.gameOver();
        setPhase("gameover");
      },
      onChargeReady: (ready) => setPulseReady(ready),
    };
  }, [game, synth]);

  // global input + lifecycle listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const ph = phaseRef.current;
      const dir = keyToDir(e.code);
      if (dir !== null) {
        e.preventDefault();
        if (ph === "playing" && !e.repeat) {
          synth.unlock();
          game.setHeld(dir, true);
        }
        return;
      }
      switch (e.code) {
        case "Space":
        case "Enter": {
          e.preventDefault();
          if (e.repeat) return;
          synth.unlock();
          if (ph === "menu") {
            if (menuViewRef.current === "main") startRun();
          } else if (ph === "playing") {
            game.inputPulse();
          } else if (ph === "paused") {
            resume();
          } else if (ph === "gameover" && performance.now() - gameOverAt.current > 600) {
            startRun();
          }
          break;
        }
        case "KeyE":
        case "ShiftLeft":
        case "ShiftRight":
          if (ph === "playing") game.inputPulse();
          break;
        case "KeyP":
        case "Escape":
          if (ph === "playing") pause();
          else if (ph === "paused") resume();
          else if (ph === "menu" && menuViewRef.current === "scores") setMenuView("main");
          break;
        case "KeyR":
          if (ph === "gameover" || ph === "paused") startRun();
          break;
        case "KeyM":
          toggleMute();
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = keyToDir(e.code);
      if (dir !== null) game.setHeld(dir, false);
    };
    const onBlur = () => {
      game.clearHeld();
      pause();
    };
    const onVis = () => {
      if (document.hidden) {
        game.clearHeld();
        pause();
      }
    };
    const onResize = () => setLandscape(window.innerWidth > window.innerHeight);
    const onTouch = () => setIsTouch(true);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", onResize);
    window.addEventListener("touchstart", onTouch, { passive: true, once: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("touchstart", onTouch);
    };
  }, [game, synth, startRun, pause, resume, toggleMute]);

  const onNameChange = (n: string) => {
    setName(n);
    saveName(n);
    if (lastRun?.entryId) setScores(updateName(lastRun.entryId, n));
  };

  const onAccent = useCallback(
    (id: string) => {
      synth.ui();
      applyAccent(id);
      setProfile((p) => ({ ...p, accent: id }));
    },
    [synth],
  );

  const dismissToast = useCallback(() => {
    setToast(toastQueueRef.current.shift() ?? null);
  }, []);

  const touchPortrait = isTouch && !landscape;
  const touchLandscape = isTouch && landscape;
  const best = scores.length ? scores[0].score : null;

  return (
    <div className="bg-scene flex h-full w-full items-center justify-center" onContextMenu={(e) => e.preventDefault()}>
      <div className={`flex items-center justify-center ${touchLandscape ? "flex-row gap-5" : "flex-col gap-2"}`}>
        <GameCanvas
          game={game}
          reserveBottom={touchPortrait ? TOUCH_H : isTouch ? 0 : 36}
          reserveRight={touchLandscape ? TOUCH_W : 0}
          onUnlockAudio={unlockAudio}
          watchActive={phase === "playing"}
          onStall={stall.onStall}
          onStallRecover={stall.onStallRecover}
        />
        {isTouch ? (
          <TouchControls
            game={game}
            pulseReady={pulseReady}
            landscape={landscape}
            onPause={pause}
            onUnlockAudio={unlockAudio}
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
              synth.unlock();
              synth.ui();
              setMenuView("scores");
            }}
            muted={muted}
            onToggleMute={toggleMute}
            best={best}
            isTouch={isTouch}
            profile={profile}
            nearest={nearest(profile, 3)}
            onAccent={onAccent}
          />
        ) : (
          <ScoresPanel
            scores={scores}
            onBack={() => {
              synth.ui();
              setMenuView("main");
            }}
            onClear={() => setScores(clearScores())}
          />
        ))}

      {phase === "paused" && (
        <PauseScreen
          onResume={resume}
          onRestart={startRun}
          onMenu={toMenu}
          muted={muted}
          onToggleMute={toggleMute}
          isTouch={isTouch}
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
          scores={scores}
          onRestart={startRun}
          onMenu={toMenu}
          muted={muted}
          onToggleMute={toggleMute}
          isTouch={isTouch}
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

      {toast && <AchievementToast achievement={toast} onDone={dismissToast} />}
    </div>
  );
}
