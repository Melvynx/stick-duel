import { GRID_H, GRID_W } from './constants.js';
import { buildLanding } from './maps/landing.js';
import { buildOutpost } from './maps/outpost.js';
import { Painter, S, bedrock } from './maps/painter.js';
import { buildRidge } from './maps/ridge.js';
import { CRYSTAL, pal } from './palette.js';
import { mulberry32 } from './rng.js';
import { pinFloating } from './sim.js';
import { Terrain } from './terrain.js';

// Maps are built procedurally from (id, seed) so server and clients get identical grids
// without shipping terrain data. Builders live in ./maps/, one file per map.
export { PALETTE, pal } from './palette.js';

function buildFlat(P, rnd) {
  P.rect(0, 400, GRID_W, GRID_H - 12, S, '#55304c');
  P.rect(0, 400, GRID_W, 403, null, '#45d483');
  bedrock(P, rnd, '#1d1128', '#28182f');
}

// Spawns are [x, scanY] in world px: the player stands on the first ground below scanY.
// The first two are the match start positions for slot 0 and slot 1.
export const MAPS = {
  landing: {
    name: 'LANDING PAGE',
    crystals: false,
    build: buildLanding,
    spawns: [
      [140, 560],
      [1460, 560],
      [800, 500],
      [444, 600],
      [1156, 600],
      [250, 300],
      [1350, 300],
    ],
  },
  ridge: {
    name: 'DUSK RIDGE',
    build: buildRidge,
    spawns: [
      [120, 400],
      [1480, 400],
      [800, 100],
      [360, 300],
      [1240, 300],
    ],
  },
  outpost: {
    name: 'OUTPOST',
    w: 1200,
    h: 600,
    build: buildOutpost,
    spawns: [
      [180, 700],
      [2220, 700],
      [1200, 400],
      [480, 500],
      [1920, 500],
      [840, 300],
      [1560, 300],
      [120, 500],
      [2280, 500],
      [700, 800],
      [1700, 800],
    ],
  },
  flat: {
    name: 'FLAT',
    hidden: true,
    build: buildFlat,
    spawns: [
      [400, 0],
      [1200, 0],
    ],
  },
};

export const MAP_IDS = Object.keys(MAPS).filter((id) => !MAPS[id].hidden);

export function buildMap(id, seed) {
  const def = MAPS[id] ? MAPS[id] : MAPS.landing;
  const terrain = new Terrain(def.w, def.h);
  const P = new Painter(terrain);
  def.build(P, mulberry32(seed >>> 0));
  pinFloating(terrain, CRYSTAL.map(pal), def.crystals !== false);
  // `cores`: indestructible cell rects [x0, y0, x1, y1] under islands and key platforms.
  return { id: MAPS[id] ? id : 'landing', name: def.name, terrain, spawns: def.spawns, cores: P.cores };
}
