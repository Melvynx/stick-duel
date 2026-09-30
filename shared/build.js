import { CELL, MAT_BUILD, PHYS } from './constants.js';
import { playerBox } from './geom.js';
import { COLLIDE, ONEWAY, PASS } from './materials.js';
import { BUILD } from './weapons.js';

// Fortnite-style builder: two pieces on a grid of `BUILD.tile` blocks.
//   WALL  - vertical, one tile tall, on the grid line nearest the cursor
//   FLOOR - horizontal, one tile wide, on the tile under the cursor
// Columns are global so neighbouring pieces always line up. Levels count whole tiles up from the
// surface under the cursor (ground, a floor or a wall top), so a wall stands on what is below it,
// a floor lands flush on the walls of its tile and pieces stack storey by storey.
// Pure: the authority uses it to place pieces, the client to preview them.
export const PIECE = { WALL: 0, FLOOR: 1 };
export const PIECE_NAMES = ['WALL', 'FLOOR'];

// Builder choice sent with every input as `k`: mode (PIECE), style (0 = team colour, else palette
// BUILD index + 1) and the cursor distance in 4 px steps.
export const MODE_NAMES = PIECE_NAMES;
export const STYLE_NAMES = ['TEAM', 'BRICK', 'STEEL', 'SANDSTONE', 'WOOD', 'STONE', 'NEON', 'OBSIDIAN'];
export const packBuild = (mode, style, dist) => (mode & 7) | ((style & 7) << 3) | (Math.max(0, Math.min(63, Math.round(dist / 4))) << 6);
export const unpackBuild = (k) => ({ mode: k & 7, style: (k >> 3) & 7, dist: ((k >> 6) & 63) * 4 });

const T = BUILD.tile * BUILD.block; // tile side, cells
const TH = BUILD.thick;
const SCAN = 3 * T; // how far down a piece looks for something to stand on

// True when the part overlaps the inclusive cell box.
export function partHits(part, cx0, cy0, cx1, cy1) {
  return part.x <= cx1 && part.x + part.w > cx0 && part.y <= cy1 && part.y + part.h > cy0;
}

// Cell box of a player standing at (x, feet).
export function bodyCells(x, feet, pad = 0) {
  const [a, b, c, d] = playerBox(x, feet, pad);
  return [Math.floor(a / CELL), Math.floor(b / CELL), Math.floor((c - 1e-6) / CELL), Math.floor((d - 1e-6) / CELL)];
}

// Number of free cells the piece would fill (0 = nothing to build there).
export function freeCells(t, parts) {
  let n = 0;
  for (const p of parts) {
    for (let y = Math.max(0, p.y); y < Math.min(t.h, p.y + p.h); y++) {
      for (let x = Math.max(0, p.x); x < Math.min(t.w, p.x + p.w); x++) if (PASS[t.mat[y * t.w + x]]) n++;
    }
  }
  return n;
}

function rowBlocked(t, x0, x1, y) {
  for (let x = x0; x < x1; x++) {
    const m = t.cell(x, y);
    if (COLLIDE[m] || ONEWAY[m]) return true;
  }
  return false;
}

// First blocked row at or below `y` over columns [x0, x1), or -1 when there is nothing close.
function surface(t, x0, x1, y) {
  for (let r = Math.max(0, y); r < Math.min(t.h, y + SCAN); r++) if (rowBlocked(t, x0, x1, r)) return r;
  return -1;
}

// Plans the piece for a builder standing at (x, feet), aiming at `ang` with the cursor `dist` px
// from the shoulder, `mode` as in `unpackBuild`.
// Returns { kind, parts, cost, box: [x0, y0, x1, y1] in world px } (no parts: nothing to build).
export function planPiece(t, x, feet, ang, mode = PIECE.WALL, dist = BUILD.cursor) {
  const kind = mode === PIECE.FLOOR ? PIECE.FLOOR : PIECE.WALL;
  const d = Math.min(dist > 0 ? dist : BUILD.cursor, BUILD.cursor);
  const px = (x + Math.cos(ang) * d) / CELL;
  const py = (feet - PHYS.AIM_Y + Math.sin(ang) * d) / CELL;
  const self = bodyCells(x, feet);
  let part;
  if (kind === PIECE.WALL) {
    // Nearest grid line, pushed one tile further when it would cut through the builder.
    let gx = Math.round(px / T);
    const cuts = (g) => g * T - TH / 2 <= self[2] && g * T + TH / 2 > self[0];
    if (cuts(gx)) gx += px >= x / CELL ? 1 : -1;
    const x0 = gx * T - TH / 2;
    // Aimed at a wall already there: nothing (aim above it to stack). Aimed at the top half of
    // natural ground: the wall goes on top of it.
    let y = Math.floor(py);
    for (let c = x0; c < x0 + TH; c++) if (t.cell(c, y) === MAT_BUILD) return { kind, parts: [], cost: 1, box: null };
    let up = 0;
    while (up <= T / 2 && rowBlocked(t, x0, x0 + TH, y - up)) up++;
    if (up > T / 2) return { kind, parts: [], cost: 1, box: null };
    y -= up;
    const s = surface(t, x0, x0 + TH, y);
    const bottom = s < 0 ? Math.ceil(py / T) * T : s - Math.floor((s - y) / T) * T;
    part = { x: x0, y: bottom - T, w: TH, h: T };
  } else {
    const x0 = Math.floor(px / T) * T;
    // Interior columns only, so the walls on the tile's edges do not count as its ground.
    const s = surface(t, x0 + TH, x0 + T - TH, Math.floor(py));
    const top = s < 0 ? Math.round(py / T) * T : s - Math.max(0, Math.round((s - py) / T)) * T;
    part = { x: x0, y: top, w: T, h: TH };
  }
  return { kind, parts: [part], cost: 1, box: [part.x * CELL, part.y * CELL, (part.x + part.w) * CELL, (part.y + part.h) * CELL] };
}
