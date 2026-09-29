import { DT, RULES, SNAP_EVERY } from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';
import { randomSeed } from '../shared/rng.js';
import { FULL_POOL, sanitizePool } from '../shared/weapons.js';
import { Game } from './game.js';
import { processInputs, queueInputs, resetInputs, send, sendSnapshot } from './inputs.js';

// One 1v1 match: two slots, match flow and the weapon pool. No unlocks in 1v1: both players own
// every allowed weapon from the first second, and sky crates only heal and refill.
export class Room {
  constructor(code, { pub = false, map = 'landing', goal = 5, pool = FULL_POOL } = {}) {
    this.code = code;
    this.pub = pub;
    this.mapId = MAPS[map] ? map : 'landing';
    this.goal = RULES.GOALS.includes(goal) ? goal : 5;
    this.clients = [null, null];
    this.state = 'waiting';
    this.timer = 0;
    this.scores = [0, 0];
    this.winner = -1;
    this.rematch = [false, false];
    this.pool = sanitizePool(pool);
    this.game = new Game(this.mapId, randomSeed());
    this.game.onKill = (v, by) => this.onKill(v, by);
    this.applyPool();
    this.applyRules();
  }

  get count() {
    return (this.clients[0] ? 1 : 0) + (this.clients[1] ? 1 : 0);
  }

  get full() {
    return this.count >= 2;
  }

  // Takes effect on the next reset (match start, map change) and for waiting players right away.
  applyPool() {
    const g = this.game;
    g.pool = this.pool;
    g.startOwned = this.pool;
    g.baseOwned = this.pool;
  }

  broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const c of this.clients) send(c, raw);
  }

  info() {
    return {
      t: 'room', code: this.code, st: this.state, timer: Math.round(this.timer * 100) / 100, goal: this.goal,
      scores: this.scores, names: this.clients.map((c) => (c ? c.name : null)), winner: this.winner,
      rematch: this.rematch, map: this.mapId, pub: this.pub, pool: this.pool,
    };
  }

  mapMsg() {
    return { t: 'map', ...this.game.mapState() };
  }

  applyRules() {
    const g = this.game;
    g.allowFire = this.state !== 'countdown';
    g.scoring = this.state === 'playing';
    g.cratesOn = this.state === 'playing';
    g.armoryOn = false;
  }

  join(client) {
    const slot = this.clients[0] ? 1 : 0;
    this.clients[slot] = client;
    client.room = this;
    resetInputs(client, slot, slot === 0 ? 0 : Math.PI);
    send(client, { t: 'joined', code: this.code, slot, pub: this.pub });
    if (this.count === 2) {
      this.startMatch();
    } else {
      this.game.addPlayer(slot);
      send(client, this.mapMsg());
      this.broadcast(this.info());
    }
    return slot;
  }

  leave(client) {
    const slot = client.slot;
    if (this.clients[slot] !== client) return;
    this.clients[slot] = null;
    client.room = null;
    this.game.removePlayer(slot);
    this.state = 'waiting';
    this.timer = 0;
    this.scores = [0, 0];
    this.winner = -1;
    this.rematch = [false, false];
    this.applyRules();
    this.broadcast({ t: 'left', slot });
    this.broadcast(this.info());
  }

  startMatch() {
    this.game.reset(this.mapId, randomSeed());
    for (let s = 0; s < 2; s++) {
      const c = this.clients[s];
      if (!c) continue;
      this.game.present[s] = true;
      this.game.spawn(s, s);
      this.game.players[s].btn = c.last.b;
    }
    this.game.takeEvents();
    this.scores = [0, 0];
    this.winner = -1;
    this.rematch = [false, false];
    this.state = 'countdown';
    this.timer = RULES.COUNTDOWN;
    this.applyRules();
    this.broadcast(this.mapMsg());
    this.broadcast(this.info());
  }

  onKill(victim, by) {
    if (this.state !== 'playing') return;
    const point = by === victim || by < 0 ? 1 - victim : by;
    this.scores[point]++;
    if (this.scores[point] >= this.goal) {
      this.state = 'over';
      this.winner = point;
      this.applyRules();
    }
    this.broadcast(this.info());
  }

  requestRematch(client, map) {
    if (this.state !== 'over' || this.count < 2) return;
    if (map && MAPS[map] && !MAPS[map].hidden) this.mapId = map;
    this.rematch[client.slot] = true;
    if (this.rematch[0] && this.rematch[1]) this.startMatch();
    else this.broadcast(this.info());
  }

  setMap(client, map) {
    if (!MAPS[map] || (MAPS[map].hidden && map !== 'flat')) return;
    if (this.state === 'countdown' || this.state === 'playing') return;
    this.mapId = map;
    if (this.state === 'waiting') {
      this.game.reset(this.mapId, randomSeed());
      for (let s = 0; s < 2; s++) if (this.clients[s]) this.game.addPlayer(s);
      this.game.takeEvents();
      this.broadcast(this.mapMsg());
    }
    this.broadcast(this.info());
  }

  setOpts(client, { pool }) {
    if (this.state === 'countdown' || this.state === 'playing') return;
    this.pool = sanitizePool(pool, this.pool);
    this.applyPool();
    if (this.state === 'waiting') {
      for (let s = 0; s < 2; s++) {
        const p = this.game.players[s];
        if (!this.clients[s]) continue;
        p.owned = this.pool;
        if (!(this.pool & (1 << p.w))) p.w = 0;
      }
    }
    this.broadcast(this.info());
  }

  queueInputs(client, list) {
    queueInputs(client, list);
  }

  tick() {
    processInputs(this.clients, (s, inp) => this.game.applyInput(s, inp));
    this.game.update();
    if (this.state === 'countdown') {
      this.timer -= DT;
      if (this.timer <= 0) {
        this.state = 'playing';
        this.timer = 0;
        this.applyRules();
        this.broadcast(this.info());
      }
    }
    if (this.game.tick % SNAP_EVERY === 0) this.sendSnapshot();
  }

  sendSnapshot() {
    sendSnapshot(this.clients, this.game.snapshot());
  }
}
