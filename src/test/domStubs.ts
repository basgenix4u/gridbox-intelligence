/**
 * Minimal DOM stubs so the game core can run under Node.
 *
 * The engine only touches the DOM for two reasons: offscreen canvases used as
 * sprite/vignette caches, and `navigator.vibrate`. Neither needs a real
 * implementation to exercise simulation logic — the 2D context is a no-op
 * proxy, which is why this is a test helper and not a mock library.
 */
const noop = (): void => undefined;

function createContextStub(): unknown {
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop === "canvas") return { width: 320, height: 420 };
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return () => ({ addColorStop: noop });
      }
      if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      if (prop in target) return target[prop];
      return noop;
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
}

/** Installs global `document`/`window`/`navigator` stubs. Idempotent. */
export function installDomStubs(): void {
  const g = globalThis as unknown as Record<string, unknown>;

  g.document ??= {
    createElement: (tag: string) =>
      tag === "canvas" ? { width: 0, height: 0, style: {}, getContext: () => createContextStub() } : { style: {} },
    fonts: { load: () => Promise.resolve([]) },
    hidden: false,
  };

  g.window ??= {
    devicePixelRatio: 1,
    innerWidth: 400,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
    addEventListener: noop,
    removeEventListener: noop,
  };

  g.navigator ??= { vibrate: noop };
}

/**
 * Patches `HTMLCanvasElement.prototype.getContext` with a no-op 2D context.
 *
 * jsdom ships no canvas implementation, so `getContext("2d")` returns null and
 * any component that guards on it silently skips its own setup. Install this
 * when a test needs the canvas *code path* to run, not just the element.
 */
export function installCanvasContextStub(): void {
  if (typeof HTMLCanvasElement === "undefined") return;
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return createContextStub() as RenderingContext;
  } as HTMLCanvasElement["getContext"];
}
