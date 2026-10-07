import { MAT_SAND } from '../constants.js';
import { D, MAT_BEAM, MAT_BEDROCK, MAT_EMPTY, MAT_METAL, MAT_PLANK, MAT_ROCK, S, bedrock, core } from './painter.js';
import { crate, crateStack } from './props.js';

// Underground duel: the map is a solid block of earth with a bunker buried on each side. Nobody
// sees anybody at the start: dig tunnels (flamer, shove, explosives) or risk the open surface.
// Pre-dug galleries show a cave wall; fresh holes open to the sky. Mirrored halves, no explosives.
const WALL = ['#1f1a24', '#241e2a', '#1b1620'];
const EARTH = ['#8a8a96', '#7d7d8a', '#94949f'];
const DEEP = ['#6c6878', '#625e6e', '#716d7d'];
const ROCK = '#4a4658';
const ROCK_L = '#5c586c';
const WOOD = '#b9854a';
const WOOD_D = '#8a5a2e';
const SURFACE = 62;

export function buildMine(P, rnd) {
  const { w, h } = P.t;
  const floor = h - 12;
  const s1 = rnd() * 6.28;
  const H = new Int16Array(w);
  for (let x = 0; x < w; x++) H[x] = Math.round(SURFACE + 2 * Math.sin(x * 0.03 + s1) + Math.sin(x * 0.11));

  for (let x = 0; x < w; x++) {
    for (let y = H[x]; y < floor; y++) {
      const d = y - H[x];
      const pal = d < 150 ? EARTH : DEEP;
      const hex = d < 2 ? '#c9c9d3' : pal[((x >> 2) * 7 + (y >> 2) * 3 + ((x * y) & 3)) % 3];
      P.put(x, y, S, hex);
    }
  }
  // Brick-like block seams so the earth reads as stacked stone blocks.
  for (let y = SURFACE + 8; y < floor; y += 12) {
    for (let x = 0; x < w; x++) P.put(x, y, null, '#5d5a68');
    const off = (y / 12) & 1 ? 0 : 10;
    for (let x = off; x < w; x += 20) for (let k = 1; k < 12; k++) P.put(x, y + k, null, '#5d5a68');
  }
  bedrock(P, rnd, '#15121b', '#1d1924');
  // Side walls: nobody digs around the map edge.
  P.rect(0, SURFACE - 6, 4, floor, MAT_BEDROCK, '#15121b');
  P.rect(w - 4, SURFACE - 6, w, floor, MAT_BEDROCK, '#15121b');

  const half = [];
  for (const side of [1, -1]) half.push((x, x1 = x) => (side > 0 ? [x, x1] : [w - x1, w - x]));

  // Hard rock veins: slower to dig, they bend the tunnels.
  for (let i = 0; i < 9; i++) {
    const x = 120 + Math.floor(rnd() * 170);
    const y = SURFACE + 40 + Math.floor(rnd() * 300);
    const r = 5 + rnd() * 9;
    for (const m of half) {
      const [cx] = m(x);
      P.disc(cx, y, r, MAT_ROCK, ROCK);
      P.disc(cx - r / 3, y - r / 3, r / 3, null, ROCK_L);
    }
  }
  // Sand pockets: dig under one and it pours into your tunnel.
  for (const [x, y, r] of [
    [230, 180, 9],
    [330, 330, 8],
    [170, 270, 7],
  ]) {
    for (const m of half) {
      const [cx] = m(x);
      P.disc(cx, y, r, MAT_SAND, '#d8b56a');
      P.disc(cx, y, r + 2, null, '#e3c37c');
      P.disc(cx, y, r, null, '#d8b56a');
    }
  }

  for (const m of half) {
    // Bunker: a stone room with a plank loft, metal plates on the side facing the enemy.
    const [bx0, bx1] = m(24, 124);
    const top = 322;
    const bot = 392;
    for (let y = top; y < bot; y++) for (let x = bx0; x < bx1; x++) P.put(x, y, D, WALL[(x + y * 2) % 3]);
    const [fx0, fx1] = m(20, 128);
    P.rect(fx0, bot, fx1, bot + 6, MAT_ROCK, ROCK);
    P.rect(fx0, bot, fx1, bot + 1, null, ROCK_L);
    core(P, fx0 + 10, bot, fx1 - 10, bot + 6, null);
    const [mx0, mx1] = m(124, 128);
    P.rect(mx0, top - 4, mx1, bot, MAT_METAL, '#8f9bb0');
    for (let y = top; y < bot; y += 10) P.rect(mx0, y, mx1, y + 1, null, '#6d7890');
    // Loft on beams.
    const [lx0, lx1] = m(60, 124);
    P.plat(lx0, 356, lx1, 360, 0, WOOD, 2, MAT_PLANK, MAT_BEAM);
    P.rect(lx0, 359, lx1, 360, null, WOOD_D);
    const [px] = m(90, 92);
    P.rect(px, 360, px + 2, bot, MAT_BEAM, WOOD_D);
    const [cx] = m(30, 42);
    crateStack(P, cx, bot, 2, 10);
    lantern(P, m(74)[0], top + 3);

    // Mine shaft from the bunker roof toward the surface, cut short: finish it or dig your own.
    const [sx0, sx1] = m(40, 60);
    carveTunnel(P, sx0, 180, sx1, top);
    for (let y = 196; y < top; y += 26) {
      P.rect(sx0 - 1, y, sx1 + 1, y + 2, MAT_PLANK, WOOD);
      P.rect(sx0 - 1, y + 1, sx1 + 1, y + 2, null, WOOD_D);
    }
    // Side gallery toward the middle, braced with timber, ends in a dead end.
    const [gx0, gx1] = m(128, 236);
    carveTunnel(P, gx0, 350, gx1, bot);
    braces(P, gx0, gx1, 350, bot);
    // Upper gallery off the shaft.
    const [ux0, ux1] = m(60, 170);
    carveTunnel(P, ux0, 210, ux1, 250);
    braces(P, ux0, ux1, 210, 250);
    // A small cave halfway with a crate: cover for whoever gets there first.
    const [kx0, kx1] = m(262, 312);
    carveTunnel(P, kx0, 260, kx1, 300);
    crate(P, m(280, 290)[0], 300, 10);
  }

  // Middle cavern with an unbreakable pillar: whoever breaks in first holds the high ground.
  carveTunnel(P, 360, 300, 440, 360);
  P.rect(392, 330, 408, 360, MAT_ROCK, ROCK);
  P.rect(392, 330, 408, 331, null, ROCK_L);
  core(P, 394, 334, 406, 360, null);
  lantern(P, 400, 303);
  crateStack(P, 364, 360, 2, 9);
  crateStack(P, 418, 360, 2, 9);

  // Surface: bare and exposed, a few stone blocks and the crate drops land here.
  for (const x of [150, 330, 470, 650]) {
    const g = Math.min(H[x], H[x + 16]);
    P.rect(x, g - 12, x + 16, g, MAT_ROCK, ROCK_L);
    P.frame(x, g - 12, x + 16, g, ROCK);
  }
  crate(P, 394, Math.min(H[394], H[405]), 12);
}

// Clears a rectangle of earth back to the cave wall.
function carveTunnel(P, x0, y0, x1, y1) {
  const t = P.t;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * t.w + x;
      if (t.mat[i] === MAT_EMPTY || t.mat[i] === D) continue;
      P.put(x, y, D, WALL[(x + y * 2) % 3]);
    }
  }
}

// Timber frames every few cells along a gallery: burnable, they only prop up the look.
function braces(P, x0, x1, y0, y1) {
  for (let x = x0 + 6; x < x1 - 4; x += 28) {
    P.rect(x, y0 + 1, x + 2, y1, MAT_BEAM, WOOD_D);
    P.rect(x - 3, y0, x + 5, y0 + 2, MAT_BEAM, WOOD);
  }
}

function lantern(P, x, y) {
  P.rect(x, y - 3, x + 1, y, D, '#3a3040');
  P.rect(x - 1, y, x + 2, y + 3, D, '#ffcf5a');
  P.put(x, y + 1, D, '#fff1b8');
}
