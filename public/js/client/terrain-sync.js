import { PALETTE } from '/shared/maps.js';
import { OP, TerrainSim } from '/shared/sim.js';

const EARTH = ['#7a5a3a', '#5e4630', '#8c6a44', '#4a3a2a'];

// Keeps the browser copy of the sandbox in lockstep with the authority and turns terrain ops
// into effects (debris, scorch, shockwaves, dust from landing chunks).
// Online: owns its own TerrainSim and replays the server's op stream tick by tick.
// Solo: `attach` reuses the local Game's sim and only listens to its ops.
export class TerrainSync {
  constructor(game) {
    this.g = game;
    this.sim = null;
    this.pending = [];
    this.count = 0;
    this.quiet = false;
    this.attached = false;
  }

  get view() {
    return this.g.view;
  }

  load(terrain, ops, st) {
    this.sim = new TerrainSim(terrain);
    this.attached = false;
    this.pending = [];
    this.count = 0;
    this.quiet = true;
    this.push(ops, 0);
    this.advance(st);
    this.quiet = false;
  }

  attach(game) {
    this.sim = game.sim;
    this.attached = true; // the local authority applies ops itself; snapshots' op lists are ignored
    this.pending = [];
    game.onOp = (op, removed) => this.opFx(op, removed);
  }

  // Called by the solo host after each authoritative update.
  afterStep() {
    this.landFx();
  }

  push(ops, os = this.count) {
    if (this.attached || !ops || !ops.length) return;
    let skip = 0;
    if (os < this.count) skip = this.count - os; // already have the start of this batch
    else if (os > this.count) console.warn(`terrain ops gap: have ${this.count}, got ${os}`);
    for (let i = skip; i < ops.length; i++) this.pending.push(ops[i]);
    this.count = Math.max(this.count, os + ops.length);
  }

  advance(st) {
    const sim = this.sim;
    if (!sim || this.attached) return;
    while (sim.t < st) {
      this.applyDue();
      sim.landings.length = 0;
      sim.step();
      sim.triggers.length = 0; // TNT blasts are the server's business; their carves arrive as ops
      if (!this.quiet) this.landFx();
    }
    this.applyDue();
  }

  applyDue() {
    const sim = this.sim;
    let n = 0;
    while (n < this.pending.length && this.pending[n][0] <= sim.t) {
      const op = this.pending[n++];
      const removed = sim.apply(op);
      sim.triggers.length = 0;
      this.opFx(op, removed);
    }
    if (n) this.pending.splice(0, n);
  }

  // ---------- effects ----------

  landFx() {
    const g = this.g;
    for (const l of this.sim.landings) {
      const colors = this.colorsAround(l.x, l.y + 2, 4);
      const puffs = Math.min(6, 1 + Math.floor(l.w / 24));
      for (let k = 0; k < puffs; k++) g.fx.debris(l.x - l.w / 2 + (l.w * (k + 0.5)) / puffs, l.y - 2, colors, 3);
      if (l.n > 60) {
        g.sfx.play(l.n > 600 ? 'rumble' : 'crumble', l.x, Math.min(1, l.n / 900 + 0.3));
        if (l.n > 300) g.fx.shake(Math.min(10, l.n / 150));
      }
    }
  }

  opFx(op, removed) {
    const g = this.g;
    const view = this.view;
    const n = removed ? removed.length / 2 : 0;
    switch (op[1]) {
      case OP.CARVE: {
        const [, , x, y, r] = op;
        view.scorch(x / 2, y / 2, r / 2, Math.min(200, 50 + r * 3));
        if (this.quiet || !n) return;
        g.fx.debris(x, y, this.colorsAround(x, y, r + 3), Math.min(50, Math.ceil(n / 5)));
        if (n > 150) g.sfx.play('debris', x);
        return;
      }
      case OP.CAPSULE: {
        const [, , x1, y1, x2, y2, r] = op;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(1, Math.ceil(len / 16));
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          view.scorch((x1 + (x2 - x1) * f) / 2, (y1 + (y2 - y1) * f) / 2, r / 2, 90);
        }
        if (this.quiet || !n) return;
        const colors = this.colorsAround(x1, y1, r + 3);
        const pts = Math.min(12, Math.ceil(len / 80));
        for (let i = 0; i <= pts; i++) {
          const f = i / pts;
          g.fx.debris(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, colors, 3);
        }
        return;
      }
      case OP.QUAKE: {
        if (this.quiet) return;
        const [, , x, y, r] = op;
        g.fx.shockwave?.(x, y, r);
        g.fx.shake(9);
        g.sfx.play('rumble', x);
        return;
      }
      case OP.PLACE: {
        const [, , x0, y0, bw, bh] = op;
        view.unscorch(x0, y0, x0 + bw - 1, y0 + bh - 1);
        return;
      }
      case OP.RAMP: {
        const [, , x0, y0, len, thick] = op;
        view.unscorch(x0, y0, x0 + len - 1, y0 + len + thick - 2);
        return;
      }
      default:
    }
  }

  // Palette colours of solid cells on a ring around a blast (the carved cells lost theirs).
  colorsAround(x, y, r) {
    const t = this.sim?.terrain || this.g.terrain;
    const out = [];
    const cr = Math.max(2, r / 2);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const cx = Math.floor(x / 2 + Math.cos(a) * cr);
      const cy = Math.floor(y / 2 + Math.sin(a) * cr);
      if (cx < 0 || cy < 0 || cx >= t.w || cy >= t.h) continue;
      const i = cy * t.w + cx;
      if (t.mat[i] && t.col[i]) out.push(PALETTE[t.col[i]]);
    }
    return out.length ? out : EARTH;
  }
}
