import { describe, expect, it } from "vitest";
import { createRng } from "@/core/adapters/seededRng";
import { ParticleSystem } from "./particles";

/** Minimal 2D context recorder — enough to assert what `draw` emits. */
function recordingContext() {
  const rects: { x: number; y: number; size: number; alpha: number }[] = [];
  let alpha = 1;
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    fillRect: (x: number, y: number, w: number) => {
      rects.push({ x, y, size: w, alpha });
    },
  };
  return {
    rects,
    ctx: new Proxy(ctx, {
      set(target, prop: string, value) {
        if (prop === "globalAlpha") alpha = value as number;
        (target as unknown as Record<string, unknown>)[prop] = value;
        return true;
      },
      get(target, prop: string) {
        if (prop === "globalAlpha") return alpha;
        return (target as unknown as Record<string, unknown>)[prop];
      },
    }) as unknown as CanvasRenderingContext2D,
  };
}

describe("ParticleSystem", () => {
  it("emits the requested number of particles", () => {
    const ps = new ParticleSystem(createRng(1));
    ps.emit(10, 20, "#fff", { count: 12, speed: 3, size: 4, life: 500 });
    expect(ps.list).toHaveLength(12);
  });

  it("caps total particles instead of growing without bound", () => {
    const ps = new ParticleSystem(createRng(2));
    ps.max = 50;
    for (let i = 0; i < 20; i++) ps.emit(0, 0, "#fff", { count: 10, speed: 1, size: 1, life: 100 });
    expect(ps.list.length).toBeLessThanOrEqual(50);
  });

  it("ages particles out on update", () => {
    const ps = new ParticleSystem(createRng(3));
    ps.emit(0, 0, "#fff", { count: 5, speed: 1, size: 1, life: 100 });
    ps.update(50);
    expect(ps.list).toHaveLength(5);
    ps.update(100);
    expect(ps.list).toHaveLength(0);
  });

  it("ignores non-positive dt so a paused frame cannot age particles", () => {
    const ps = new ParticleSystem(createRng(4));
    ps.emit(0, 0, "#fff", { count: 3, speed: 1, size: 1, life: 100 });
    ps.update(0);
    ps.update(-10);
    expect(ps.list).toHaveLength(3);
  });

  it("clears everything", () => {
    const ps = new ParticleSystem(createRng(5));
    ps.emit(0, 0, "#fff", { count: 8, speed: 1, size: 1, life: 100 });
    ps.clear();
    expect(ps.list).toHaveLength(0);
  });

  it("emits a ring with the requested count", () => {
    const ps = new ParticleSystem(createRng(6));
    ps.ring(100, 100, "#0ff", 16, 5, 3, 400);
    expect(ps.list).toHaveLength(16);
  });

  it("respects a directed arc rather than a full circle", () => {
    const full = new ParticleSystem(createRng(7));
    full.emit(0, 0, "#fff", { count: 40, speed: 5, size: 1, life: 500 });

    const directed = new ParticleSystem(createRng(7));
    directed.emit(0, 0, "#fff", { count: 40, speed: 5, size: 1, life: 500, angle: 0, arc: Math.PI / 8 });

    const spread = (ps: ParticleSystem): number => {
      // Directed emission should keep velocities on one side.
      return ps.list.filter((p) => p.vx > 0).length;
    };
    expect(spread(directed)).toBeGreaterThan(spread(full));
  });

  it("draws one rect per particle and restores globalAlpha", () => {
    const ps = new ParticleSystem(createRng(8));
    ps.emit(0, 0, "#fff", { count: 6, speed: 1, size: 4, life: 500 });
    const { ctx, rects } = recordingContext();
    ps.draw(ctx);
    expect(rects).toHaveLength(6);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("is deterministic for a given seed", () => {
    const a = new ParticleSystem(createRng(99));
    const b = new ParticleSystem(createRng(99));
    a.emit(0, 0, "#fff", { count: 10, speed: 2, size: 2, life: 300 });
    b.emit(0, 0, "#fff", { count: 10, speed: 2, size: 2, life: 300 });
    expect(a.list).toEqual(b.list);
  });
});
