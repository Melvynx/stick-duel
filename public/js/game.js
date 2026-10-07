import { BTN, DT, INTERP_TICKS, PHYS, PLAYER_COLORS, TICK_MS } from '/shared/constants.js';
import { buildMap } from '/shared/maps.js';
import { createPlayer, stepPlayer, unpackPlayer } from '/shared/player.js';
import { ALIVE, stepProj, unpackProj } from '/shared/projectiles.js';
import { FULL_POOL, W, owns, poolList, sanitizePool } from '/shared/weapons.js';
import { builder } from './client/builder.js';
import { events } from './client/events.js';
import { interp } from './client/interp.js';
import { shots } from './client/shots.js';
import { TerrainSync } from './client/terrain-sync.js';
import './fx-tools.js';
import {
  TerrainView, drawCrosshair, drawItem, drawNameTag, drawOffscreen, drawProjectile, drawStick, makeSky,
} from './render.js';

const MAX_SNAPS = 40;
const SNAP_ERR = 60; // px: larger prediction errors snap instead of smoothing

const r3 = (v) => Math.round(v * 1000) / 1000;

// Per-player animation state that only exists on the client.
function makeAnim() {
  return { phase: 0, kick: 0, face: 1, lastX: null };
}

// Client side of one match: prediction of the local player, interpolation of everyone else,
// a lockstep copy of the sandbox, a camera that follows the local player and drawing.
// Behaviour lives in mixins: client/shots.js (weapons and tool effects), client/events.js
// (server events), client/interp.js (remote timeline) and client/terrain-sync.js (terrain ops).
export class ClientGame {
  constructor({ net, input, fx, sfx }) {
    this.net = net;
    this.input = input;
    this.fx = fx;
    this.sfx = sfx;
    this.view = new TerrainView();
    this.sky = makeSky();
    this.sync = new TerrainSync(this);
    this.active = false;
    this.slot = -1;
    this.names = ['P1', 'P2'];
    this.colors = PLAYER_COLORS.slice();
    this.team = [0, 1];
    this.present = [false, false];
    this.interp = INTERP_TICKS;
    this.roomState = 'waiting';
    this.seq = 0;
    this.ack = 0;
    this.pending = [];
    this.offset = null;
    this.rtt = 0;
    this.time = 0;
    this.hitFlash = 0;
    this.armory = -1;
    this.pool = FULL_POOL; // allowed weapons of the current match: hotbar and number keys follow it
    this.onFeed = null;
    this.onHurt = null;
    this.onUnlock = null;
    this.onToast = null;
    this.reset();
  }

  reset() {
    this.me = createPlayer(Math.max(0, this.slot));
    this.me.dead = true;
    this.prev = { x: 0, y: 0 };
    this.err = { x: 0, y: 0 };
    this.snaps = [];
    this.projs = [];
    this.projK = 0;
    this.projDisp = new Map();
    this.ghosts = [];
    this.delayed = [];
    this.lastFireK = [];
    this.anims = [];
    this.wantW = 0;
    this.lastW = 0;
    this.prevB = 0;
    this.aim = 0;
    this.remotes = [];
    this.items = [];
    this.cam = null;
    this.camBx = 0;
    this.camBy = 0;
  }

  // Everyone the camera, tracers and effects care about: slot -> drawn state.
  playerAt(s) {
    return s === this.slot ? this.me : this.remotes[s] || null;
  }

  hostile(a, b) {
    return a !== b && (this.team[a] ?? a) !== (this.team[b] ?? b);
  }

  anim(s) {
    return this.anims[s] || (this.anims[s] = makeAnim());
  }

  color(s) {
    return this.colors[s] || PLAYER_COLORS[s % PLAYER_COLORS.length];
  }

  setSlot(slot) {
    this.slot = slot;
  }

  // ---------- network ----------

  // `msg` = { id, seed, ops, st }: the map is rebuilt, then every terrain op so far is replayed
  // in lockstep. `game` (solo) shares the local authority's simulation instead.
  loadMap(msg, game) {
    const map = buildMap(msg.id, msg.seed);
    this.setPool(game ? game.pool : msg.wp);
    this.terrain = game ? game.terrain : map.terrain;
    this.mapName = map.name;
    this.fx.clear();
    this.fx.terrain = this.terrain;
    this.reset();
    this.me.slot = this.slot;
    this.view.scorchMap.fill(0);
    this.view.setTerrain(this.terrain);
    if (game) this.sync.attach(game);
    else this.sync.load(this.terrain, msg.ops || [], msg.st || 0);
    this.view.redraw(0, 0, this.terrain.w - 1, this.terrain.h - 1);
    this.active = true;
  }

  setPool(pool) {
    this.pool = sanitizePool(pool, this.pool);
  }

  leave() {
    this.active = false;
    this.slot = -1;
    this.sfx.setLoops(0, this.sfx.earX, false, 0);
    this.sfx.setLoops(1, this.sfx.earX, false, 0);
  }

  // Server tick currently shown for remote entities (fractional).
  renderTick(now = performance.now()) {
    if (this.offset === null) return 0;
    return (now - this.offset) / TICK_MS - this.interp;
  }

  onSnapshot(msg) {
    if (!this.active) return;
    const now = performance.now();
    const sample = now - msg.k * TICK_MS;
    if (this.offset === null || Math.abs(sample - this.offset) > 250) this.offset = sample;
    else if (sample < this.offset) this.offset += (sample - this.offset) * 0.25;
    else this.offset += (sample - this.offset) * 0.03;
    if (msg.r) this.rtt = msg.r[this.slot] || 0;
    if (msg.ar !== undefined) this.armory = msg.ar;

    if (msg.o) {
      this.sync.push(msg.o, msg.os);
      this.sync.advance(msg.st);
    }

    const players = msg.p.map((a, s) => (a ? unpackPlayer(a, createPlayer(s)) : null));
    this.present = players.map((p) => p !== null);
    this.snaps.push({ k: msg.k, p: players, c: msg.c });
    if (this.snaps.length > MAX_SNAPS) this.snaps.shift();

    this.projK = msg.k;
    this.projs = msg.j.map(unpackProj);

    for (const ev of msg.e) this.onEvent(ev, msg.k);

    const mine = msg.p[this.slot];
    if (mine) this.reconcile(msg.a, mine);

    // Own ghost projectiles hand over to the authoritative copy once the server has it.
    this.ghosts = this.ghosts.filter((g) => {
      if (this.projs.some((p) => p.o === this.slot && p.sq === g.sq && p.k === g.pr.k)) return false;
      if (this.ack >= g.sq) g.miss++;
      return g.miss < 3;
    });
  }

  reconcile(ack, packed) {
    const me = this.me;
    const oldX = me.x;
    const oldY = me.y;
    const wasDead = me.dead;
    this.ack = ack;
    while (this.pending.length && this.pending[0].s <= ack) this.pending.shift();
    unpackPlayer(packed, me);
    for (const inp of this.pending) stepPlayer(me, inp, this.terrain, null, { noFire: inp.nf });
    const dx = oldX - me.x;
    const dy = oldY - me.y;
    if (wasDead !== me.dead || Math.hypot(this.err.x + dx, this.err.y + dy) > SNAP_ERR) {
      this.err.x = 0;
      this.err.y = 0;
      this.prev.x = me.x;
      this.prev.y = me.y;
    } else {
      this.err.x += dx;
      this.err.y += dy;
      this.prev.x -= dx;
      this.prev.y -= dy;
    }
  }

  // ---------- fixed tick ----------

  tick() {
    if (!this.active || this.slot < 0) return;
    const me = this.me;
    const input = this.input;

    const req = input.takeWeaponRequest();
    if (req) this.pickWeapon(req);
    const breq = input.takeBuildRequest();
    if (breq) this.changeBuild(breq);
    const b = input.buttons();
    const pressed = b & ~this.prevB;
    this.prevB = b;

    const aimAt = { x: (input.mx + this.camBx) * 2, y: (input.my + this.camBy) * 2 };
    if (!me.dead) this.aim = Math.atan2(aimAt.y - (me.y - PHYS.AIM_Y), aimAt.x - me.x);
    if (pressed & BTN.FIRE && !me.dead && me.ammo[me.w] === 0) {
      this.sfx.play('empty', me.x);
      if (this.wantW !== 0) this.pickWeapon({ abs: 0 });
    }
    if (pressed & BTN.SPRINT && !me.dead) this.sfx.play('sprint', me.x);

    const rt = this.renderTick();
    const inp = {
      s: ++this.seq, b, a: r3(this.aim), w: this.wantW, v: Math.max(0, Math.floor(rt)), nf: this.roomState === 'countdown',
      k: this.buildKey(aimAt),
    };
    this.prev.x = me.x;
    this.prev.y = me.y;
    const out = [];
    stepPlayer(me, inp, this.terrain, out, { noFire: inp.nf });
    for (const a of out) this.localAction(a, inp.s);
    this.pending.push(inp);
    if (this.pending.length > 240) this.pending.shift();
    this.net.send({ t: 'i', l: [[inp.s, inp.b, inp.a, inp.w, inp.v, inp.k]] });

    this.err.x *= Math.exp(-12 * DT);
    this.err.y *= Math.exp(-12 * DT);

    for (const g of this.ghosts) {
      if (g.done) continue;
      if (stepProj(g.pr, this.terrain, DT) !== ALIVE) g.done = true;
    }

    while (this.delayed.length && this.delayed[0].k <= rt) this.playRemote(this.delayed.shift().ev);

    this.remoteState(rt);
    this.updateProjDisplay(rt);
    this.continuousFx();
  }

  // Follows the local player with a lead towards the cursor, clamped to the map.
  updateCamera(x, y, alive, dt) {
    const MW = this.terrain.w * 2;
    const MH = this.terrain.h * 2;
    const clampX = (v) => (MW <= 1600 ? (MW - 1600) / 2 : Math.max(0, Math.min(MW - 1600, v)));
    const clampY = (v) => (MH <= 900 ? (MH - 900) / 2 : Math.max(0, Math.min(MH - 900, v)));
    let tx;
    let ty;
    if (alive) {
      const scope = this.wantW === W.sniper ? 2 : 1; // the sniper scope drags the view towards the cursor
      tx = x - 800 + (this.input.mx * 2 - 800) * 0.3 * scope;
      ty = y - PHYS.HEIGHT / 2 - 450 + (this.input.my * 2 - 450) * 0.25 * scope;
    } else if (this.cam) {
      tx = this.cam.x;
      ty = this.cam.y;
    } else {
      tx = (MW - 1600) / 2;
      ty = (MH - 900) / 2;
    }
    tx = clampX(tx);
    ty = clampY(ty);
    if (!this.cam) {
      this.cam = { x: tx, y: ty };
    } else {
      const k = 1 - Math.exp(-dt * 7);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
    this.camBx = Math.round(this.cam.x / 2);
    this.camBy = Math.round(this.cam.y / 2);
    this.sfx.earX = this.cam.x + 800;
  }

  // ---------- drawing ----------

  render(ctx, alpha, dt) {
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    ctx.drawImage(this.sky, 0, 0);
    if (!this.active) return;
    const me = this.me;
    const meOn = !me.dead && this.present[this.slot];
    const mx = this.prev.x + (me.x - this.prev.x) * alpha + this.err.x;
    const my = this.prev.y + (me.y - this.prev.y) * alpha + this.err.y;
    this.updateCamera(mx, my, meOn, Math.min(dt, 0.1));
    const cx = this.camBx;
    const cy = this.camBy;
    const [sx, sy] = this.fx.offset();
    ctx.save();
    ctx.translate(sx - cx, sy - cy);
    this.view.flush();
    ctx.drawImage(this.view.canvas, 0, 0);
    this.fx.drawBack(ctx);

    for (const c of this.items) drawItem(ctx, c.kind, c.x, c.y, c.falling, c.t);

    for (const d of this.projDisp.values()) {
      const x = d.px + (d.x - d.px) * alpha;
      const y = d.py + (d.y - d.py) * alpha;
      drawProjectile(ctx, { ...d, x, y });
    }

    const others = [];
    for (let s = 0; s < this.remotes.length; s++) {
      const r = this.remotes[s];
      if (r && !r.dead && this.present[s]) others.push(s);
    }
    for (const s of others) {
      const r = this.remotes[s];
      if (Math.abs(r.x / 2 - cx - 400) < 460 && Math.abs(r.y / 2 - cy - 225) < 290) this.drawPlayer(ctx, s, r, r.x, r.y, r.aim, dt);
    }
    if (meOn) this.drawPlayer(ctx, this.slot, me, mx, my, this.aim, dt);
    if (meOn && this.wantW === W.builder) this.drawBuildPreview(ctx, me.x, me.y);
    this.drawLasers(ctx, others, meOn ? { x: mx, y: my } : null);

    this.fx.drawFront(ctx);

    for (const s of others) {
      const r = this.remotes[s];
      drawNameTag(ctx, r.x, r.y, this.names[s] || `P${s + 1}`, this.color(s), r.hp, true);
    }
    ctx.restore();

    for (const s of others) drawOffscreen(ctx, this.remotes[s].x / 2 - cx, this.remotes[s].y / 2 - cy, this.color(s));
    this.drawMinimap(ctx, others, meOn ? { x: mx, y: my } : null);
    if (meOn) {
      drawOffscreen(ctx, mx / 2 - cx, my / 2 - cy, this.color(this.slot));
      drawCrosshair(ctx, this.input.mx, this.input.my, this.color(this.slot), this.hitFlash);
    }
  }

  // Bottom-left overview of maps bigger than the screen: terrain, the view box and every player.
  drawMinimap(ctx, others, me) {
    const t = this.terrain;
    const MW = t.w * 2;
    const MH = t.h * 2;
    if (MW <= 1600 && MH <= 900) return;
    let w = 132;
    let h = Math.round((w * MH) / MW);
    if (h > 64) {
      h = 64;
      w = Math.round((h * MW) / MH);
    }
    const x0 = 6;
    const y0 = 450 - 20 - h;
    const k = w / MW;
    ctx.fillStyle = 'rgba(8, 6, 18, 0.72)';
    ctx.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.view.canvas, 0, 0, t.w, t.h, x0, y0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(244, 241, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0 + this.camBx * 2 * k) + 0.5, Math.round(y0 + this.camBy * 2 * k) + 0.5, Math.round(1600 * k), Math.round(900 * k));
    const dot = (x, y, color, r) => {
      const px = Math.round(x0 + x * k);
      const py = Math.round(y0 + (y - PHYS.HEIGHT / 2) * k);
      ctx.fillStyle = '#000';
      ctx.fillRect(px - r - 1, py - r - 1, r * 2 + 3, r * 2 + 3);
      ctx.fillStyle = color;
      ctx.fillRect(px - r, py - r, r * 2 + 1, r * 2 + 1);
    };
    for (const s of others) dot(this.remotes[s].x, this.remotes[s].y, this.color(s), 1);
    if (me) dot(me.x, me.y, '#ffffff', 1);
  }

  drawPlayer(ctx, slot, p, x, y, aim, dt) {
    const an = this.anim(slot);
    const face = Math.cos(aim) >= 0 ? 1 : -1;
    if (an.lastX !== null && p.grounded) an.phase += (Math.abs(x - an.lastX) / 2) * 0.55;
    an.lastX = x;
    an.kick = Math.max(0, an.kick - dt * 30);
    drawStick(ctx, {
      x, y, aim, w: p.w, vx: p.vx, vy: p.vy, grounded: p.grounded, jet: p.jetK, flipT: p.flipT, face,
      phase: an.phase, time: this.time, color: this.color(slot), kick: an.kick, shield: p.shield, jetpack: true,
    });
  }

  hud() {
    const me = this.me;
    const sim = this.sync.sim;
    return {
      hp: me.hp, fuel: me.fuel, stamina: me.stamina, sprinting: me.sprinting, w: this.wantW, ammo: me.ammo, owned: me.owned,
      nades: me.nades, dead: me.dead, respawnT: me.respawnT, rtt: this.rtt, armory: this.armory,
      destruction: sim ? sim.destruction : 0, pool: this.pool,
      locked: poolList(this.pool).filter((w) => !owns(me.owned, w)).length,
      build: this.wantW === W.builder ? this.buildHud() : null,
    };
  }
}

Object.assign(ClientGame.prototype, shots, events, interp, builder);
