import { GRID_H, GRID_W } from '../constants.js';
import { measureText } from '../font.js';
import { D, MAT_GLASS, MAT_METAL, MAT_WOOD, S, bedrock, core } from './painter.js';
import { arch, brickWall, bridge, crate, crateStack, glassCase, house, tower } from './props.js';

// A destroyable startup landing page.
export function buildLanding(P, rnd) {
  const NAVY = '#1c1936';
  const ORANGE = '#ff7b22';
  const WHITE = '#ffffff';

  // Page background (decor: bullets fly through it, explosions punch holes to the sky).
  P.rect(12, 8, 788, 20, D, '#2b2640');
  P.disc(20, 14, 2, D, '#ff5f57');
  P.disc(27, 14, 2, D, '#febc2e');
  P.disc(34, 14, 2, D, '#28c840');
  P.round(44, 10, 250, 19, 3, D, '#3d3759');
  P.text('HTTPS://STICKCO.DEV', 52, 11, 1, null, '#b8afd8');
  P.rect(12, 20, 788, 196, D, '#fff1e4');
  P.rect(12, 196, 788, 286, D, '#f7f3ee');
  P.rect(12, 286, 788, 392, D, '#efe7f8');
  for (let y = 292; y < 390; y += 8) for (let x = 18; x < 784; x += 8) P.put(x, y, D, '#e0d4f0');
  P.disc(92, 92, 30, D, '#ffe3cb');
  P.disc(706, 78, 36, D, '#ffe3cb');
  P.disc(646, 150, 14, D, '#ffd9ea');
  P.disc(150, 168, 10, D, '#ffd9ea');
  for (let i = 0; i < 14; i++) {
    const x = 30 + Math.floor(rnd() * 740);
    const y = 46 + Math.floor(rnd() * 140);
    if (x > 280 && x < 520 && y < 140) continue;
    P.rect(x - 1, y, x + 2, y + 1, D, '#ffc9a3');
    P.rect(x, y - 1, x + 1, y + 2, D, '#ffc9a3');
  }

  // Nav bar.
  P.round(150, 26, 650, 40, 3, MAT_GLASS, WHITE);
  P.rect(152, 39, 648, 40, null, '#e6dbcf');
  P.round(158, 29, 168, 37, 2, null, ORANGE);
  P.text('STICKCO', 172, 30, 1, null, NAVY);
  P.text('HOME', 300, 30, 1, null, '#7d7394');
  P.text('PRICING', 330, 30, 1, null, '#7d7394');
  P.text('BLOG', 376, 30, 1, null, '#7d7394');
  P.text('DOCS', 406, 30, 1, null, '#7d7394');
  P.round(590, 28, 644, 38, 2, null, NAVY);
  P.textCenter('SIGN UP', 617, 30, 1, null, WHITE);

  // Hero title with an orange extrude.
  const title = 'DESTROY';
  const tx = Math.round(400 - measureText(title, 5) / 2);
  P.text(title, tx + 2, 60, 5, S, ORANGE);
  P.text(title, tx + 1, 59, 5, S, ORANGE);
  P.text(title, tx, 58, 5, S, NAVY);
  P.textCenter('THE LANDING PAGE THAT SHOOTS BACK', 400, 104, 1, D, '#8f86a3');

  P.plat(322, 120, 396, 134, 3, ORANGE);
  P.rect(324, 132, 394, 134, null, '#d95f10');
  P.textCenter('PLAY NOW', 359, 124, 1, null, WHITE);
  P.plat(404, 120, 478, 134, 3, WHITE);
  P.frame(404, 120, 478, 134, NAVY);
  P.textCenter('LEARN MORE', 441, 124, 1, null, NAVY);

  // Cookie banners (mirrored). The OK button is an unbreakable block, so the banner spawns always
  // keep something to stand on.
  for (const x0 of [24, 670]) {
    const ok = x0 < 400 ? x0 + 87 : x0 + 4;
    P.plat(x0, 150, x0 + 106, 166, 3, WHITE);
    P.frame(x0, 150, x0 + 106, 166, '#e2d9cf');
    P.text('WE USE COOKIES', x0 < 400 ? x0 + 6 : x0 + 24, 155, 1, null, '#5c5470');
    P.round(ok, 153, ok + 15, 163, 2, S, '#6c4cff');
    P.textCenter('OK', ok + 7, 155, 1, null, WHITE);
    core(P, ok, 153, ok + 15, 163, null);
  }

  // Feature cards (solid cover).
  const cards = [
    [60, 'FAST', ORANGE],
    [335, 'SAFE', '#ff4d9d'],
    [610, 'FREE', '#19b9a8'],
  ];
  for (const [x0, label, accent] of cards) {
    const x1 = x0 + 130;
    P.round(x0 + 3, 209, x1 + 3, 261, 4, D, '#eadfd2');
    P.round(x0, 206, x1, 258, 4, S, WHITE);
    for (let x = x0 + 4; x < x1 - 4; x++) {
      P.put(x, 206, null, '#e6ddd2');
      P.put(x, 257, null, '#e6ddd2');
    }
    P.disc(x0 + 18, 223, 9, null, accent);
    P.text('►', x0 + 16, 220, 1, null, WHITE);
    P.text(label, x0 + 34, 216, 2, null, NAVY);
    P.rect(x0 + 12, 238, x1 - 12, 241, null, '#e3dcea');
    P.rect(x0 + 12, 245, x1 - 34, 248, null, '#e3dcea');
    P.rect(x0 + 12, 252, x1 - 60, 254, null, accent);
    // Unbreakable core under the top edge and a keel below it: the card can be chipped away
    // but never falls or vanishes.
    core(P, x0 + 16, 208, x1 - 16, 214, null);
    core(P, x0 + 44, 214, x1 - 44, 232, null);
  }

  // Search bar.
  P.plat(330, 300, 470, 312, 3, WHITE);
  P.frame(330, 300, 470, 312, '#cfc4dd');
  P.text('SEARCH...', 338, 303, 1, null, '#a79fb8');
  P.ring(456, 305, 3, NAVY);
  P.put(459, 308, null, NAVY);
  P.put(460, 309, null, NAVY);

  // Loading bar: a glass tube around a wooden progress bar. Crack it and it drops, light it and
  // the progress burns away.
  P.round(330, 280, 470, 294, 2, MAT_GLASS, '#cfeeff');
  for (let y = 282; y < 292; y++) {
    for (let x = 332; x < 468; x++) P.put(x, y, MAT_WOOD, x < 430 ? ((x >> 2) % 2 ? ORANGE : '#ff9a4d') : '#f4e3d3');
  }

  // Tag chips on the sides.
  P.plat(40, 320, 110, 330, 3, '#ffd24d');
  P.textCenter('NEW!', 75, 322, 1, null, NAVY);
  P.plat(690, 320, 760, 330, 3, '#45d483');
  P.textCenter('SALE', 725, 322, 1, null, WHITE);

  // Low cover blocks.
  P.round(200, 356, 244, 392, 3, MAT_METAL, '#6c4cff');
  P.rect(200, 388, 244, 392, null, '#5238cc');
  P.textCenter('404', 222, 366, 2, null, WHITE);
  P.round(556, 356, 600, 392, 3, MAT_METAL, '#19b9a8');
  P.rect(556, 388, 600, 392, null, '#11927f');
  P.textCenter('$0', 578, 366, 2, null, WHITE);

  // Footer and bedrock.
  P.rect(0, 392, GRID_W, GRID_H - 12, S, NAVY);
  P.rect(0, 392, GRID_W, 394, null, '#2f2a52');
  P.textCenter('ABOUT   BLOG   JOBS   PRESS   TERMS', 400, 404, 1, null, '#6f6891');
  P.textCenter('(C) 2026 STICKCO - ALL WRONGS RESERVED', 400, 419, 1, null, '#4f4872');
  bedrock(P, rnd, '#120f22', '#1b1731');

  props(P);
}

// Destructible set pieces, mirrored on both halves (the footer is the ground at row 392).
// Spawns stand on the chips, the cookie banners, the 404/$0 blocks and the floor at x 400:
// nothing here covers them. No explosives: everything here is cover to wreck.
function props(P) {
  for (const side of [1, -1]) {
    const m = (x, w = 0) => (side > 0 ? x : GRID_W - x - w);
    house(P, m(16, 48), m(16, 48) + 48, 392, side, 34);
    tower(P, m(172), 392, 2, 16);
    crateStack(P, m(112, 30), 392, 3, 10);
    brickWall(P, m(258, 30), m(258, 30) + 30, 392, 14);
    crate(P, m(300, 11), 392, 11);
    crateStack(P, m(318, 20), 392, 2, 10);
    arch(P, m(342, 30), m(342, 30) + 30, 392, 24);
    crate(P, m(40, 10), 150, 10);
    // Scaffold bridges between the feature cards, propped on stilts from the floor.
    bridge(P, m(192, 142), 206, m(192, 142) + 142, 206, [m(250, 3), m(292, 3)]);
  }
  // Showcase on the middle card: a glass case with a crate pyramid inside.
  glassCase(P, 386, 414, 206, 26);
  crateStack(P, 391, 204, 2, 9);
}
