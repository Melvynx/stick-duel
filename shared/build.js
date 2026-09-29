import { CELL, PHYS } from './constants.js';
import { playerBox } from './geom.js';
import { COLLIDE, ONEWAY, PASS } from './materials.js';
import { rampTop } from './sim.js';
import { BUILD } from './weapons.js';

// Builder pieces, picked by the aim angle so building stays one-click fast:
//   flat aim      -> WALL   (1 x wallH blocks, stands on the ground where the aim lands)
//   diagonal aim  -> RAMP   (45 degree band of `ramp` blocks from your feet, up or down)
//   steep up      -> FLOOR  (`floor` blocks wide, just above your head)
//   steep down    -> FLOOR under your feet in the air, BUNKER (walls + roof) on the ground
// Everything is grid-snapped to `BUILD.block` cells so pieces line up and chain.
// Pure: the authority uses it to place pieces, the client to preview them.
export const PIECE = { WALL: 0, RAMP: 1, FLOOR: 2, BUNKER: 3 };
export const PIECE_NAMES = ['WALL', 'RAMP', 'FLOOR', 'BUNKER'];

const B = BUILD.block;
const SIDE = B * CELL;
const RAMP_MIN = Math.sin((30 * Math.PI) / 180);
const FLOOR_MIN = Math.sin((62 * Math.PI) / 180);

const cellRow = (px) => Math.floor(px / CELL);
const blockLine = (px) => Math.floor(px / SIDE) * B; // grid row at or above a world y

function standing(t, x, feet) {
  const hw = PHYS.HALF_W;
  if (t.rectSolid(x - hw, feet, x + hw, feet + CELL)) return true;
  const row = feet / CELL;
  return Math.abs(row - Math.round(row)) < 1e-3 && t.rowHasPlatform(x - hw, x + hw, Math.round(row));
}

export function pieceKind(ang, grounded) {
  const up = -Math.sin(ang);
  const e = Math.abs(up);
  if (e < RAMP_MIN) return PIECE.WALL;
  if (e < FLOOR_MIN) return PIECE.RAMP;
  return up < 0 && grounded ? PIECE.BUNKER : PIECE.FLOOR;
}

// Calls fn(x, y) for every cell of a part: { x, y, w, h } rect or { ramp: 1, x, y, len, thick, rise }.
export function eachCell(part, fn) {
  if (!part.ramp) {
    for (let y = part.y; y < part.y + part.h; y++) for (let x = part.x; x < part.x + part.w; x++) fn(x, y);
    return;
  }
  for (let k = 0; k < part.len; k++) {
    const top = rampTop(part.y, part.len, part.rise, k);
    for (let y = top; y < top + part.thick; y++) fn(part.x + k, y);
  }
}

// True when the part overlaps the inclusive cell box.
export function partHits(part, cx0, cy0, cx1, cy1) {
  if (!part.ramp) return part.x <= cx1 && part.x + part.w > cx0 && part.y <= cy1 && part.y + part.h > cy0;
  for (let x = Math.max(cx0, part.x); x <= Math.min(cx1, part.x + part.len - 1); x++) {
    const top = rampTop(part.y, part.len, part.rise, x - part.x);
    if (top <= cy1 && top + part.thick > cy0) return true;
  }
  return false;
}

// Cell box of a player standing at (x, feet).
export function bodyCells(x, feet, pad = 0) {
  const [a, b, c, d] = playerBox(x, feet, pad);
  return [Math.floor(a / CELL), Math.floor(b / CELL), Math.floor((c - 1e-6) / CELL), Math.floor((d - 1e-6) / CELL)];
}

// Number of free cells the piece would fill (0 = nothing to build there).
export function freeCells(t, parts) {
  let n = 0;
  for (const part of parts) {
    eachCell(part, (x, y) => {
      if (x >= 0 && y >= 0 && x < t.w && y < t.h && PASS[t.mat[y * t.w + x]]) n++;
    });
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

// Plans the piece for a builder standing at (x, feet) and aiming at `ang`.
// Returns { kind, parts, cost, box: [x0, y0, x1, y1] in world px } (no parts: nothing to build).
export function planPiece(t, x, feet, ang) {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const dir = dx >= 0 ? 1 : -1;
  const my = feet - PHYS.AIM_Y;
  const kind = pieceKind(ang, dy > 0 && standing(t, x, feet));
  const self = bodyCells(x, feet);
  let parts;
  if (kind === PIECE.WALL) {
    const hit = t.raycast(x, my, dx, dy, BUILD.reach);
    const d = hit >= 0 ? Math.max(0, hit - SIDE / 2) : BUILD.air;
    const tx = x + dx * d;
    const ty = my + dy * d;
    let bx = Math.floor(tx / SIDE);
    // Never inside the builder: at least the first column clear of their body.
    if (dir > 0) bx = Math.max(bx, Math.floor(self[2] / B) + 1);
    else bx = Math.min(bx, Math.floor(self[0] / B) - 1);
    const h = BUILD.wallH * B;
    const x0 = bx * B;
    let r0 = Math.max(0, cellRow(ty));
    // Aimed into something already built: stack on top when the aim is near its top edge.
    let k = 0;
    while (k <= 2 * B && rowBlocked(t, x0, x0 + B, r0 - k)) k++;
    if (k > 2 * B) return { kind, parts: [], cost: 1, box: null };
    r0 -= k;
    let bottom = blockLine(ty) + (BUILD.wallH >> 1) * B; // hangs centred on the aim when there is no ground
    for (let y = r0; y < Math.min(t.h, r0 + h + 40); y++) {
      if (rowBlocked(t, x0, x0 + B, y)) {
        bottom = Math.ceil(y / B) * B; // sinks into uneven ground instead of leaving a gap
        break;
      }
    }
    parts = [{ x: x0, y: bottom - h, w: B, h }];
  } else if (kind === PIECE.RAMP) {
    const len = BUILD.ramp * B;
    const base = Math.round(feet / SIDE) * B;
    const own = Math.floor(x / SIDE);
    for (let k = 0; k < 4; k++) {
      const near = (dir > 0 ? own + k : own + 1 - k) * B;
      const x0 = dir > 0 ? near : near - len;
      const part = dy < 0
        ? { ramp: 1, x: x0, y: base - len, len, thick: B, rise: dir }
        : { ramp: 1, x: x0, y: base, len, thick: B, rise: -dir };
      parts = [part];
      if (!partHits(part, ...self)) break;
    }
  } else if (kind === PIECE.FLOOR) {
    const w = BUILD.floor * B;
    const y0 = dy < 0 ? blockLine(feet - PHYS.HEIGHT - 8) - B : Math.ceil((feet + 1) / SIDE) * B;
    const lift = Math.abs(y0 * CELL + (dy < 0 ? B * CELL : 0) - my);
    const tx = x + (dx / Math.max(0.3, Math.abs(dy))) * lift;
    const bx = Math.floor(tx / SIDE) - (BUILD.floor >> 1);
    parts = [{ x: bx * B, y: y0, w, h: B }];
  } else {
    const bx = Math.floor(x / SIDE);
    const bottom = Math.ceil(feet / SIDE) * B;
    const top = blockLine(feet - PHYS.HEIGHT - 6) - B;
    const h = bottom - top;
    parts = [
      { x: (bx - 2) * B, y: top, w: B, h },
      { x: (bx + 2) * B, y: top, w: B, h },
      { x: (bx - 1) * B, y: top, w: 3 * B, h: B },
    ];
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    const w = p.ramp ? p.len : p.w;
    const h = p.ramp ? p.len + p.thick - 1 : p.h;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + w);
    y1 = Math.max(y1, p.y + h);
  }
  return { kind, parts, cost: kind === PIECE.BUNKER ? BUILD.bunkerCost : 1, box: [x0 * CELL, y0 * CELL, x1 * CELL, y1 * CELL] };
}
