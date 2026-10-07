import { DT, RULES, SNAP_EVERY } from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';
import { MODES } from '../shared/modes.js';
import { randomSeed } from '../shared/rng.js';
import { FULL_POOL, sanitizePool } from '../shared/weapons.js';
import { Game } from './game.js';
import { processInputs, queueInputs, resetInputs, send, sendSnapshot } from './inputs.js';

const SPAWN_GAP = 36; // world px between players sharing a start spawn
const SPAWN_STEP = 48; // max ground height difference for that side-step

// One online match room. No unlocks: everyone owns every allowed weapon from the first second,
// and sky crates only heal and refill.
// - 'duel': two slots, the match starts as soon as both are in, both players must want a rematch.
// - 'ffa' / 'teams': group rooms of up to MODES[mode].max players. The first player in is the
//   host: only they change the settings and start the match. Players can join mid-match; the
//   match falls back to the warm-up when too few players (or an empty team) are left.
export class Room {
  constructor(code, { pub = false, map, goal, pool = FULL_POOL, mode = 'duel' } = {}) {
    this.code = code;
    this.pub = pub;
    this.mode = MODES[mode] ? mode : 'duel';
    this.group = this.mode !== 'duel';
    this.max = MODES[this.mode].max;
    this.mapId = MAPS[map] ? map : this.group ? 'canyon' : 'landing';
    this.goal = MODES[this.mode].goals.includes(goal) ? goal : MODES[this.mode].goal;
    this.clients = new Array(this.max).fill(null);
    this.teams = new Array(this.max).fill(-1); // team of each slot in 'teams', -1 elsewhere
    this.host = -1;
    this.state = 'waiting';
    this.timer = 0;
    this.scores = new Array(this.max).fill(0); // kills (duel: points)
    this.deaths = new Array(this.max).fill(0);
    this.teamScores = [0, 0];
    this.winner = -1; // slot, or team in 'teams'
    this.rematch = new Array(this.max).fill(false);
    this.pool = sanitizePool(pool);
    this.game = new Game(this.mapId, randomSeed(), this.max);
    this.game.onKill = (v, by) => this.onKill(v, by);
    this.applyPool();
    this.applyRules();
  }

  get count() {
    let n = 0;
    for (const c of this.clients) if (c) n++;
    return n;
  }

  get full() {
    return this.count >= this.max;
  }

  // Takes effect on the next reset (match start, map change) and for waiting players right away.
  applyPool() {
    const g = this.game;
    g.pool = this.pool;
    g.startOwned = this.pool;
    g.baseOwned = this.pool;
  }

  applyTeams() {
    for (let s = 0; s < this.max; s++) this.game.team[s] = this.mode === 'teams' && this.teams[s] >= 0 ? this.teams[s] : s;
  }

  broadcast(msg) {
    const raw = JSON.stringify(msg);
    for (const c of this.clients) send(c, raw);
  }

  info() {
    return {
      t: 'room', code: this.code, mode: this.mode, max: this.max, host: this.host, st: this.state,
      timer: Math.round(this.timer * 100) / 100, goal: this.goal, scores: this.scores, deaths: this.deaths,
      teams: this.teams, teamScores: this.teamScores, names: this.clients.map((c) => (c ? c.name : null)),
      winner: this.winner, rematch: this.rematch, map: this.mapId, pub: this.pub, pool: this.pool,
    };
  }

  mapMsg() {
    return { t: 'map', ...this.game.mapState() };
  }

  // Only reads `game` and `state` (the arena harness borrows it for its headless matches).
  applyRules() {
    const g = this.game;
    g.allowFire = this.state !== 'countdown';
    g.scoring = this.state === 'playing';
    g.cratesOn = this.state === 'playing';
    g.armoryOn = false;
    g.infiniteAmmo = true;
  }

  isHost(client) {
    return !this.group || client.slot === this.host;
  }

  teamSize(t) {
    let n = 0;
    for (let s = 0; s < this.max; s++) if (this.clients[s] && this.teams[s] === t) n++;
    return n;
  }

  smallerTeam() {
    return this.teamSize(1) < this.teamSize(0) ? 1 : 0;
  }

  // Enough players for a match: two, and in 'teams' at least one per team.
  canPlay() {
    if (this.count < 2) return false;
    return this.mode !== 'teams' || (this.teamSize(0) > 0 && this.teamSize(1) > 0);
  }

  cantPlayMsg() {
    return this.mode === 'teams' && this.count >= 2 ? 'EACH TEAM NEEDS A PLAYER' : 'NEED AT LEAST 2 PLAYERS';
  }

  // Two players never share a name in one room: the newcomer gets a number (PLAYER, PLAYER-2...).
  uniqueName(name) {
    const taken = new Set(this.clients.filter(Boolean).map((c) => c.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) {
      const n = `${name.slice(0, 11 - String(i).length)}-${i}`;
      if (!taken.has(n)) return n;
    }
  }

  join(client) {
    const slot = this.clients.indexOf(null);
    client.name = this.uniqueName(client.name);
    this.clients[slot] = client;
    client.room = this;
    resetInputs(client, slot, slot % 2 === 0 ? 0 : Math.PI);
    if (this.host < 0) this.host = slot;
    this.scores[slot] = 0;
    this.deaths[slot] = 0;
    this.rematch[slot] = false;
    if (this.mode === 'teams') this.teams[slot] = this.smallerTeam();
    this.applyTeams();
    send(client, { t: 'joined', code: this.code, slot, pub: this.pub, mode: this.mode });
    if (!this.group && this.count === 2) {
      this.startMatch();
    } else {
      this.game.addPlayer(slot, this.group ? this.game.pickSpawn(slot) : slot);
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
    this.teams[slot] = -1;
    this.scores[slot] = 0;
    this.deaths[slot] = 0;
    this.rematch[slot] = false;
    if (this.host === slot) this.host = this.clients.findIndex(Boolean);
    if (!this.group || (this.state !== 'waiting' && !this.canPlay())) this.toWaiting();
    this.broadcast({ t: 'left', slot });
    this.broadcast(this.info());
  }

  toWaiting() {
    this.state = 'waiting';
    this.timer = 0;
    this.resetScores();
    this.applyRules();
  }

  resetScores() {
    this.scores.fill(0);
    this.deaths.fill(0);
    this.teamScores = [0, 0];
    this.winner = -1;
    this.rematch.fill(false);
  }

  // Start spawn index per slot: duel slot i on spawn i; each team on its own half of the map,
  // from the edge inwards; free-for-all spread across the map in a random order.
  startSpawns() {
    const order = new Map();
    const slots = [];
    for (let s = 0; s < this.max; s++) if (this.clients[s]) slots.push(s);
    if (!this.group) {
      for (const s of slots) order.set(s, s);
      return order;
    }
    const byX = this.game.spawns.map(([x], i) => ({ x, i })).sort((a, b) => a.x - b.x);
    if (this.mode === 'teams') {
      const mid = this.game.worldW / 2;
      const halves = [byX.filter((p) => p.x < mid), byX.filter((p) => p.x >= mid).reverse()];
      const seen = [0, 0];
      for (const s of slots) {
        const t = this.teams[s];
        const half = halves[t].length ? halves[t] : byX;
        order.set(s, half[seen[t]++ % half.length].i);
      }
      return order;
    }
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const n = slots.length;
    slots.forEach((s, k) => order.set(s, byX[n > 1 ? Math.round((k * (byX.length - 1)) / (n - 1)) % byX.length : 0].i));
    return order;
  }

  // Players sharing a spawn (more players than spawns) stand a body width apart, when the ground
  // there is at the same height; otherwise they share the spot and the spawn shield covers them.
  placeAtStart(order) {
    const g = this.game;
    const used = new Map();
    for (const [s, idx] of order) {
      g.present[s] = true;
      const k = used.get(idx) ?? 0;
      used.set(idx, k + 1);
      const [sx, sy] = g.spawns[idx];
      const base = g.terrain.findStand(sx, sy);
      let spot = null;
      if (k > 0) {
        const off = Math.ceil(k / 2) * SPAWN_GAP * (k % 2 ? 1 : -1);
        for (const x of [sx + off, sx - off]) {
          if (x < SPAWN_GAP || x > g.worldW - SPAWN_GAP) continue;
          const y = g.terrain.findStand(x, sy);
          if (Math.abs(y - base) <= SPAWN_STEP) {
            spot = [x, y];
            break;
          }
        }
      }
      if (spot) g.spawnAt(s, spot[0], spot[1]);
      else g.spawn(s, idx);
      g.players[s].btn = this.clients[s].last.b;
    }
  }

  startMatch() {
    this.game.reset(this.mapId, randomSeed());
    this.applyTeams();
    this.placeAtStart(this.startSpawns());
    this.game.takeEvents();
    this.resetScores();
    this.state = 'countdown';
    this.timer = RULES.COUNTDOWN;
    this.applyRules();
    this.broadcast(this.mapMsg());
    this.broadcast(this.info());
  }

  // Group rooms: the host starts from the warm-up or the results screen.
  begin(client) {
    if (!this.group || !this.isHost(client)) return;
    if (this.state === 'countdown' || this.state === 'playing') return;
    if (!this.canPlay()) {
      send(client, { t: 'err', m: this.cantPlayMsg() });
      return;
    }
    this.startMatch();
  }

  onKill(victim, by) {
    if (this.state !== 'playing') return;
    this.deaths[victim]++;
    const kill = by >= 0 && by !== victim;
    let win = -1;
    if (this.mode === 'duel') {
      const point = kill ? by : 1 - victim;
      this.scores[point]++;
      if (this.scores[point] >= this.goal) win = point;
    } else if (this.mode === 'ffa') {
      // A suicide or a death to the world costs a point, never below zero.
      if (kill) this.scores[by]++;
      else this.scores[victim] = Math.max(0, this.scores[victim] - 1);
      if (kill && this.scores[by] >= this.goal) win = by;
    } else {
      if (kill) this.scores[by]++;
      const t = kill ? this.teams[by] : 1 - this.teams[victim];
      this.teamScores[t]++;
      if (this.teamScores[t] >= this.goal) win = t;
    }
    if (win >= 0) {
      this.state = 'over';
      this.winner = win;
      this.applyRules();
    }
    this.broadcast(this.info());
  }

  // Duel: both players must ask. Group: the host restarts right away, the others mark themselves
  // ready, and the match also restarts once everyone is ready.
  requestRematch(client, map) {
    if (this.state !== 'over' || this.count < 2) return;
    if (map && MAPS[map] && !MAPS[map].hidden && this.isHost(client)) this.mapId = map;
    this.rematch[client.slot] = true;
    if (this.group) {
      const all = this.clients.every((c, s) => !c || this.rematch[s]);
      if (client.slot === this.host || all) {
        if (this.canPlay()) return this.startMatch();
        if (client.slot === this.host) send(client, { t: 'err', m: this.cantPlayMsg() });
      }
      return this.broadcast(this.info());
    }
    if (this.rematch[0] && this.rematch[1]) this.startMatch();
    else this.broadcast(this.info());
  }

  setMap(client, map) {
    if (!MAPS[map] || (MAPS[map].hidden && map !== 'flat')) return;
    if (this.state === 'countdown' || this.state === 'playing' || !this.isHost(client)) return;
    this.mapId = map;
    if (this.state === 'waiting') {
      this.game.reset(this.mapId, randomSeed());
      this.applyTeams();
      for (let s = 0; s < this.max; s++) if (this.clients[s]) this.game.addPlayer(s, this.group ? this.game.pickSpawn(s) : s);
      this.game.takeEvents();
      this.broadcast(this.mapMsg());
    }
    this.broadcast(this.info());
  }

  // `pool` and `goal` any room; `mode` (FFA <-> TEAMS) in group rooms. Host only in group rooms.
  setOpts(client, { pool, goal, mode } = {}) {
    if (this.state === 'countdown' || this.state === 'playing' || !this.isHost(client)) return;
    if (pool !== undefined) {
      this.pool = sanitizePool(pool, this.pool);
      this.applyPool();
      if (this.state === 'waiting') {
        for (let s = 0; s < this.max; s++) {
          const p = this.game.players[s];
          if (!this.clients[s]) continue;
          p.owned = this.pool;
          if (!(this.pool & (1 << p.w))) p.w = 0;
        }
      }
    }
    if (this.group && MODES[mode] && mode !== 'duel' && mode !== this.mode) {
      this.mode = mode;
      this.teams.fill(-1);
      if (mode === 'teams') for (let s = 0; s < this.max; s++) if (this.clients[s]) this.teams[s] = this.smallerTeam();
      this.applyTeams();
      if (!MODES[mode].goals.includes(this.goal)) this.goal = MODES[mode].goal;
      this.resetScores();
    }
    const n = Number(goal);
    if (MODES[this.mode].goals.includes(n)) this.goal = n;
    this.broadcast(this.info());
  }

  // Anyone can switch side in 'teams' outside a running match.
  setTeam(client, team) {
    if (this.mode !== 'teams' || (team !== 0 && team !== 1)) return;
    if (this.state === 'countdown' || this.state === 'playing') return;
    this.teams[client.slot] = team;
    this.applyTeams();
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
