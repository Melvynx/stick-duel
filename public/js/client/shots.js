import { PHYS } from '/shared/constants.js';
import { playerBox, railTrace, segAabb } from '/shared/geom.js';
import { PROJ } from '/shared/projectiles.js';
import { BEAM, FLAME, GRENADE, RAIL, SPRAY, W, WEAPONS, owns, pelletDirs, poolBar } from '/shared/weapons.js';
import { jetNozzle, muzzleWorld } from '../render.js';

const BIG_SHOT = [1, 1, 2, 2, 2, 1, 2, 0, 0, 0, 0, 2, 2, 1];
const LASER = 1400; // px: reach of the sniper's laser sight
const TRACER = '#fff3a8';
const LOOP_TOOL = { flame: 0, beam: 1, spray: 2 };
const GHOST_KIND = { rocket: PROJ.ROCKET, mirv: PROJ.MIRV, quake: PROJ.QUAKE };

// Local weapon handling and every shot / continuous-tool effect (mixin of ClientGame).
export const shots = {
  // `bar` = numbered hotbar slot of the match's pool (the builder has its own key, `builder`),
  // `abs` = weapon index, `last` = previous, `rel` = wheel (cycles owned pool weapons).
  pickWeapon(req) {
    const me = this.me;
    const bar = poolBar(this.pool);
    let w = this.wantW;
    if (req.bar !== undefined) w = bar.nums[req.bar] ?? -1;
    else if (req.builder) w = bar.slots.includes(W.builder) ? W.builder : -1;
    else if (req.abs !== undefined) w = req.abs;
    else if (req.last) w = this.lastW;
    else if (req.rel) {
      const list = bar.slots;
      const n = list.length;
      const at = Math.max(0, list.indexOf(this.wantW));
      for (let i = 1; i <= n; i++) {
        const c = list[(at + req.rel * i + n * 4) % n];
        if (owns(me.owned, c) && me.ammo[c] !== 0) {
          w = c;
          break;
        }
      }
    }
    if (w < 0 || w >= WEAPONS.length || w === this.wantW) return;
    if (!owns(me.owned, w)) {
      this.sfx.play('lock');
      if (this.onToast) this.onToast(`${WEAPONS[w].name} LOCKED`, '#8d86a6');
      return;
    }
    if (me.ammo[w] === 0 && !me.dead) {
      this.sfx.play('empty', me.x);
      return;
    }
    this.lastW = this.wantW;
    this.wantW = w;
  },

  // Laser sight of every sniper on screen: warns the target and shows the shooter the line.
  // `others` = visible remote slots, `mine` = the local player's drawn position (null if dead).
  drawLasers(ctx, others, mine) {
    const list = others.map((s) => [s, this.remotes[s], this.remotes[s].x, this.remotes[s].y, this.remotes[s].aim]);
    if (mine && this.wantW === W.sniper) list.push([this.slot, this.me, mine.x, mine.y, this.aim]);
    for (const [s, p, x, y, aim] of list) {
      if (p.w !== W.sniper && !(s === this.slot && this.wantW === W.sniper)) continue;
      const mz = muzzleWorld(x, y, aim, W.sniper);
      const dx = Math.cos(aim);
      const dy = Math.sin(aim);
      const hit = this.terrain.raycast(mz.x, mz.y, dx, dy, LASER);
      let d = hit >= 0 ? hit : LASER;
      for (let o = 0; o < this.present.length; o++) {
        const q = this.playerAt(o);
        if (o === s || !q || q.dead || !this.present[o]) continue;
        const t = segAabb(mz.x, mz.y, mz.x + dx * d, mz.y + dy * d, ...playerBox(q.x, q.y));
        if (t >= 0) d *= t;
      }
      const ex = (mz.x + dx * d) / 2;
      const ey = (mz.y + dy * d) / 2;
      ctx.save();
      ctx.globalAlpha = 0.6 + Math.sin(this.time * 14) * 0.1;
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mz.x / 2, mz.y / 2);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(ex - 1, ey - 1, 2, 2);
      ctx.restore();
    }
  },

  localAction(a, seq) {
    const me = this.me;
    switch (a.k) {
      case 'switch':
        this.sfx.play('switch', me.x);
        break;
      case 'jump':
        this.sfx.play('jump', me.x);
        break;
      case 'flip':
        this.sfx.play('flip', me.x);
        break;
      case 'land':
        this.sfx.play('land', me.x, Math.min(1.5, a.v / 700));
        this.dust(me.x, me.y);
        break;
      case 'det':
        this.sfx.play('det', me.x);
        break;
      case 'melee':
        this.meleeFx(me.x, me.y - PHYS.HEIGHT / 2, a.a);
        break;
      case 'fire': {
        this.shotFx(this.slot, a.w, a.a, a.x, a.y, seq, true);
        const kind = WEAPONS[a.w].kind;
        if (GHOST_KIND[kind]) this.ghostProj(a, seq);
        else if (kind === 'c4') this.ghostC4(a, seq);
        break;
      }
      case 'nade': {
        const dx = Math.cos(a.a);
        const dy = Math.sin(a.a);
        this.addGhost(seq, {
          k: PROJ.GRENADE, x: a.x, y: a.y, vx: dx * GRENADE.speed + a.vx * 0.4, vy: dy * GRENADE.speed + a.vy * 0.3 - 120,
        });
        this.sfx.play('nade', me.x);
        this.fx.shake(0.04);
        break;
      }
      default:
        break;
    }
  },

  addGhost(seq, pr) {
    this.ghosts.push({ sq: seq, miss: 0, done: false, pr: { id: -seq, o: this.slot, fx: pr.x, fy: pr.y, t: 0, sq: seq, ...pr } });
  },

  // Same initial state the server gives the projectile, so the handover is seamless.
  ghostProj(a, seq) {
    const W = WEAPONS[a.w];
    const dx = Math.cos(a.a);
    const dy = Math.sin(a.a);
    const wall = this.terrain.raycast(a.x, a.y, dx, dy, W.muzzle);
    if (wall >= 0 && wall < 10) return;
    const dist = wall >= 0 ? Math.max(0, wall - 3) : W.muzzle;
    const k = GHOST_KIND[W.kind];
    this.addGhost(seq, {
      k, x: a.x + dx * dist, y: a.y + dy * dist, vx: dx * W.speed + (k !== PROJ.ROCKET ? a.vx * 0.3 : 0), vy: dy * W.speed,
    });
  },

  ghostC4(a, seq) {
    const W = WEAPONS[a.w];
    this.addGhost(seq, {
      k: PROJ.C4, x: a.x, y: a.y, st: 0,
      vx: Math.cos(a.a) * W.speed + a.vx * 0.3, vy: Math.sin(a.a) * W.speed + a.vy * 0.2 - 60,
    });
  },

  // Muzzle flash, sound, casing and tracers for a shot from `slot` whose shoulder is at (x, y).
  shotFx(slot, w, a, x, y, seq, local) {
    const W = WEAPONS[w];
    const fx = this.fx;
    const mz = muzzleWorld(x, y + PHYS.AIM_Y, a, w);
    const dirX = Math.cos(a);
    this.anim(slot).kick = W.kick / 2;
    if (BIG_SHOT[w]) fx.muzzle(mz.x, mz.y, a, BIG_SHOT[w]);
    if (W.casing) fx.casing(x + dirX * 10, y, dirX >= 0 ? 1 : -1, w === 2);
    this.sfx.play(`shot${w}`, x);
    fx.shake(W.shake * (local ? 0.6 : 0.15));

    if (W.kind === 'bullet') {
      const targets = this.targetBoxes(slot);
      for (const [ang] of pelletDirs(w, slot, seq, a)) {
        const end = this.traceBullet(x, y, ang, targets);
        fx.tracer(mz.x, mz.y, end.x, end.y, TRACER, w === 2 ? 0.05 : 0.06);
      }
    } else if (W.kind === 'rail' && local) {
      const tr = railTrace(this.terrain, x, y, a, RAIL.range, RAIL.maxPen);
      fx.rail(mz.x, mz.y, tr.x2, tr.y2, this.color(slot));
    }
  },

  // Boxes of the players a shot from `slot` can hit, where this client currently draws them.
  targetBoxes(slot) {
    const out = [];
    for (let s = 0; s < this.present.length; s++) {
      if (!this.present[s] || !this.hostile(slot, s)) continue;
      const p = this.playerAt(s);
      if (p && !p.dead) out.push(playerBox(p.x, p.y, 1));
    }
    return out;
  },

  // End of a ray from (x, y): first wall within `range`, cut short by the nearest target box.
  traceBullet(x, y, a, boxes, range = 1500) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const wall = this.terrain.raycast(x, y, dx, dy, range);
    let d = wall < 0 ? range : wall;
    const x2 = x + dx * d;
    const y2 = y + dy * d;
    let best = 1;
    for (const box of boxes) {
      const t = segAabb(x, y, x2, y2, ...box);
      if (t >= 0 && t < best) best = t;
    }
    d *= best;
    return { x: x + dx * d, y: y + dy * d, wall: best === 1 && wall >= 0, body: best < 1 };
  },

  // Held tools and jetpack exhaust. Sound loop 0 is ours, loop 1 the loudest other player.
  continuousFx() {
    const me = this.me;
    let other = null;
    let otherD = 1100;
    for (let s = 0; s < this.present.length; s++) {
      const mine = s === this.slot;
      const p = this.playerAt(s);
      if (!p || p.dead || !this.present[s]) {
        if (mine) this.sfx.setLoops(0, me.x, false, 0);
        continue;
      }
      const aim = mine ? this.aim : p.aim;
      const kind = WEAPONS[p.w]?.kind;
      const tool = p.flaming ? LOOP_TOOL[kind] : undefined;
      if (tool !== undefined) this.toolFx(s, p, aim, kind);
      if (p.jetK > 0.05) {
        const n = jetNozzle(p.x, p.y, Math.cos(aim) >= 0 ? 1 : -1);
        this.fx.jet(n.x, n.y, p.jetK);
      }
      if (p.sprinting && p.grounded && Math.random() < 0.5) this.fx.kick(p.x, p.y, Math.sign(p.vx) || 1);
      const on = tool !== undefined;
      if (mine) {
        this.sfx.setLoops(0, p.x, on, p.jetK, tool);
      } else if (on || p.jetK > 0.05) {
        const d = Math.abs(p.x - this.sfx.earX) - (on ? 300 : 0);
        if (d < otherD) {
          otherD = d;
          other = { x: p.x, on, jet: p.jetK, tool };
        }
      }
    }
    if (other) this.sfx.setLoops(1, other.x, other.on, other.jet, other.tool);
    else this.sfx.setLoops(1, this.sfx.earX, false, 0);
  },

  toolFx(s, p, aim, kind) {
    const ox = p.x;
    const oy = p.y - PHYS.AIM_Y;
    const mz = muzzleWorld(p.x, p.y, aim, p.w);
    this.anim(s).kick = 0.5;
    if (kind === 'flame') {
      const wall = this.terrain.raycast(ox, oy, Math.cos(aim), Math.sin(aim), FLAME.range);
      this.fx.flame(mz.x, mz.y, aim, Math.max(20, (wall >= 0 ? wall : FLAME.range) - 40));
    } else if (kind === 'beam') {
      const end = this.traceBullet(ox, oy, aim, this.targetBoxes(s), BEAM.range);
      this.fx.beam(mz.x, mz.y, end.x, end.y, end.wall || end.body);
    } else if (kind === 'spray') {
      const wall = this.terrain.raycast(ox, oy, Math.cos(aim), Math.sin(aim), SPRAY.reach);
      this.fx.spray(mz.x, mz.y, aim, Math.max(16, (wall >= 0 ? wall : SPRAY.reach) - 30));
    }
  },
};
