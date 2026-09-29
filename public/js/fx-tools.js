import { Fx } from './fx.js';

// Effects for the sandbox tools, mixed into Fx so callers keep a single `fx` object.

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const SAND = ['#e8c77e', '#d9b36a', '#c9a15a', '#f0d690'];
const BEAM_CORE = '#7df9ff';
const SPARK = ['#ffffff', '#7df9ff', '#fff3a8', '#ffd23f'];

Object.assign(Fx.prototype, {
  // Cutter: a live beam redrawn every tick, sparks where it bites.
  beam(x1, y1, x2, y2, bite) {
    this.lines.push({ x1, y1, x2, y2, c: BEAM_CORE, life: 0.034, t: 0, w: 2, rail: true });
    if (Math.random() < 0.5) {
      const f = Math.random();
      this.add({ k: 'px', x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, vx: rand(-20, 20), vy: rand(-30, 0), g: 0, drag: 3, life: 0.2, t: 0, c: BEAM_CORE, s: 1 });
    }
    if (!bite) return;
    for (let i = 0; i < 3; i++) {
      this.add({
        k: 'px', x: x2, y: y2, vx: rand(-260, 260), vy: rand(-320, 60), g: 1300, drag: 1, life: rand(0.15, 0.4), t: 0,
        c: pick(SPARK), s: 1, bounce: true,
      });
    }
    if (Math.random() < 0.3) this.add({ k: 'smoke', x: x2, y: y2, vx: rand(-20, 20), vy: rand(-50, -20), life: rand(0.3, 0.6), t: 0, r0: 1.5, r1: 5, c: '#57506f' });
  },

  // Sandstorm: a jet of grains; the real sand is placed by the simulation.
  spray(x, y, a, reach) {
    for (let i = 0; i < 4; i++) {
      const aa = a + rand(-0.14, 0.14);
      const sp = rand(420, 620);
      this.add({
        k: 'px', x, y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, g: 500, drag: 1.5, life: (reach / sp) * rand(0.7, 1), t: 0,
        c: pick(SAND), s: 1, stop: true,
      });
    }
  },

  // Quake: expanding shock rings and dust thrown off the ground.
  shockwave(x, y, r) {
    this.ring(x, y, 8, r * 2, '#c77dff', 0.5);
    this.ring(x, y, 4, r * 1.3, '#ffffff', 0.3);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const sp = rand(200, 420);
      this.add({ k: 'px', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 900, drag: 2, life: rand(0.4, 0.8), t: 0, c: pick(['#c77dff', '#7b3fbf', '#e8c77e']), s: 1 });
    }
  },

  // Builder: the piece snaps in with a flash along its outline and dust (w x h px box).
  puff(x, y, w, color, h = w) {
    const hw = w / 2;
    const hh = h / 2;
    const n = Math.min(40, 10 + Math.round((w + h) / 12));
    for (let i = 0; i < n; i++) {
      const side = i % 4;
      const px = side < 2 ? x + rand(-1, 1) * hw : x + (side === 2 ? -hw : hw);
      const py = side < 2 ? y + (side === 0 ? -hh : hh) : y + rand(-1, 1) * hh;
      const k = 6 * Math.min(1, 24 / Math.max(w, h));
      this.add({ k: 'px', x: px, y: py, vx: (px - x) * k + rand(-20, 20), vy: (py - y) * k, g: 200, drag: 5, life: rand(0.2, 0.35), t: 0, c: i & 1 ? '#ffffff' : color, s: 1 });
    }
    const size = Math.max(w, h);
    this.ring(x, y, size * 0.3, size * 0.8, '#ffffff', 0.18);
  },

  // Sprint dust kicked up behind the feet.
  kick(x, y, dir) {
    this.add({ k: 'smoke', x: x - dir * 6, y: y - 2, vx: -dir * rand(30, 70), vy: rand(-40, -10), life: rand(0.25, 0.45), t: 0, r0: 1.5, r1: 4, c: '#8d86a6' });
  },

  // Weapon unlock: a column of light on the player.
  unlockFx(x, y, color) {
    this.ring(x, y - 29, 10, 70, color, 0.5);
    for (let i = 0; i < 24; i++) {
      this.add({ k: 'px', x: x + rand(-14, 14), y: y - rand(0, 60), vx: rand(-20, 20), vy: rand(-260, -120), g: 0, drag: 2, life: rand(0.4, 0.8), t: 0, c: i & 1 ? '#ffffff' : color, s: 1 });
    }
  },
});
