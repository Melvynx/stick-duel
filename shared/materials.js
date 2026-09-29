import {
  MAT_ANCHOR, MAT_BEAM, MAT_BEDROCK, MAT_BUILD, MAT_DECOR, MAT_EMPTY, MAT_GLASS, MAT_METAL, MAT_PLANK,
  MAT_PLATFORM, MAT_ROCK, MAT_SAND, MAT_SOLID, MAT_TNT, MAT_WOOD,
} from './constants.js';

// Material property tables, indexed by material id. Every terrain query goes through these
// typed arrays so adding a material is one row here.
const N = 16;
export const COLLIDE = new Uint8Array(N); // stops players
export const SHOT = new Uint8Array(N); // stops bullets and projectiles
export const ONEWAY = new Uint8Array(N); // stand on top, pass from below
export const PASS = new Uint8Array(N); // free space for sand and falling bodies
export const BURN = new Uint8Array(N); // catches fire
export const STRUCT = new Uint8Array(N); // takes part in structural support
export const ANCHOR = new Uint8Array(N); // holds a structure in place
export const HARD = new Float32Array(N); // carve radius multiplier (0 = indestructible)
export const CRUMBLE = new Uint8Array(N); // turns to rubble at the edge of blasts

const T = { collide: 1, shot: 1, struct: 1, hard: 1 };
const rows = {
  [MAT_EMPTY]: { pass: 1, hard: 0 },
  [MAT_DECOR]: { pass: 1, hard: 1 },
  [MAT_SOLID]: { ...T, crumble: 1 },
  [MAT_PLATFORM]: { shot: 1, oneway: 1, struct: 1, hard: 1 },
  [MAT_BEDROCK]: { collide: 1, shot: 1, anchor: 1, struct: 1, hard: 0 },
  [MAT_SAND]: { collide: 1, shot: 1, hard: 1.25 },
  [MAT_WOOD]: { ...T, burn: 1 },
  [MAT_METAL]: { ...T, hard: 0.45 },
  [MAT_GLASS]: { ...T, hard: 1.7, crumble: 1 },
  [MAT_BEAM]: { struct: 1, burn: 1, hard: 1 },
  [MAT_ROCK]: { ...T, hard: 0.7, crumble: 1 },
  [MAT_TNT]: { ...T, burn: 1 },
  [MAT_PLANK]: { shot: 1, oneway: 1, struct: 1, burn: 1, hard: 1 },
  [MAT_ANCHOR]: { ...T, anchor: 1, hard: 0.35 },
  // Builder pieces stay where they were placed: outside the structure graph, so they never fall
  // and never hold map structures up, but falling pieces and sand land on them.
  [MAT_BUILD]: { collide: 1, shot: 1, hard: 0.75 },
};
for (const [m, r] of Object.entries(rows)) {
  COLLIDE[m] = r.collide | 0;
  SHOT[m] = r.shot | 0;
  ONEWAY[m] = r.oneway | 0;
  PASS[m] = r.pass | 0;
  BURN[m] = r.burn | 0;
  STRUCT[m] = r.struct | 0;
  ANCHOR[m] = r.anchor | 0;
  HARD[m] = r.hard ?? 1;
  CRUMBLE[m] = r.crumble | 0;
}

// Cheap deterministic integer hash, identical on server and browser.
export function hash3(x, y, t) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(t | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return (h ^ (h >>> 16)) >>> 0;
}
