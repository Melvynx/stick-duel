import { DT } from './constants.js';
import { Game } from './game.js';
import { mulberry32 } from './rng.js';
import { brain } from './survival-bots.js';
import { ALL_OWNED, FULL_POOL, GRENADE, fullAmmo, poolStart, sanitizePool } from './weapons.js';

// Wave survival on the outpost, for 1 to MAX_HUMANS players against bots. Runs in the browser for
// solo and on the server for online co-op. Humans hold slots [0, MAX_HUMANS) on team 0, bots the
// rest on team 1. Waves, team lives and revives live here, the bot brain in survival-bots.js.
// Everything the client needs beyond the Game snapshot comes from `state()` and `takeEvents()`.

export const SURVIVAL_MAP = 'outpost';
export const MAX_HUMANS = 4;
const MAX_BOTS = 10;
export const SURVIVAL_SLOTS = MAX_HUMANS + MAX_BOTS;
const HUMAN_SPAWN = 2; // roof of the central fort
const FIRST_BREAK = 3; // s before wave 1
const BREAK = 6; // s between waves
const CORPSE = 1.2; // s a dead enemy keeps its slot so clients see it die
const OVER_DELAY = 1.6; // s between the last death and the game over panel
const WAVE_HEAL = 100;
// Survival is forgiving: humans take less damage, heal out of combat and share spare lives.
const HUMAN_TAKE = 0.6;
const REGEN_DELAY = 3.5; // s without damage before health comes back
const REGEN = 10; // hp/s
const REVIVE = 2.5; // s before a spent life respawns on the fort roof
const REVIVE_SHIELD = 3; // s of spawn protection after a revive

// Team lives are spare revives shared by the crew: 3 alone, one more per extra player; every
// 5th wave adds one. With none left a downed player is out until the wave is cleared.
const startLives = (crew) => 2 + crew;
const maxLives = (crew) => 4 + crew;

// Enemy archetypes. `take` / `deal` scale damage received / dealt, `range` is the distance band
// the bot tries to hold, `gap` the pause between shots, `acc` scales its aim error.
export const ENEMIES = {
  grunt: { name: 'GRUNT', w: 0, color: '#7cc6ff', take: 1.7, deal: 0.26, range: [220, 460], gap: [0.7, 1.2], acc: 1, pts: 100, hop: 0.25 },
  brute: { name: 'BRUTE', w: 2, color: '#ffd23f', take: 0.85, deal: 0.3, range: [30, 150], gap: [1.0, 1.5], acc: 1.2, pts: 150, hop: 0.5, reach: 260 },
  rocketeer: { name: 'ROCKETEER', w: 3, color: '#b4ff5a', take: 1.4, deal: 0.3, range: [320, 620], gap: [2.0, 2.8], acc: 0.8, pts: 200, hop: 0.15 },
  flamer: { name: 'FLAMER', w: 5, color: '#3ee6c4', take: 1.1, deal: 0.3, range: [20, 120], gap: [0, 0], acc: 1.4, pts: 200, hop: 0.6, reach: 200 },
  sniper: { name: 'SNIPER', w: 4, color: '#c77dff', take: 1.9, deal: 0.28, range: [520, 950], gap: [3.0, 4.0], acc: 0.5, pts: 250, hop: 0, steady: 0.8, reach: 1400 },
  boss: { name: 'WARLORD', w: 6, alt: 1, color: '#ff3b5c', take: 0.25, deal: 0.32, range: [220, 480], gap: [2.2, 3.0], acc: 0.9, pts: 1500, hop: 0.2 },
};

export const isHuman = (s) => s < MAX_HUMANS;

// Which enemies wave `n` sends for a crew of `crew` humans, in spawn order.
function roster(n, crew, rng) {
  const pool = [['grunt', 6]];
  if (n >= 2) pool.push(['brute', 3]);
  if (n >= 3) pool.push(['rocketeer', 2]);
  if (n >= 4) pool.push(['flamer', 2]);
  if (n >= 6) pool.push(['sniper', 2]);
  const sum = pool.reduce((s, [, w]) => s + w, 0);
  const boss = n % 5 === 0;
  const base = boss ? 2 + n : 2 + n + Math.floor(n / 2);
  const total = Math.min(26 + 8 * (crew - 1), Math.round(base * (1 + 0.6 * (crew - 1))));
  const out = [];
  while (out.length < total) {
    let r = rng() * sum;
    for (const [key, w] of pool) {
      r -= w;
      if (r <= 0) {
        out.push(key);
        break;
      }
    }
  }
  // The boss comes third; bigger crews face one boss per two players.
  if (boss) for (let i = 0; i < Math.ceil(crew / 2); i++) out.splice(Math.min(2 + i * 4, out.length), 0, 'boss');
  return out;
}

export class Survival {
  // `lobby`: players warm up (auto respawn, no waves) until `begin()`.
  // `pool`: allowed weapons; humans start with its first 4 and each cleared wave unlocks the next.
  constructor(seed, { lobby = false, pool = FULL_POOL } = {}) {
    this.pool = sanitizePool(pool);
    this.reset(seed, lobby);
  }

  reset(seed, lobby = false) {
    const g = new Game(SURVIVAL_MAP, seed, SURVIVAL_SLOTS);
    g.team = g.team.map((_, s) => (isHuman(s) ? 0 : 1));
    g.autoRespawn = lobby;
    g.cratesOn = !lobby;
    g.canLoot = g.canLoot.map((_, s) => isHuman(s));
    g.pool = this.pool;
    g.startOwned = poolStart(this.pool);
    g.baseOwned = g.startOwned;
    g.onKill = (v, by) => this.onKill(v, by);
    this.game = g;
    this.seed = seed;
    this.lobby = lobby;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.bots = new Array(SURVIVAL_SLOTS).fill(null);
    this.crew = new Array(MAX_HUMANS).fill(null); // per human: revive timer, regen, out
    this.keys = new Array(SURVIVAL_SLOTS).fill('');
    this.events = [];
    this.spawnUse = [];
    this.time = 0;
    this.wave = 0;
    this.kills = 0;
    this.score = 0;
    this.phase = lobby ? 'lobby' : 'break'; // lobby | break | fight
    this.timer = FIRST_BREAK;
    this.pendingSpawns = [];
    this.spawnT = 0;
    this.over = false;
    this.overT = 0;
    this.overSent = false;
    this.lives = 0;
    this.livesSet = false;
    this.setDifficulty(1);
  }

  emit(ev) {
    this.events.push(ev);
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- humans ----------

  humans() {
    const out = [];
    for (let s = 0; s < MAX_HUMANS; s++) if (this.crew[s]) out.push(s);
    return out;
  }

  crewSize() {
    return Math.max(1, this.humans().length);
  }

  // New weapon pool (lobby warm-up): everyone restarts from the pool's starting arsenal.
  setPool(pool) {
    const g = this.game;
    this.pool = sanitizePool(pool, this.pool);
    g.pool = this.pool;
    g.startOwned = poolStart(this.pool);
    g.baseOwned = g.startOwned;
    for (const s of this.humans()) {
      const p = g.players[s];
      p.owned = g.baseOwned;
      if (!(p.owned & (1 << p.w))) p.w = 0;
    }
  }

  // A newcomer gets the crew's arsenal; mid-run it also brings one life.
  addHuman(slot) {
    const g = this.game;
    let owned = g.baseOwned;
    for (const s of this.humans()) owned |= g.players[s].owned;
    g.takeMul[slot] = HUMAN_TAKE;
    g.addPlayer(slot, HUMAN_SPAWN);
    this.place(slot);
    g.players[slot].owned = owned;
    this.crew[slot] = { reviveT: 0, calmT: 0, lastHp: 100, out: false };
    if (!this.livesSet) return;
    this.lives = Math.min(maxLives(this.crewSize()), this.lives + 1);
  }

  removeHuman(slot) {
    if (!this.crew[slot]) return;
    this.crew[slot] = null;
    this.game.removePlayer(slot);
    this.checkOver();
  }

  applyInput(slot, inp) {
    this.game.applyInput(slot, inp);
  }

  // ---------- tick ----------

  step() {
    const g = this.game;
    this.time += DT;
    if (!this.lobby && !this.livesSet && this.humans().length) {
      this.livesSet = true;
      this.lives = startLives(this.crewSize());
    }
    for (let s = MAX_HUMANS; s < SURVIVAL_SLOTS; s++) {
      const bot = this.bots[s];
      if (!bot) continue;
      if (g.players[s].dead) {
        bot.deadT += DT;
        if (bot.deadT > CORPSE) {
          g.removePlayer(s);
          this.bots[s] = null;
          this.keys[s] = '';
        }
        continue;
      }
      g.applyInput(s, this.think(s, bot));
    }
    if (!this.lobby) {
      this.runWaves();
      for (const s of this.humans()) this.aid(s);
    }
    g.update();
  }

  // Everything clients show besides the game snapshot. `r`: enemy kind per slot ('' = none).
  state() {
    return {
      wave: this.wave,
      left: this.pendingSpawns.length + this.alive(),
      score: this.score,
      kills: this.kills,
      st: this.phase,
      lives: this.lives,
      timer: Math.round(this.timer * 10) / 10,
      over: this.over,
      r: this.keys,
    };
  }

  alive() {
    let n = 0;
    for (let s = MAX_HUMANS; s < SURVIVAL_SLOTS; s++) if (this.bots[s] && !this.game.players[s].dead) n++;
    return n;
  }

  // Out-of-combat regeneration and revives while team lives remain.
  aid(s) {
    const g = this.game;
    const h = this.crew[s];
    const p = g.players[s];
    if (h.reviveT > 0) {
      h.reviveT -= DT;
      if (h.reviveT <= 0) this.revive(s);
      return;
    }
    if (p.dead) return;
    if (p.hp < h.lastHp) h.calmT = 0;
    else h.calmT += DT;
    if (h.calmT > REGEN_DELAY && p.hp < 100) p.hp = Math.min(100, p.hp + REGEN * DT);
    h.lastHp = p.hp;
  }

  // Each human gets its own spot on the fort roof so the crew never spawns stacked.
  place(s) {
    const g = this.game;
    const [sx, sy] = g.spawns[HUMAN_SPAWN];
    const x = sx + (s - (MAX_HUMANS - 1) / 2) * 26;
    g.spawnAt(s, x, g.terrain.findStand(x, sy));
  }

  revive(s) {
    const g = this.game;
    const h = this.crew[s];
    this.place(s);
    g.players[s].shield = REVIVE_SHIELD;
    h.reviveT = 0;
    h.out = false;
    h.lastHp = g.players[s].hp;
    this.emit({ e: 'revive', s });
  }

  checkOver() {
    if (this.lobby || this.over) return;
    const hs = this.humans();
    if (hs.length && hs.every((s) => this.crew[s].out)) {
      this.over = true;
      this.overT = 0;
    }
  }

  // ---------- waves ----------

  setDifficulty(n) {
    const k = Math.min(1, (n - 1) / 14);
    const crew = this.crew ? this.crewSize() : 1;
    this.aimErr = 0.3 - 0.14 * k;
    this.reaction = 0.9 - 0.45 * k;
    this.turn = 2.5 + 4 * k;
    this.gapMul = 1.5 - 0.5 * k;
    this.dealScale = Math.min(1.35, 1 + 0.035 * (n - 1));
    this.maxAlive = Math.min(MAX_BOTS, 2 + Math.floor(n / 2) + 2 * (crew - 1));
  }

  runWaves() {
    if (this.over) {
      this.overT += DT;
      if (this.overT > OVER_DELAY && !this.overSent) {
        this.overSent = true;
        this.emit({ e: 'over', wave: this.wave, kills: this.kills, score: this.score });
      }
      return;
    }
    if (this.phase === 'break') {
      this.timer -= DT;
      if (this.timer <= 0) this.startWave();
      return;
    }
    this.spawnT -= DT;
    if (this.pendingSpawns.length && this.spawnT <= 0 && this.alive() < this.maxAlive) {
      const slot = this.freeSlot();
      if (slot > 0) {
        this.spawnBot(slot, this.pendingSpawns.shift());
        this.spawnT = (0.9 + this.rng() * 0.8) / Math.sqrt(this.crewSize());
      }
    }
    if (!this.pendingSpawns.length && this.alive() === 0) this.clearWave();
  }

  startWave() {
    this.wave++;
    this.setDifficulty(this.wave);
    this.pendingSpawns = roster(this.wave, this.crewSize(), this.rng);
    this.phase = 'fight';
    this.spawnT = 0.4;
    this.emit({ e: 'wave', n: this.wave, count: this.pendingSpawns.length, boss: this.pendingSpawns.includes('boss') });
  }

  // Cleared: heal and refill the living, bring back whoever is out, unlock the next weapon.
  clearWave() {
    const g = this.game;
    const bonus = 250 * this.wave;
    this.score += bonus;
    this.phase = 'break';
    this.timer = BREAK;
    for (const s of this.humans()) {
      const p = g.players[s];
      const h = this.crew[s];
      if (h.out) this.revive(s);
      else if (!p.dead) {
        p.hp = Math.min(100, p.hp + WAVE_HEAL);
        p.ammo = fullAmmo();
        p.nades = GRENADE.count;
      }
      g.grant(s, g.nextLocked(s));
    }
    if (this.wave % 5 === 0 && this.lives < maxLives(this.crewSize())) {
      this.lives++;
      this.emit({ e: 'life', lives: this.lives });
    }
    this.emit({ e: 'clear', n: this.wave, bonus });
  }

  freeSlot() {
    for (let s = MAX_HUMANS; s < SURVIVAL_SLOTS; s++) if (!this.bots[s] && !this.game.present[s]) return s;
    return -1;
  }

  // Enemies enter at a map spawn far from every human, never twice in a row at the same one.
  spawnBot(slot, key) {
    const g = this.game;
    const T = ENEMIES[key];
    const hs = this.humans().map((s) => g.players[s]).filter((p) => !p.dead);
    const pts = g.spawns.map(([x, y], i) => ({ i, x, y: g.terrain.findStand(x, y) }));
    const fresh = (q) => this.time - (this.spawnUse[q.i] ?? -99) > 2;
    const away = (q, d) => hs.every((p) => Math.hypot(q.x - p.x, q.y - p.y) > d);
    let pick = pts.filter((q) => fresh(q) && away(q, 700));
    if (!pick.length) pick = pts.filter((q) => away(q, 450));
    if (!pick.length) pick = pts;
    const sp = pick[Math.floor(this.rng() * pick.length)];
    this.spawnUse[sp.i] = this.time;

    g.takeMul[slot] = T.take;
    g.dealMul[slot] = T.deal * this.dealScale;
    g.addPlayer(slot, sp.i);
    this.keys[slot] = key;
    const p = g.players[slot];
    p.owned = ALL_OWNED;
    const rng = this.rng;
    const spread = 0.85 + rng() * 0.3;
    this.bots[slot] = {
      key, T, w: T.w, seq: 0, aim: p.aim, err: 0, errT: 0, los: false, losT: 0, seen: 0,
      fireT: 1.4 + rng() * 1.0, burst: 0, steady: 0, swapT: 5, tgt: -1, tgtT: 0,
      near: T.range[0] * spread, far: T.range[1] * spread,
      strafe: 0, strafeT: 0, jetT: 0, cool: 0, downT: 0, stuck: 0, lastX: p.x,
      detour: 0, detourT: 0, roofT: 0, edge: rng() < 0.5 ? -1 : 1, deadT: 0,
    };
  }

  onKill(v) {
    const g = this.game;
    if (isHuman(v)) {
      const h = this.crew[v];
      if (!h || this.lobby) return;
      if (this.lives > 0) {
        this.lives--;
        h.reviveT = REVIVE;
        this.emit({ e: 'down', s: v, lives: this.lives });
      } else {
        h.out = true;
        this.emit({ e: 'out', s: v });
        this.checkOver();
      }
      return;
    }
    const bot = this.bots[v];
    if (!bot) return;
    this.kills++;
    const pts = bot.T.pts * this.wave;
    this.score += pts;
    const p = g.players[v];
    this.emit({ e: 'pts', x: Math.round(p.x), y: Math.round(p.y), pts });
    // The boss always drops a supply crate.
    if (bot.key === 'boss') g.dropCrate(p.x);
  }
}

Object.assign(Survival.prototype, brain);
