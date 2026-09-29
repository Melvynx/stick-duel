import { forEachPixel, measureText } from '/shared/font.js';

// Particles and one-shot effects. Positions are world px; drawing targets the half-res backbuffer.

const MAX_PARTS = 2600;
const FIRE = ['#ffffff', '#fff3a8', '#ffd23f', '#ff9a1f', '#ff5a1f', '#c8321e', '#5a2a2a', '#3a2a36'];
const SMOKE = ['#8d86a6', '#6f6889', '#57506f', '#433c5a'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// Bresenham line in backbuffer pixels.
export function pxLine(ctx, x0, y0, x1, y1, w = 1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = Math.floor((w - 1) / 2);
  for (let guard = 0; guard < 4000; guard++) {
    ctx.fillRect(x0 - o, y0 - o, w, w);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

const textCache = new Map();

// Pixel-font text with a 1px dark outline, cached per (text, color, scale).
export function textSprite(text, color, scale = 1) {
  const key = `${text}|${color}|${scale}`;
  let c = textCache.get(key);
  if (c) return c;
  const w = measureText(text, 1);
  c = document.createElement('canvas');
  c.width = (w + 2) * scale;
  c.height = 9 * scale;
  const g = c.getContext('2d');
  g.fillStyle = '#0e0b1c';
  for (const [ox, oy] of [[0, 1], [2, 1], [1, 0], [1, 2], [2, 2]]) {
    forEachPixel(text, (x, y) => g.fillRect((x + ox) * scale, (y + oy) * scale, scale, scale));
  }
  g.fillStyle = color;
  forEachPixel(text, (x, y) => g.fillRect((x + 1) * scale, (y + 1) * scale, scale, scale));
  if (textCache.size > 400) textCache.clear();
  textCache.set(key, c);
  return c;
}

export function drawText(ctx, text, x, y, color, scale = 1, align = 'center') {
  const s = textSprite(text, color, scale);
  let dx = x;
  if (align === 'center') dx = x - s.width / 2;
  else if (align === 'right') dx = x - s.width;
  ctx.drawImage(s, Math.round(dx), Math.round(y));
}

export class Fx {
  constructor() {
    this.parts = [];
    this.lines = [];
    this.rings = [];
    this.texts = [];
    this.gibs = [];
    this.trauma = 0;
    this.terrain = null;
    this.time = 0;
  }

  clear() {
    this.parts.length = 0;
    this.lines.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.gibs.length = 0;
    this.trauma = 0;
  }

  solid(x, y) {
    return this.terrain ? this.terrain.blocksShot(x, y) : false;
  }

  add(p) {
    if (this.parts.length >= MAX_PARTS) this.parts.splice(0, 200);
    this.parts.push(p);
    return p;
  }

  shake(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  offset() {
    const s = this.trauma * this.trauma;
    if (s < 0.001) return [0, 0];
    return [Math.round((Math.random() * 2 - 1) * 9 * s), Math.round((Math.random() * 2 - 1) * 7 * s)];
  }

  // ---------- spawners ----------

  muzzle(x, y, a, big = 1) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    this.add({ k: 'flash', x, y, a, life: 0.05, t: 0, s: big });
    for (let i = 0; i < 4 * big; i++) {
      const aa = a + rand(-0.5, 0.5);
      const sp = rand(120, 420);
      this.add({
        k: 'px', x, y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, g: 0, drag: 8, life: rand(0.05, 0.14), t: 0,
        c: pick(FIRE.slice(0, 4)), s: 1,
      });
    }
    for (let i = 0; i < 2 * big; i++) {
      this.add({
        k: 'smoke', x: x + ca * 4, y: y + sa * 4, vx: ca * rand(20, 60) + rand(-10, 10), vy: sa * rand(20, 60) - rand(10, 30),
        life: rand(0.35, 0.7), t: 0, r0: 2, r1: rand(4, 7), c: pick(SMOKE),
      });
    }
  }

  tracer(x1, y1, x2, y2, color = '#fff3a8', life = 0.06) {
    this.lines.push({ x1, y1, x2, y2, c: color, life, t: 0, w: 1 });
  }

  rail(x1, y1, x2, y2, color) {
    this.lines.push({ x1, y1, x2, y2, c: color, life: 0.45, t: 0, w: 5, rail: true });
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.min(80, Math.floor(len / 16));
    for (let i = 0; i < n; i++) {
      const f = Math.random();
      this.add({
        k: 'px', x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, vx: rand(-40, 40), vy: rand(-60, 10), g: -20, drag: 2,
        life: rand(0.3, 0.8), t: 0, c: Math.random() < 0.5 ? '#ffffff' : color, s: 1,
      });
    }
    this.shake(0.12);
  }

  impact(x, y, a, colors, n = 5) {
    const back = a + Math.PI;
    for (let i = 0; i < n; i++) {
      const aa = back + rand(-1, 1);
      const sp = rand(80, 320);
      this.add({
        k: 'px', x, y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, g: 900, drag: 1.5, life: rand(0.25, 0.6), t: 0,
        c: colors && colors.length ? pick(colors) : '#c9ccd8', s: 1, bounce: true,
      });
    }
    for (let i = 0; i < 3; i++) {
      const aa = back + rand(-0.7, 0.7);
      const sp = rand(250, 600);
      this.add({ k: 'px', x, y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, g: 400, drag: 6, life: rand(0.04, 0.12), t: 0, c: '#fff3a8', s: 1 });
    }
    this.add({ k: 'smoke', x, y, vx: Math.cos(back) * 30, vy: Math.sin(back) * 30 - 10, life: rand(0.3, 0.5), t: 0, r0: 1, r1: 4, c: pick(SMOKE) });
  }

  shieldHit(x, y) {
    this.rings.push({ x, y, r0: 4, r1: 18, life: 0.2, t: 0, c: '#3ee6ff' });
  }

  debris(x, y, colors, count) {
    const n = Math.min(60, count);
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0) + rand(-0.4, 0.4);
      const sp = rand(60, 380);
      this.add({
        k: 'px', x: x + rand(-4, 4), y: y + rand(-4, 4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1300, drag: 0.8,
        life: rand(0.6, 1.6), t: 0, c: pick(colors), s: Math.random() < 0.25 ? 2 : 1, bounce: true,
      });
    }
  }

  explosion(x, y, r) {
    const k = r / 46;
    this.add({ k: 'boom', x, y, r, life: 0.16, t: 0 });
    this.rings.push({ x, y, r0: r * 0.4, r1: r * 1.9, life: 0.28, t: 0, c: '#fff3a8' });
    const nFire = Math.round(26 * k);
    for (let i = 0; i < nFire; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(40, 380) * k;
      this.add({
        k: 'fire', x: x + Math.cos(a) * rand(0, r * 0.3), y: y + Math.sin(a) * rand(0, r * 0.3),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(20, 90), g: -120, drag: 4, life: rand(0.25, 0.6), t: 0,
        r0: rand(3, 6) * k + 2, r1: rand(1, 3),
      });
    }
    const nSmoke = Math.round(14 * k);
    for (let i = 0; i < nSmoke; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(0, r * 0.7);
      this.add({
        k: 'smoke', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * rand(10, 60), vy: Math.sin(a) * rand(10, 40) - rand(20, 60),
        life: rand(0.8, 1.8), t: -rand(0, 0.12), r0: rand(4, 8) * k, r1: rand(10, 18) * k, c: pick(SMOKE),
      });
    }
    for (let i = 0; i < Math.round(18 * k); i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(300, 900) * k;
      this.add({ k: 'px', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 600, drag: 3, life: rand(0.1, 0.35), t: 0, c: pick(FIRE.slice(0, 4)), s: 1 });
    }
  }

  flame(x, y, a, range) {
    for (let i = 0; i < 3; i++) {
      const aa = a + rand(-0.1, 0.1);
      const sp = rand(480, 640);
      this.add({
        k: 'fire', x: x + Math.cos(a) * rand(0, 6), y: y + Math.sin(a) * rand(0, 6), vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp,
        g: -200, drag: 1.2, life: (range / sp) * rand(0.8, 1.15), t: 0, r0: rand(1, 2), r1: rand(5, 9), stop: true,
      });
    }
  }

  jet(x, y, k) {
    if (Math.random() > k + 0.2) return;
    this.add({
      k: 'fire', x: x + rand(-1.5, 1.5), y, vx: rand(-25, 25), vy: rand(260, 420), g: 0, drag: 5, life: rand(0.08, 0.18), t: 0,
      r0: rand(2, 3.5), r1: 1, stop: true,
    });
    if (Math.random() < 0.35) {
      this.add({ k: 'smoke', x, y: y + 12, vx: rand(-30, 30), vy: rand(60, 120), life: rand(0.4, 0.8), t: 0, r0: 2, r1: rand(5, 8), c: pick(SMOKE) });
    }
  }

  trail(x, y, big = 1) {
    this.add({ k: 'smoke', x, y, vx: rand(-15, 15), vy: rand(-25, 0), life: rand(0.35, 0.7) * big, t: 0, r0: 1.5 * big, r1: 5 * big, c: pick(SMOKE) });
    if (Math.random() < 0.6) this.add({ k: 'px', x, y, vx: rand(-40, 40), vy: rand(-40, 40), g: 0, drag: 4, life: 0.08, t: 0, c: pick(FIRE.slice(1, 4)), s: 1 });
  }

  casing(x, y, dir, big = false) {
    this.add({
      k: 'px', x, y, vx: -dir * rand(60, 160), vy: rand(-260, -160), g: 1500, drag: 0.5, life: rand(0.9, 1.4), t: 0,
      c: big ? '#c8321e' : '#ffd23f', s: 1, bounce: true, w: big ? 2 : 1,
    });
  }

  hit(x, y, color, dx, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(0, dx || 1) + rand(-0.9, 0.9) - 0.3 * Math.sign(dx || 1) * 0;
      const sp = rand(80, 340);
      this.add({
        k: 'px', x, y, vx: Math.cos(a) * sp * Math.sign(dx || 1), vy: Math.sin(a) * sp - rand(40, 160), g: 1100, drag: 1,
        life: rand(0.3, 0.7), t: 0, c: Math.random() < 0.7 ? color : '#ffffff', s: Math.random() < 0.3 ? 2 : 1, bounce: true,
      });
    }
  }

  text(x, y, str, color, scale = 1, life = 0.9) {
    this.texts.push({ x, y, str, c: color, s: scale, life, t: 0, vy: -70 });
  }

  ring(x, y, r0, r1, color, life = 0.35) {
    this.rings.push({ x, y, r0, r1, life, t: 0, c: color });
  }

  spawnFx(x, y, color) {
    this.ring(x, y - 29, 36, 4, color, 0.3);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.add({ k: 'px', x: x + Math.cos(a) * 30, y: y - 29 + Math.sin(a) * 30, vx: -Math.cos(a) * 90, vy: -Math.sin(a) * 90, g: 0, drag: 2, life: 0.3, t: 0, c: color, s: 1 });
    }
  }

  // Stickman pieces flying away on death: [x1, y1, x2, y2] segments relative to (x, y).
  gib(x, y, vx, vy, segs, color, head) {
    for (const s of segs) {
      const mx = (s[0] + s[2]) / 2;
      const my = (s[1] + s[3]) / 2;
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
      this.gibs.push({
        x: x + mx, y: y + my, vx: vx * 0.6 + rand(-220, 220) + mx * 4, vy: vy * 0.6 - rand(250, 520), a: Math.atan2(s[3] - s[1], s[2] - s[0]),
        va: rand(-18, 18), len, c: color, life: rand(2.2, 3.2), t: 0, head: false,
      });
    }
    if (head) {
      this.gibs.push({ x: x + head[0], y: y + head[1], vx: vx * 0.6 + rand(-160, 160), vy: vy * 0.6 - rand(380, 600), a: 0, va: rand(-12, 12), len: 0, c: color, life: 3, t: 0, head: true });
    }
    for (let i = 0; i < 18; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 420);
      this.add({
        k: 'px', x: x + rand(-6, 6), y: y - rand(10, 50), vx: Math.cos(a) * sp + vx * 0.3, vy: Math.sin(a) * sp - 150, g: 1200, drag: 1,
        life: rand(0.5, 1.2), t: 0, c: Math.random() < 0.8 ? color : '#ffffff', s: Math.random() < 0.4 ? 2 : 1, bounce: true,
      });
    }
  }

  // ---------- simulation ----------

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const keep = [];
    for (const p of this.parts) {
      p.t += dt;
      if (p.t >= p.life) continue;
      if (p.t < 0) {
        keep.push(p);
        continue;
      }
      if (p.k === 'flash' || p.k === 'boom') {
        keep.push(p);
        continue;
      }
      const drag = Math.exp(-(p.drag || 0) * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + (p.g || 0) * dt;
      if (p.k === 'smoke') {
        p.vx *= Math.exp(-2 * dt);
        p.vy = p.vy * Math.exp(-2 * dt) - 30 * dt;
      }
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if ((p.bounce || p.stop) && this.solid(nx, ny)) {
        if (p.stop) {
          p.vx *= 0.1;
          p.vy *= 0.1;
          if (p.k === 'fire') p.t = Math.max(p.t, p.life * 0.7);
        } else {
          if (this.solid(nx, p.y)) p.vx *= -0.35;
          else p.x = nx;
          if (this.solid(p.x, ny)) {
            p.vy *= -0.3;
            p.vx *= 0.6;
            if (Math.abs(p.vy) < 40) p.vy = 0;
          } else {
            p.y = ny;
          }
        }
      } else {
        p.x = nx;
        p.y = ny;
      }
      keep.push(p);
    }
    this.parts = keep;
    this.lines = this.lines.filter((l) => (l.t += dt) < l.life);
    this.rings = this.rings.filter((r) => (r.t += dt) < r.life);
    this.texts = this.texts.filter((t) => {
      t.t += dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-3 * dt);
      return t.t < t.life;
    });
    this.gibs = this.gibs.filter((g) => {
      g.t += dt;
      if (g.t > g.life) return false;
      g.vy += 1500 * dt;
      const nx = g.x + g.vx * dt;
      const ny = g.y + g.vy * dt;
      if (this.solid(nx, g.y)) g.vx *= -0.4;
      else g.x = nx;
      if (this.solid(g.x, ny + 2)) {
        g.vy *= -0.35;
        g.vx *= 0.7;
        g.va *= 0.6;
        if (Math.abs(g.vy) < 60) g.vy = 0;
      } else {
        g.y = ny;
      }
      g.a += g.va * dt;
      return g.y < (this.terrain ? this.terrain.h * 2 : 900) + 100;
    });
  }

  // ---------- drawing ----------

  drawBack(ctx) {
    for (const p of this.parts) {
      if (p.t < 0 || p.k !== 'smoke') continue;
      const f = p.t / p.life;
      const r = (p.r0 + (p.r1 - p.r0) * Math.sqrt(f)) / 2;
      ctx.globalAlpha = 0.85 * (1 - f);
      ctx.fillStyle = p.c;
      pxCircle(ctx, p.x / 2, p.y / 2, r);
    }
    ctx.globalAlpha = 1;
  }

  drawFront(ctx) {
    for (const g of this.gibs) {
      const fade = g.t > g.life - 0.5 ? (g.life - g.t) / 0.5 : 1;
      ctx.globalAlpha = fade;
      ctx.fillStyle = g.c;
      if (g.head) {
        pxCircle(ctx, g.x / 2, g.y / 2, 3.5);
      } else {
        const hx = (Math.cos(g.a) * g.len) / 4;
        const hy = (Math.sin(g.a) * g.len) / 4;
        pxLine(ctx, g.x / 2 - hx, g.y / 2 - hy, g.x / 2 + hx, g.y / 2 + hy, 2);
      }
    }
    ctx.globalAlpha = 1;

    for (const p of this.parts) {
      if (p.t < 0) continue;
      const f = p.t / p.life;
      if (p.k === 'px') {
        ctx.fillStyle = p.c;
        ctx.globalAlpha = f > 0.75 ? (1 - f) * 4 : 1;
        const s = p.s || 1;
        ctx.fillRect(Math.round(p.x / 2), Math.round(p.y / 2), s * (p.w || 1), s);
      } else if (p.k === 'fire') {
        const idx = Math.min(FIRE.length - 1, Math.floor(f * FIRE.length * 0.999 + 1));
        ctx.fillStyle = FIRE[idx];
        ctx.globalAlpha = f > 0.8 ? (1 - f) * 5 : 1;
        const r = (p.r0 + (p.r1 - p.r0) * f) / 2;
        pxCircle(ctx, p.x / 2, p.y / 2, Math.max(0.5, r));
      } else if (p.k === 'flash') {
        ctx.globalAlpha = 1;
        const ca = Math.cos(p.a);
        const sa = Math.sin(p.a);
        const L = 5 * p.s;
        ctx.fillStyle = '#fff3a8';
        pxCircle(ctx, p.x / 2 + ca * 2, p.y / 2 + sa * 2, 2.5 * p.s);
        ctx.fillStyle = '#ffffff';
        pxLine(ctx, p.x / 2, p.y / 2, p.x / 2 + ca * L, p.y / 2 + sa * L, 2);
        pxCircle(ctx, p.x / 2 + ca, p.y / 2 + sa, 1.5);
      } else if (p.k === 'boom') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = f < 0.35 ? '#ffffff' : '#fff3a8';
        pxCircle(ctx, p.x / 2, p.y / 2, (p.r / 2) * (0.7 + f * 0.5));
      }
    }
    ctx.globalAlpha = 1;

    for (const l of this.lines) {
      const f = l.t / l.life;
      if (l.rail) {
        const w = Math.max(1, Math.round(l.w * (1 - f)));
        ctx.globalAlpha = 1 - f * 0.6;
        ctx.fillStyle = l.c;
        pxLine(ctx, l.x1 / 2, l.y1 / 2, l.x2 / 2, l.y2 / 2, w + 2);
        ctx.fillStyle = '#ffffff';
        pxLine(ctx, l.x1 / 2, l.y1 / 2, l.x2 / 2, l.y2 / 2, Math.max(1, w - 1));
      } else {
        // Short streak moving toward the target.
        const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
        const seg = Math.min(len, 90);
        const head = Math.min(1, (f * 1.4 + 0.3));
        const hx = l.x1 + (l.x2 - l.x1) * head;
        const hy = l.y1 + (l.y2 - l.y1) * head;
        const ux = (l.x2 - l.x1) / (len || 1);
        const uy = (l.y2 - l.y1) / (len || 1);
        ctx.globalAlpha = 1;
        ctx.fillStyle = l.c;
        pxLine(ctx, (hx - ux * seg) / 2, (hy - uy * seg) / 2, hx / 2, hy / 2, 1);
      }
    }
    ctx.globalAlpha = 1;

    for (const r of this.rings) {
      const f = r.t / r.life;
      const rad = (r.r0 + (r.r1 - r.r0) * (1 - (1 - f) * (1 - f))) / 2;
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = r.c;
      pxRing(ctx, r.x / 2, r.y / 2, rad);
    }
    ctx.globalAlpha = 1;

    for (const t of this.texts) {
      const f = t.t / t.life;
      ctx.globalAlpha = f > 0.7 ? (1 - f) / 0.3 : 1;
      drawText(ctx, t.str, t.x / 2, t.y / 2, t.c, t.s);
    }
    ctx.globalAlpha = 1;
  }
}

export function pxCircle(ctx, cx, cy, r) {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const ri = Math.ceil(r);
  const r2 = r * r + r * 0.6;
  for (let dy = -ri; dy <= ri; dy++) {
    const span = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
    if (r2 - dy * dy < 0) continue;
    ctx.fillRect(x0 - span, y0 + dy, span * 2 + 1, 1);
  }
}

export function pxRing(ctx, cx, cy, r) {
  const n = Math.max(12, Math.floor(r * 6.3));
  let lx = null;
  let ly = null;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (x === lx && y === ly) continue;
    ctx.fillRect(x, y, 1, 1);
    lx = x;
    ly = y;
  }
}
