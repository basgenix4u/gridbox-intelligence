import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  glow?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "ghost",
  glow = false,
  className = "",
  children,
  ...rest
}: ButtonProps): ReactElement {
  const v = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost";
  return (
    <button type="button" className={`btn ${v} ${glow ? "btn-glow" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      onClick={onToggle}
      aria-label={muted ? "Unmute" : "Mute"}
      title={muted ? "Unmute (M)" : "Mute (M)"}
    >
      {muted ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 5a9 9 0 0 1 0 14" />
        </svg>
      )}
    </button>
  );
}

export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}): ReactElement {
  return (
    <div className="flex flex-col items-center rounded-xl border border-slate-700/60 bg-slate-900/60 px-2 py-2">
      <span className="font-display text-base font-bold" style={{ color: accent ?? "#f8fafc" }}>
        {value}
      </span>
      <span className="text-[10px] font-semibold tracking-[0.2em] text-slate-400">{label}</span>
    </div>
  );
}
