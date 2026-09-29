// Shared simulation constants. Movement values mirror destroy.spritefusion.com.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAP_EVERY = 2; // 30 Hz snapshots
export const INTERP_TICKS = 6; // remote players are drawn 100 ms in the past
export const MAX_REWIND = 24; // lag compensation cap (400 ms)

export const CELL = 2; // world px per terrain cell
export const WORLD_W = 1600;
export const WORLD_H = 900;
export const GRID_W = WORLD_W / CELL;
export const GRID_H = WORLD_H / CELL;

export const MAT_EMPTY = 0;
export const MAT_SOLID = 1;
export const MAT_PLATFORM = 2; // one-way
export const MAT_BEDROCK = 3; // indestructible
export const MAT_DECOR = 4; // background, no collision, destructible
// Sandbox materials (see materials.js for their properties).
export const MAT_SAND = 5;
export const MAT_WOOD = 6;
export const MAT_METAL = 7;
export const MAT_GLASS = 8;
export const MAT_BEAM = 9;
export const MAT_ROCK = 10;
export const MAT_TNT = 11;
export const MAT_PLANK = 12;
export const MAT_ANCHOR = 13;
export const MAT_BUILD = 14; // builder pieces: static, never fall, never crumble

export const BTN = { LEFT: 1, RIGHT: 2, JUMP: 4, DOWN: 8, FIRE: 16, ALT: 32, SPRINT: 64 };
export const BTN_MASK = 127;

export const PHYS = {
  RUN: 275,
  JET_RUN: 350,
  GROUND_ACC: 3600,
  GROUND_BRAKE: 4600,
  GROUND_OVER: 1800,
  JET_ACC_STEER: 2300,
  JET_ACC: 900,
  AIR_ACC_STEER: 1650,
  AIR_ACC: 700,
  OVER_ACC: 200,
  JUMP_BUF: 0.12,
  COYOTE: 0.09,
  JUMP_V: 650,
  FLIP_V: 700, // air jump: a full-strength boost, not cut by releasing the key
  FLIPS: 1,
  FLIP_TIME: 0.36,
  GRAV: 1900,
  GRAV_RISE_HOLD: 0.92,
  GRAV_FALL: 1.12,
  MAX_FALL: 1150,
  MAX_FALL_DROP: 1250,
  DROP_GRAV: 0.6,
  JET_HOLD: 0.12,
  JET_VY: -150,
  JET_LONG: 0.45,
  JET_IGNITE: 0.14,
  JET_THRUST: 3700,
  JET_MAX_UP: 430,
  JET_DAMP: 8,
  JET_K_ON: 11,
  JET_K_OFF: 7,
  HALF_W: 6,
  HEIGHT: 58,
  STEP_UP: 7,
  STEP_DOWN: 9,
  DROP_T: 0.22,
  AIM_Y: 40,
  CEIL_Y: -140,
  MAX_SPEED: 1400,
  SPRINT: 1.55, // ground speed multiplier while sprinting
};

export const HITBOX = { HW: 8, H: 58 };

export const RULES = {
  HP: 100,
  RESPAWN: 1.5,
  SHIELD: 1,
  FUEL: 100,
  FUEL_DRAIN: 30,
  FUEL_REGEN: 90,
  FUEL_DELAY: 0.2,
  COUNTDOWN: 2,
  CRATE_FIRST: 5,
  CRATE_EVERY: 9,
  CRATE_LIFE: 30,
  CRATE_HEAL: 40,
  GOALS: [3, 5, 10],
  SELF_DAMAGE: 0.4,
  STAMINA: 100,
  STAMINA_DRAIN: 22,
  STAMINA_REGEN: 36,
  STAMINA_DELAY: 0.5,
  AMMO_FIRST: 3,
  AMMO_EVERY: 5,
  AMMO_LIFE: 25,
  ARMORY_EVERY: 20, // 1v1: default seconds between weapon unlocks
  ARMORY_CHOICES: [10, 20, 40, 0], // 0 = no armory drops
};

export const PLAYER_COLORS = ['#ff7b22', '#ff4d9d'];
export const CREW_COLORS = ['#ff7b22', '#ff4d9d', '#f4f1ff', '#4d8bff']; // co-op survival humans
