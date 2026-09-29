import {
  CELL, GRID_H, GRID_W, MAT_BEDROCK, MAT_DECOR, MAT_EMPTY, MAT_PLATFORM, MAT_SAND, MAT_SOLID, PHYS,
  WORLD_H, WORLD_W,
} from './constants.js';
import { COLLIDE, HARD, ONEWAY, SHOT } from './materials.js';

export const CHUNK = 32; // cells per chunk side, for sleeping and redraws
const MAX_HARD = 1.7;

// Destructible cell grid.
// `mat` drives physics, `col` is the palette index shown, `bg` the background colour revealed
// when a loose cell moves away (0 = sky), `burn` the remaining fire time of a burning cell.
export class Terrain {
  constructor(w = GRID_W, h = GRID_H) {
    this.w = w;
    this.h = h;
    this.mat = new Uint8Array(w * h);
    this.col = new Uint8Array(w * h);
    this.bg = new Uint8Array(w * h);
    this.burn = new Uint8Array(w * h);
    this.cw = Math.ceil(w / CHUNK);
    this.ch = Math.ceil(h / CHUNK);
    this.dirty = new Uint8Array(this.cw * this.ch).fill(1);
  }

  cell(cx, cy) {
    if (cx < 0 || cx >= this.w || cy >= this.h) return MAT_BEDROCK;
    if (cy < 0) return MAT_EMPTY;
    return this.mat[cy * this.w + cx];
  }

  matAt(x, y) {
    return this.cell(Math.floor(x / CELL), Math.floor(y / CELL));
  }

  set(cx, cy, m, c) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return;
    const i = cy * this.w + cx;
    this.mat[i] = m;
    this.col[i] = c;
    this.touch(cx, cy);
  }

  touch(cx, cy) {
    this.dirty[(cy >> 5) * this.cw + (cx >> 5)] = 1;
  }

  touchRect(cx0, cy0, cx1, cy1) {
    const a = Math.max(0, cx0) >> 5;
    const b = Math.min(this.w - 1, cx1) >> 5;
    const c = Math.max(0, cy0) >> 5;
    const d = Math.min(this.h - 1, cy1) >> 5;
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) this.dirty[y * this.cw + x] = 1;
  }

  // Empties cell `i`, revealing its background (or the sky when `wipe` also clears it).
  clear(i, wipe) {
    if (wipe) this.bg[i] = 0;
    const b = this.bg[i];
    this.mat[i] = b ? MAT_DECOR : MAT_EMPTY;
    this.col[i] = b;
    this.burn[i] = 0;
  }

  // Captures DECOR cells as the background layer. Called once after a map is painted.
  bakeBackground() {
    for (let i = 0; i < this.mat.length; i++) this.bg[i] = this.mat[i] === MAT_DECOR ? this.col[i] : 0;
  }

  solidAt(x, y) {
    return COLLIDE[this.matAt(x, y)] === 1;
  }

  blocksShot(x, y) {
    return SHOT[this.matAt(x, y)] === 1;
  }

  // True when a player-sized rect overlaps colliding cells. `noSand` ignores loose sand.
  rectSolid(x0, y0, x1, y1, noSand) {
    const cx0 = Math.floor(x0 / CELL);
    const cx1 = Math.floor((x1 - 1e-6) / CELL);
    const cy0 = Math.floor(y0 / CELL);
    const cy1 = Math.floor((y1 - 1e-6) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const m = this.cell(cx, cy);
        if (COLLIDE[m] && !(noSand && m === MAT_SAND)) return true;
      }
    }
    return false;
  }

  rectBlocksShot(x0, y0, x1, y1) {
    const cx0 = Math.floor(x0 / CELL);
    const cx1 = Math.floor((x1 - 1e-6) / CELL);
    const cy0 = Math.floor(y0 / CELL);
    const cy1 = Math.floor((y1 - 1e-6) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) if (SHOT[this.cell(cx, cy)]) return true;
    }
    return false;
  }

  // True when the cell row contains a one-way platform (planks, banners, floors).
  rowHasPlatform(x0, x1, cy) {
    if (cy < 0 || cy >= this.h) return false;
    const cx0 = Math.max(0, Math.floor(x0 / CELL));
    const cx1 = Math.min(this.w - 1, Math.floor((x1 - 1e-6) / CELL));
    const row = cy * this.w;
    for (let cx = cx0; cx <= cx1; cx++) if (ONEWAY[this.mat[row + cx]]) return true;
    return false;
  }

  // Removes every destructible cell inside the circle, scaled by material hardness.
  // `removed` collects [index, material] pairs.
  carveCircle(x, y, r, removed) {
    const w = this.w;
    const R = r * MAX_HARD;
    const cy0 = Math.max(0, Math.floor((y - R) / CELL));
    const cy1 = Math.min(this.h - 1, Math.floor((y + R) / CELL));
    const cx0 = Math.max(0, Math.floor((x - R) / CELL));
    const cx1 = Math.min(w - 1, Math.floor((x + R) / CELL));
    const r2 = r * r;
    let n = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      const dy = cy * CELL + CELL / 2 - y;
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = cx * CELL + CELL / 2 - x;
        const i = cy * w + cx;
        const m = this.mat[i];
        const k = HARD[m];
        if (!k || dx * dx + dy * dy > r2 * k * k) continue;
        if (removed) removed.push(i, m);
        this.clear(i, true);
        n++;
      }
    }
    if (n) this.touchRect(cx0, cy0, cx1, cy1);
    return n;
  }

  carveCapsule(x1, y1, x2, y2, r, removed) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / Math.max(1, r * 0.5)));
    let n = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      n += this.carveCircle(x1 + dx * t, y1 + dy * t, r, removed);
    }
    return n;
  }

  // Distance along (dx, dy) to the first shot-blocking cell, or -1.
  raycast(x, y, dx, dy, maxDist) {
    for (let d = 0; d <= maxDist; d += 1) {
      if (this.blocksShot(x + dx * d, y + dy * d)) return d;
    }
    return -1;
  }

  // Finds the first standable feet position at or below yStart for a player centred on x.
  findStand(x, yStart) {
    const hw = PHYS.HALF_W;
    const h = PHYS.HEIGHT;
    const bottom = this.h * CELL;
    for (let y = Math.max(h, Math.floor(yStart / CELL) * CELL); y < bottom; y += CELL) {
      if (this.rectSolid(x - hw, y - h, x + hw, y)) continue;
      const floor = this.rectSolid(x - hw, y, x + hw, y + 1) || this.rowHasPlatform(x - hw, x + hw, y / CELL);
      if (floor) return y;
    }
    return bottom - 40;
  }

  get worldW() {
    return this.w * CELL;
  }

  get worldH() {
    return this.h * CELL;
  }

  countSolid() {
    let n = 0;
    for (let i = 0; i < this.mat.length; i++) if (HARD[this.mat[i]] && this.mat[i] !== MAT_DECOR) n++;
    return n;
  }
}

export function inWorld(x, y, t) {
  const w = t ? t.worldW : WORLD_W;
  const h = t ? t.worldH : WORLD_H;
  return x >= 0 && x <= w && y <= h && y >= -400;
}

export { MAT_BEDROCK, MAT_DECOR, MAT_EMPTY, MAT_PLATFORM, MAT_SOLID };
