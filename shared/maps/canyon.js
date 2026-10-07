import { MAT_EMPTY } from '../constants.js';
import { D, MAT_ROCK, S, bedrock, islandCore, ledge, smooth } from './painter.js';
import { brickWall, bridge, crate, crateStack, footing, glassCase, house, keep, sandFill, sandbags, tower, watchtower } from './props.js';

// Huge red canyon for group rooms (1800x700 cells, 3.5 screens): stone keeps on raised plateaus at
// both edges, valleys with a watchtower, two mesas with a tunnel through their foot, a deep
// canyon in the middle crossed by a rope bridge from mesa to mesa, a tower on the canyon floor and
// three tiers of floating islands. Mirrored, no explosives.
export function buildCanyon(P, rnd) {
  const W = P.t.w;
  const floor = P.t.h - 12;
  const s1 = rnd() * 6.28;
  const s2 = rnd() * 6.28;
  const s3 = rnd() * 6.28;
  const MID = W / 2;
  const MESA = 650; // left mesa centre, the right one is mirrored
  const MESA_TOP = 430;
  const H = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    const m = Math.min(x, W - 1 - x); // mirrored distance from the edge
    let h = 545 + 7 * Math.sin(x * 0.017 + s1) + 4 * Math.sin(x * 0.047 + s2) + 1.5 * Math.sin(x * 0.16 + s3);
    h += (455 + 2 * Math.sin(x * 0.07 + s2) - h) * smooth((190 - m) / 70);
    h += (MESA_TOP + Math.sin(x * 0.11 + s3) - h) * smooth((90 - Math.abs(m - MESA)) / 25);
    h += (625 + 3 * Math.sin(x * 0.05 + s1) - h) * smooth((120 - Math.abs(x - MID)) / 40);
    H[x] = Math.round(h);
  }
  const ground = (x) => H[Math.max(0, Math.min(W - 1, Math.round(x)))];

  // Layered red rock: bright rim, then strata bands that show on every cliff face.
  const soil = (x, y, d) => {
    if (d < 2) return '#f09a5c';
    if (d < 4) return '#d9743f';
    const band = (y + Math.round(3 * Math.sin(x * 0.02 + s3))) % 22;
    if (band < 3) return '#b8563a';
    if (y > 600) return '#6a2c26';
    return band < 12 ? '#9a4632' : '#853b2c';
  };
  for (let x = 0; x < W; x++) {
    for (let y = H[x]; y < floor; y++) P.put(x, y, S, soil(x, y, y - H[x]));
  }
  for (let i = 0; i < 140; i++) {
    const x = Math.floor(rnd() * W);
    const y = H[x] + 10 + Math.floor(rnd() * Math.max(1, floor - 12 - H[x]));
    const r = 1.5 + rnd() * 3.5;
    P.disc(x, y, r, null, '#c2765a');
    P.put(Math.round(x - r / 2), Math.round(y - r / 2), null, '#d8977b');
  }
  bedrock(P, rnd, '#1d1128', '#2a1830');

  // Background first so it never overwrites ground: far buttes, cacti, radio masts.
  P.behind(() => {
    for (let x = 0; x < W; x++) {
      const far = 360 + 26 * Math.sin(x * 0.006 + s1) + 14 * Math.sin(x * 0.019 + s2) + 6 * Math.sin(x * 0.07 + s3);
      for (let y = Math.round(far); y < H[x]; y++) P.put(x, y, D, (y - Math.round(far)) < 2 ? '#4a2a4a' : '#3a2140');
    }
    for (const x of [230, 520, 790, W - 790, W - 520, W - 230]) {
      const g = ground(x);
      const h = 18 + Math.floor(rnd() * 10);
      P.rect(x - 2, g - h, x + 2, g, D, '#2f7a57');
      P.rect(x - 7, g - h + 6, x - 2, g - h + 9, D, '#2f7a57');
      P.rect(x - 7, g - h + 1, x - 4, g - h + 9, D, '#2f7a57');
      P.rect(x + 2, g - h + 10, x + 7, g - h + 13, D, '#2f7a57');
      P.rect(x + 4, g - h + 4, x + 7, g - h + 13, D, '#2f7a57');
      P.rect(x - 1, g - h, x, g, D, '#3f9a6c');
    }
    for (const x of [24, W - 24]) {
      const g = ground(x);
      for (let y = g - 120; y < g; y++) {
        const k = (g - y) % 10;
        P.put(x - 4, y, D, '#4b4466');
        P.put(x + 4, y, D, '#4b4466');
        if (k === 0) P.rect(x - 4, y, x + 5, y + 1, D, '#4b4466');
        else P.put(x - 4 + Math.round(k * 0.8), y, D, '#3a3452');
      }
      P.rect(x - 1, g - 130, x + 2, g - 120, D, '#ff5a5a');
    }
  });

  // Tunnels through the foot of both mesas: a dark cave you can walk through or blast open.
  const tunnelFloor = 548;
  for (const side of [1, -1]) {
    const cx = side > 0 ? MESA : W - 1 - MESA;
    const x0 = cx - 104;
    const x1 = cx + 104;
    P.round(x0, tunnelFloor - 38, x1, tunnelFloor, 10, MAT_EMPTY, '#000000');
    P.round(x0, tunnelFloor - 38, x1, tunnelFloor, 10, D, '#2a1620');
    for (let x = x0 + 14; x < x1 - 10; x += 40) {
      P.rect(x, tunnelFloor - 36, x + 1, tunnelFloor - 30, D, '#5a3a2a');
      P.rect(x - 1, tunnelFloor - 30, x + 2, tunnelFloor - 27, D, '#ffd23f');
    }
  }

  // Floating islands in three tiers, each on an unbreakable rock core.
  for (const [cx, cy, w] of [
    [300, 330, 64],
    [W - 300, 330, 64],
    [520, 250, 50],
    [W - 520, 250, 50],
    [MID - 150, 300, 52],
    [MID + 150, 300, 52],
    [MID, 175, 60],
  ]) {
    const half = w / 2;
    for (let x = cx - half; x < cx + half; x++) {
      const t = (x - cx) / half;
      const depth = Math.round((1 - t * t) * w * 0.38 + rnd() * 2) + 4;
      for (let d = 0; d < depth; d++) {
        const col = d < 2 ? '#f09a5c' : d < 4 ? '#d9743f' : d < depth - 3 ? '#9a4632' : '#853b2c';
        P.put(x, cy + d, S, col);
      }
      if (rnd() < 0.16) P.behind(() => P.rect(x, cy + depth, x + 1, cy + depth + 2 + Math.floor(rnd() * 5), D, '#853b2c'));
    }
    islandCore(P, cx, cy, w);
  }

  // Rope bridge over the canyon, starting where each mesa top ends, on two stilts.
  let bx0 = MESA;
  while (bx0 < MID && H[bx0] < MESA_TOP + 4) bx0++;
  bridge(P, bx0, MESA_TOP, W - bx0, MESA_TOP, [MID - 90, MID + 87]);

  // Wooden ledges on posts over the valleys.
  for (const [x0, x1, y] of [
    [210, 280, 470],
    [W - 280, W - 210, 470],
    [420, 490, 480],
    [W - 490, W - 420, 480],
  ]) {
    ledge(P, x0, x1, y, ground);
  }

  const top = (x0, x1) => {
    let g = P.t.h;
    for (let x = x0; x < x1; x++) g = Math.min(g, ground(x));
    return g;
  };

  // Canyon floor: a three-storey tower in the middle, sandbag nests and a sand silo.
  tower(P, MID, top(MID - 20, MID + 20), 3, 18);

  for (const side of [1, -1]) {
    const m = (x, w = 0) => (side > 0 ? x : W - x - w);
    // Base: a stone keep with its door facing the map, and a house next to it.
    const kx = m(72);
    keep(P, kx, top(kx - 24, kx + 24), 2, 22, side);
    const hx = m(112, 44);
    footing(P, hx, hx + 44, top(hx, hx + 44));
    house(P, hx, hx + 44, top(hx, hx + 44), side, 38);
    // Valley: watchtower, boulder, brick cover and crates.
    watchtower(P, m(350), ground);
    const bx = m(250);
    P.disc(bx, ground(bx) - 5, 10, MAT_ROCK, '#7d5a6a');
    P.disc(bx - 3, ground(bx) - 9, 4, null, '#9a7486');
    const wx = m(440, 26);
    footing(P, wx, wx + 26, top(wx, wx + 26));
    brickWall(P, wx, wx + 26, top(wx, wx + 26), 14);
    crateStack(P, m(500, 30), top(m(500, 30), m(500, 30) + 30), 3, 10);
    // Mesa top: parapets on the canyon edge and loot to fight over.
    const px = m(MESA + 40, 18);
    brickWall(P, px, px + 18, top(px, px + 18), 10);
    crate(P, m(MESA - 50, 12), top(m(MESA - 50, 12), m(MESA - 50, 12) + 12));
    crate(P, m(MESA - 36, 9), top(m(MESA - 36, 9), m(MESA - 36, 9) + 9), 9);
    // Canyon floor cover.
    const sx = m(MID - 120, 28);
    sandbags(P, sx, sx + 28, top(sx, sx + 28), 3);
    const gx = m(MID - 64, 11);
    const gg = top(gx, gx + 11);
    glassCase(P, gx, gx + 11, gg, 24);
    sandFill(P, gx + 2, gg - 16, gx + 9, gg - 2);
    // Islands: crates on the low ones.
    crate(P, m(290, 12), 330);
    crate(P, m(MID - 154, 9), 300, 9);
  }
  crate(P, MID - 5, 175, 10);
}
