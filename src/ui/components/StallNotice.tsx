import { useEffect, useRef, type ReactElement } from "react";

export interface StallNoticeProps {
  /** Resume the paused run. */
  onResume: () => void;
  /** Leave the run entirely. */
  onMenu: () => void;
}

/**
 * Shown when the RAF watchdog detects that the render loop has stopped on a
 * visible tab. The game is already paused by then — this explains the freeze
 * and offers the two ways out. `role="alert"` announces it to screen readers
 * without stealing focus from the canvas.
 */
export function StallNotice({ onResume, onMenu }: StallNoticeProps): ReactElement {
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    resumeRef.current?.focus();
  }, []);

  return (
    <div
      role="alert"
      data-testid="stall-notice"
      className="card fixed inset-x-0 top-3 z-40 mx-auto flex w-max max-w-[92vw] flex-col items-center gap-2 px-4 py-3 text-center"
    >
      <p className="text-sm leading-relaxed text-veil-200">
        The game loop stalled — browsers sometimes throttle background tabs. The run is paused; nothing is lost.
      </p>
      <div className="flex gap-2">
        <button ref={resumeRef} type="button" className="btn btn-primary" onClick={onResume}>
          Resume
        </button>
        <button type="button" className="btn btn-ghost" onClick={onMenu}>
          Main menu
        </button>
      </div>
    </div>
  );
}
