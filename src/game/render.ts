import type { Game } from "./engine";
import { COLORS, COLS, COMBO_WINDOW, KINDS, PULSE_COST, PULSE_RADIUS, ROWS, START_LIVES } from "./constants";
import { clamp, easeOutBack, easeOutCubic, rgba, rr, setLetterSpacing } from "./draw";
import { DX, DY, type Enemy } from "./types";

const FONT_D = 'Orbitron, "Segoe UI", system-ui, sans-serif';
const FONT_B = 'Rajdhani, "Segoe UI", system-ui, sans-serif';
const DIR_ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

export function renderGame(g: Game, ctx: CanvasRenderingContext2D): void {
  const L = g.layout;
  const { W, H, cell, ox, oy, dpr } = L;
  const ui = clamp(cell / 56, 0.62, 1.05);
  const cx = (gx: number) => ox + (gx + 0.5) * cell;
  const cy = (gy: number) => oy + (gy + 0.5) * cell;
  const glow = (color: string, x: number, y: number, size: number, alpha: number) => {
    // fixed-size texture (one per color), scaled on draw — keeps the cache tiny
    const sp = g.sprites.glow(color, 96);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
  };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  // ---- screen shake (trauma^2 for a punchy curve)
  const sh = g.trauma * g.trauma * (g.reducedMotion ? 0.25 : 1);
  if (sh > 0.001) {
    const m = cell * 0.38 * sh;
    ctx.translate(W / 2 + (Math.random() * 2 - 1) * m, H / 2 + (Math.random() * 2 - 1) * m);
    ctx.rotate((Math.random() * 2 - 1) * 0.028 * sh);
    ctx.translate(-W / 2, -H / 2);
  }

  const st = g.sprites.staticLayer;
  if (st) ctx.drawImage(st, 0, 0, W, H);

  const p = g.player;
  const alive = g.mode !== "dead";

  // ---- pulse range indicator / pulse flash
  if ((g.charge >= PULSE_COST && alive) || g.pulseFlash > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, COLS * cell, ROWS * cell);
    ctx.clip();
    const x0 = ox + (p.gx - PULSE_RADIUS) * cell;
    const y0 = oy + (p.gy - PULSE_RADIUS) * cell;
    const w = (PULSE_RADIUS * 2 + 1) * cell;
    if (g.pulseFlash > 0) {
      ctx.fillStyle = rgba(COLORS.player, g.pulseFlash * 0.32);
      ctx.fillRect(x0, y0, w, w);
    }
    if (g.charge >= PULSE_COST && alive) {
      const pulse = 0.5 + 0.5 * Math.sin(g.time * 0.008);
      ctx.fillStyle = rgba(COLORS.player, 0.03 + 0.03 * pulse);
      rr(ctx, x0 + 2, y0 + 2, w - 4, w - 4, 8);
      ctx.fill();
      ctx.setLineDash([cell * 0.25, cell * 0.18]);
      ctx.lineDashOffset = -g.time * 0.02;
      ctx.strokeStyle = rgba(COLORS.player, 0.25 + 0.2 * pulse);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // ---- enemy intent outlines (telegraphed next moves)
  for (const e of g.enemies) {
    if (e.dead || e.intent < 0) continue;
    const win = Math.min(320, e.period * 0.6);
    const prog = clamp(1 - e.timer / win, 0, 1);
    const tx = e.gx + DX[e.intent];
    const ty = e.gy + DY[e.intent];
    const K = KINDS[e.kind];
    rr(ctx, ox + tx * cell + 3, oy + ty * cell + 3, cell - 6, cell - 6, cell * 0.12);
    ctx.fillStyle = rgba(K.color, 0.06 + 0.12 * prog);
    ctx.fill();
    ctx.strokeStyle = rgba(K.color, 0.2 + 0.55 * prog);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---- spawners
  for (const s of g.spawners) {
    const K = KINDS[s.kind];
    const prog = s.t / s.total;
    const x = ox + s.gx * cell;
    const y = oy + s.gy * cell;
    const blink = 0.5 + 0.5 * Math.sin(g.time * 0.02 + prog * 10);
    rr(ctx, x + 4, y + 4, cell - 8, cell - 8, cell * 0.14);
    ctx.strokeStyle = rgba(K.color, 0.3 + 0.5 * blink);
    ctx.lineWidth = 2;
    ctx.stroke();
    const sz = cell * 0.62 * easeOutCubic(prog);
    rr(ctx, cx(s.gx) - sz / 2, cy(s.gy) - sz / 2, sz, sz, sz * 0.2);
    ctx.fillStyle = rgba(K.color, 0.25 + 0.25 * prog);
    ctx.fill();
  }

  // ---- chips
  for (const c of g.chips) {
    const x = cx(c.gx);
    const y = cy(c.gy) + Math.sin(c.phase) * cell * 0.05;
    const s = easeOutBack(c.anim);
    glow(COLORS.chip, x, y, cell * 1.5, 0.45 * s);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4 + Math.sin(c.phase * 0.6) * 0.18);
    const size = cell * 0.3 * s * (1 + 0.06 * Math.sin(c.phase * 2));
    rr(ctx, -size / 2, -size / 2, size, size, size * 0.2);
    ctx.fillStyle = COLORS.chip;
    ctx.fill();
    const inner = size * 0.42;
    rr(ctx, -inner / 2, -inner / 2, inner, inner, inner * 0.2);
    ctx.fillStyle = COLORS.chipLight;
    ctx.fill();
    ctx.restore();
  }

  // ---- player trail
  for (const gh of g.ghosts) {
    const a = (1 - gh.t / 260) * 0.3;
    const s = cell * 0.6 * (0.85 + 0.15 * (1 - gh.t / 260));
    ctx.fillStyle = rgba(COLORS.player, a);
    rr(ctx, cx(gh.x) - s / 2, cy(gh.y) - s / 2, s, s, s * 0.22);
    ctx.fill();
  }

  // ---- enemies
  for (const e of g.enemies) {
    if (e.dead) continue;
    drawEnemy(g, ctx, e, cell, cx(e.vx), cy(e.vy), glow);
  }

  // ---- player
  if (alive) {
    const blink = p.invuln > 0 && Math.floor(g.time / 90) % 2 === 0;
    const x = cx(p.vx) + p.bumpX * cell;
    const y = cy(p.vy) + p.bumpY * cell;
    const size = cell * 0.72;
    const charged = g.charge >= PULSE_COST;
    const chargeGlow = charged ? 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(g.time * 0.012)) : 0;
    glow(COLORS.player, x, y, cell * (2.4 + chargeGlow * 1.2), blink ? 0.25 : 0.55 + chargeGlow * 0.5);
    if (blink) ctx.globalAlpha = 0.45;
    const w = size * p.sx;
    const h = size * p.sy;
    rr(ctx, x - w / 2, y - h / 2, w, h, size * 0.22);
    ctx.fillStyle = COLORS.player;
    ctx.fill();
    rr(ctx, x - w * 0.3, y - h * 0.3, w * 0.6, h * 0.6, size * 0.12);
    ctx.fillStyle = rgba(COLORS.playerLight, 0.9);
    ctx.fill();
    const ex = DX[p.facing] * size * 0.09;
    const ey = DY[p.facing] * size * 0.09;
    ctx.fillStyle = "#0b1020";
    for (const o of [-1, 1]) {
      rr(ctx, x + o * size * 0.13 - size * 0.055 + ex, y - size * 0.08 + ey, size * 0.11, size * 0.17, 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- rings
  for (const r of g.rings) {
    const t = r.t / r.life;
    const rad = easeOutCubic(t) * r.maxR;
    ctx.beginPath();
    ctx.arc(cx(r.gx), cy(r.gy), Math.max(0.1, rad), 0, Math.PI * 2);
    ctx.strokeStyle = rgba(r.color, 1 - t);
    ctx.lineWidth = Math.max(1, r.width * (1 - t) + 1);
    ctx.stroke();
  }

  // ---- particles
  g.particles.draw(ctx);

  // ---- popups
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const popUi = Math.max(ui, 0.78);
  for (const pp of g.popups) {
    const t = pp.t / pp.life;
    const a = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const rise = easeOutCubic(t) * cell * 0.9;
    const s = 1 + 0.6 * (1 - Math.min(1, pp.t / 130));
    ctx.globalAlpha = a;
    ctx.font = `800 ${Math.round(pp.size * popUi * s)}px ${FONT_D}`;
    const x = cx(pp.gx);
    const y = cy(pp.gy) - rise - cell * 0.25;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(5,7,13,0.85)";
    ctx.strokeText(pp.text, x, y);
    ctx.fillStyle = pp.color;
    ctx.fillText(pp.text, x, y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawHUD(g, ctx, ui);

  if (g.flash.a > 0) {
    ctx.fillStyle = `rgba(${g.flash.r},${g.flash.g},${g.flash.b},${g.flash.a})`;
    ctx.fillRect(0, 0, W, H);
  }
  const vg = g.sprites.vignette;
  if (vg) ctx.drawImage(vg, 0, 0, W, H);

  drawBanner(g, ctx, ui);
}

function drawEnemy(
  g: Game,
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  cell: number,
  x: number,
  y: number,
  glow: (color: string, x: number, y: number, size: number, alpha: number) => void,
): void {
  const K = KINDS[e.kind];
  const appear = easeOutBack(e.spawnAnim);
  let sx = e.sx;
  let sy = e.sy;
  let lx = 0;
  let ly = 0;
  let prog = 0;
  if (e.intent >= 0) {
    const win = Math.min(320, e.period * 0.6);
    prog = clamp(1 - e.timer / win, 0, 1);
    const lean = prog < 0.5 ? -prog * 0.6 : (prog - 0.5) * 1.4 - 0.3;
    lx = DX[e.intent] * lean * cell * 0.1;
    ly = DY[e.intent] * lean * cell * 0.1;
    if (DX[e.intent] !== 0) {
      sx *= 1 - 0.12 * prog;
      sy *= 1 + 0.1 * prog;
    } else {
      sx *= 1 + 0.1 * prog;
      sy *= 1 - 0.12 * prog;
    }
  }
  const size = cell * 0.68 * appear;
  const bob = Math.sin(g.time * 0.004 + e.seed) * cell * 0.015;
  const px = x + lx;
  const py = y + ly + bob;
  glow(K.color, px, py, cell * 2.1, 0.45 * appear);

  const w = size * sx;
  const h = size * sy;
  rr(ctx, px - w / 2, py - h / 2, w, h, size * 0.2);
  ctx.fillStyle = K.color;
  ctx.fill();
  rr(ctx, px - w * 0.33, py - h * 0.33, w * 0.66, h * 0.66, size * 0.1);
  ctx.fillStyle = "rgba(7,10,18,0.55)";
  ctx.fill();

  // eye direction: intent, else toward the player
  let dx = g.player.gx - e.gx;
  let dy = g.player.gy - e.gy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  if (e.intent >= 0) {
    dx = DX[e.intent];
    dy = DY[e.intent];
  }
  const er = size * 0.14;
  if (e.kind === 1) {
    // hunter: two narrow, angry eyes
    ctx.fillStyle = K.light;
    for (const o of [-1, 1]) {
      rr(ctx, px + o * size * 0.17 - er * 0.45 + dx * er * 0.35, py - er * 0.7 + dy * er * 0.35, er * 0.9, er * 1.3, 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.arc(px, py, er * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = K.light;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + dx * er * 0.5, py + dy * er * 0.5, er * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1020";
    ctx.fill();
    if (e.kind === 2) {
      ctx.beginPath();
      ctx.arc(px, py, er * 1.75, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(K.light, 0.7);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  if (e.kind === 3) {
    // oracle: rotating outer frame
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(g.time * 0.0025 + e.seed);
    ctx.strokeStyle = rgba(K.color, 0.75);
    ctx.lineWidth = 1.5;
    const d = size * 0.82;
    ctx.strokeRect(-d / 2, -d / 2, d, d);
    ctx.restore();
  }
  if (e.intent >= 0 && prog > 0.05) {
    // chevron pointing where it will move
    ctx.save();
    ctx.translate(px + DX[e.intent] * (w / 2 + 2), py + DY[e.intent] * (h / 2 + 2));
    ctx.rotate(DIR_ANGLE[e.intent]);
    const a = size * 0.14;
    ctx.beginPath();
    ctx.moveTo(a, 0);
    ctx.lineTo(-a * 0.4, -a);
    ctx.lineTo(-a * 0.4, a);
    ctx.closePath();
    ctx.fillStyle = rgba(K.light, prog);
    ctx.fill();
    ctx.restore();
  }
}

function drawHUD(g: Game, ctx: CanvasRenderingContext2D, ui: number): void {
  const { W, H, hudH, botH, pad } = g.layout;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, hudH);
  ctx.fillRect(0, H - botH, W, botH);
  ctx.fillStyle = "rgba(34,211,238,0.18)";
  ctx.fillRect(pad, hudH - 1, W - pad * 2, 1);
  ctx.textBaseline = "alphabetic";

  // score
  setLetterSpacing(ctx, 2);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(148,163,184,0.9)";
  ctx.font = `600 ${Math.round(11 * ui)}px ${FONT_B}`;
  ctx.fillText("SCORE", pad + 2, hudH * 0.36);
  setLetterSpacing(ctx, 0);
  ctx.fillStyle = "#f8fafc";
  ctx.font = `700 ${Math.round(25 * ui)}px ${FONT_D}`;
  ctx.fillText(String(g.score), pad, hudH * 0.8);

  // combo
  ctx.textAlign = "center";
  if (g.combo > 1) {
    const pop = 1 + 0.35 * easeOutCubic(g.comboPop);
    ctx.fillStyle = COLORS.chip;
    ctx.font = `800 ${Math.round(23 * ui * pop)}px ${FONT_D}`;
    ctx.fillText(`×${g.combo}`, W / 2, hudH * 0.6);
    const bw = 72 * ui;
    const bh = 4;
    const r = clamp(g.comboTimer / COMBO_WINDOW, 0, 1);
    ctx.fillStyle = "rgba(251,191,36,0.2)";
    rr(ctx, W / 2 - bw / 2, hudH * 0.7, bw, bh, 2);
    ctx.fill();
    ctx.fillStyle = r < 0.3 ? COLORS.red : COLORS.chip;
    rr(ctx, W / 2 - bw / 2, hudH * 0.7, Math.max(2, bw * r), bh, 2);
    ctx.fill();
  } else {
    setLetterSpacing(ctx, 2);
    ctx.fillStyle = "rgba(148,163,184,0.5)";
    ctx.font = `600 ${Math.round(11 * ui)}px ${FONT_B}`;
    ctx.fillText("COMBO", W / 2, hudH * 0.36);
    setLetterSpacing(ctx, 0);
    ctx.fillStyle = "rgba(148,163,184,0.35)";
    ctx.font = `700 ${Math.round(20 * ui)}px ${FONT_D}`;
    ctx.fillText("×1", W / 2, hudH * 0.8);
  }

  // lives
  const bs = 13 * ui;
  const gap = 6 * ui;
  const popS = 1 + 0.5 * g.livesPop;
  for (let i = 0; i < START_LIVES; i++) {
    const x = W - pad - (START_LIVES - i) * (bs + gap) + gap;
    const y = hudH * 0.2;
    if (i < g.lives) {
      ctx.fillStyle = COLORS.player;
      rr(ctx, x, y, bs, bs, 3);
      ctx.fill();
    } else {
      const s = i === g.lives ? popS : 1;
      ctx.strokeStyle = i === g.lives && g.livesPop > 0 ? rgba(COLORS.red, 0.9) : "rgba(148,163,184,0.3)";
      ctx.lineWidth = 1.5;
      rr(ctx, x - (bs * (s - 1)) / 2, y - (bs * (s - 1)) / 2, bs * s, bs * s, 3);
      ctx.stroke();
    }
  }
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(226,232,240,0.9)";
  ctx.font = `700 ${Math.round(14 * ui)}px ${FONT_D}`;
  ctx.fillText(`LV ${g.level}`, W - pad, hudH * 0.8);

  // charge meter
  const ready = g.charge >= PULSE_COST;
  const y0 = H - botH;
  const labelW = 54 * ui;
  const cyc = y0 + botH / 2;
  ctx.textBaseline = "middle";
  setLetterSpacing(ctx, 2);
  ctx.textAlign = "left";
  ctx.font = `700 ${Math.round(11 * ui)}px ${FONT_B}`;
  ctx.fillStyle = ready ? COLORS.player : "rgba(148,163,184,0.8)";
  ctx.fillText("PULSE", pad + 2, cyc + 1);
  const hintW = ready ? (g.isTouch ? 60 : 118) * ui : 0;
  const segX0 = pad + labelW;
  const segArea = W - pad * 2 - labelW - hintW;
  const segGap = 4;
  const sw = (segArea - segGap * (PULSE_COST - 1)) / PULSE_COST;
  const shh = 8 * ui;
  const shake = g.chargeDeny > 0 ? Math.sin(g.time * 0.09) * 4 * g.chargeDeny : 0;
  const glowA = ready ? 0.55 + 0.45 * Math.sin(g.time * 0.01) : 0;
  for (let i = 0; i < PULSE_COST; i++) {
    const filled = i < g.charge;
    const x = segX0 + i * (sw + segGap) + shake;
    const y = cyc - shh / 2;
    rr(ctx, x, y, sw, shh, 2);
    ctx.fillStyle = filled ? (ready ? rgba(COLORS.player, 0.75 + 0.25 * glowA) : "rgba(34,211,238,0.7)") : "rgba(148,163,184,0.15)";
    ctx.fill();
    if (filled && i === g.charge - 1 && g.chargePop > 0) {
      ctx.fillStyle = rgba(COLORS.white, g.chargePop * 0.7);
      ctx.fill();
    }
  }
  if (ready) {
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(COLORS.player, 0.6 + 0.4 * glowA);
    ctx.font = `700 ${Math.round(11 * ui)}px ${FONT_B}`;
    ctx.fillText(g.isTouch ? "READY" : "READY · SPACE", W - pad, cyc + 1);
  }
  setLetterSpacing(ctx, 0);
  ctx.textBaseline = "alphabetic";
}

function drawBanner(g: Game, ctx: CanvasRenderingContext2D, ui: number): void {
  const b = g.banner;
  if (!b) return;
  const { W, oy, cell } = g.layout;
  const p = b.t / b.life;
  const a = p < 0.12 ? p / 0.12 : p > 0.75 ? (1 - p) / 0.25 : 1;
  const s = easeOutBack(Math.min(1, p / 0.25));
  const yc = oy + ROWS * cell * 0.42;
  ctx.save();
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.translate(W / 2, yc);
  ctx.scale(s, s);
  rr(ctx, -W * 0.44, -36 * ui, W * 0.88, 72 * ui, 10);
  ctx.fillStyle = "rgba(7,10,18,0.8)";
  ctx.fill();
  ctx.strokeStyle = rgba(b.color, 0.6);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = rgba(b.color, 0.35);
  ctx.fillRect(-W * 0.44, -36 * ui, W * 0.88, 2);
  ctx.fillRect(-W * 0.44, 36 * ui - 2, W * 0.88, 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = b.color;
  ctx.font = `900 ${Math.round(30 * ui)}px ${FONT_D}`;
  ctx.fillText(b.title, 0, -10 * ui);
  setLetterSpacing(ctx, 3);
  ctx.fillStyle = "rgba(226,232,240,0.92)";
  ctx.font = `600 ${Math.round(13 * ui)}px ${FONT_B}`;
  ctx.fillText(b.sub, 0, 16 * ui);
  setLetterSpacing(ctx, 0);
  ctx.restore();
}
