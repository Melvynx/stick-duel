import { D, MAT_BEAM, MAT_EMPTY, MAT_GLASS, MAT_PLANK, MAT_TNT, MAT_WOOD, S } from './painter.js';

// Destructible set pieces. Wood burns, beams only hold things up (cut them and the rest falls),
// glass shatters and releases whatever it holds, barrels explode. Coordinates are cells; `gy`
// is the ground row the prop stands on, `dir` mirrors asymmetric props (1 = door on the right).

const WOOD = '#a4683a';
const WOOD_D = '#7c4a2a';
const WOOD_L = '#c8894f';
const POST = '#6b4128';
const ROOF = '#8c3b30';
const ROOF_D = '#6e2c25';
const INSIDE = '#3b2a33';
const GLASS = '#9fe7ff';
const GLASS_IN = '#cdf4ff';

// Wooden crate with a cross brace.
export function crate(P, x, gy, s = 12) {
  const y = gy - s;
  P.rect(x, y, x + s, gy, MAT_WOOD, WOOD);
  P.frame(x, y, x + s, gy, WOOD_D);
  for (let i = 1; i < s - 1; i++) {
    P.put(x + i, y + i, null, WOOD_D);
    P.put(x + s - 1 - i, y + i, null, WOOD_D);
  }
}

// Red explosive barrel: TNT inside, chains with every blast and fire nearby.
export function barrel(P, x, gy, w = 7, h = 10) {
  const y = gy - h;
  P.rect(x, y, x + w, gy, MAT_TNT, '#c92f2f');
  P.rect(x, y + 2, x + w, y + 3, null, '#7d1b1b');
  P.rect(x, gy - 3, x + w, gy - 2, null, '#7d1b1b');
  P.rect(x + 1, y + 4, x + w - 1, gy - 4, null, '#f0c33c');
  P.put(x + (w >> 1), y + 5, null, '#1d1128');
  P.rect(x + 1, y, x + 3, y + 1, null, '#ff6b5a');
}

// Low wall of stacked sandbags: good cover that crumbles under fire.
export function sandbags(P, x0, x1, gy, rows = 3) {
  for (let r = 0; r < rows; r++) {
    const y = gy - (r + 1) * 3;
    const off = r & 1 ? 3 : 0;
    for (let x = x0 + off - (r & 1 ? 6 : 0); x < x1; x += 6) {
      const a = Math.max(x0 + r, x);
      const b = Math.min(x1 - r, x + 6);
      if (b - a < 2) continue;
      P.rect(a, y, b, y + 3, S, '#c9a15a');
      P.rect(a, y + 2, b, y + 3, null, '#a88445');
      P.put(b - 1, y, null, '#a88445');
    }
  }
}

// Stilt watchtower: beam legs, one-way plank deck, parapets, a wooden roof and a barrel upstairs.
export function watchtower(P, cx, groundAt, legH = 64) {
  const gy = Math.min(groundAt(cx - 13), groundAt(cx + 13));
  const dy = gy - legH;
  P.over(() => {
    for (const lx of [cx - 14, cx + 11]) {
      P.rect(lx, dy, lx + 3, groundAt(lx + 1), MAT_BEAM, POST);
      P.rect(lx + 1, dy, lx + 2, groundAt(lx + 1), null, WOOD_D);
    }
    // X braces between the legs.
    for (let y0 = dy + 6; y0 + 20 <= gy; y0 += 22) {
      for (let i = 0; i <= 22; i++) {
        const y = y0 + Math.round((i * 20) / 22);
        P.rect(cx - 11 + i, y, cx - 9 + i, y + 1, MAT_BEAM, POST);
        P.rect(cx + 9 - i, y, cx + 11 - i, y + 1, MAT_BEAM, POST);
      }
    }
  });
  P.plat(cx - 19, dy, cx + 19, dy + 4, 0, WOOD_L, 2, MAT_PLANK, MAT_BEAM);
  P.rect(cx - 19, dy + 3, cx + 19, dy + 4, null, WOOD_D);
  // Cabin: open sides above the parapets, corner posts and a gabled roof.
  P.rect(cx - 19, dy - 40, cx + 19, dy, D, INSIDE);
  for (const x of [cx - 19, cx + 16]) {
    P.rect(x, dy - 10, x + 3, dy, MAT_WOOD, WOOD);
    P.rect(x, dy - 10, x + 3, dy - 9, null, WOOD_L);
    P.rect(x, dy - 40, x + 3, dy - 10, MAT_BEAM, POST);
  }
  for (let r = 0; r < 12; r++) P.rect(cx - 23 + r * 2, dy - 44 - r, cx + 23 - r * 2, dy - 40 - r, MAT_WOOD, r % 3 ? ROOF : ROOF_D);
  barrel(P, cx + 6, dy);
  crate(P, cx - 12, dy, 9);
}

// Single-storey wooden house: window on one side, door on the other, gabled roof, loot inside.
export function house(P, x0, x1, gy, dir = 1, h = 40) {
  const top = gy - h;
  P.rect(x0, top, x1, gy, D, INSIDE);
  for (let y = top + 6; y < gy; y += 7) P.rect(x0 + 3, y, x1 - 3, y + 1, D, '#33242c');
  const [win, door] = dir > 0 ? [x0, x1 - 3] : [x1 - 3, x0];
  P.rect(win, top, win + 3, gy, MAT_WOOD, WOOD);
  P.rect(win, top + 12, win + 3, top + 22, MAT_GLASS, GLASS);
  P.put(win + 1, top + 14, null, '#e4fbff');
  P.rect(door, top, door + 3, gy - 34, MAT_WOOD, WOOD);
  P.rect(x0, top - 3, x1, top, MAT_WOOD, WOOD_D);
  // Roof overhang, shingles in alternating rows.
  const span = x1 - x0 + 8;
  for (let r = 0; r * 4 < span / 2 - 2; r++) {
    P.rect(x0 - 4 + r * 4, top - 6 - r * 3, x1 + 4 - r * 4, top - 3 - r * 3, MAT_WOOD, r & 1 ? ROOF_D : ROOF);
  }
  const mid = (x0 + x1) >> 1;
  crate(P, dir > 0 ? x0 + 4 : x1 - 16, gy);
  barrel(P, mid - 3, gy);
  P.over(() => P.rect(x0, gy, x1, gy + 6, S, '#6b4a3a'));
}

// Glass tank of explosive barrels on beam stilts: cut a leg and it topples, crack the glass
// and the barrels spill, one stray shot and the whole stack goes up.
export function waterTower(P, cx, groundAt, legH = 46) {
  const gy = Math.min(groundAt(cx - 12), groundAt(cx + 12));
  const ty = gy - legH;
  P.over(() => {
    for (const lx of [cx - 12, cx - 5, cx + 3, cx + 10]) P.rect(lx, ty, lx + 2, groundAt(lx + 1), MAT_BEAM, POST);
    for (let y = ty + 10; y < gy - 4; y += 14) P.rect(cx - 12, y, cx + 12, y + 1, MAT_BEAM, WOOD_D);
  });
  P.plat(cx - 16, ty, cx + 16, ty + 3, 0, WOOD_L, 2, MAT_PLANK, MAT_BEAM);
  glassCase(P, cx - 14, cx + 14, ty, 30);
  barrelCluster(P, cx - 11, ty - 2, 3);
  crate(P, cx - 4, ty - 22, 8);
  P.rect(cx - 15, ty - 33, cx + 15, ty - 30, MAT_WOOD, ROOF);
}

// First row at or below `y` that holds something (not sky or background).
export function drop(P, x, y) {
  const t = P.t;
  while (y < t.h) {
    const m = t.mat[y * t.w + x];
    if (m !== MAT_EMPTY && m !== D) return y;
    y++;
  }
  return t.h;
}

// Packed-earth foundation under [x0, x1) from row `gy` down to the ground, so props on slopes
// sit flush instead of floating on a corner.
export function footing(P, x0, x1, gy, hex = '#6b4a3a') {
  P.over(() => {
    for (let x = x0; x < x1; x++) P.rect(x, gy, x + 1, Math.max(gy + 3, drop(P, x, gy)), S, hex);
  });
}

// Hollow glass box [x0, x1) standing on row `gy`: 2-cell panes, see-through inside.
export function glassCase(P, x0, x1, gy, h) {
  P.rect(x0, gy - h, x1, gy, MAT_GLASS, GLASS);
  P.rect(x0 + 2, gy - h + 2, x1 - 2, gy - 2, D, GLASS_IN);
  P.rect(x0 + 1, gy - h + 3, x0 + 2, gy - h + 9, null, '#e4fbff');
}

// Pyramid of crates, `n` wide at the bottom.
export function crateStack(P, x, gy, n = 3, s = 10) {
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < n - r; i++) crate(P, x + i * s + ((r * s) >> 1), gy - r * s, s);
  }
}

// Barrels a cell apart, `n` on the ground and `n - 1` on top: one blast sets off the next.
// Footprint is n * 8 - 1 cells wide, 20 tall.
export function barrelCluster(P, x, gy, n = 3) {
  for (let i = 0; i < n; i++) barrel(P, x + i * 8, gy);
  for (let i = 0; i < n - 1; i++) barrel(P, x + 4 + i * 8, gy - 10);
}

// Wooden plank bridge from (x0, y0) to (x1, y1): one-way deck (sloped decks climb in 1-cell
// steps), rope rail, and beam stilts down to whatever is below each x in `stilts`.
// Everything burns; cut the stilts and the span drops.
export function bridge(P, x0, y0, x1, y1, stilts = []) {
  const deck = (x) => Math.round(y0 + ((y1 - y0) * (x - x0)) / Math.max(1, x1 - 1 - x0));
  for (let x = x0; x < x1; x++) {
    const y = deck(x);
    P.rect(x, y, x + 1, y + 2, MAT_PLANK, (x - x0) % 6 === 5 ? WOOD_D : WOOD_L);
    P.rect(x, y + 2, x + 1, y + 4, MAT_BEAM, WOOD_D);
  }
  P.over(() => {
    for (let x = x0 + 2; x < x1 - 1; x += 9) P.rect(x, deck(x) - 8, x + 1, deck(x), MAT_BEAM, POST);
    // Rail and braces are painted 4-connected so no stray cell becomes its own floating piece.
    for (let x = x0 + 2; x < x1 - 2; x++) {
      const a = deck(x) - 8;
      const b = deck(x + 1) - 8;
      P.rect(x, Math.min(a, b), x + 1, Math.max(a, b) + 1, MAT_BEAM, '#c8a26a');
    }
    for (const sx of stilts) {
      const top = deck(sx) + 4;
      P.rect(sx, top, sx + 3, drop(P, sx + 1, top), MAT_BEAM, POST);
      P.rect(sx + 1, top, sx + 2, drop(P, sx + 1, top), null, WOOD_D);
      // Knee braces up to the deck on both sides.
      for (let i = 0; i < 10; i++) {
        for (const d of [-1, 1]) {
          const bx = sx + 1 + d * (i + 2);
          if (bx >= x0 && bx < x1) P.rect(bx, deck(bx) + 13 - i, bx + 1, deck(bx) + 16 - i, MAT_BEAM, POST);
        }
      }
    }
  });
}

// Wooden tower of `floors` storeys on row `gy`, `half` cells either side of `cx`: doors on both
// sides at the bottom, glass windows upstairs, one-way plank floors to jump up through and an
// open roof deck. The centre beam holds it all up: burn or cut it and the tower comes down.
export function tower(P, cx, gy, floors = 2, half = 18) {
  const SH = 36;
  const x0 = cx - half;
  const x1 = cx + half;
  const roof = gy - floors * SH;
  footing(P, x0 - 2, x1 + 2, gy);
  P.rect(x0, roof, x1, gy, D, INSIDE);
  for (let y = roof + 6; y < gy; y += 7) P.rect(x0 + 3, y, x1 - 3, y + 1, D, '#33242c');
  P.rect(cx - 1, roof, cx + 1, gy, MAT_BEAM, POST);
  for (let k = 0; k < floors; k++) {
    const y1 = gy - k * SH;
    const y0 = y1 - SH;
    for (const wx of [x0, x1 - 3]) {
      if (k === 0) {
        P.rect(wx, y0, wx + 3, y1 - 31, MAT_WOOD, WOOD);
        continue;
      }
      P.rect(wx, y0, wx + 3, y1, MAT_WOOD, WOOD);
      P.rect(wx, y1 - 26, wx + 3, y1 - 7, MAT_GLASS, GLASS);
      P.put(wx + 1, y1 - 24, null, '#e4fbff');
    }
    if (k > 0) {
      P.plat(x0 + 3, y1, x1 - 3, y1 + 3, 0, WOOD_L, 2, MAT_PLANK, MAT_BEAM);
      P.rect(x0 + 3, y1 + 2, x1 - 3, y1 + 3, null, WOOD_D);
    }
    // Something to blow up on every storey.
    if (k & 1) crate(P, cx + 4, y1, 9);
    else barrel(P, cx + 5, y1);
    if (k === 0) crate(P, x0 + 4, y1, 9);
  }
  P.plat(x0 - 2, roof, x1 + 2, roof + 3, 0, WOOD_L, 2, MAT_PLANK, MAT_BEAM);
  P.rect(x0 - 2, roof + 2, x1 + 2, roof + 3, null, WOOD_D);
  P.over(() => {
    for (let x = x0; x < x1; x += 6) P.rect(x, roof - 7, x + 1, roof, MAT_BEAM, POST);
    P.rect(x0, roof - 8, x1, roof - 7, MAT_BEAM, '#c8a26a');
  });
  barrel(P, cx - 9, roof);
}
