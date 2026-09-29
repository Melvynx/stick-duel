import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { Room } from '../server/room.js';
import { Game } from '../shared/game.js';
import { createPlayer, unpackPlayer } from '../shared/player.js';
import { MAX_HUMANS, Survival } from '../shared/survival.js';
import {
  BASIC_POOL, FULL_POOL, START_OWNED, UNLOCKS, W, owns, poolList, poolStart, sanitizePool,
} from '../shared/weapons.js';

let srv;
before(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1' });
});
after(async () => {
  await srv.close();
});

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const c = { ws, msgs: [], waiters: [], snap: null };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 's') c.snap = m;
    c.msgs.push(m);
    c.waiters = c.waiters.filter((w) => !w(m));
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 8000) =>
    new Promise((res, rej) => {
      const found = c.msgs.find(pred);
      if (found) return res(found);
      const to = setTimeout(() => rej(new Error('timeout')), ms);
      c.waiters.push((m) => {
        if (!pred(m)) return false;
        clearTimeout(to);
        res(m);
        return true;
      });
    });
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

const idle = { s: 0, b: 0, a: 0, w: 0, v: 0 };

test('solo survival: spent lives revive on the fort, then the last death ends the run', () => {
  const run = new Survival(1234);
  run.addHuman(0);
  const g = run.game;
  const events = [];
  let seq = 0;
  const tick = () => {
    run.applyInput(0, { ...idle, s: ++seq, v: g.tick });
    run.step();
    events.push(...run.takeEvents());
  };
  while (!events.some((e) => e.e === 'wave')) tick();
  assert.equal(run.lives, 3, 'three spare lives for one player');
  const start = [W.pistol, W.smg, W.shotgun, W.builder];
  assert.equal(g.players[0].owned, start.reduce((m, w) => m | (1 << w), 0), 'pistol, smg, shotgun and builder');
  // Kill the player every time it stands again: 3 downs with revives, then out and over.
  for (let i = 0; i < 60 * 30 && !events.some((e) => e.e === 'over'); i++) {
    if (!g.players[0].dead && g.players[0].shield <= 0) g.kill(0, MAX_HUMANS, 0);
    tick();
  }
  const kinds = events.map((e) => e.e);
  assert.equal(kinds.filter((k) => k === 'down').length, 3);
  assert.equal(kinds.filter((k) => k === 'revive').length, 3);
  assert.ok(kinds.indexOf('out') > kinds.lastIndexOf('revive'));
  assert.ok(kinds.includes('over'));
  assert.equal(run.state().over, true);
});

test('co-op survival: shared lives scale with the crew and bots only fight humans', () => {
  const run = new Survival(99);
  run.addHuman(0);
  run.addHuman(1);
  run.step();
  assert.equal(run.lives, 4);
  assert.equal(run.game.hostile(0, 1), false);
  // Wave 1 for two players sends more enemies than alone.
  for (let i = 0; i < 60 * 4; i++) run.step();
  const wave = run.takeEvents().find((e) => e.e === 'wave');
  const alone = new Survival(99);
  alone.addHuman(0);
  for (let i = 0; i < 60 * 4; i++) alone.step();
  const soloWave = alone.takeEvents().find((e) => e.e === 'wave');
  assert.ok(wave.count > soloWave.count, `${wave.count} > ${soloWave.count}`);
  const bots = run.state().r.map((k, s) => (k ? s : -1)).filter((s) => s >= 0);
  assert.ok(bots.length > 0 && bots.every((s) => s >= MAX_HUMANS && run.game.hostile(s, 0)));
});

test('co-op room over websocket: two players, start, shared waves', async () => {
  const a = client();
  const b = client();
  await Promise.all([a.open, b.open]);
  a.send({ t: 'coop', name: 'alice' });
  const ja = await a.wait((m) => m.t === 'joined');
  assert.equal(ja.mode, 'coop');
  b.send({ t: 'join', name: 'bob', code: ja.code });
  const jb = await b.wait((m) => m.t === 'joined');
  assert.equal(jb.slot, 1);
  await a.wait((m) => m.t === 'coop' && m.names[1] === 'BOB');
  a.send({ t: 'start' });
  await b.wait((m) => m.t === 'coop' && m.st === 'playing');
  const snap = await b.wait((m) => m.t === 's' && m.sv && m.sv.wave >= 1 && m.sv.r.some(Boolean), 9000);
  assert.ok(snap.p[0] && snap.p[1], 'both humans are in the run');
  assert.equal(snap.sv.lives, 4);
  a.ws.close();
  b.ws.close();
});

test('weapon pools: presets, sanitizing, retired weapons', () => {
  for (const w of [W.sand, W.quake]) {
    assert.ok(!UNLOCKS.includes(w), 'retired weapons are never selectable');
    assert.ok(!owns(FULL_POOL, w) && !owns(BASIC_POOL, w));
  }
  assert.ok(owns(BASIC_POOL, W.builder) && owns(FULL_POOL, W.builder), 'the builder is in every preset');
  assert.deepEqual(poolList(BASIC_POOL), [W.pistol, W.smg, W.shotgun, W.builder, W.rocket, W.rail]);
  const custom = sanitizePool((1 << W.rocket) | (1 << W.sand) | (1 << W.quake) | (1 << 30));
  assert.equal(custom, (1 << W.rocket) | START_OWNED, 'pistol forced, retired and unknown bits dropped');
  assert.equal(sanitizePool(0), START_OWNED);
  assert.equal(sanitizePool('basic'), BASIC_POOL);
  assert.equal(sanitizePool('nope'), FULL_POOL);
  assert.equal(sanitizePool(-5, BASIC_POOL), BASIC_POOL);
  assert.equal(sanitizePool(undefined), FULL_POOL);
});

test('1v1 rooms: everyone owns the whole pool, no armory, crates only heal and refill', () => {
  const quick = new Room('QUIK', { pub: true });
  assert.equal(quick.pool, FULL_POOL, 'quick match allows every weapon');
  const r = new Room('TEST', { pool: (1 << W.rocket) | (1 << W.sand) });
  assert.equal(r.pool, START_OWNED | (1 << W.rocket));
  const fake = (slot) => ({ slot, name: 'X', last: { b: 0 }, ws: { readyState: 3 } });
  r.join(fake(0));
  r.join(fake(1));
  const g = r.game;
  assert.equal(r.state, 'countdown');
  for (const p of g.players) assert.equal(p.owned, r.pool);
  assert.equal(g.mapState().wp, r.pool);
  r.state = 'playing';
  r.applyRules();
  assert.equal(g.armoryOn, false);
  for (let i = 0; i < 60 * 45; i++) g.update();
  assert.ok(!g.takeEvents().some((e) => e.e === 'u'), 'no unlocks over time');
  assert.equal(g.nextLocked(0), -1, 'nothing left to unlock inside the pool');
  const p = g.players[0];
  const before = p.owned;
  p.ammo[W.rocket] = 0;
  g.pickup(0, { id: 99, kind: 0, x: p.x, y: p.y });
  assert.equal(p.owned, before, 'crates never grant weapons');
  assert.ok(p.ammo[W.rocket] > 0, 'crates refill');
  // Waiting room: the pool changes and applies to whoever waits.
  const w = new Room('WAIT');
  w.join(fake(0));
  w.setOpts({}, { pool: BASIC_POOL });
  assert.equal(w.pool, BASIC_POOL);
  assert.equal(w.game.players[0].owned, BASIC_POOL);
  assert.equal(w.info().pool, BASIC_POOL);
  w.setOpts({}, { pool: 'garbage' });
  assert.equal(w.pool, BASIC_POOL, 'invalid pool keeps the current one');
});

test('nextLocked and the armory never leave the pool', () => {
  const g = new Game('flat', 7);
  g.pool = START_OWNED | (1 << W.rail) | (1 << W.c4);
  g.startOwned = START_OWNED;
  g.reset('flat', 7);
  g.addPlayer(0, 0);
  g.addPlayer(1, 1);
  const got = [];
  for (let w = g.nextLocked(0); w >= 0; w = g.nextLocked(0)) {
    got.push(w);
    g.grant(0, w, true);
  }
  assert.deepEqual(got, [W.rail, W.c4]);
  g.armoryUnlock();
  g.armoryUnlock();
  g.armoryUnlock();
  assert.equal(g.players[1].owned, g.pool);
});

test('survival progression stays inside the pool', () => {
  const pool = sanitizePool((1 << W.smg) | (1 << W.rail) | (1 << W.c4) | (1 << W.toomuch) | (1 << W.flame));
  const run = new Survival(5, { pool });
  run.addHuman(0);
  const g = run.game;
  const owned = () => poolList(pool).filter((w) => owns(g.players[0].owned, w));
  assert.equal(g.players[0].owned, poolStart(pool));
  assert.ok(owned().length <= 4);
  assert.equal(g.mapState().wp, pool);
  for (let wave = 0; wave < 6; wave++) {
    run.wave++;
    run.clearWave();
  }
  assert.equal(g.players[0].owned, pool, 'every cleared wave unlocks the next pool weapon, nothing else');
  const unlocked = g.takeEvents().filter((e) => e.e === 'u').map((e) => e.w);
  assert.deepEqual(unlocked, poolList(pool).filter((w) => !owns(poolStart(pool), w)));
  const solo = new Survival(6);
  assert.equal(solo.game.pool, FULL_POOL);
});

test('1v1 rooms and co-op lobbies take a weapon pool over websocket', async () => {
  const a = client();
  await a.open;
  const hello = await a.wait((m) => m.t === 'hello');
  assert.ok(hello.pools.some((p) => p.id === 'basic' && p.mask === BASIC_POOL));
  assert.deepEqual(hello.weapons.map((x) => x.w), UNLOCKS);
  a.send({ t: 'create', name: 'alice', map: 'flat', goal: 3, pool: (1 << W.rail) | (1 << W.sand) });
  const info = await a.wait((m) => m.t === 'room');
  assert.equal(info.pool, START_OWNED | (1 << W.rail));
  assert.equal(info.armory, undefined);
  const map = await a.wait((m) => m.t === 'map');
  assert.equal(map.wp, info.pool);
  a.send({ t: 'setopts', pool: BASIC_POOL });
  await a.wait((m) => m.t === 'room' && m.pool === BASIC_POOL);

  const b = client();
  const c = client();
  await Promise.all([b.open, c.open]);
  b.send({ t: 'coop', name: 'bob' });
  const jb = await b.wait((m) => m.t === 'joined');
  const first = await b.wait((m) => m.t === 'coop');
  assert.equal(first.pool, FULL_POOL);
  c.send({ t: 'join', name: 'carol', code: jb.code });
  await c.wait((m) => m.t === 'coop' && m.names[1] === 'CAROL');
  const small = sanitizePool((1 << W.rocket) | (1 << W.c4));
  c.send({ t: 'setopts', pool: small });
  await b.wait((m) => m.t === 'coop' && m.pool === small);
  const ownedIn = (m, s) => (m.p[s] ? unpackPlayer(m.p[s], createPlayer(s)).owned : -1);
  await c.wait((m) => m.t === 's' && ownedIn(m, 0) === poolStart(small) && ownedIn(m, 1) === poolStart(small));
  b.send({ t: 'start' });
  const run = await c.wait((m) => m.t === 'map' && m.wp === small);
  assert.equal(run.wp, small);
  a.ws.close();
  b.ws.close();
  c.ws.close();
});
