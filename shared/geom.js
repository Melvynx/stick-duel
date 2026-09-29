import { CELL, HITBOX } from './constants.js';
import { HARD, SHOT } from './materials.js';

// Entry fraction t in [0, 1] of the segment (x1,y1)->(x2,y2) into the box, or -1 (Liang-Barsky).
export function segAabb(x1, y1, x2, y2, minX, minY, maxX, maxY) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const ps = [-dx, dx, -dy, dy];
  const qs = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
  for (let i = 0; i < 4; i++) {
    const p = ps[i];
    const q = qs[i];
    if (p === 0) {
      if (q < 0) return -1;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return -1;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return -1;
      if (r < t1) t1 = r;
    }
  }
  return t0;
}

// Hit box of a player whose feet are at (x, y), optionally inflated by `pad`.
export function playerBox(x, y, pad = 0) {
  return [x - HITBOX.HW - pad, y - HITBOX.H - pad, x + HITBOX.HW + pad, y + pad];
}

// Distance from a point to the player's box (0 when inside).
export function boxDist(px, py, x, y) {
  const [x0, y0, x1, y1] = playerBox(x, y);
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

// Railgun beam: punches through up to `maxPen` px of terrain, stops at bedrock or the world edge.
export function railTrace(t, x, y, a, range, maxPen) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let pen = 0;
  let d = 0;
  const W = t.w * CELL;
  const H = t.h * CELL;
  for (; d < range; d++) {
    const px = x + dx * d;
    const py = y + dy * d;
    if (py < -400 || px < 0 || px > W || py > H) break;
    const m = t.matAt(px, py);
    if (SHOT[m] && !HARD[m]) break;
    if (SHOT[m]) {
      pen += HARD[m] < 0.5 ? 3 : 1;
      if (pen > maxPen) break;
    }
  }
  return { x2: x + dx * d, y2: y + dy * d, len: d };
}
