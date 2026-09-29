import { MAT_EMPTY } from '../constants.js';
import {
  brickWall, bridge, crate, crateStack, footing, glassCase, house, sandFill, sandbags, tower, watchtower, waterTower,
} from './props.js';
import { D, MAT_BEAM, MAT_GLASS, MAT_METAL, MAT_ROCK, S, bedrock, core, dune, islandCore, ledge, smooth } from './painter.js';

// Big desert outpost (1200x600 cells): a hollow three-storey fort in the middle, bunkers,
// shipping containers, two tiers of floating islands and raised plateaus at both edges.
// Survival is played here: no explosives, and the fort roof and the islands never break away.
export function buildOutpost(P, rnd) {
  const W = P.t.w;
  const floor = P.t.h - 12;
  const s1 = rnd() * 6.28;
  const s2 = rnd() * 6.28;
  const s3 = rnd() * 6.28;
  const H = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    let h = 472 + 9 * Math.sin(x * 0.013 + s1) + 5 * Math.sin(x * 0.041 + s2) + 1.5 * Math.sin(x * 0.15 + s3);
    const edge = Math.max(smooth((150 - x) / 70), smooth((x - (W - 150)) / 70));
    h += (412 + 3 * Math.sin(x * 0.08 + s2) - h) * edge;
    h -= 24 * Math.exp(-(((x - W / 2) / 130) ** 2));
    h += 16 * Math.exp(-(((x - 420) / 34) ** 2)) + 16 * Math.exp(-(((x - (W - 420)) / 34) ** 2));
    H[x] = Math.round(h);
  }
  const ground = (x) => H[Math.max(0, Math.min(W - 1, Math.round(x)))];

  const soil = (x, d) => {
    const wob = Math.round(2 * Math.sin(x * 0.06 + s3));
    if (d < 2) return '#f2c078';
    if (d < 4) return '#d99a4e';
    if (d < 24 + wob) return '#9c5a3c';
    if (d < 56 + wob) return '#7a4232';
    return '#5a2f2b';
  };
  for (let x = 0; x < W; x++) {
    const ripple = rnd() < 0.25 ? 1 : 0;
    for (let y = H[x]; y < floor; y++) {
      const d = y - H[x];
      P.put(x, y, S, d === 4 && ripple ? '#d99a4e' : soil(x, d));
    }
  }
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rnd() * W);
    const y = H[x] + 10 + Math.floor(rnd() * Math.max(1, floor - 12 - H[x]));
    const r = 1.5 + rnd() * 3.5;
    P.disc(x, y, r, null, '#b37a5a');
    P.put(Math.round(x - r / 2), Math.round(y - r / 2), null, '#c99577');
  }
  bedrock(P, rnd, '#1d1128', '#2a1830');

  const fx0 = W / 2 - 44;
  const fx1 = W / 2 + 44;
  const fBase = ground(W / 2) + 2;
  const storey = 46;
  const fTop = fBase - storey * 3;

  // Background props first so they never overwrite ground.
  P.behind(() => {
    for (const x of [70, 205, 520, 690, 995, 1130]) {
      const g = ground(x);
      const h = 16 + Math.floor(rnd() * 12);
      P.rect(x - 2, g - h, x + 2, g, MAT_BEAM, '#2f7a57');
      P.rect(x - 7, g - h + 6, x - 2, g - h + 9, MAT_BEAM, '#2f7a57');
      P.rect(x - 7, g - h + 1, x - 4, g - h + 9, MAT_BEAM, '#2f7a57');
      P.rect(x + 2, g - h + 10, x + 7, g - h + 13, MAT_BEAM, '#2f7a57');
      P.rect(x + 4, g - h + 4, x + 7, g - h + 13, MAT_BEAM, '#2f7a57');
      P.rect(x - 1, g - h, x, g, null, '#3f9a6c');
    }
    // Radio masts behind the plateaus.
    for (const x of [110, W - 110]) {
      const g = ground(x);
      for (let y = g - 110; y < g; y++) {
        const k = (g - y) % 10;
        P.put(x - 4, y, D, '#4b4466');
        P.put(x + 4, y, D, '#4b4466');
        if (k === 0) P.rect(x - 4, y, x + 5, y + 1, D, '#4b4466');
        else P.put(x - 4 + Math.round(k * 0.8), y, D, '#3a3452');
      }
      P.rect(x - 1, g - 118, x + 2, g - 110, D, '#5c5480');
      P.rect(x - 1, g - 120, x + 2, g - 118, D, '#ff5a5a');
    }
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(rnd() * W);
      const hgt = 1 + Math.floor(rnd() * 2);
      P.rect(x, H[x] - hgt, x + 1, H[x], D, rnd() < 0.5 ? '#c7843e' : '#a86a3a');
    }
    // Fort back wall.
    P.rect(fx0, fTop, fx1, fBase, D, '#2d2f45');
    for (let y = fTop + 6; y < fBase; y += 8) P.rect(fx0, y, fx1, y + 1, D, '#262839');
    for (let y = fTop; y < fBase; y += 8) {
      for (let x = fx0 + ((y / 8) % 2 ? 0 : 8); x < fx1; x += 16) P.rect(x, y, x + 1, y + 8, D, '#262839');
    }
  });

  // Fort shell: thick stone sides, doors and windows, one-way floors inside, crenellated roof.
  const WALL = '#6b6f8c';
  const TRIM = '#8a8fb0';
  P.rect(fx0 - 6, fTop, fx0, fBase + 8, MAT_ROCK, WALL);
  P.rect(fx1, fTop, fx1 + 6, fBase + 8, MAT_ROCK, WALL);
  P.rect(fx0 - 6, fTop - 6, fx1 + 6, fTop, S, WALL);
  P.rect(fx0 - 6, fTop - 6, fx1 + 6, fTop - 5, null, TRIM);
  for (let x = fx0 - 6; x < fx1 + 6; x += 12) P.rect(x, fTop - 12, x + 6, fTop - 6, S, WALL);
  for (let k = 1; k < 3; k++) {
    const y = fBase - storey * k;
    P.plat(fx0, y, fx1, y + 4, 0, '#8a8fb0', 3);
  }
  for (const [x0, x1] of [
    [fx0 - 6, fx0],
    [fx1, fx1 + 6],
  ]) {
    P.rect(x0, fBase - 34, x1, fBase, MAT_EMPTY, '#000000');
    P.rect(x0, fBase - storey - 22, x1, fBase - storey - 4, MAT_EMPTY, '#000000');
    P.rect(x0, fBase - storey * 2 - 22, x1, fBase - storey * 2 - 4, MAT_GLASS, '#9fe7ff');
    P.rect(x0 + 1, fBase - storey * 2 - 20, x0 + 3, fBase - storey * 2 - 14, null, '#e4fbff');
  }
  P.rect(fx0 - 6, fBase, fx1 + 6, fBase + 8, S, WALL);
  P.textCenter('OUTPOST', W / 2, fTop + 8, 1, D, '#ffd23f');
  // The middle of the roof is unbreakable (the crew always respawns up there), and so are the
  // reinforced wall sections between the doors and the first-floor windows that hold that floor.
  core(P, fx0 + 8, fTop - 6, fx1 - 8, fTop, null);
  core(P, fx0 - 6, fBase - storey - 4, fx0, fBase - 34, null);
  core(P, fx1, fBase - storey - 4, fx1 + 6, fBase - 34, null);

  // Half-dome bunkers with a firing slit.
  for (const x of [330, W - 330]) {
    const g = ground(x);
    for (let y = g - 26; y < g + 4; y++) {
      for (let xx = x - 30; xx <= x + 30; xx++) {
        const dx = (xx - x) / 30;
        const dy = (g - y) / 26;
        if (dx * dx + dy * dy <= 1) P.put(xx, y, MAT_ROCK, dx * dx + dy * dy > 0.8 ? '#5b5f7a' : '#6b6f8c');
      }
    }
    P.rect(x - 16, g - 16, x + 16, g - 13, MAT_EMPTY, '#000000');
    P.rect(x - 30, g - 1, x + 31, g + 4, MAT_ROCK, '#4b4f68');
  }

  // Shipping containers.
  for (const [x, hex, rib] of [
    [240, '#b0413e', '#8a2f30'],
    [W - 240, '#3e7cb1', '#2d5f8a'],
    [505, '#c9922e', '#a07022'],
    [W - 505, '#4f9a5a', '#3a7644'],
  ]) {
    const g = Math.min(ground(x - 20), ground(x + 20));
    P.rect(x - 20, g - 18, x + 20, g + 3, MAT_METAL, hex);
    for (let xx = x - 18; xx < x + 20; xx += 4) P.rect(xx, g - 16, xx + 1, g + 1, null, rib);
    P.frame(x - 20, g - 18, x + 20, g + 3, rib);
  }

  // Boulders.
  for (const x of [165, W - 165]) {
    const g = ground(x);
    P.disc(x, g - 4, 9, MAT_ROCK, '#8c6a78');
    P.disc(x - 3, g - 8, 3.5, null, '#a3839a');
  }

  // Floating islands, two tiers, each on an unbreakable rock core.
  for (const [cx, cy, w] of [
    [240, 330, 72],
    [W - 240, 330, 72],
    [420, 225, 56],
    [W - 420, 225, 56],
    [W / 2, 128, 46],
  ]) {
    const half = w / 2;
    for (let x = cx - half; x < cx + half; x++) {
      const t = (x - cx) / half;
      const depth = Math.round((1 - t * t) * w * 0.38 + rnd() * 2) + 4;
      for (let d = 0; d < depth; d++) {
        const col = d < 2 ? '#f2c078' : d < 4 ? '#d99a4e' : d < depth - 3 ? '#9c5a3c' : '#7a4232';
        P.put(x, cy + d, S, col);
      }
      if (rnd() < 0.16) P.behind(() => P.rect(x, cy + depth, x + 1, cy + depth + 2 + Math.floor(rnd() * 5), D, '#7a4232'));
    }
    islandCore(P, cx, cy, w);
  }

  // Wooden one-way ledges on posts.
  for (const [x0, x1, y] of [
    [20, 104, 340],
    [W - 104, W - 20, 340],
    [312, 372, 372],
    [W - 372, W - 312, 372],
    [150, 214, 262],
    [W - 214, W - 150, 262],
  ]) {
    ledge(P, x0, x1, y, ground);
  }

  // Packed-sand mounds at the edges, a crate on the top island.
  const SANDS = ['#f2c078', '#e8b064', '#f7d08e'];
  for (const [x, half, hgt] of [[60, 40, 10], [W - 60, 40, 10]]) dune(P, x, ground(x) + 1, half, hgt, SANDS);
  crate(P, W / 2 - 5, 128, 10);

  props(P, W, ground, { fx0, fx1, fBase, storey });
}

// Destructible set pieces, mirrored on both halves. `m(x, w)` is the mirrored left edge.
function props(P, W, ground, fort) {
  const { fx0, fx1, fBase, storey } = fort;
  const box = (x0, x1) => {
    let g = P.t.h;
    for (let x = x0; x < x1; x++) g = Math.min(g, ground(x));
    return g;
  };
  for (const side of [1, -1]) {
    const m = (x, w = 0) => (side > 0 ? x : W - x - w);
    const flat = (x, w) => Math.min(ground(m(x, w)), ground(m(x, w) + w - 1));
    house(P, m(30, 50), m(30, 50) + 50, 412, side);
    house(P, m(222, 36), m(222, 36) + 36, 330, -side, 38);
    waterTower(P, m(130), ground);
    watchtower(P, m(410), ground);
    crate(P, m(262, 12), flat(262, 12));
    crate(P, m(264, 9), flat(262, 12) - 12, 9);
    crate(P, m(275, 8), flat(275, 8), 8);
    // Brick wall in front of the bunker.
    const bw = m(282, 16);
    footing(P, bw, bw + 16, box(bw, bw + 16));
    brickWall(P, bw, bw + 16, box(bw, bw + 16), 12);
    // Upper islands: a parapet on the outer edge and crates.
    brickWall(P, m(396, 10), m(396, 10) + 10, 225, 8);
    crate(P, m(413, 12), 225);
    crate(P, m(432, 9), 225, 9);
    sandbags(P, m(527, 20), m(527, 20) + 20, flat(527, 20), 4);
    // Fort storeys: crates to hide behind (and blow up).
    const inner = side > 0 ? fx0 + 1 : fx1 - 14;
    crate(P, inner, fBase - storey);
    crate(P, side > 0 ? inner + 14 : inner - 10, fBase - storey, 9);
    crate(P, side > 0 ? fx0 + 20 : fx1 - 33, fBase - storey * 2);
    crate(P, side > 0 ? fx0 + 22 : fx1 - 31, fBase - storey * 2 - 12, 9);
    crateStack(P, m(580, 20), fBase, 2, 10);

    // Three-storey tower between the watchtower and the containers.
    const tx = m(455);
    tower(P, tx, box(tx - 20, tx + 20), 3, 18);
    // Broken sky bridge from the upper island toward the fort roof: the middle gap lets the
    // roof spawn drop through and makes you jump it.
    bridge(P, m(449, 141), 225, m(449, 141) + 141, 225, [m(478, 3), m(553, 3)]);
    // Sandbag nests on both shipping containers.
    for (const cx of [240, 505]) {
      const x = side > 0 ? cx : W - cx;
      sandbags(P, x - 14, x + 14, Math.min(ground(x - 20), ground(x + 20)) - 18, 2);
    }
    // Glass sand silo, crates on the low ledge.
    const sx = m(369, 11);
    const sg = Math.min(ground(sx), ground(sx + 10));
    glassCase(P, sx, sx + 11, sg, 24);
    sandFill(P, sx + 2, sg - 16, sx + 9, sg - 2);
    crateStack(P, m(330, 20), 372, 2, 10);
  }
}
