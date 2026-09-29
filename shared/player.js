import { BTN, CELL, DT, PHYS, RULES } from './constants.js';
import { CONTINUOUS, GRENADE, START_OWNED, WEAPONS, fullAmmo, owns } from './weapons.js';

// Player physics shared by the authoritative server and client-side prediction.
// Must stay deterministic: same state + input + terrain => same result.

const F_GROUNDED = 1;
const F_JET = 2;
const F_DEAD = 4;
const F_JUMPING = 8;
const F_FLAMING = 16;
const F_SPRINT = 32;

export function createPlayer(slot) {
  return {
    slot,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aim: slot === 0 ? 0 : Math.PI,
    grounded: false,
    jumping: false,
    coyote: 0,
    jumpBuf: 0,
    flips: PHYS.FLIPS,
    flipT: -1,
    jetHold: 0,
    jetOn: false,
    jetIgn: 0,
    jetK: 0,
    fuel: RULES.FUEL,
    fuelDelay: 0,
    dropT: 0,
    hp: RULES.HP,
    dead: true,
    respawnT: 0,
    shield: 0,
    w: 0,
    cd: 0,
    gcd: 0,
    fireBuf: 0,
    nades: GRENADE.count,
    ammo: fullAmmo(),
    btn: 0,
    flaming: false,
    stamina: RULES.STAMINA,
    stamDelay: 0,
    sprinting: false,
    owned: START_OWNED,
  };
}

export function resetLoadout(p) {
  p.hp = RULES.HP;
  p.ammo = fullAmmo();
  p.nades = GRENADE.count;
  p.fuel = RULES.FUEL;
  p.cd = 0;
  p.gcd = 0;
  p.vx = 0;
  p.vy = 0;
  p.jetOn = false;
  p.jetK = 0;
  p.flaming = false;
  p.flipT = -1;
  p.stamina = RULES.STAMINA;
  p.stamDelay = 0;
  p.sprinting = false;
  if (!owns(p.owned, p.w)) p.w = 0;
}

export function aimOrigin(p) {
  return { x: p.x, y: p.y - PHYS.AIM_Y };
}

function approach(v, target, amount) {
  if (v < target) return Math.min(target, v + amount);
  if (v > target) return Math.max(target, v - amount);
  return v;
}

function onPlatformTop(p, t) {
  const row = p.y / CELL;
  if (Math.abs(row - Math.round(row)) > 1e-4) return false;
  return t.rowHasPlatform(p.x - PHYS.HALF_W, p.x + PHYS.HALF_W, Math.round(row));
}

function checkGround(p, t, dropping) {
  const hw = PHYS.HALF_W;
  if (t.rectSolid(p.x - hw, p.y, p.x + hw, p.y + 0.5)) return true;
  return !dropping && onPlatformTop(p, t);
}

function moveX(p, dx, t, grounded, ns) {
  const hw = PHYS.HALF_W;
  const h = PHYS.HEIGHT;
  const sg = Math.sign(dx);
  let rem = Math.abs(dx);
  while (rem > 1e-9) {
    const s = rem > 1 ? 1 : rem;
    const nx = p.x + sg * s;
    if (!t.rectSolid(nx - hw, p.y - h, nx + hw, p.y, ns)) {
      p.x = nx;
    } else {
      let stepped = false;
      if (grounded) {
        for (let up = 1; up <= PHYS.STEP_UP; up++) {
          if (!t.rectSolid(nx - hw, p.y - up - h, nx + hw, p.y - up, ns)) {
            p.x = nx;
            p.y -= up;
            stepped = true;
            break;
          }
        }
      }
      if (!stepped) {
        p.vx = 0;
        return;
      }
    }
    rem -= s;
  }
}

// Returns 1 when landing, -1 on a ceiling bump, 0 otherwise.
function moveY(p, dy, t, dropping, ns) {
  const hw = PHYS.HALF_W;
  const h = PHYS.HEIGHT;
  if (dy > 0) {
    let rem = dy;
    while (rem > 1e-9) {
      const s = rem > 1 ? 1 : rem;
      const ny = p.y + s;
      const rNew = Math.floor((ny - 1e-6) / CELL);
      if (t.rectSolid(p.x - hw, ny - h, p.x + hw, ny, ns)) {
        p.y = Math.max(p.y, rNew * CELL);
        return 1;
      }
      if (!dropping) {
        const rOld = Math.floor((p.y - 1e-6) / CELL);
        if (rNew > rOld && t.rowHasPlatform(p.x - hw, p.x + hw, rNew)) {
          p.y = rNew * CELL;
          return 1;
        }
      }
      p.y = ny;
      rem -= s;
    }
  } else if (dy < 0) {
    let rem = -dy;
    while (rem > 1e-9) {
      const s = rem > 1 ? 1 : rem;
      const ny = p.y - s;
      if (t.rectSolid(p.x - hw, ny - h, p.x + hw, ny, ns)) {
        const rTop = Math.floor((ny - h) / CELL);
        p.y = Math.min(p.y, (rTop + 1) * CELL + h);
        return -1;
      }
      p.y = ny;
      rem -= s;
    }
  }
  return 0;
}

// Pushes a player that ended up inside terrain (falling debris, a map reset) back out.
// Returns 0 when free, 1 when buried only in loose sand (they wade through it), 2 when stuck.
function unstick(p, t) {
  const hw = PHYS.HALF_W;
  const h = PHYS.HEIGHT;
  if (!t.rectSolid(p.x - hw, p.y - h, p.x + hw, p.y)) return 0;
  for (let up = CELL; up <= 32; up += CELL) {
    if (!t.rectSolid(p.x - hw, p.y - up - h, p.x + hw, p.y - up)) {
      p.y -= up;
      return 0;
    }
  }
  if (!t.rectSolid(p.x - hw, p.y - h, p.x + hw, p.y, true)) {
    // Buried in sand: climb out a little every tick instead of teleporting.
    if (!t.rectSolid(p.x - hw, p.y - CELL - h, p.x + hw, p.y - CELL, true)) p.y -= CELL * 0.5;
    return 1;
  }
  return 2;
}

// Advances one tick. `out` (optional) collects actions: fire, nade, jump, flip, land, switch, jet.
export function stepPlayer(p, inp, t, out, opts) {
  const dt = DT;
  const b = inp.b | 0;
  const pressed = b & ~p.btn;
  const released = p.btn & ~b;
  p.btn = b;
  if (Number.isFinite(inp.a)) p.aim = inp.a;
  if (Number.isInteger(inp.w) && inp.w >= 0 && inp.w < WEAPONS.length && inp.w !== p.w && owns(p.owned, inp.w)) {
    p.w = inp.w;
    p.cd = Math.max(p.cd, 0.1);
    p.fireBuf = 0;
    if (out) out.push({ k: 'switch', w: p.w });
  }
  p.flaming = false;
  if (p.dead) return;

  p.cd -= dt;
  p.gcd = Math.max(0, p.gcd - dt);
  p.shield = Math.max(0, p.shield - dt);
  if (p.flipT >= 0) {
    p.flipT += dt;
    if (p.flipT > PHYS.FLIP_TIME) p.flipT = -1;
  }

  const jumpHeld = (b & BTN.JUMP) !== 0;
  const down = (b & BTN.DOWN) !== 0;
  const dir = (b & BTN.RIGHT ? 1 : 0) - (b & BTN.LEFT ? 1 : 0);

  const stuck = unstick(p, t);
  const ns = stuck === 1;

  if (pressed & BTN.DOWN && p.grounded && onPlatformTop(p, t)) {
    p.dropT = PHYS.DROP_T;
    p.grounded = false;
  }
  p.dropT = Math.max(0, p.dropT - dt);
  const dropping = p.dropT > 0 || (down && !p.grounded);

  if (pressed & BTN.JUMP) p.jumpBuf = PHYS.JUMP_BUF;
  else p.jumpBuf = Math.max(0, p.jumpBuf - dt);
  if (p.grounded) {
    p.coyote = PHYS.COYOTE;
    p.flips = PHYS.FLIPS;
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
  }

  // Sprint: only on the ground, drains stamina, which refills after a short pause.
  const wantSprint = (b & BTN.SPRINT) !== 0 && dir !== 0;
  if (wantSprint && p.grounded && p.stamina > 0) p.sprinting = true;
  else if (!wantSprint || p.stamina <= 0) p.sprinting = false;
  if (p.sprinting && p.grounded) {
    p.stamina = Math.max(0, p.stamina - RULES.STAMINA_DRAIN * dt);
    p.stamDelay = RULES.STAMINA_DELAY;
  } else {
    p.stamDelay = Math.max(0, p.stamDelay - dt);
    if (p.stamDelay === 0) p.stamina = Math.min(RULES.STAMINA, p.stamina + RULES.STAMINA_REGEN * dt);
  }

  // Horizontal control.
  const maxSp = p.jetOn ? PHYS.JET_RUN : p.sprinting ? PHYS.RUN * PHYS.SPRINT : PHYS.RUN;
  const target = dir * maxSp;
  let acc;
  if (Math.abs(p.vx) > maxSp && (dir === 0 || dir === Math.sign(p.vx))) {
    acc = p.grounded ? PHYS.GROUND_OVER : PHYS.OVER_ACC;
  } else if (p.grounded) {
    acc = dir !== 0 && (p.vx === 0 || Math.sign(p.vx) === dir) ? PHYS.GROUND_ACC : PHYS.GROUND_BRAKE;
  } else if (p.jetOn) {
    acc = dir ? PHYS.JET_ACC_STEER : PHYS.JET_ACC;
  } else {
    acc = dir ? PHYS.AIR_ACC_STEER : PHYS.AIR_ACC;
  }
  p.vx = approach(p.vx, target, acc * dt);

  // Jump, then flip (double jump) on a fresh press in the air: one air jump, refilled on landing.
  let jumped = false;
  if (p.jumpBuf > 0 && (p.grounded || p.coyote > 0)) {
    p.vy = -PHYS.JUMP_V;
    p.grounded = false;
    p.coyote = 0;
    p.jumpBuf = 0;
    p.jumping = true;
    jumped = true;
    if (out) out.push({ k: 'jump' });
  } else if (pressed & BTN.JUMP && !p.grounded && p.flips > 0 && !p.jetOn) {
    p.vy = Math.min(p.vy, -PHYS.FLIP_V);
    p.flips--;
    p.jumpBuf = 0;
    p.flipT = 0;
    p.jumping = true;
    jumped = true;
    if (out) out.push({ k: 'flip' });
  }
  // Short hop: releasing jump early cuts the ground jump only. The air jump (flip) is a fixed,
  // full-strength boost, otherwise a normal quick tap would halve it within a couple of ticks.
  if (released & BTN.JUMP && p.vy < 0 && p.jumping && !p.jetOn && p.flips >= PHYS.FLIPS) p.vy *= 0.5;

  // Jetpack: hold jump in the air.
  if (pressed & BTN.JUMP || !jumpHeld || p.grounded) p.jetHold = 0;
  else p.jetHold += dt;
  if (
    !p.jetOn && jumpHeld && !p.grounded && p.fuel > 0 && p.jetHold >= PHYS.JET_HOLD &&
    (p.vy > PHYS.JET_VY || p.jetHold > PHYS.JET_LONG)
  ) {
    p.jetOn = true;
    p.jetIgn = 0;
    if (out) out.push({ k: 'jet' });
  }
  if (p.jetOn && (!jumpHeld || p.grounded || p.fuel <= 0)) p.jetOn = false;
  if (p.jetOn) p.jetIgn += dt;
  const thrusting = p.jetOn && p.jetIgn >= PHYS.JET_IGNITE;
  const kRate = thrusting ? PHYS.JET_K_ON : PHYS.JET_K_OFF;
  p.jetK += ((thrusting ? 1 : 0) - p.jetK) * (1 - Math.exp(-kRate * dt));
  if (p.jetK < 0.001) p.jetK = 0;

  if (thrusting) {
    p.fuel = Math.max(0, p.fuel - RULES.FUEL_DRAIN * dt);
    p.fuelDelay = RULES.FUEL_DELAY;
  } else {
    p.fuelDelay = Math.max(0, p.fuelDelay - dt);
    if (p.fuelDelay === 0 && p.grounded) p.fuel = Math.min(RULES.FUEL, p.fuel + RULES.FUEL_REGEN * dt);
  }

  // Gravity and thrust.
  if (!p.grounded) {
    let g = PHYS.GRAV;
    if (p.vy < 0 && jumpHeld && !p.jetOn) g *= PHYS.GRAV_RISE_HOLD;
    else if (p.vy > 0) g *= PHYS.GRAV_FALL;
    if (dropping && p.vy > -50) g += PHYS.GRAV * PHYS.DROP_GRAV;
    p.vy += g * dt;
  }
  if (p.jetK > 0.02) {
    p.vy -= PHYS.JET_THRUST * p.jetK * dt;
    if (p.vy < -PHYS.JET_MAX_UP) p.vy += (-PHYS.JET_MAX_UP - p.vy) * Math.min(1, PHYS.JET_DAMP * dt);
  }
  const maxFall = dropping ? PHYS.MAX_FALL_DROP : PHYS.MAX_FALL;
  if (p.vy > maxFall) p.vy = maxFall;
  if (p.grounded && p.vy > 0) p.vy = 0;

  // Firing happens before movement so shots leave from where the player saw themselves.
  if (pressed & BTN.FIRE) p.fireBuf = 0.12;
  else p.fireBuf = Math.max(0, p.fireBuf - dt);
  const W = WEAPONS[p.w];
  const noFire = opts && opts.noFire;
  if (!noFire) {
    const held = (b & BTN.FIRE) !== 0;
    const ammo = p.ammo[p.w];
    if (CONTINUOUS.has(W.kind)) {
      if (held && ammo > 0) {
        p.flaming = true;
        p.ammo[p.w]--;
      }
    } else if ((W.auto ? held : p.fireBuf > 0) && p.cd <= 1e-9 && ammo !== 0) {
      p.cd = Math.max(p.cd, -dt) + W.cd;
      p.fireBuf = 0;
      if (ammo > 0) p.ammo[p.w]--;
      const ox = p.x;
      const oy = p.y - PHYS.AIM_Y;
      if (W.push) {
        const ca = Math.cos(p.aim);
        const sa = Math.sin(p.aim);
        p.vx -= ca * W.push;
        p.vy -= sa * W.push;
        if (p.vy < -60) p.grounded = false;
      }
      if (out) out.push({ k: 'fire', w: p.w, a: p.aim, x: ox, y: oy, vx: p.vx, vy: p.vy });
    }
    if (pressed & BTN.ALT && W.kind === 'c4') {
      if (out) out.push({ k: 'det' });
    } else if (pressed & BTN.ALT && p.gcd <= 0 && p.nades > 0) {
      p.gcd = GRENADE.cd;
      p.nades--;
      if (out) out.push({ k: 'nade', a: p.aim, x: p.x, y: p.y - PHYS.AIM_Y, vx: p.vx, vy: p.vy });
    }
  }
  if (p.cd < -1) p.cd = -1;

  // Integrate and collide.
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > PHYS.MAX_SPEED) {
    p.vx *= PHYS.MAX_SPEED / sp;
    p.vy *= PHYS.MAX_SPEED / sp;
  }
  const wasGrounded = p.grounded;
  if (stuck !== 2) {
    if (ns) p.vx *= 0.9;
    moveX(p, p.vx * dt, t, wasGrounded, ns);
    const hitY = moveY(p, p.vy * dt, t, dropping, ns && p.vy < 0);
    if (hitY === 1) {
      if (out && p.vy > 320) out.push({ k: 'land', v: p.vy });
      p.vy = 0;
    } else if (hitY === -1 && p.vy < 0) {
      p.vy = 0;
    }
  } else {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  p.grounded = checkGround(p, t, dropping);
  if (!p.grounded && wasGrounded && !jumped && p.vy >= 0 && !dropping) {
    const hw = PHYS.HALF_W;
    for (let d = 1; d <= PHYS.STEP_DOWN; d++) {
      const ny = p.y + d;
      if (t.rectSolid(p.x - hw, ny - PHYS.HEIGHT, p.x + hw, ny)) break;
      const rowTop = Math.abs(ny / CELL - Math.round(ny / CELL)) < 1e-4;
      if (t.rectSolid(p.x - hw, ny, p.x + hw, ny + 0.5) || (rowTop && t.rowHasPlatform(p.x - hw, p.x + hw, Math.round(ny / CELL)))) {
        p.y = ny;
        p.grounded = true;
        break;
      }
    }
  }
  if (p.grounded) {
    p.jumping = false;
    if (p.vy > 0) p.vy = 0;
  } else if (p.vy >= 0) {
    p.jumping = false;
  }

  if (p.y < PHYS.CEIL_Y) {
    p.y = PHYS.CEIL_Y;
    if (p.vy < 0) p.vy = 0;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function packPlayer(p) {
  const flags =
    (p.grounded ? F_GROUNDED : 0) | (p.jetOn ? F_JET : 0) | (p.dead ? F_DEAD : 0) |
    (p.jumping ? F_JUMPING : 0) | (p.flaming ? F_FLAMING : 0) | (p.sprinting ? F_SPRINT : 0);
  return [
    r2(p.x), r2(p.y), r2(p.vx), r2(p.vy), r3(p.aim), flags, p.w, r3(p.cd), r3(p.gcd), p.nades,
    r2(p.fuel), r2(p.hp), p.ammo.slice(), r3(p.coyote), r3(p.jumpBuf), p.flips, r3(p.jetHold),
    r3(p.jetIgn), r3(p.jetK), r3(p.dropT), r3(p.shield), p.btn, r3(p.fireBuf), r3(p.fuelDelay),
    r3(p.flipT), r2(p.respawnT), r2(p.stamina), r3(p.stamDelay), p.owned,
  ];
}

export function unpackPlayer(a, p) {
  p.x = a[0];
  p.y = a[1];
  p.vx = a[2];
  p.vy = a[3];
  p.aim = a[4];
  const f = a[5];
  p.grounded = (f & F_GROUNDED) !== 0;
  p.jetOn = (f & F_JET) !== 0;
  p.dead = (f & F_DEAD) !== 0;
  p.jumping = (f & F_JUMPING) !== 0;
  p.flaming = (f & F_FLAMING) !== 0;
  p.sprinting = (f & F_SPRINT) !== 0;
  p.w = a[6];
  p.cd = a[7];
  p.gcd = a[8];
  p.nades = a[9];
  p.fuel = a[10];
  p.hp = a[11];
  p.ammo = a[12].slice();
  p.coyote = a[13];
  p.jumpBuf = a[14];
  p.flips = a[15];
  p.jetHold = a[16];
  p.jetIgn = a[17];
  p.jetK = a[18];
  p.dropT = a[19];
  p.shield = a[20];
  p.btn = a[21];
  p.fireBuf = a[22];
  p.fuelDelay = a[23];
  p.flipT = a[24];
  p.respawnT = a[25];
  p.stamina = a[26];
  p.stamDelay = a[27];
  p.owned = a[28];
  return p;
}
