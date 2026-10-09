import { Button, MuteButton } from "./ui";

interface Props {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  muted: boolean;
  onToggleMute: () => void;
  isTouch: boolean;
  score: number;
}

export function PauseScreen({ onResume, onRestart, onMenu, muted, onToggleMute, isTouch, score }: Props) {
  return (
    <div className="overlay">
      <div className="panel max-w-[360px] px-6 py-8 text-center">
        <div className="font-display text-xs font-bold tracking-[0.45em] text-cyan-300">SYSTEM</div>
        <h2 className="font-display mt-1 text-4xl font-black tracking-tight text-white">PAUSED</h2>
        <div className="mt-2 text-xs font-semibold tracking-[0.25em] text-slate-400">
          SCORE <span className="font-display text-amber-300">{score}</span>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <Button variant="primary" onClick={onResume} autoFocus>
            Resume
          </Button>
          <Button onClick={onRestart}>Restart</Button>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onMenu}>
              Main Menu
            </Button>
            <MuteButton muted={muted} onToggle={onToggleMute} />
          </div>
        </div>

        {!isTouch && (
          <div className="mt-5 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] font-semibold tracking-[0.15em] text-slate-500">
            <span>
              <span className="kbd">P</span> / <span className="kbd">ESC</span> RESUME
            </span>
            <span>
              <span className="kbd">R</span> RESTART
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
