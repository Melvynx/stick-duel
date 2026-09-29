import { GRID_H, GRID_W } from '../constants.js';
import { D, MAT_BEAM, MAT_ROCK, S, bedrock, islandCore, ledge, smooth } from './painter.js';
import { brickWall, bridge, crate, crateStack, footing, house, keep, tower } from './props.js';

// Dusk ridge with floating islands and wooden ledges.
export function buildRidge(P, rnd) {
  const s1 = rnd() * 6.28;
  const s2 = rnd() * 6.28;
  const s3 = rnd() * 6.28;
  const H = new Int16Array(GRID_W);
  for (let x = 0; x < GRID_W; x++) {
    let h = 372 + 6 * Math.sin(x * 0.021 + s1) + 4 * Math.sin(x * 0.053 + s2) + 1.5 * Math.sin(x * 0.17 + s3);
    const edge = Math.max(smooth((140 - x) / 60), smooth((x - 660) / 60));
    const ledge = 330 + 3 * Math.sin(x * 0.09 + s2);
    h = h + (ledge - h) * edge;
    h -= 46 * Math.exp(-(((x - 400) / 62) ** 2));
    H[x] = Math.round(h);
  }

  const soil = (x, d) => {
    const wob = Math.round(2 * Math.sin(x * 0.07 + s3));
    if (d < 2) return '#45d483';
    if (d < 4) return '#2fb56a';
    if (d < 22 + wob) return '#6a3d5c';
    if (d < 48 + wob) return '#55304c';
    return '#432640';
  };
  for (let x = 0; x < GRID_W; x++) {
    const drip = rnd() < 0.3 ? 1 : 0;
    for (let y = H[x]; y < GRID_H - 12; y++) {
      const d = y - H[x];
      P.put(x, y, S, d === 4 && drip ? '#2fb56a' : soil(x, d));
    }
  }
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rnd() * GRID_W);
    const y = H[x] + 10 + Math.floor(rnd() * Math.max(1, GRID_H - 24 - H[x]));
    const r = 1.5 + rnd() * 3;
    P.disc(x, y, r, null, '#7d5b73');
    P.put(Math.round(x - r / 2), Math.round(y - r / 2), null, '#95738a');
  }
  bedrock(P, rnd, '#1d1128', '#28182f');

  // Trees are burnable background structure: set them on fire or cut the trunk.
  P.over(() => {
    for (const x of [130, 300, 512, 684]) {
      const g = H[x];
      P.rect(x - 2, g - 28, x + 2, g, MAT_BEAM, '#3b2433');
      P.disc(x, g - 34, 12, MAT_BEAM, '#236048');
      P.disc(x - 8, g - 27, 8, MAT_BEAM, '#236048');
      P.disc(x + 8, g - 28, 8, MAT_BEAM, '#236048');
      P.disc(x - 3, g - 38, 6, null, '#2e7a58');
      P.disc(x + 5, g - 31, 3, null, '#2e7a58');
    }
  });

  // Background props first so they never overwrite ground.
  P.behind(() => {
    for (const x of [356, 452]) {
      const g = H[x];
      P.rect(x - 5, g - 44, x + 5, g, D, '#4f4266');
      P.rect(x - 7, g - 48, x + 7, g - 44, D, '#5f5178');
      P.rect(x - 5, g - 44, x - 3, g, D, '#5f5178');
      P.rect(x + 1, g - 30, x + 5, g - 26, D, '#3d3252');
    }
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(rnd() * GRID_W);
      const hgt = 1 + Math.floor(rnd() * 3);
      P.rect(x, H[x] - hgt, x + 1, H[x], D, rnd() < 0.5 ? '#2fb56a' : '#45d483');
    }
  });

  // Solid boulders as cover.
  for (const x of [238, 566]) {
    const g = H[x];
    P.disc(x, g - 5, 10, MAT_ROCK, '#6e5a7e');
    P.disc(x - 3, g - 9, 4, null, '#85709a');
  }

  // Floating islands, each on an unbreakable rock core.
  for (const [cx, cy, w] of [
    [180, 230, 60],
    [620, 230, 60],
    [400, 150, 50],
  ]) {
    const half = w / 2;
    for (let x = cx - half; x < cx + half; x++) {
      const t = (x - cx) / half;
      const depth = Math.round((1 - t * t) * w * 0.4 + rnd() * 2) + 4;
      for (let d = 0; d < depth; d++) {
        const col = d < 2 ? '#45d483' : d < 4 ? '#2fb56a' : d < depth - 3 ? '#6a3d5c' : '#55304c';
        P.put(x, cy + d, S, col);
      }
      if (rnd() < 0.18) P.behind(() => P.rect(x, cy + depth, x + 1, cy + depth + 2 + Math.floor(rnd() * 5), D, '#2e7a58'));
    }
    islandCore(P, cx, cy, w);
  }

  // Wooden one-way ledges on posts.
  for (const [x0, x1, y] of [
    [226, 300, 310],
    [500, 574, 310],
    [30, 100, 252],
    [700, 770, 252],
  ]) {
    ledge(P, x0, x1, y, (px) => H[Math.max(0, Math.min(GRID_W - 1, px))]);
  }

  // King of the hill: a two-storey tower on the crest, rope bridges from both side islands to
  // its roof (a cell short of the islands so they keep their own anchor), houses on the
  // plateaus, stone keeps in the valleys, brick walls on the slopes, crates under the ledges and
  // on the islands. No explosives anywhere.
  const top = (x0, x1) => {
    let g = GRID_H;
    for (let x = x0; x < x1; x++) g = Math.min(g, H[x]);
    return g;
  };
  const gy = top(380, 420);
  tower(P, 400, gy, 2, 18);
  const roof = gy - 72;
  bridge(P, 211, 230, 380, roof, [216, 330]);
  bridge(P, 420, roof, 589, 230, [467, 581]);
  for (const side of [1, -1]) {
    const m = (x, w = 0) => (side > 0 ? x : GRID_W - x - w);
    const hx = m(42, 44);
    const hg = top(hx, hx + 44);
    footing(P, hx, hx + 44, hg);
    house(P, hx, hx + 44, hg, side, 38);
    const bx = m(314, 30);
    const bg = top(bx, bx + 30);
    footing(P, bx, bx + 30, bg);
    brickWall(P, bx, bx + 30, bg, 16);
    const cx = m(257, 10);
    const cg = top(cx, cx + 10);
    footing(P, cx, cx + 10, cg);
    crate(P, cx, cg, 10);
    const kx = m(170);
    keep(P, kx, top(kx - 20, kx + 20), 1, 18, side);
    crateStack(P, m(152, 20), 230, 2, 10);
  }
}
