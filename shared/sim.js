import { MAT_ANCHOR, MAT_BEAM, MAT_DECOR, MAT_GLASS, MAT_PLANK, MAT_SAND, MAT_TNT, MAT_WOOD } from './constants.js';
import { ANCHOR, BURN, CRUMBLE, PASS, STRUCT, hash3 } from './materials.js';
import { ASH, BUILD, SAND, pal } from './palette.js';
import { CHUNK } from './terrain.js';

// Deterministic falling-sand world simulation.
// Server and browsers run the exact same integer automaton: every terrain change is an "op"
// applied at a known sim tick, so all copies stay in lockstep without streaming cells.
//
// Op wire format: [simTick, type, ...intArgs]
export const OP = { CARVE: 1, CAPSULE: 2, IGNITE: 3, QUAKE: 4, PLACE: 5, RAMP: 6 };
export const CRUMBLE_F = 1; // blast edge turns into rubble
export const IGNITE_F = 2; // blast edge catches fire

const BODY_CAP = 9000; // bigger pieces count as anchored
const TNT_CAP = 600;
const GRAV = 38; // falling bodies, 1/256 cell per tick²
const VMAX = 5 * 256;
const SAND_MAX = 4;

// Two-tone brick courses for builder pieces (local cell coordinates).
const brick = (x, y) => y % 4 === 3 || (x + (y >> 2) * 3) % 6 === 0;

// Top row of ramp column `k` (see TerrainSim.ramp).
export const rampTop = (y0, len, rise, k) => y0 + (rise > 0 ? len - 1 - k : k);

export class TerrainSim {
  constructor(terrain) {
    const t = terrain;
    this.terrain = t;
    this.w = t.w;
    this.h = t.h;
    this.t = 0;
    this.awake = new Uint8Array(t.cw * t.ch);
    this.next = new Uint8Array(t.cw * t.ch).fill(1);
    this.vel = new Uint8Array(t.w * t.h);
    this.body = new Uint16Array(t.w * t.h);
    this.visit = new Int32Array(t.w * t.h);
    this.stamp = 0;
    this.stack = new Int32Array(4096);
    this.bodies = [];
    this.nextBody = 1;
    this.seeds = [];
    this.triggers = []; // TNT blasts waiting for the game: { x, y, r } in world px
    this.landings = []; // settled bodies for effects: { x, y, w, n, v }
    this.total = Math.max(1, t.countSolid());
    this.destroyed = 0;
    this.ash = ASH.map(pal);
    this.build = BUILD.map((pair) => pair.map(pal));
    this.sandCol = SAND.map(pal);
  }

  // Share of the original map that has been blown away, 0..1.
  get destruction() {
    return Math.min(1, this.destroyed / this.total);
  }

  // ---------- waking ----------

  wake(x, y) {
    this.wakeRect(x - 1, y - 1, x + 1, y + 1);
  }

  wakeRect(x0, y0, x1, y1) {
    const t = this.terrain;
    const a = Math.max(0, x0) >> 5;
    const b = Math.min(this.w - 1, x1) >> 5;
    const c = Math.max(0, y0) >> 5;
    const d = Math.min(this.h - 1, y1) >> 5;
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) this.next[y * t.cw + x] = 1;
  }

  // ---------- ops ----------

  // Applies one op. Returns removed [index, material] pairs for debris effects.
  apply(op) {
    const out = [];
    switch (op[1]) {
      case OP.CARVE:
        this.carve(op[2], op[3], op[4], op[5] | 0, out);
        break;
      case OP.CAPSULE:
        this.terrain.carveCapsule(op[2], op[3], op[4], op[5], op[6], out);
        this.removedCells(out);
        this.wakeRect(
          (Math.min(op[2], op[4]) - op[6] * 2) >> 1, (Math.min(op[3], op[5]) - op[6] * 2) >> 1,
          (Math.max(op[2], op[4]) + op[6] * 2) >> 1, (Math.max(op[3], op[5]) + op[6] * 2) >> 1,
        );
        break;
      case OP.IGNITE:
        this.ring(op[2], op[3], 0, op[4], 2);
        break;
      case OP.QUAKE:
        this.ring(op[2], op[3], 0, op[4], 3);
        break;
      case OP.PLACE:
        this.place(op[2], op[3], op[4], op[5], op[6], op[7]);
        break;
      case OP.RAMP:
        this.ramp(op[2], op[3], op[4], op[5], op[6], op[7], op[8]);
        break;
    }
    return out;
  }

  carve(x, y, r, flags, out) {
    this.terrain.carveCircle(x, y, r, out);
    this.removedCells(out);
    if (flags & CRUMBLE_F) this.ring(x, y, r, r * 1.45, 1);
    if (flags & IGNITE_F) this.ring(x, y, r * 0.6, r * 1.6, 2);
    const R = Math.ceil((r * 1.8) / 2);
    this.wakeRect((x >> 1) - R, (y >> 1) - R, (x >> 1) + R, (y >> 1) + R);
  }

  // Bookkeeping after cells vanished: structure seeds, TNT chain, destruction meter.
  removedCells(out) {
    const w = this.w;
    let tnt = 0;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < out.length; k += 2) {
      const i = out[k];
      const m = out[k + 1];
      if (m !== MAT_DECOR) this.destroyed++;
      if (STRUCT[m]) this.seeds.push(i);
      if (m === MAT_TNT) {
        tnt++;
        sx += i % w;
        sy += (i / w) | 0;
      }
    }
    if (!tnt) return;
    const extra = [];
    for (let k = 0; k < out.length; k += 2) {
      if (out[k + 1] !== MAT_TNT) continue;
      const i = out[k];
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j >= 0 && j < this.terrain.mat.length && this.terrain.mat[j] === MAT_TNT) extra.push(j);
      }
    }
    this.detonate(extra, tnt, sx, sy);
  }

  // Removes every TNT cell connected to `starts` and queues one blast sized by the charge.
  detonate(starts, n = 0, sx = 0, sy = 0) {
    const t = this.terrain;
    const w = this.w;
    const stack = [...starts];
    while (stack.length && n < TNT_CAP) {
      const i = stack.pop();
      if (t.mat[i] !== MAT_TNT) continue;
      const x = i % w;
      const y = (i / w) | 0;
      t.clear(i, true);
      t.touch(x, y);
      this.seeds.push(i);
      this.destroyed++;
      n++;
      sx += x;
      sy += y;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w);
      if (y < this.h - 1) stack.push(i + w);
    }
    if (!n) return;
    const r = Math.min(110, Math.round(22 + Math.sqrt(n) * 3.4));
    this.triggers.push({ x: Math.round((sx / n) * 2 + 1), y: Math.round((sy / n) * 2 + 1), r });
  }

  // Applies an effect to cells in the annulus r0..r1 (world px).
  // mode 1: blast rubble, 2: ignite, 3: quake (loosen ground into sand).
  ring(x, y, r0, r1, mode) {
    const t = this.terrain;
    const w = this.w;
    const cx0 = Math.max(0, Math.floor((x - r1) / 2));
    const cx1 = Math.min(w - 1, Math.floor((x + r1) / 2));
    const cy0 = Math.max(0, Math.floor((y - r1) / 2));
    const cy1 = Math.min(this.h - 1, Math.floor((y + r1) / 2));
    const a = r0 * r0;
    const b = r1 * r1;
    for (let cy = cy0; cy <= cy1; cy++) {
      const dy = cy * 2 + 1 - y;
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = cx * 2 + 1 - x;
        const d = dx * dx + dy * dy;
        if (d < a || d > b) continue;
        const i = cy * w + cx;
        const m = t.mat[i];
        const roll = hash3(cx, cy, this.t) & 255;
        if (mode === 2) {
          if (BURN[m] && !t.burn[i] && roll < 150) this.ignite(i);
        } else if (CRUMBLE[m] && !ANCHOR[m]) {
          const odds = m === MAT_GLASS ? 256 : mode === 3 ? 190 : 120;
          if (roll < odds) this.loosen(i);
        } else if (mode === 3 && (m === MAT_WOOD || m === MAT_PLANK) && roll < 40) {
          this.loosen(i);
        }
      }
    }
    this.wakeRect(cx0 - 1, cy0 - 1, cx1 + 1, cy1 + 1);
  }

  // Turns a structural cell into loose sand of the same colour.
  loosen(i) {
    const t = this.terrain;
    if (this.body[i]) return;
    this.seeds.push(i);
    t.mat[i] = MAT_SAND;
    this.vel[i] = 0;
    t.touch(i % this.w, (i / this.w) | 0);
  }

  ignite(i) {
    const t = this.terrain;
    if (t.mat[i] === MAT_TNT) {
      this.detonate([i]);
      return;
    }
    const x = i % this.w;
    const y = (i / this.w) | 0;
    const life = t.mat[i] === MAT_BEAM ? 70 : 110;
    t.burn[i] = life + (hash3(x, y, this.t + 7) % 90);
    t.touch(x, y);
    this.wake(x, y);
  }

  // Builder walls and floors: fills free cells of a cell rect with a two-tone brick pattern
  // (or loose sand for the legacy sandstorm).
  place(x0, y0, bw, bh, mat, colId) {
    const t = this.terrain;
    const [c0, c1] = this.build[colId % this.build.length];
    for (let y = y0; y < y0 + bh; y++) {
      if (y < 0 || y >= this.h) continue;
      for (let x = x0; x < x0 + bw; x++) {
        if (x < 0 || x >= this.w) continue;
        const i = y * this.w + x;
        if (!PASS[t.mat[i]]) continue;
        t.mat[i] = mat;
        t.burn[i] = 0;
        if (mat === MAT_SAND) {
          t.col[i] = this.sandCol[hash3(x, y, this.t) & 3];
          this.vel[i] = 0;
          continue;
        }
        t.col[i] = brick(x - x0, y - y0) ? c1 : c0;
        if (STRUCT[mat]) this.seeds.push(i);
      }
    }
    t.touchRect(x0, y0, x0 + bw, y0 + bh);
    this.wakeRect(x0 - 1, y0 - 1, x0 + bw + 1, y0 + bh + 1);
  }

  // Builder ramp: a 45 degree band `thick` cells tall over `len` columns starting at x0, whose
  // highest column tops out at row y0 (`rise` 1 = climbs to the right, -1 = to the left).
  ramp(x0, y0, len, thick, rise, mat, colId) {
    const t = this.terrain;
    const [c0, c1] = this.build[colId % this.build.length];
    for (let k = 0; k < len; k++) {
      const x = x0 + k;
      if (x < 0 || x >= this.w) continue;
      const top = rampTop(y0, len, rise, k);
      for (let y = Math.max(0, top); y < Math.min(this.h, top + thick); y++) {
        const i = y * this.w + x;
        if (!PASS[t.mat[i]]) continue;
        t.mat[i] = mat;
        t.burn[i] = 0;
        t.col[i] = brick(k, y - top) ? c1 : c0;
        if (STRUCT[mat]) this.seeds.push(i);
      }
    }
    t.touchRect(x0, y0, x0 + len, y0 + len + thick);
    this.wakeRect(x0 - 1, y0 - 1, x0 + len + 1, y0 + len + thick + 1);
  }

  // ---------- step ----------

  step() {
    const cur = this.next;
    this.next = this.awake;
    this.next.fill(0);
    this.awake = cur;
    this.checkSeeds();
    this.stepBodies();
    this.stepCells(cur);
    this.t++;
  }

  stepCells(awake) {
    const t = this.terrain;
    const { mat, burn } = t;
    const w = this.w;
    const cw = t.cw;
    const flip = this.t & 1;
    for (let y = this.h - 1; y >= 0; y--) {
      const cr = (y >> 5) * cw;
      const row = y * w;
      for (let k = 0; k < cw; k++) {
        const cc = flip ? cw - 1 - k : k;
        if (!awake[cr + cc]) continue;
        const xa = cc * CHUNK;
        const xb = Math.min(w, xa + CHUNK) - 1;
        for (let n = 0; n <= xb - xa; n++) {
          const x = flip ? xb - n : xa + n;
          const i = row + x;
          if (burn[i]) this.fire(i, x, y);
          if (mat[i] === MAT_SAND && !this.body[i]) this.sand(i, x, y);
        }
      }
    }
  }

  sand(i, x, y) {
    const t = this.terrain;
    const { mat } = t;
    const w = this.w;
    if (y >= this.h - 1) return;
    const v = this.vel[i];
    const speed = Math.min(SAND_MAX, 1 + (v >> 3));
    let j = i;
    let ny = y;
    for (let s = 0; s < speed && ny < this.h - 1 && PASS[mat[j + w]]; s++) {
      j += w;
      ny++;
    }
    if (j !== i) {
      this.move(i, j, x, y, x, ny);
      this.vel[j] = Math.min(40, v + 1);
      return;
    }
    let d = hash3(x, y, this.t) & 1 ? 1 : -1;
    for (let k = 0; k < 2; k++, d = -d) {
      const nx = x + d;
      if (nx < 0 || nx >= w) continue;
      if (PASS[mat[i + w + d]] && PASS[mat[i + d]]) {
        this.move(i, i + w + d, x, y, nx, y + 1);
        this.vel[i + w + d] = v >> 1;
        return;
      }
    }
    this.vel[i] = 0;
  }

  move(i, j, x, y, nx, ny) {
    const t = this.terrain;
    t.mat[j] = t.mat[i];
    t.col[j] = t.col[i];
    t.burn[j] = t.burn[i];
    t.clear(i);
    this.vel[i] = 0;
    // Whatever rested on this grain may have lost its footing.
    if (y > 0 && STRUCT[t.mat[i - this.w]] && !this.body[i - this.w]) this.seeds.push(i - this.w);
    t.touch(x, y);
    t.touch(nx, ny);
    this.wake(x, y);
    this.wake(nx, ny);
  }

  fire(i, x, y) {
    const t = this.terrain;
    const w = this.w;
    const m = t.mat[i];
    if (!BURN[m] && m !== MAT_SAND) {
      t.burn[i] = 0;
      return;
    }
    const h = hash3(x, y, this.t);
    // Flames climb faster than they spread sideways or down.
    if (y > 0 && (h & 63) < 9) this.catchAt(i - w);
    if (x > 0 && ((h >>> 6) & 63) < 5) this.catchAt(i - 1);
    if (x < w - 1 && ((h >>> 12) & 63) < 5) this.catchAt(i + 1);
    if (y < this.h - 1 && ((h >>> 18) & 63) < 2) this.catchAt(i + w);
    t.touch(x, y);
    this.wake(x, y);
    if (--t.burn[i] > 0) return;
    // Burnt out: leaves ash sometimes, otherwise the cell is gone.
    if (STRUCT[m]) this.seeds.push(i);
    this.destroyed++;
    if (m !== MAT_BEAM && (h >>> 24) % 3 === 0) {
      t.mat[i] = MAT_SAND;
      t.col[i] = this.ash[(h >>> 26) % this.ash.length];
    } else {
      t.clear(i);
    }
  }

  catchAt(j) {
    const t = this.terrain;
    if (BURN[t.mat[j]] && !t.burn[j]) this.ignite(j);
  }

  // ---------- structural support ----------

  checkSeeds() {
    if (!this.seeds.length) return;
    const t = this.terrain;
    const w = this.w;
    const n = t.mat.length;
    const gen = this.stamp + 1;
    const seeds = this.seeds;
    this.seeds = [];
    for (const s of seeds) {
      for (const j of [s, s - w, s - 1, s + 1, s + w]) {
        if (j < 0 || j >= n || !STRUCT[t.mat[j]] || this.body[j] || this.visit[j] >= gen) continue;
        this.flood(j, gen);
      }
    }
  }

  // Walks the structure touching `start`; detaches it as a falling body when nothing holds it.
  flood(start, gen) {
    const t = this.terrain;
    const { mat } = t;
    const w = this.w;
    const h = this.h;
    const id = ++this.stamp;
    const cells = [start];
    let stack = this.stack;
    let sp = 0;
    stack[sp++] = start;
    this.visit[start] = id;
    let anchored = false;
    outer: while (sp) {
      const i = stack[--sp];
      const y = (i / w) | 0;
      const x = i - y * w;
      if (ANCHOR[mat[i]] || x === 0 || x === w - 1 || y === h - 1 || cells.length > BODY_CAP) {
        anchored = true;
        break;
      }
      // Pushed last = explored first: dive downwards to reach the ground quickly.
      const nb = [y > 0 ? i - w : -1, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i + w];
      for (const j of nb) {
        if (j < 0 || !STRUCT[mat[j]] || this.body[j]) continue;
        const v = this.visit[j];
        if (v === id) continue;
        if (v >= gen) {
          anchored = true;
          break outer;
        }
        this.visit[j] = id;
        if (sp >= stack.length) {
          const bigger = new Int32Array(stack.length * 2);
          bigger.set(stack);
          this.stack = stack = bigger;
        }
        stack[sp++] = j;
        cells.push(j);
      }
    }
    if (!anchored) this.detach(cells);
  }

  detach(cells) {
    const t = this.terrain;
    const w = this.w;
    // Crumbs just turn into falling sand.
    if (cells.length < 8) {
      for (const i of cells) {
        if (t.mat[i] === MAT_BEAM || t.mat[i] === MAT_PLANK) t.clear(i);
        else this.loosen(i);
        this.wake(i % w, (i / w) | 0);
      }
      return;
    }
    let id = this.nextBody++ & 0xffff;
    if (!id) id = this.nextBody++ & 0xffff;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (const i of cells) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      this.body[i] = id;
    }
    // Rubble trapped on the structure rides along instead of wedging it in the air.
    for (let y = y1 - 1; y >= y0; y--) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (t.mat[i] === MAT_SAND && !this.body[i] && this.body[i + w] === id) {
          this.body[i] = id;
          cells.push(i);
        }
      }
    }
    const n = cells.length;
    const b = {
      id, x: x0, y: y0, w: x1 - x0 + 1, n, vy: 0, acc: 0, fall: 0,
      dx: new Int16Array(n), dy: new Int16Array(n), mat: new Uint8Array(n), bottoms: [],
    };
    cells.forEach((i, k) => {
      b.dx[k] = (i % w) - x0;
      b.dy[k] = ((i / w) | 0) - y0;
      b.mat[k] = t.mat[i];
      this.body[i] = id;
    });
    this.findBottoms(b);
    this.bodies.push(b);
  }

  findBottoms(b) {
    const w = this.w;
    b.bottoms = [];
    b.h = 0;
    for (let k = 0; k < b.n; k++) {
      if (b.dy[k] > b.h) b.h = b.dy[k];
      const i = (b.y + b.dy[k]) * w + b.x + b.dx[k];
      if (b.dy[k] + b.y >= this.h - 1 || this.body[i + w] !== b.id) b.bottoms.push(k);
    }
  }

  // ---------- falling bodies ----------

  stepBodies() {
    if (!this.bodies.length) return;
    const keep = [];
    // Lowest pieces first so the ones stacked on them can follow in the same tick.
    this.bodies.sort((a, c) => c.y + c.h - (a.y + a.h) || a.id - c.id);
    for (const b of this.bodies) {
      if (b.dead || !this.validate(b)) continue;
      b.vy = Math.min(VMAX, b.vy + GRAV);
      b.acc += b.vy;
      const want = b.acc >> 8;
      b.acc &= 255;
      let k = 0;
      let block = 0;
      while (k < want && !(block = this.blocked(b, k + 1))) k++;
      if (k) this.shift(b, k);
      if (!block && want === 0) block = this.blocked(b, 1);
      // Only loose sand below: the piece sinks through it, pushing the grains up its sides.
      if (block === 2) {
        b.vy = Math.min(b.vy, 96);
        if (this.t % 3 === 0) this.sink(b);
        block = 0;
      }
      // Touching another falling piece: they interlock, so fuse them into one.
      if (block === 3) {
        const o = this.bodies.find((q) => q.id === this.other && !q.dead);
        if (o) {
          this.merge(b, o);
          continue;
        }
        block = 0;
      }
      if (block) this.settle(b);
      else keep.push(b);
    }
    this.bodies = keep.filter((b) => !b.dead);
  }

  merge(a, b) {
    const n = a.n + b.n;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const dx = new Int16Array(n);
    const dy = new Int16Array(n);
    const mat = new Uint8Array(n);
    let x1 = 0;
    let k = 0;
    for (const q of [b, a]) {
      for (let m = 0; m < q.n; m++, k++) {
        dx[k] = q.x + q.dx[m] - x0;
        dy[k] = q.y + q.dy[m] - y0;
        mat[k] = q.mat[m];
        if (dx[k] > x1) x1 = dx[k];
        this.body[(y0 + dy[k]) * this.w + x0 + dx[k]] = b.id;
      }
    }
    Object.assign(b, { x: x0, y: y0, w: x1 + 1, n, dx, dy, mat, vy: Math.min(a.vy, b.vy) });
    b.fall = Math.min(a.fall, b.fall);
    a.dead = true;
    this.findBottoms(b);
  }

  // Drops cells that were carved or burnt while falling. False when nothing is left.
  validate(b) {
    const t = this.terrain;
    const w = this.w;
    let lost = 0;
    for (let k = 0; k < b.n; k++) {
      const i = (b.y + b.dy[k]) * w + b.x + b.dx[k];
      if (t.mat[i] !== b.mat[k] || this.body[i] !== b.id) {
        b.mat[k] = 0;
        lost++;
      }
    }
    if (!lost) return true;
    let n = 0;
    for (let k = 0; k < b.n; k++) {
      if (!b.mat[k]) continue;
      b.dx[n] = b.dx[k];
      b.dy[n] = b.dy[k];
      b.mat[n] = b.mat[k];
      n++;
    }
    b.n = n;
    if (!n) return false;
    this.findBottoms(b);
    return true;
  }

  // 0 = free to drop `off` cells, 1 = blocked by something solid, 2 = only by loose sand,
  // 3 = resting on another falling piece (ride along, never settle mid-air).
  blocked(b, off) {
    const t = this.terrain;
    const w = this.w;
    let res = 0;
    for (const k of b.bottoms) {
      const y = b.y + b.dy[k] + off;
      if (y >= this.h) return 1;
      const j = y * w + b.x + b.dx[k];
      const m = t.mat[j];
      const other = this.body[j];
      if (PASS[m] || other === b.id) continue;
      if (other) {
        this.other = other;
        return 3;
      }
      if (m !== MAT_SAND) return 1;
      res = 2;
    }
    return res;
  }

  shift(b, off) {
    const t = this.terrain;
    const w = this.w;
    const cols = new Uint8Array(b.n);
    const burns = new Uint8Array(b.n);
    for (let k = 0; k < b.n; k++) {
      const i = (b.y + b.dy[k]) * w + b.x + b.dx[k];
      cols[k] = t.col[i];
      burns[k] = t.burn[i];
      this.body[i] = 0;
      t.clear(i);
    }
    b.y += off;
    b.fall += off;
    for (let k = 0; k < b.n; k++) {
      const i = (b.y + b.dy[k]) * w + b.x + b.dx[k];
      t.mat[i] = b.mat[k];
      t.col[i] = cols[k];
      t.burn[i] = burns[k];
      this.vel[i] = 0;
      this.body[i] = b.id;
    }
    const h = b.h;
    t.touchRect(b.x, b.y - off, b.x + b.w, b.y + h);
    this.wakeRect(b.x - 1, b.y - off - 1, b.x + b.w + 1, b.y + h + 1);
  }

  // Moves the piece one cell down into sand, re-depositing each grain on top of its column.
  sink(b) {
    const t = this.terrain;
    const w = this.w;
    const moved = [];
    for (const k of b.bottoms) {
      const x = b.x + b.dx[k];
      const j = (b.y + b.dy[k] + 1) * w + x;
      if (t.mat[j] !== MAT_SAND || this.body[j]) continue;
      let top = j - w;
      while (top - w >= 0 && this.body[top - w] === b.id) top -= w;
      moved.push(top, t.col[j]);
      t.clear(j);
    }
    this.shift(b, 1);
    for (let n = 0; n < moved.length; n += 2) {
      const i = moved[n];
      if (!PASS[t.mat[i]]) continue;
      t.mat[i] = MAT_SAND;
      t.col[i] = moved[n + 1];
      this.vel[i] = 0;
    }
  }

  settle(b) {
    const t = this.terrain;
    const w = this.w;
    const hard = b.fall > 10 && b.vy > 2 * 256;
    for (let k = 0; k < b.n; k++) {
      const x = b.x + b.dx[k];
      const y = b.y + b.dy[k];
      const i = y * w + x;
      this.body[i] = 0;
      if (!hard) continue;
      const m = t.mat[i];
      const roll = hash3(x, y, this.t) & 255;
      if (m === MAT_GLASS || (CRUMBLE[m] && !ANCHOR[m] && roll < 70)) this.loosen(i);
    }
    const h = b.h;
    this.wakeRect(b.x - 1, b.y - 1, b.x + b.w + 1, b.y + h + 2);
    if (b.fall > 2) this.landings.push({ x: (b.x + b.w / 2) * 2, y: (b.y + h) * 2, w: b.w * 2, n: b.n, v: b.vy / 256 });
  }

  // Body id overlapping a player-sized world rect, if any piece is falling fast there.
  crushing(x0, y0, x1, y1) {
    if (!this.bodies.length) return null;
    const w = this.w;
    const cx0 = Math.max(0, Math.floor(x0 / 2));
    const cx1 = Math.min(w - 1, Math.floor(x1 / 2));
    const cy0 = Math.max(0, Math.floor(y0 / 2));
    const cy1 = Math.min(this.h - 1, Math.floor(y1 / 2));
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const id = this.body[y * w + x];
        if (!id) continue;
        const b = this.bodies.find((q) => q.id === id);
        if (b && b.vy > 1.4 * 256) return b;
      }
    }
    return null;
  }

  // True when a burning cell overlaps the world rect.
  burningIn(x0, y0, x1, y1) {
    const t = this.terrain;
    const w = this.w;
    for (let y = Math.max(0, Math.floor(y0 / 2)); y <= Math.min(this.h - 1, Math.floor(y1 / 2)); y++) {
      for (let x = Math.max(0, Math.floor(x0 / 2)); x <= Math.min(w - 1, Math.floor(x1 / 2)); x++) {
        if (t.burn[y * w + x]) return true;
      }
    }
    return false;
  }
}

// Map helper: every structure that touches no anchor gets a levitation crystal, so the map
// starts stable and floating pieces fall once their crystal (or link to the ground) is shot.
export function pinFloating(t, crystal, visible = true) {
  const w = t.w;
  const h = t.h;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !STRUCT[t.mat[s]]) continue;
    const cells = [];
    let anchored = false;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const y = (i / w) | 0;
      const x = i - y * w;
      if (ANCHOR[t.mat[i]] || x === 0 || x === w - 1 || y === h - 1) anchored = true;
      for (const j of [y > 0 ? i - w : -1, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && STRUCT[t.mat[j]]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (anchored) continue;
    // Anchor at the cell nearest the centroid; big pieces show a glowing crystal.
    let sx = 0;
    let sy = 0;
    for (const i of cells) {
      sx += i % w;
      sy += (i / w) | 0;
    }
    sx /= cells.length;
    sy /= cells.length;
    let best = cells[0];
    let bd = Infinity;
    for (const i of cells) {
      const d = (i % w - sx) ** 2 + (((i / w) | 0) - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const bx = best % w;
    const by = (best / w) | 0;
    const show = visible && cells.length > 160;
    const size = show ? 3 : 0;
    for (let dy = -size; dy <= size; dy++) {
      for (let dx = -size; dx <= size; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > size) continue;
        const x = bx + dx;
        const y = by + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (!STRUCT[t.mat[i]] && i !== best) continue;
        t.mat[i] = MAT_ANCHOR;
        if (show) t.col[i] = crystal[Math.abs(dx) + Math.abs(dy) === size ? 1 : dx === 0 && dy <= 0 ? 2 : 0];
      }
    }
  }
}
