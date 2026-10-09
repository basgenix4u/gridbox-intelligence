import type { Layout } from "./types";
import { hexToRgb, rr } from "./draw";

/**
 * Pre-rendered bitmaps: radial glows (instead of shadowBlur, which is very slow on
 * mobile), the static grid/walls layer and the vignette. Everything is rebuilt on resize.
 */
export class SpriteCache {
  staticLayer: HTMLCanvasElement | null = null;
  vignette: HTMLCanvasElement | null = null;
  private glows = new Map<string, HTMLCanvasElement>();

  clearGlows(): void {
    this.glows.clear();
  }

  glow(color: string, size: number): HTMLCanvasElement {
    const s = Math.max(4, Math.round(size));
    const key = `${color}:${s}`;
    let c = this.glows.get(key);
    if (!c) {
      c = document.createElement("canvas");
      c.width = s;
      c.height = s;
      const ctx = c.getContext("2d");
      if (ctx) {
        const { r, g, b } = hexToRgb(color);
        const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, `rgba(${r},${g},${b},0.6)`);
        grad.addColorStop(0.35, `rgba(${r},${g},${b},0.2)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
      }
      this.glows.set(key, c);
    }
    return c;
  }

  buildStatic(L: Layout, walls: Uint8Array, cols: number, rows: number): void {
    const { W, H, cell, ox, oy, dpr } = L;
    const c = this.staticLayer ?? document.createElement("canvas");
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1020");
    bg.addColorStop(1, "#05070d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const gw = cols * cell;
    const gh = rows * cell;

    // frame
    rr(ctx, ox - 5, oy - 5, gw + 10, gh + 10, 12);
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(34,211,238,0.25)";
    ctx.stroke();

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = ox + x * cell;
        const py = oy + y * cell;
        if (walls[y * cols + x]) {
          rr(ctx, px + 2, py + 2, cell - 4, cell - 4, cell * 0.16);
          ctx.fillStyle = "#1c2639";
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = "rgba(148,163,184,0.3)";
          ctx.stroke();
          rr(ctx, px + cell * 0.3, py + cell * 0.3, cell * 0.4, cell * 0.4, cell * 0.06);
          ctx.fillStyle = "#0a1120";
          ctx.fill();
          ctx.fillStyle = "rgba(148,163,184,0.14)";
          ctx.fillRect(px + cell * 0.22, py + 3.5, cell * 0.56, 1.5);
        } else {
          rr(ctx, px + 1.5, py + 1.5, cell - 3, cell - 3, cell * 0.12);
          ctx.fillStyle = (x + y) % 2 === 0 ? "rgba(56,189,248,0.05)" : "rgba(56,189,248,0.035)";
          ctx.fill();
          ctx.fillStyle = "rgba(148,163,184,0.13)";
          ctx.fillRect(px + cell / 2 - 0.75, py + cell / 2 - 0.75, 1.5, 1.5);
        }
      }
    }
    this.staticLayer = c;
  }

  buildVignette(L: Layout): void {
    const { W, H, dpr } = L;
    const c = this.vignette ?? document.createElement("canvas");
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const inner = Math.min(W, H) * 0.38;
    const outer = Math.max(W, H) * 0.78;
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    this.vignette = c;
  }
}
