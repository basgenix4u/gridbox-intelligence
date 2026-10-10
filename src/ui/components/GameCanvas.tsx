import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import type { Game } from "@/game/engine";
import { renderGame } from "@/game/render";
import type { Dir } from "@/game/types";

interface Props {
  game: Game;
  reserveBottom: number;
  reserveRight: number;
  onUnlockAudio: () => void;
}

const SWIPE_FIRST = 20;
const SWIPE_REPEAT = 38;

export function GameCanvas({ game, reserveBottom, reserveRight, onUnlockAudio }: Props): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const apply = () => {
      const availW = Math.min(window.innerWidth - 16 - reserveRight, 640);
      const availH = window.innerHeight - reserveBottom - 16;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      game.resize(availW, availH, dpr);
      const L = game.layout;
      canvas.width = Math.round(L.W * dpr);
      canvas.height = Math.round(L.H * dpr);
      canvas.style.width = `${L.W}px`;
      canvas.style.height = `${L.H}px`;
    };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      game.update(dt);
      renderGame(game, ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // make sure the canvas fonts are available early
    if ("fonts" in document) {
      void document.fonts.load("700 20px Orbitron");
      void document.fonts.load("600 14px Rajdhani");
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, [game, reserveBottom, reserveRight]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    onUnlockAudio();
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = swipe.current;
    if (s?.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const threshold = s.moved ? SWIPE_REPEAT : SWIPE_FIRST;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
    game.inputDir(dir);
    s.x = e.clientX;
    s.y = e.clientY;
    s.moved = true;
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (swipe.current?.id === e.pointerId) swipe.current = null;
  };

  return (
    <canvas
      ref={ref}
      className="block touch-none rounded-2xl shadow-[0_20px_70px_rgba(0,0,0,0.55)] select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
