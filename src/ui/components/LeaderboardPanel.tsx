import type { ReactElement } from "react";
import type { LeaderboardRow, RunMode } from "../../shared/contracts.js";
import type { UseLeaderboardResult } from "../../app/useLeaderboard.js";
import { Button } from "./ui";

/**
 * Leaderboard panel (task 4.8, the UI half of 4.2).
 *
 * Every state the resource hook can report gets its own sentence, because the
 * five states mean five different things to a player:
 *
 *   loading  "one moment" — nothing to show yet
 *   ready    the board, with the player's own row marked
 *   empty    "nobody has played this yet" — an invitation, not an apology
 *   offline  "you are not connected" — and *no* retry button, because the
 *            browser is already waiting for the network to come back
 *   error    "the server is unhappy" — with a retry, because it might not be
 *
 * The offline case deliberately hides the retry button. Offering "Retry" to
 * someone with no connection is a button that cannot work, and a backoff is
 * already running underneath — the request fires the moment `online` lands.
 */

const MODE_LABEL: Record<RunMode, string> = {
  endless: "ENDLESS",
  daily: "DAILY",
  zen: "ZEN",
  hardcore: "HARDCORE",
};

interface PanelProps {
  board: UseLeaderboardResult;
  onBack: () => void;
}

/** A scope + mode switcher. Radios, not tabs: arrow keys must work. */
function ScopeSwitch({
  scope,
  mode,
  onScope,
  onMode,
}: {
  scope: "daily" | "global";
  mode: RunMode;
  onScope: (scope: "daily" | "global") => void;
  onMode: (mode: RunMode) => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex gap-1 rounded-lg bg-ink-900/70 p-1"
        role="radiogroup"
        aria-label="Leaderboard scope"
      >
        {(["daily", "global"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={scope === s}
            onClick={() => onScope(s)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[11px] font-bold tracking-[0.18em] transition-colors ${
              scope === s ? "bg-bloom-500 text-ink-950" : "text-veil-300 hover:text-white"
            }`}
          >
            {s === "daily" ? "TODAY" : "ALL TIME"}
          </button>
        ))}
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label="Game mode">
        {(["endless", "daily", "zen", "hardcore"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => onMode(m)}
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-bold tracking-[0.14em] transition-colors ${
              mode === m ? "bg-ink-700 text-white" : "text-veil-400 hover:text-white"
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

function BoardTable({ rows, you }: { rows: LeaderboardRow[]; you: string | null }): ReactElement {
  return (
    <div className="card overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left text-[13px]">
        <caption className="sr-only">
          Leaderboard, {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </caption>
        <thead>
          <tr className="bg-ink-900/80 text-[10px] font-bold tracking-[0.2em] text-veil-300">
            <th className="py-2 pl-3 font-bold">#</th>
            <th className="py-2 font-bold">NAME</th>
            <th className="py-2 text-right font-bold">LV</th>
            <th className="py-2 pr-3 text-right font-bold">SCORE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isYou = you !== null && row.playerId === you;
            return (
              <tr
                key={`${row.playerId}-${row.rank}`}
                className={`border-t border-ink-800/60 ${
                  isYou ? "bg-bloom-500/15 font-bold text-white" : "text-veil-200"
                }`}
              >
                <td className="py-2 pl-3 tabular-nums">{row.rank}</td>
                <td className="py-2">
                  {row.initials}
                  {isYou && (
                    <span
                      data-testid="you-badge"
                      className="ml-2 text-[10px] tracking-[0.14em] text-bloom-400"
                    >
                      YOU
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{row.level}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{row.score.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A non-blocking notice shown above a stale board. */
function Notice({ tone, title, children }: { tone: "error" | "offline"; title: string; children: ReactElement }): ReactElement {
  return (
    <div
      role="status"
      className={`mb-3 rounded-lg border px-4 py-3 text-center ${
        tone === "error" ? "border-rose-500/40 bg-rose-500/10" : "border-ink-700 bg-ink-900/70"
      }`}
    >
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-0.5 text-xs text-veil-300">{children}</p>
    </div>
  );
}

/** The five states, each with its own sentence. */
function BoardBody({ board, you }: { board: UseLeaderboardResult; you: string | null }): ReactElement {
  const rows = board.data ?? [];

  if (board.status === "loading") {
    return (
      <div className="card border-dashed px-4 py-6 text-center text-sm font-medium text-veil-300">
        Loading the board…
      </div>
    );
  }

  // A failed refresh keeps the last good board on screen — a stale leaderboard
  // beats a blank one — with the failure stated above it rather than instead
  // of it. Only a *first* load that fails leaves nothing to show.
  if (rows.length > 0 && (board.status === "error" || board.status === "offline")) {
    return (
      <div>
        {board.status === "error" ? (
          <>
            <Notice tone="error" title="Could not refresh the board">
              <>{board.error?.message ?? "Unknown error"}</>
            </Notice>
            <div className="mt-3 text-center">
              <Button variant="ghost" onClick={board.refresh}>
                Try again
              </Button>
            </div>
          </>
        ) : (
          // No retry button on purpose: there is nothing to retry until the
          // network returns, and the hook is already listening for that.
          <Notice tone="offline" title="You are offline">
            <>Showing your last board. It will update when you are back online.</>
          </Notice>
        )}
        <div className="mt-3">
          <BoardTable rows={rows} you={you} />
        </div>
      </div>
    );
  }

  if (board.status === "offline") {
    return (
      <div className="card border-dashed px-4 py-6 text-center">
        <p className="text-sm font-semibold text-white">You are offline</p>
        <p className="mt-1 text-xs text-veil-300">
          The board will appear as soon as you are back online.
        </p>
      </div>
    );
  }

  if (board.status === "error") {
    return (
      <div className="card border-dashed px-4 py-6 text-center">
        <p className="text-sm font-semibold text-white">Could not load the board</p>
        <p className="mt-1 text-xs text-veil-300">{board.error?.message ?? "Unknown error"}</p>
        <Button variant="ghost" className="mt-3" onClick={board.refresh}>
          Try again
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    // An empty board is a fact about the world, not a failure.
    return (
      <div className="card border-dashed px-4 py-6 text-center">
        <p className="text-sm font-semibold text-white">No runs yet</p>
        <p className="mt-1 text-xs text-veil-300">
          {board.scope === "daily" ? "Be the first on today's board." : "Be the first on the board."}
        </p>
      </div>
    );
  }

  return <BoardTable rows={rows} you={you} />;
}

export function LeaderboardPanel({
  board,
  onBack,
  onScope,
  onMode,
  you,
}: PanelProps & {
  onScope: (scope: "daily" | "global") => void;
  onMode: (mode: RunMode) => void;
  you: string | null;
}): ReactElement {
  return (
    <div className="overlay">
      <div className="panel px-5 py-7 sm:px-7">
        <div className="text-center">
          <div className="font-display text-xs font-bold tracking-[0.45em] text-bloom-400">
            {board.scope === "daily" ? "TODAY" : "ALL TIME"}
          </div>
          <h2 className="mt-1 font-display text-3xl font-black tracking-tight text-white">LEADERBOARD</h2>
        </div>

        <div className="mt-5">
          <ScopeSwitch
            scope={board.scope}
            mode={board.mode}
            onScope={onScope}
            onMode={onMode}
          />
        </div>

        <div className="mt-4">
          <BoardBody board={board} you={you} />
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="primary" className="flex-1" onClick={onBack} autoFocus>
            Back
          </Button>
          {board.retrying && board.data !== null && (
            <span className="self-center text-[10px] tracking-[0.14em] text-veil-400">SYNCING</span>
          )}
        </div>
      </div>
    </div>
  );
}
