/**
 * Multi-source breadth-first search over the grid. Writes the step distance
 * from the nearest source into `out` (-1 = unreachable / wall).
 */
export function bfs(
  walls: Uint8Array,
  cols: number,
  rows: number,
  sources: number[],
  out: Int16Array,
  queue: Int32Array,
): void {
  out.fill(-1);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (s < 0 || s >= out.length || walls[s]) continue;
    if (out[s] === 0) continue;
    out[s] = 0;
    queue[tail++] = s;
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % cols;
    const y = (i / cols) | 0;
    const d = out[i] + 1;
    // up
    if (y > 0) {
      const j = i - cols;
      if (!walls[j] && out[j] < 0) {
        out[j] = d;
        queue[tail++] = j;
      }
    }
    // down
    if (y < rows - 1) {
      const j = i + cols;
      if (!walls[j] && out[j] < 0) {
        out[j] = d;
        queue[tail++] = j;
      }
    }
    // left
    if (x > 0) {
      const j = i - 1;
      if (!walls[j] && out[j] < 0) {
        out[j] = d;
        queue[tail++] = j;
      }
    }
    // right
    if (x < cols - 1) {
      const j = i + 1;
      if (!walls[j] && out[j] < 0) {
        out[j] = d;
        queue[tail++] = j;
      }
    }
  }
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
