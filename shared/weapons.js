import { shotRng } from './rng.js';

// Stats follow destroy.spritefusion.com for the original seven; the rest are sandbox tools.
// Indices are part of the wire format, so new weapons are only ever appended.
// `push` is shooter recoil (px/s), `hold` and `muzzle` are world px from the shoulder,
// `ammo` is per life (-1 = infinite; continuous tools count ticks).
export const WEAPONS = [
  {
    id: 'pistol', name: 'PISTOL', kind: 'bullet', auto: false, cd: 0.16, speed: 2300, spread: 0.012,
    pellets: 1, dmg: 22, carve: 6, push: 0, kick: 4, shake: 0.12, ammo: -1, hold: 16, muzzle: 38, casing: true,
  },
  {
    id: 'smg', name: 'SMG', kind: 'bullet', auto: true, cd: 0.068, speed: 2000, spread: 0.07,
    pellets: 1, dmg: 9, carve: 4, push: 14, kick: 2, shake: 0.07, ammo: 120, hold: 14, muzzle: 44, casing: true,
  },
  {
    id: 'shotgun', name: 'SHOTGUN', kind: 'bullet', auto: false, cd: 0.62, speed: 1750, spread: 0.17,
    pellets: 10, dmg: 11, carve: 5, push: 230, kick: 7, shake: 0.42, ammo: 14, hold: 14, muzzle: 52, casing: true,
  },
  {
    id: 'rocket', name: 'ROCKET', kind: 'rocket', auto: false, cd: 0.85, speed: 420,
    push: 120, kick: 6, shake: 0.3, ammo: 6, hold: 12, muzzle: 50,
  },
  {
    id: 'rail', name: 'RAILGUN', kind: 'rail', auto: false, cd: 1.1, dmg: 80,
    push: 260, kick: 9, shake: 0.55, ammo: 5, hold: 14, muzzle: 54,
  },
  {
    id: 'flame', name: 'FLAMER', kind: 'flame', auto: true, cd: 0, speed: 560, spread: 0.1, dps: 42,
    push: 0, kick: 1, shake: 0.03, ammo: 300, hold: 14, muzzle: 50,
  },
  {
    id: 'toomuch', name: 'TOO MUCH', kind: 'mirv', auto: false, cd: 1.9, speed: 760,
    push: 300, kick: 10, shake: 0.7, ammo: 1, hold: 12, muzzle: 56,
  },
  {
    id: 'cutter', name: 'CUTTER', kind: 'beam', auto: true, cd: 0, dps: 55,
    push: 0, kick: 0, shake: 0.02, ammo: 420, hold: 14, muzzle: 46,
  },
  {
    id: 'builder', name: 'BUILDER', kind: 'build', auto: true, cd: 0.13,
    push: 0, kick: 1, shake: 0.03, ammo: 60, hold: 12, muzzle: 40,
  },
  {
    id: 'sand', name: 'SANDSTORM', kind: 'spray', auto: true, cd: 0,
    push: 0, kick: 0, shake: 0.02, ammo: 480, hold: 14, muzzle: 46,
  },
  {
    id: 'c4', name: 'C4', kind: 'c4', auto: false, cd: 0.35, speed: 520,
    push: 0, kick: 2, shake: 0.05, ammo: 4, hold: 10, muzzle: 30,
  },
  {
    id: 'quake', name: 'QUAKE', kind: 'quake', auto: false, cd: 1.3, speed: 640,
    push: 160, kick: 8, shake: 0.4, ammo: 3, hold: 12, muzzle: 48,
  },
  // One-shot headshots (`head` multiplies hits in the top of the box); the scope drags the camera.
  {
    id: 'sniper', name: 'SNIPER', kind: 'bullet', auto: false, cd: 1.05, speed: 5200, spread: 0,
    pellets: 1, dmg: 70, head: 1.5, carve: 6, push: 70, kick: 9, shake: 0.4, ammo: 10, hold: 16, muzzle: 64, casing: true,
  },
  {
    id: 'rifle', name: 'AK-47', kind: 'bullet', auto: true, cd: 0.088, speed: 2400, spread: 0.045,
    pellets: 1, dmg: 15, carve: 6, push: 12, kick: 5, shake: 0.13, ammo: 180, hold: 30, muzzle: 56, casing: true,
  },
];

export const W = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

// Kill-feed ids past the weapon list.
export const NADE_W = WEAPONS.length;
export const CRUSH_W = NADE_W + 1;
export const FIRE_W = NADE_W + 2;
export const TNT_W = NADE_W + 3;
export const KILL_NAMES = [...WEAPONS.map((w) => w.name), 'GRENADE', 'DEBRIS', 'FIRE', 'TNT'];

// Hotbar and unlock order of every weapon a player can get. The pistol is always owned.
// SANDSTORM, QUAKE and CUTTER are retired: they keep their `WEAPONS` index (wire format) but are
// never selectable, granted or shown.
export const UNLOCKS = ['pistol', 'smg', 'shotgun', 'builder', 'rifle', 'sniper', 'rocket', 'flame', 'rail', 'c4', 'toomuch']
  .map((id) => W[id]);
export const SELECTABLE = UNLOCKS;
export const START_OWNED = 1 << W.pistol;
export const ALL_OWNED = (1 << WEAPONS.length) - 1; // bots: every weapon, retired ones included
const maskOf = (ids) => ids.reduce((m, id) => m | (1 << W[id]), 0);

// Weapon pools ("allowed weapons"): a bitmask of SELECTABLE weapons. 1v1 players own the whole pool
// from the start; survival starts with the first 4 of it and unlocks the rest wave by wave.
export const FULL_POOL = UNLOCKS.reduce((m, w) => m | (1 << w), 0);
export const BASIC_POOL = maskOf(['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'rocket', 'rail', 'builder']);
export const POOLS = {
  all: { name: 'ALL WEAPONS', mask: FULL_POOL },
  basic: { name: 'BASIC', mask: BASIC_POOL },
};
export const POOL_IDS = Object.keys(POOLS);

// Keeps only selectable weapons and always the pistol. Accepts a mask or a preset id.
export function sanitizePool(pool, fallback = FULL_POOL) {
  if (typeof pool === 'string' && POOLS[pool]) return POOLS[pool].mask;
  const m = Number(pool);
  if (pool === null || pool === undefined || pool === '' || !Number.isInteger(m) || m < 0) return fallback;
  return (m & FULL_POOL) | START_OWNED;
}

// Weapons of `pool` in unlock order.
export const poolList = (pool) => UNLOCKS.filter((w) => (pool & (1 << w)) !== 0);

// Hotbar layout for `pool`: numbered weapons (keys 1..n) in unlock order, then the builder (key B).
export function poolBar(pool) {
  const list = poolList(pool);
  const nums = list.filter((w) => w !== W.builder);
  return { nums, slots: list.length > nums.length ? [...nums, W.builder] : nums };
}

// Survival starting arsenal: the first `n` weapons of the pool.
export const poolStart = (pool, n = 4) => poolList(pool).slice(0, n).reduce((m, w) => m | (1 << w), START_OWNED);

export const GRENADE = { cd: 0.55, fuse: 1.55, speed: 700, count: 3 };

// `r` blast radius, `w` kill-feed id. Every blast crumbles the rim; `fire` also sets it alight.
export const BOOMS = {
  rocket: { r: 46, dmg: 95, power: 1, w: W.rocket },
  grenade: { r: 50, dmg: 85, power: 1, w: NADE_W },
  mirv: { r: 46, dmg: 60, power: 1, w: W.toomuch },
  bomblet: { r: 30, dmg: 40, power: 0.7, w: W.toomuch },
  c4: { r: 60, dmg: 110, power: 1.15, w: W.c4, fire: 1 },
  quake: { r: 26, dmg: 45, power: 0.9, w: W.quake, quake: 110 },
  tnt: { r: 50, dmg: 100, power: 1.2, w: TNT_W, fire: 1 },
};

// The flamer melts terrain fast, shoves what it hits and pushes its user back (`thrust`, px/s²):
// aimed down it becomes a hover. It lights terrain rarely so maps do not turn into a fire pit.
// Against a wall it digs a body-sized tunnel: aimed sideways the cut spans `tunnel` px (head
// clearance above the jet, feet below) so the user can walk into the hole it melts.
export const FLAME = {
  range: 210, carveEvery: 2, carveR: 12, tunnel: [10, 30], igniteEvery: 14, hitEvery: 6, thrust: 1500, push: 170,
};
// F: a shove that breaks the terrain in front of the player (never bedrock) and knocks enemies back.
export const MELEE = { cd: 0.28, reach: 16, r: 16, dmg: 20, hitR: 30, push: 460 };
export const RAIL = { range: 2400, maxPen: 150, carve: 4 };
export const BEAM = { range: 300, carveEvery: 2, carveR: 4, hitEvery: 6 };
// Builder pieces (see shared/build.js): `block` brick size and `thick` piece thickness in cells,
// `tile` grid square in blocks (walls and floors are one tile long), `cursor` reach from the shoulder in px.
export const BUILD = { block: 6, tile: 6, thick: 4, cursor: 170 };
export const SPRAY = { reach: 120, every: 2, size: 3 };
export const C4 = { max: 4, stick: 1 };

// [angle, speed] per pellet, identical on client and server for a given (slot, seq).
export function pelletDirs(weapon, slot, seq, aim) {
  const w = WEAPONS[weapon];
  const rng = shotRng(slot, seq);
  const out = [];
  for (let i = 0; i < w.pellets; i++) {
    const a = aim + (rng() - 0.5) * 2 * w.spread;
    const sp = w.pellets > 1 ? w.speed * (0.85 + rng() * 0.3) : w.speed;
    out.push([a, sp]);
  }
  return out;
}

export function fullAmmo() {
  return WEAPONS.map((w) => w.ammo);
}

export const owns = (mask, w) => (mask & (1 << w)) !== 0;

// Continuous tools drain ammo per tick while the trigger is held.
export const CONTINUOUS = new Set(['flame', 'beam', 'spray']);
