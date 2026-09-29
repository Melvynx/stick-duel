import { BTN, DT, PHYS } from './constants.js';
import { WEAPONS } from './weapons.js';

const RETARGET = 0.6; // s between target choices
const STICKY = 180; // px a new target must be closer by to steal a bot's attention

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Survival bot brain (mixin of Survival): picks the nearest living human, holds its archetype's
// range, climbs with the jetpack, walks out of buildings and shoots with reaction time and aim error.
export const brain = {
  pickTarget(p, bot) {
    const g = this.game;
    bot.tgtT -= DT;
    const cur = bot.tgt >= 0 && g.present[bot.tgt] && !g.players[bot.tgt].dead ? bot.tgt : -1;
    if (cur >= 0 && bot.tgtT > 0) return g.players[cur];
    bot.tgtT = RETARGET;
    let best = -1;
    let bestD = Infinity;
    for (const s of this.humans()) {
      const q = g.players[s];
      if (q.dead) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y) - (s === cur ? STICKY : 0);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    bot.tgt = best;
    return best >= 0 ? g.players[best] : null;
  },

  think(slot, bot) {
    const g = this.game;
    const t = g.terrain;
    const p = g.players[slot];
    const T = bot.T;
    const rng = this.rng;
    const target = this.pickTarget(p, bot);
    let b = 0;
    let move = 0;
    let wantUp = false;
    let wantDown = false;

    // The boss alternates between its MIRV launcher and an SMG.
    if (T.alt !== undefined) {
      bot.swapT -= DT;
      if (bot.swapT <= 0) {
        bot.w = bot.w === T.w ? T.alt : T.w;
        bot.swapT = bot.w === T.w ? 5 : 3;
        bot.burst = 0;
      }
    }
    // Enemies never run dry.
    if (p.ammo[bot.w] >= 0 && p.ammo[bot.w] < 3) p.ammo[bot.w] = WEAPONS[bot.w].ammo;
    const W = WEAPONS[bot.w];

    const ox = p.x;
    const oy = p.y - PHYS.AIM_Y;
    let dx = 0;
    let dy = 0;
    let dist = Infinity;
    let desired = bot.aim;

    bot.strafeT -= DT;
    if (bot.strafeT <= 0) {
      const r = rng();
      bot.strafe = r < 0.3 ? 0 : r < 0.65 ? -1 : 1;
      bot.strafeT = 0.5 + rng() * 1.1;
    }

    if (target) {
      const tx = target.x;
      const ty = target.y - 30;
      dx = tx - ox;
      dy = ty - oy;
      dist = Math.hypot(dx, dy) || 1;
      if (--bot.losT <= 0) {
        bot.losT = 4 + (slot % 3);
        const d = t.raycast(ox, oy, dx / dist, dy / dist, dist);
        bot.los = d < 0 || d > dist - 8;
      }
      bot.seen = bot.los ? Math.min(3, bot.seen + DT) : Math.max(0, bot.seen - DT * 2);

      // Aim: lead moving targets, rockets go for the feet, plus a wandering error.
      let ax = tx;
      let ay = ty;
      if (W.kind === 'rocket' || W.kind === 'mirv') {
        const lt = dist / W.speed;
        ax += target.vx * lt * 0.7;
        ay = target.grounded ? target.y - 6 : ty;
      } else if (W.kind === 'bullet') {
        ax += target.vx * (dist / W.speed);
      }
      bot.errT -= DT;
      if (bot.errT <= 0) {
        bot.errT = 0.3 + rng() * 0.5;
        bot.err = (rng() * 2 - 1) * this.aimErr * T.acc;
      }
      desired = Math.atan2(ay - oy, ax - ox) + bot.err;

      // Movement: close in without line of sight, then hold the preferred range and strafe.
      const hd = target.x - p.x;
      const dirTo = hd >= 0 ? 1 : -1;
      const feetDy = target.y - p.y;
      if (!bot.los || dist > bot.far) move = Math.abs(hd) > 30 ? dirTo : 0;
      else if (dist < bot.near) move = -dirTo;
      else move = bot.strafe;
      wantUp = feetDy < -80 && (Math.abs(hd) < 420 || !bot.los);
      wantDown = feetDy > 80 && Math.abs(hd) < 320;
      // A solid ceiling between us and a target above: drop to the lowest floor and walk out
      // sideways (the fort only has doors at ground level) before trying to climb again.
      if (bot.roofT <= 0 && wantUp && !bot.los && t.rectSolid(p.x - 5, p.y - 120, p.x + 5, p.y - 60)) {
        bot.roofT = 3 + rng();
      }
      if (bot.roofT > 0) {
        bot.roofT -= DT;
        move = bot.edge;
        wantUp = false;
        wantDown = true;
      } else if ((wantDown || !bot.los) && move === 0) {
        move = bot.edge;
      }
    } else {
      move = bot.strafe;
      bot.los = false;
      bot.seen = 0;
    }

    // Unstick: walls ahead get jumped, long blocks trigger a short detour the other way.
    if (bot.detourT > 0) {
      bot.detourT -= DT;
      move = bot.detour;
    }
    if (move !== 0 && Math.abs(p.x - bot.lastX) < 0.3) bot.stuck += DT;
    else bot.stuck = Math.max(0, bot.stuck - DT);
    bot.lastX = p.x;
    if (bot.stuck > 1.6) {
      bot.detour = -move;
      bot.detourT = 0.6 + rng() * 0.6;
      bot.edge = -bot.edge;
      bot.stuck = 0;
    }
    const wall = move !== 0 && t.rectSolid(p.x + move * 12 - 3, p.y - 52, p.x + move * 12 + 3, p.y - 12);
    if (move > 0) b |= BTN.RIGHT;
    else if (move < 0) b |= BTN.LEFT;

    // Jump, keep holding for the jetpack while there is a reason to climb.
    if (bot.cool > 0) bot.cool -= DT;
    if (bot.jetT > 0) {
      bot.jetT -= DT;
      b |= BTN.JUMP;
      if (bot.jetT <= 0 && !p.grounded && p.fuel > 15 && bot.roofT <= 0 && (wall || wantUp)) bot.jetT = 0.2;
      if (bot.jetT <= 0) bot.cool = 0.12;
    } else if (bot.cool <= 0 && p.grounded && bot.roofT > 0) {
      // Leaving a building: only hop over low lips, never climb back up.
      const high = t.rectSolid(p.x + move * 12 - 3, p.y - 52, p.x + move * 12 + 3, p.y - 26);
      if (wall && !high) bot.jetT = 0.1;
    } else if (bot.cool <= 0 && p.grounded) {
      if (wall || bot.stuck > 0.25) bot.jetT = 0.35 + rng() * 0.4;
      else if (wantUp && rng() < DT * 2.5) bot.jetT = 0.5 + rng() * 0.7;
      else if (bot.los && rng() < DT * T.hop) bot.jetT = 0.12;
    }

    // Drop through one-way platforms towards a lower target.
    if (bot.downT > 0) {
      bot.downT -= DT;
      b |= BTN.DOWN;
    } else if (wantDown && p.grounded && rng() < DT * (bot.roofT > 0 ? 12 : 3)) {
      bot.downT = 0.1;
    }

    // Turn towards the desired aim at a limited speed.
    const diff = wrap(desired - bot.aim);
    const maxTurn = this.turn * DT;
    bot.aim = wrap(bot.aim + Math.max(-maxTurn, Math.min(maxTurn, diff)));
    const aligned = Math.abs(diff) < 0.18;

    // Fire.
    bot.fireT -= DT;
    const gap = () => (T.gap[0] + rng() * (T.gap[1] - T.gap[0])) * this.gapMul;
    const canShoot = target && bot.los && bot.seen >= this.reaction && aligned && dist < (T.reach ?? bot.far * 1.3);
    if (W.kind === 'flame') {
      if (canShoot) b |= BTN.FIRE;
    } else if (W.auto) {
      if (bot.burst > 0) {
        bot.burst -= DT;
        if (canShoot) b |= BTN.FIRE;
        if (bot.burst <= 0) bot.fireT = gap() * 0.6;
      } else if (canShoot && bot.fireT <= 0) {
        bot.burst = 0.35 + rng() * 0.4;
      }
    } else if (canShoot) {
      bot.steady += DT;
      if (bot.fireT <= 0 && bot.steady >= (T.steady || 0)) {
        b |= BTN.FIRE;
        bot.fireT = gap();
        bot.steady = 0;
      }
    } else {
      bot.steady = 0;
    }

    // Grenades from wave 4, mostly lobbed over cover.
    let a = bot.aim;
    if (target && this.wave >= 4 && p.nades > 0 && p.gcd <= 0 && dist < 520 && bot.seen > 0) {
      if (rng() < DT * (bot.los ? 0.04 : 0.2)) {
        b |= BTN.ALT;
        a = Math.atan2(dy - Math.min(260, dist * 0.45), dx);
      }
    }

    return { s: ++bot.seq, b, a: Math.round(a * 1000) / 1000, w: bot.w, v: g.tick };
  },
};
