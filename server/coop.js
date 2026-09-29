import { SNAP_EVERY } from '../shared/constants.js';
import { randomSeed } from '../shared/rng.js';
import { MAX_HUMANS, Survival } from '../shared/survival.js';
import { FULL_POOL, sanitizePool } from '../shared/weapons.js';
import { processInputs, queueInputs, resetInputs, send, sendSnapshot } from './inputs.js';

// Online co-op survival: up to MAX_HUMANS players against the waves of shared/survival.js.
// States: 'lobby' (warm-up, anyone can press START or change the weapon pool), 'playing',
// 'over' (START plays again). Snapshots carry the survival state in `sv` next to the usual Game
// snapshot fields.
export class CoopRoom {
  constructor(code, { pool = FULL_POOL } = {}) {
    this.code = code;
    this.pub = false;
    this.clients = new Array(MAX_HUMANS).fill(null);
    this.state = 'lobby';
    this.pool = sanitizePool(pool);
    this.run = new Survival(randomSeed(), { lobby: true, pool: this.pool });
  }

  get game() {
    return this.run.game;
  }

  get count() {
    return this.clients.filter(Boolean).length;
  }

  get full() {
    return this.count >= MAX_HUMANS;
  }

  broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const c of this.clients) send(c, raw);
  }

  info() {
    return {
      t: 'coop', code: this.code, st: this.state, pool: this.pool, names: this.clients.map((c) => (c ? c.name : null)),
    };
  }

  mapMsg() {
    return { t: 'map', ...this.game.mapState() };
  }

  join(client) {
    const slot = this.clients.indexOf(null);
    this.clients[slot] = client;
    client.room = this;
    resetInputs(client, slot);
    send(client, { t: 'joined', code: this.code, slot, pub: false, mode: 'coop' });
    this.run.addHuman(slot);
    send(client, this.mapMsg());
    this.broadcast(this.info());
    return slot;
  }

  leave(client) {
    const slot = client.slot;
    if (this.clients[slot] !== client) return;
    this.clients[slot] = null;
    client.room = null;
    this.run.removeHuman(slot);
    this.broadcast({ t: 'left', slot });
    this.broadcast(this.info());
  }

  // Anyone in the lobby (or on the game over panel) can change the weapon pool of the next run.
  // Warm-up arsenals follow right away; clients rebuild their hotbar from the `pool` in info().
  setOpts(client, { pool }) {
    if (this.state === 'playing') return;
    const next = sanitizePool(pool, this.pool);
    if (next === this.pool) return;
    this.pool = next;
    if (this.state === 'lobby') this.run.setPool(next);
    this.broadcast(this.info());
  }

  // Starts a run (from the lobby or after a game over) on a fresh map with everyone present.
  begin() {
    if (this.state === 'playing') return;
    this.run = new Survival(randomSeed(), { pool: this.pool });
    for (const c of this.clients) {
      if (!c) continue;
      this.run.addHuman(c.slot);
      this.game.players[c.slot].btn = c.last.b;
    }
    this.state = 'playing';
    this.broadcast(this.mapMsg());
    this.broadcast(this.info());
  }

  queueInputs(client, list) {
    queueInputs(client, list);
  }

  tick() {
    processInputs(this.clients, (s, inp) => this.run.applyInput(s, inp));
    this.run.step();
    const events = this.run.takeEvents();
    if (this.state === 'playing' && events.some((e) => e.e === 'over')) {
      this.state = 'over';
      this.broadcast(this.info());
    }
    if (events.length) this.pendingEvents = (this.pendingEvents || []).concat(events);
    if (this.game.tick % SNAP_EVERY === 0) {
      const snap = this.game.snapshot();
      snap.sv = this.run.state();
      snap.se = this.pendingEvents || [];
      this.pendingEvents = null;
      sendSnapshot(this.clients, snap);
    }
  }
}
