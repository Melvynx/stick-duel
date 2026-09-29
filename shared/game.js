import { CELL, DT, MAX_REWIND, PHYS, RULES } from './constants.js';
import { playerBox, segAabb } from './geom.js';
import { blasts } from './game/blast.js';
import { combat } from './game/combat.js';
import { items } from './game/items.js';
import { world } from './game/world.js';
import { buildMap } from './maps.js';
import { createPlayer, packPlayer, resetLoadout, stepPlayer } from './player.js';
import { packProj } from './projectiles.js';
import { mulberry32 } from './rng.js';
import { TerrainSim } from './sim.js';
import { FULL_POOL, START_OWNED, owns } from './weapons.js';

const HISTORY = 64;
const r1 = (v) => Math.round(v * 10) / 10;

// Authoritative simulation of one map: players, weapons, projectiles, items and the sandbox world.
// Runs on the Node server for online duels and in the browser for solo waves.
// `n` slots; slots on the same team never hurt each other (by default every slot is its own team).
// Behaviour is split across mixins: game/combat.js (weapons), game/blast.js (damage, explosions,
// projectiles), game/items.js (pickups, unlocks) and game/world.js (terrain ops, hazards).
export class Game {
  constructor(mapId, seed, n = 2) {
    this.n = n;
    this.tick = 0;
    this.present = new Array(n).fill(false);
    this.team = Array.from({ length: n }, (_, i) => i);
    this.takeMul = new Array(n).fill(1);
    this.dealMul = new Array(n).fill(1);
    this.canLoot = new Array(n).fill(true);
    this.autoRespawn = true;
    this.allowFire = true;
    this.scoring = false;
    this.cratesOn = false; // supply crates and ammo boxes drop from the sky
    this.armoryOn = false; // everyone unlocks the next pool weapon every `armoryEvery` s (unused by 1v1)
    this.armoryEvery = RULES.ARMORY_EVERY;
    this.pool = FULL_POOL; // allowed weapons: unlocks never leave it, clients build the hotbar from it
    this.startOwned = START_OWNED;
    this.onKill = null;
    this.reset(mapId, seed);
  }

  reset(mapId, seed) {
    const map = buildMap(mapId, seed);
    this.mapId = map.id;
    this.seed = seed;
    this.terrain = map.terrain;
    this.sim = new TerrainSim(this.terrain);
    this.opLog = [];
    this.opSent = 0;
    this.culprit = -1;
    this.spawns = map.spawns;
    this.worldW = this.terrain.w * CELL;
    this.worldH = this.terrain.h * CELL;
    this.rng = mulberry32(seed ^ 0x5bd1e995);
    this.baseOwned = this.startOwned;
    this.players = Array.from({ length: this.n }, (_, s) => this.freshPlayer(s));
    this.projs = [];
    this.bullets = [];
    this.items = [];
    this.events = [];
    this.nextId = 1;
    this.history = new Array(HISTORY).fill(null);
    this.flameAcc = Array.from({ length: this.n }, () => new Map());
    this.flameTick = new Array(this.n).fill(0);
    this.flameW = new Array(this.n).fill(0);
    this.buildN = 0;
    this.hazard = Array.from({ length: this.n }, () => ({ fire: 0 }));
    this.crateT = RULES.CRATE_FIRST;
    this.ammoT = RULES.AMMO_FIRST;
    this.armoryT = this.armoryEvery;
  }

  freshPlayer(slot) {
    const p = createPlayer(slot);
    p.owned = this.baseOwned;
    return p;
  }

  hostile(a, b) {
    return a !== b && this.team[a] !== this.team[b];
  }

  // Slots that `slot` can hurt and that are currently in play.
  *targets(slot) {
    for (let s = 0; s < this.n; s++) if (this.present[s] && this.hostile(slot, s)) yield s;
  }

  emit(ev) {
    this.events.push(ev);
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- players ----------

  addPlayer(slot, spawnIndex = slot) {
    this.present[slot] = true;
    this.players[slot] = this.freshPlayer(slot);
    this.flameAcc[slot].clear();
    this.spawn(slot, spawnIndex);
  }

  removePlayer(slot) {
    this.present[slot] = false;
    this.players[slot] = this.freshPlayer(slot);
    this.flameAcc[slot].clear();
    for (const acc of this.flameAcc) acc.delete(slot);
  }

  // Picks a spawn far from every living enemy, with a little randomness among the best two.
  pickSpawn(slot) {
    const foes = [];
    for (const s of this.targets(slot)) if (!this.players[s].dead) foes.push(this.players[s]);
    const scored = this.spawns.map(([x, y], i) => {
      const sy = this.terrain.findStand(x, y);
      let d = foes.length ? Infinity : this.rng() * 1000;
      for (const o of foes) d = Math.min(d, Math.hypot(x - o.x, sy - o.y));
      return { i, d };
    });
    scored.sort((a, b) => b.d - a.d);
    return scored[Math.min(scored.length - 1, Math.floor(this.rng() * 2))].i;
  }

  spawn(slot, spawnIndex) {
    const idx = spawnIndex ?? this.pickSpawn(slot);
    const [sx, sy] = this.spawns[idx % this.spawns.length];
    this.spawnAt(slot, sx, this.terrain.findStand(sx, sy));
  }

  spawnAt(slot, x, y) {
    const p = this.players[slot];
    const btn = p.btn;
    resetLoadout(p);
    p.btn = btn;
    p.x = x;
    p.y = y;
    p.aim = x < this.worldW / 2 ? 0 : Math.PI;
    p.dead = false;
    p.respawnT = 0;
    p.grounded = false;
    p.shield = RULES.SHIELD;
    p.flips = PHYS.FLIPS;
    this.emit({ e: 'spawn', s: slot, x: r1(p.x), y: r1(p.y) });
  }

  // Applies one client input for `slot`. `inp` = { s, b, a, w, v }.
  applyInput(slot, inp) {
    if (!this.present[slot]) return;
    const p = this.players[slot];
    const out = [];
    const lag = Math.max(0, Math.min(MAX_REWIND, this.tick - (inp.v | 0)));
    stepPlayer(p, inp, this.terrain, out, { noFire: !this.allowFire });
    for (const a of out) {
      if (a.k === 'fire') this.fire(slot, a, inp.s, lag);
      else if (a.k === 'nade') this.throwNade(slot, a, inp.s);
      else if (a.k === 'det') this.detonateC4(slot);
    }
    if (p.flaming) this.continuous(slot, lag);
  }

  // Position of `slot` as the shooter saw it `lag` ticks ago.
  rewound(slot, lag) {
    const p = this.players[slot];
    if (lag > 0) {
      const h = this.history[(this.tick - lag) % HISTORY];
      if (h && h.tick === this.tick - lag) return { x: h.x[slot], y: h.y[slot], alive: h.alive[slot] && !p.dead };
    }
    return { x: p.x, y: p.y, alive: !p.dead };
  }

  // First enemy of `slot` crossed by the segment, as { s, f } with f in [0, 1], or null.
  firstHit(slot, x1, y1, x2, y2, pad, lag) {
    let best = null;
    for (const s of this.targets(slot)) {
      const o = this.rewound(s, lag);
      if (!o.alive) continue;
      const f = segAabb(x1, y1, x2, y2, ...playerBox(o.x, o.y, pad));
      if (f >= 0 && (!best || f < best.f)) best = { s, f };
    }
    return best;
  }

  owns(slot, w) {
    return owns(this.players[slot].owned, w);
  }

  // ---------- world update ----------

  update() {
    this.tick++;
    this.worldTriggers();
    for (let s = 0; s < this.n; s++) if (!this.players[s].flaming) this.flushFlame(s);
    this.updateBullets();
    this.updateProjs();
    this.updateItems();
    if (this.autoRespawn) {
      for (let s = 0; s < this.n; s++) {
        const p = this.players[s];
        if (!this.present[s] || !p.dead) continue;
        p.respawnT -= DT;
        if (p.respawnT <= 0) this.spawn(s);
      }
    }
    this.stepWorld();
    const x = new Array(this.n);
    const y = new Array(this.n);
    const alive = new Array(this.n);
    for (let s = 0; s < this.n; s++) {
      const p = this.players[s];
      x[s] = p.x;
      y[s] = p.y;
      alive[s] = this.present[s] && !p.dead;
    }
    this.history[this.tick % HISTORY] = { tick: this.tick, x, y, alive };
  }

  snapshot() {
    const ops = this.opLog.slice(this.opSent);
    const os = this.opSent;
    this.opSent = this.opLog.length;
    return {
      k: this.tick,
      p: this.players.map((p, s) => (this.present[s] ? packPlayer(p) : null)),
      j: this.projs.map(packProj),
      c: this.items.map((c) => [c.id, r1(c.x), r1(c.y), Math.round(c.t * 10) / 10, c.kind]),
      o: ops,
      os,
      st: this.sim.t,
      ar: this.armoryOn && (this.baseOwned & this.pool) !== this.pool ? Math.ceil(this.armoryT) : -1,
      e: this.takeEvents(),
    };
  }

  // Everything a client needs to rebuild the current world: map + every terrain op so far,
  // plus the weapon pool `wp` the hotbar is built from.
  mapState() {
    return { id: this.mapId, seed: this.seed, ops: this.opLog, st: this.sim.t, k: this.tick, wp: this.pool };
  }
}

Object.assign(Game.prototype, combat, blasts, items, world);
