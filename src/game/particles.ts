export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
}

export interface EmitOpts {
  count: number;
  speed: number; // px per frame at 60fps
  size: number;
  life: number; // ms
  drag?: number;
  angle?: number;
  arc?: number;
}

/** Cheap axis-aligned square particles — fits the gridbox aesthetic and is fast on mobile. */
export class ParticleSystem {
  list: Particle[] = [];
  max = 420;

  clear(): void {
    this.list.length = 0;
  }

  private push(p: Particle): void {
    if (this.list.length >= this.max) {
      // overwrite a random older particle instead of growing
      this.list[(Math.random() * this.list.length) | 0] = p;
    } else {
      this.list.push(p);
    }
  }

  emit(x: number, y: number, color: string, o: EmitOpts): void {
    const drag = o.drag ?? 0.9;
    const fullArc = o.arc === undefined || o.arc >= Math.PI * 2;
    for (let i = 0; i < o.count; i++) {
      const a = fullArc
        ? Math.random() * Math.PI * 2
        : (o.angle ?? 0) + (Math.random() - 0.5) * (o.arc ?? Math.PI);
      const sp = o.speed * (0.3 + Math.random() * 0.7);
      const life = o.life * (0.55 + Math.random() * 0.45);
      this.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        max: life,
        size: o.size * (0.5 + Math.random() * 0.6),
        color,
        drag,
      });
    }
  }

  /** Evenly spaced radial burst (used by the pulse). */
  ring(x: number, y: number, color: string, count: number, speed: number, size: number, life: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = speed * (0.85 + Math.random() * 0.3);
      this.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        max: life,
        size: size * (0.7 + Math.random() * 0.5),
        color,
        drag: 0.93,
      });
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const f = dt / 16.667;
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) {
        l[i] = l[l.length - 1];
        l.pop();
        continue;
      }
      p.x += p.vx * f;
      p.y += p.vy * f;
      const d = Math.pow(p.drag, f);
      p.vx *= d;
      p.vy *= d;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const a = p.life / p.max;
      const s = p.size * (0.35 + 0.65 * a);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
}
