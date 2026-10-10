import { describe, expect, it } from "vitest";
import { bfs, chebyshev, manhattan } from "./ai";

const COLS = 5;
const ROWS = 5;
const idx = (x: number, y: number): number => y * COLS + x;

describe("bfs", () => {
  it("returns 0 at the source and -1 where unreachable", () => {
    const walls = new Uint8Array(COLS * ROWS);
    const out = new Int16Array(COLS * ROWS);
    const queue = new Int32Array(COLS * ROWS);
    bfs(walls, COLS, ROWS, [idx(0, 0)], out, queue);
    expect(out[idx(0, 0)]).toBe(0);
    expect(out[idx(4, 4)]).toBe(8);
  });

  it("does not cross walls", () => {
    const walls = new Uint8Array(COLS * ROWS);
    // Full vertical wall in column 2 isolates the right half.
    for (let y = 0; y < ROWS; y++) walls[idx(2, y)] = 1;
    const out = new Int16Array(COLS * ROWS);
    const queue = new Int32Array(COLS * ROWS);
    bfs(walls, COLS, ROWS, [idx(0, 0)], out, queue);
    expect(out[idx(4, 4)]).toBe(-1);
    expect(out[idx(1, 0)]).toBe(1);
  });

  it("supports multiple sources and picks the nearest", () => {
    const walls = new Uint8Array(COLS * ROWS);
    const out = new Int16Array(COLS * ROWS);
    const queue = new Int32Array(COLS * ROWS);
    bfs(walls, COLS, ROWS, [idx(0, 0), idx(4, 0)], out, queue);
    expect(out[idx(0, 0)]).toBe(0);
    expect(out[idx(4, 0)]).toBe(0);
    expect(out[idx(2, 0)]).toBe(2); // equidistant from both sources
  });

  it("ignores sources that are walls or out of bounds", () => {
    const walls = new Uint8Array(COLS * ROWS);
    walls[idx(0, 0)] = 1;
    const out = new Int16Array(COLS * ROWS);
    const queue = new Int32Array(COLS * ROWS);
    expect(() => bfs(walls, COLS, ROWS, [idx(0, 0), -1, 999], out, queue)).not.toThrow();
    expect(out[idx(0, 0)]).toBe(-1); // wall cells are never reached
  });

  it("produces a monotonically increasing field on an open board", () => {
    const walls = new Uint8Array(COLS * ROWS);
    const out = new Int16Array(COLS * ROWS);
    const queue = new Int32Array(COLS * ROWS);
    bfs(walls, COLS, ROWS, [idx(2, 2)], out, queue);
    expect(out[idx(2, 2)]).toBe(0);
    expect(out[idx(2, 3)]).toBe(1);
    expect(out[idx(2, 4)]).toBe(2);
    expect(out[idx(0, 0)]).toBe(4);
  });
});

describe("manhattan", () => {
  it("sums axis distances", () => {
    expect(manhattan(0, 0, 3, 4)).toBe(7);
    expect(manhattan(3, 4, 0, 0)).toBe(7);
    expect(manhattan(2, 2, 2, 2)).toBe(0);
  });
});

describe("chebyshev", () => {
  it("takes the larger axis distance", () => {
    expect(chebyshev(0, 0, 3, 4)).toBe(4);
    expect(chebyshev(0, 0, 5, 2)).toBe(5);
    expect(chebyshev(2, 2, 2, 2)).toBe(0);
  });
});
