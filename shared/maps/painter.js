import {
  GRID_W, MAT_ANCHOR, MAT_BEAM, MAT_BEDROCK, MAT_DECOR, MAT_EMPTY, MAT_GLASS, MAT_METAL, MAT_PLANK,
  MAT_PLATFORM, MAT_ROCK, MAT_SOLID, MAT_WOOD,
} from '../constants.js';
import { forEachPixel, measureText } from '../font.js';
import { COLLIDE } from '../materials.js';
import { pal } from '../palette.js';

// Map painting toolkit. Coordinates are in cells (1 cell = 2 world px).
export const S = MAT_SOLID;
export const D = MAT_DECOR;
export const PL = MAT_PLATFORM;
export { MAT_ANCHOR, MAT_BEAM, MAT_BEDROCK, MAT_EMPTY, MAT_GLASS, MAT_METAL, MAT_PLANK, MAT_ROCK, MAT_WOOD };

// `mat === null` recolours existing non-empty cells and keeps their material.
// Inside `behind()`, painting only fills empty cells (background props behind the ground).
export class Painter {
  constructor(t) {
    this.t = t;
    this.onlyEmpty = false;
    this.cores = []; // indestructible cores, [x0, y0, x1, y1] in cells (see core())
  }

  put(x, y, mat, hex) {
    const t = this.t;
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) return;
    const i = y * t.w + x;
    const c = pal(hex);
    if (mat === null) {
      if (t.mat[i] === MAT_EMPTY) return;
      t.col[i] = c;
      if (t.mat[i] === D) t.bg[i] = c;
      return;
    }
    if (this.onlyEmpty && t.mat[i] !== MAT_EMPTY) return;
    // The background layer remembers decor so it shows again when a loose cell moves away.
    if (mat === D) t.bg[i] = c;
    else if (mat === MAT_EMPTY) t.bg[i] = 0;
    t.mat[i] = mat;
    t.col[i] = c;
  }

  // Paints only where there is background or sky (props in front of decor, not in the ground).
  over(fn) {
    const put = this.put;
    this.put = (x, y, mat, hex) => {
      const t = this.t;
      if (x < 0 || y < 0 || x >= t.w || y >= t.h) return;
      const m = t.mat[y * t.w + x];
      if (m === MAT_EMPTY || m === D || mat === null) put.call(this, x, y, mat, hex);
    };
    fn();
    this.put = put;
  }

  behind(fn) {
    this.onlyEmpty = true;
    fn();
    this.onlyEmpty = false;
  }

  rect(x0, y0, x1, y1, mat, hex) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.put(x, y, mat, hex);
  }

  frame(x0, y0, x1, y1, hex) {
    for (let x = x0; x < x1; x++) {
      this.put(x, y0, null, hex);
      this.put(x, y1 - 1, null, hex);
    }
    for (let y = y0; y < y1; y++) {
      this.put(x0, y, null, hex);
      this.put(x1 - 1, y, null, hex);
    }
  }

  inRound(x, y, x0, y0, x1, y1, r) {
    const cx = x < x0 + r ? x0 + r : x > x1 - 1 - r ? x1 - 1 - r : x;
    const cy = y < y0 + r ? y0 + r : y > y1 - 1 - r ? y1 - 1 - r : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r + r * 0.8;
  }

  round(x0, y0, x1, y1, r, mat, hex) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) if (this.inRound(x, y, x0, y0, x1, y1, r)) this.put(x, y, mat, hex);
    }
  }

  // One-way platform: the top rows collide from above, the body is decor.
  plat(x0, y0, x1, y1, r, hex, rows = 3, top = PL, body = D) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (this.inRound(x, y, x0, y0, x1, y1, r)) this.put(x, y, y < y0 + rows ? top : body, hex);
      }
    }
  }

  disc(cx, cy, r, mat, hex) {
    const r2 = r * r + r * 0.8;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.put(x, y, mat, hex);
      }
    }
  }

  ring(cx, cy, r, hex) {
    const outer = r * r + r * 0.8;
    const inner = (r - 1) * (r - 1) + (r - 1) * 0.8;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d <= outer && d > inner) this.put(x, y, null, hex);
      }
    }
  }

  text(str, x, y, scale, mat, hex) {
    forEachPixel(str, (px, py) => {
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) this.put(x + px * scale + sx, y + py * scale + sy, mat, hex);
      }
    });
  }

  textCenter(str, cx, y, scale, mat, hex) {
    this.text(str, Math.round(cx - measureText(str, scale) / 2), y, scale, mat, hex);
  }
}

export function bedrock(P, rnd, a, b) {
  const { w, h } = P.t;
  P.rect(0, h - 12, w, h, MAT_BEDROCK, a);
  for (let i = 0; i < Math.round((260 * w) / GRID_W); i++) {
    const x = Math.floor(rnd() * w);
    const y = h - 12 + Math.floor(rnd() * 12);
    P.put(x, y, null, b);
  }
}

export const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

// Dark rock that shows once the ground around an indestructible core is blown away.
export const CORE = ['#2a2238', '#342a44', '#3d3350'];

// Indestructible core: every solid cell of [x0, x1) x [y0, y1) becomes bedrock (never carved,
// burnt or crumbled, and it anchors whatever is built on it). `hexes` recolours the cells as dark
// rock, `null` keeps the painted look (a card or a roof that should just never break).
export function core(P, x0, y0, x1, y1, hexes = CORE) {
  const t = P.t;
  for (let y = Math.max(0, y0); y < Math.min(t.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(t.w, x1); x++) {
      const i = y * t.w + x;
      if (!COLLIDE[t.mat[i]]) continue;
      t.mat[i] = MAT_BEDROCK;
      if (hexes) t.col[i] = pal(hexes[(x * 7 + y * 13 + ((x ^ y) & 3)) % hexes.length]);
    }
  }
  P.cores.push([x0, y0, x1, y1]);
}

// Floating island of width `w` whose grass line is row `cy`: a rock slab under the top two rows
// (most of the width) plus a keel under its middle, so blasts chip the edges but the island
// always stays up and standable.
export function islandCore(P, cx, cy, w) {
  const a = Math.round(w * 0.36);
  const b = Math.round(w * 0.18);
  core(P, cx - a, cy + 2, cx + a, cy + 8);
  core(P, cx - b, cy + 8, cx + b, cy + 15);
}

// Dune-shaped mound of packed earth (solid, crumbles under blasts), sitting on whatever is below.
export function dune(P, cx, base, half, height, hexes) {
  for (let x = cx - half; x <= cx + half; x++) {
    const k = 1 - ((x - cx) / half) ** 2;
    const top = Math.round(height * k);
    for (let d = 0; d < top; d++) {
      const y = base - 1 - d;
      const m = P.t.mat[y * P.t.w + x];
      if (m !== MAT_EMPTY && m !== D) continue;
      P.put(x, y, S, hexes[(x * 7 + d * 3) % hexes.length]);
    }
  }
}

// Wooden ledge: one-way planks on burnable posts.
export function ledge(P, x0, x1, y, groundAt) {
  P.plat(x0, y, x1, y + 5, 1, '#b8763f', 3, MAT_PLANK, MAT_BEAM);
  P.rect(x0, y + 4, x1, y + 5, null, '#8a5230');
  for (let x = x0 + 4; x < x1; x += 12) P.put(x, y + 2, null, '#8a5230');
  P.over(() => {
    for (const px of [x0 + 5, x1 - 7]) P.rect(px, y + 5, px + 2, groundAt(px), MAT_BEAM, '#6b4128');
  });
}
