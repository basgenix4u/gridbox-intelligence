import { Component, useEffect, useRef, type ErrorInfo, type ReactElement, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional reporter, called once per caught error (telemetry hook). */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

function reloadPage(): void {
  window.location.reload();
}

/**
 * Development-only detail overlay.
 *
 * Renders the error message, the stack and the React component stack so a
 * developer sees the failure in place instead of guessing. In production it
 * renders nothing — internal failure details never reach players.
 */
export function DevErrorOverlay({
  error,
  componentStack,
}: {
  error: Error;
  componentStack: string | null;
}): ReactElement | null {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      role="alert"
      data-testid="dev-error-overlay"
      className="mt-4 max-h-40 overflow-auto rounded-lg border border-bloom-700/40 bg-black/50 p-3 text-left"
    >
      <p className="font-mono text-[11px] font-semibold text-bloom-300">{error.name}</p>
      <pre className="mt-1 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-veil-300">
        {error.stack ?? error.message}
      </pre>
      {componentStack && (
        <pre className="text-veil-400 mt-2 border-t border-white/10 pt-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
          {componentStack}
        </pre>
      )}
    </div>
  );
}

/**
 * Catches render/lifecycle errors anywhere below it and swaps the tree for a
 * calm recovery panel — a thrown error must never leave the player on a blank
 * screen. The caught error is logged to the console (never shipped anywhere)
 * and handed to the optional `onError` reporter.
 *
 * Reset re-mounts the children from scratch, which is enough for transient
 * failures; Reload covers the rest. Local progress lives in the versioned
 * store, so neither action loses it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[error-boundary] uncaught error", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error, info);
  }

  private reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  override render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return <ErrorPanel error={error} componentStack={componentStack} onReset={this.reset} />;
  }
}

function ErrorPanel({
  error,
  componentStack,
  onReset,
}: {
  error: Error;
  componentStack: string | null;
  onReset: () => void;
}): ReactElement {
  const resetRef = useRef<HTMLButtonElement>(null);

  // Move focus to the recovery action so keyboard users are not stranded.
  useEffect(() => {
    resetRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="error-boundary-title"
      className="bg-scene fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      <div className="card w-full max-w-md p-6 text-center">
        <h1 id="error-boundary-title" className="font-display text-xl font-bold text-veil-100">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-veil-300">
          The game hit an unexpected error. Your progress is saved on this device — you can pick up right where you left
          off.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button ref={resetRef} type="button" className="btn btn-primary" onClick={onReset}>
            Try again
          </button>
          <button type="button" className="btn btn-ghost" onClick={reloadPage}>
            Reload
          </button>
        </div>
        <DevErrorOverlay error={error} componentStack={componentStack} />
      </div>
    </div>
  );
}
