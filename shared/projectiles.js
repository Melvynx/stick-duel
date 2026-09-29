import { CELL } from './constants.js';
import { mulberry32 } from './rng.js';
import { GRENADE } from './weapons.js';

// Physical projectiles, stepped by the server and extrapolated by clients with the same code.
// Shape: { id, k, o: owner slot, x, y, vx, vy, t: age, sq: fire input seq, fx, fy: last free point }
export const PROJ = { ROCKET: 1, GRENADE: 2, MIRV: 3, BOMBLET: 4, C4: 5, QUAKE: 6 };

export const ROCKET = { acc: 1500, max: 920, pad: 3 };
export const NADE = { grav: 1500, bounce: 0.42, friction: 0.75 };
export const MIRV = { grav: 700, split: 0.5, count: 8, pad: 3 };
export const BOMBLET = { grav: 900, chute: 0.22, fall: 110, sway: 40, pad: 4 };
export const QUAKE = { grav: 1100, pad: 4 };
export const STICKY = { grav: 1300, life: 90 };
export const MAX_AGE = 8;

// Result codes of stepProj.
export const ALIVE = 0;
export const HIT_WALL = 1;
export const TIMER = 2;
export const GONE = 3;

function moveStraight(pr, t, dt) {
  const dist = Math.hypot(pr.vx, pr.vy) * dt;
  const steps = Math.max(1, Math.ceil(dist / 3));
  const sx = (pr.vx * dt) / steps;
  const sy = (pr.vy * dt) / steps;
  for (let i = 0; i < steps; i++) {
    const nx = pr.x + sx;
    const ny = pr.y + sy;
    if (t.blocksShot(nx, ny)) {
      pr.fx = pr.x;
      pr.fy = pr.y;
      pr.x = nx;
      pr.y = ny;
      return HIT_WALL;
    }
    pr.x = nx;
    pr.y = ny;
  }
  pr.fx = pr.x;
  pr.fy = pr.y;
  return ALIVE;
}

function moveBouncy(pr, t, dt) {
  const steps = Math.max(1, Math.ceil((Math.max(Math.abs(pr.vx), Math.abs(pr.vy)) * dt) / 2));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const nx = pr.x + pr.vx * sdt;
    if (t.blocksShot(nx, pr.y)) pr.vx = -pr.vx * NADE.bounce;
    else pr.x = nx;
    const ny = pr.y + pr.vy * sdt;
    if (t.blocksShot(pr.x, ny)) {
      if (pr.vy > 0) pr.vx *= NADE.friction;
      pr.vy = -pr.vy * NADE.bounce;
      if (Math.abs(pr.vy) < 60) pr.vy = 0;
    } else {
      pr.y = ny;
    }
  }
  pr.fx = pr.x;
  pr.fy = pr.y;
}

// C4 sticks to the first surface it touches and drops again if that surface is blown away.
function stepSticky(pr, t, dt) {
  if (pr.st) {
    const r = 3;
    if (t.blocksShot(pr.x - r, pr.y) || t.blocksShot(pr.x + r, pr.y) || t.blocksShot(pr.x, pr.y - r) || t.blocksShot(pr.x, pr.y + r)) return;
    pr.st = 0;
  }
  pr.vy += STICKY.grav * dt;
  const steps = Math.max(1, Math.ceil((Math.max(Math.abs(pr.vx), Math.abs(pr.vy)) * dt) / 2));
  for (let i = 0; i < steps; i++) {
    const nx = pr.x + (pr.vx * dt) / steps;
    const ny = pr.y + (pr.vy * dt) / steps;
    if (t.blocksShot(nx, ny)) {
      pr.vx = 0;
      pr.vy = 0;
      pr.st = 1;
      break;
    }
    pr.x = nx;
    pr.y = ny;
  }
  pr.fx = pr.x;
  pr.fy = pr.y;
}

export function stepProj(pr, t, dt) {
  pr.t += dt;
  if (pr.k === PROJ.C4) {
    if (pr.t > STICKY.life || pr.y > t.h * CELL + 100) return GONE;
    stepSticky(pr, t, dt);
    return ALIVE;
  }
  if (pr.t > MAX_AGE || pr.y > t.h * CELL + 100 || pr.x < -50 || pr.x > t.w * CELL + 50) return GONE;
  switch (pr.k) {
    case PROJ.ROCKET: {
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      const ns = Math.min(ROCKET.max, sp + ROCKET.acc * dt);
      pr.vx *= ns / sp;
      pr.vy *= ns / sp;
      return moveStraight(pr, t, dt);
    }
    case PROJ.GRENADE:
      if (pr.t >= GRENADE.fuse) return TIMER;
      pr.vy += NADE.grav * dt;
      moveBouncy(pr, t, dt);
      return ALIVE;
    case PROJ.MIRV: {
      pr.vy += MIRV.grav * dt;
      if (moveStraight(pr, t, dt) === HIT_WALL) return HIT_WALL;
      return pr.t >= MIRV.split ? TIMER : ALIVE;
    }
    case PROJ.QUAKE:
      pr.vy += QUAKE.grav * dt;
      return moveStraight(pr, t, dt);
    case PROJ.BOMBLET: {
      if (pr.t < BOMBLET.chute) {
        pr.vy += BOMBLET.grav * dt;
      } else {
        pr.vy += (BOMBLET.fall - pr.vy) * Math.min(1, 6 * dt);
        const sway = Math.sin(pr.t * 3 + pr.id) * BOMBLET.sway;
        pr.vx += (sway - pr.vx) * Math.min(1, 3 * dt);
      }
      return moveStraight(pr, t, dt);
    }
    default:
      return GONE;
  }
}

// Eight parachute bomblets in an upward fan, deterministic per MIRV id.
export function mirvBomblets(pr, firstId) {
  const rng = mulberry32(Math.imul(pr.id, 7919) + 17);
  const out = [];
  const x = pr.fx ?? pr.x;
  const y = pr.fy ?? pr.y;
  for (let i = 0; i < MIRV.count; i++) {
    const a = -Math.PI / 2 + (i / (MIRV.count - 1) - 0.5) * 1.8 + (rng() - 0.5) * 0.15;
    const sp = 260 + rng() * 140;
    out.push({
      id: firstId + i, k: PROJ.BOMBLET, o: pr.o, x, y, fx: x, fy: y,
      vx: Math.cos(a) * sp + pr.vx * 0.15, vy: Math.sin(a) * sp, t: 0, sq: -1,
    });
  }
  return out;
}

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function packProj(pr) {
  return [pr.id, pr.k, pr.o, r1(pr.x), r1(pr.y), r1(pr.vx), r1(pr.vy), r3(pr.t), pr.sq, pr.st | 0];
}

export function unpackProj(a) {
  return { id: a[0], k: a[1], o: a[2], x: a[3], y: a[4], fx: a[3], fy: a[4], vx: a[5], vy: a[6], t: a[7], sq: a[8], st: a[9] | 0 };
}
