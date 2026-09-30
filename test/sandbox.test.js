import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packBuild } from '../shared/build.js';
import { BTN, DT, MAT_BUILD, RULES } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import { ITEM } from '../shared/game/items.js';
import { TerrainSim } from '../shared/sim.js';
import { buildMap } from '../shared/maps.js';
import { START_OWNED, UNLOCKS, W, owns, sanitizePool } from '../shared/weapons.js';

const idle = (g, s, extra = {}) => g.applyInput(s, { s: g.tick, b: 0, a: 0, w: g.players[s].w, v: g.tick, ...extra });

function duel(map = 'flat') {
  const g = new Game(map, 1234);
  g.addPlayer(0, 0);
  g.addPlayer(1, 1);
  for (const p of g.players) p.shield = 0;
  return g;
}

test('players start with the pistol only and cannot switch to locked weapons', () => {
  const g = duel();
  assert.equal(g.players[0].owned, START_OWNED);
  idle(g, 0, { w: W.rocket });
  assert.equal(g.players[0].w, W.pistol);
});

test('the armory unlocks pool weapons in order for everyone', () => {
  const g = duel();
  g.pool = sanitizePool((1 << W.rocket) | (1 << W.rail));
  g.armoryOn = true;
  for (let i = 0; i < Math.ceil(RULES.ARMORY_EVERY / DT) + 2; i++) g.update();
  assert.ok(owns(g.players[0].owned, W.rocket), 'first pool weapon in unlock order');
  assert.ok(owns(g.players[1].owned, W.rocket));
  assert.ok(!owns(g.players[0].owned, UNLOCKS[1]), 'weapons outside the pool are skipped');
  assert.ok(!owns(g.players[0].owned, W.rail));
  const ev = g.takeEvents().find((e) => e.e === 'u');
  assert.deepEqual([ev.s, ev.w], [-1, W.rocket]);
});

test('crates unlock the next pool weapon, ammo boxes refill owned weapons', () => {
  const g = duel();
  const p = g.players[0];
  g.pickup(0, { id: 1, kind: ITEM.CRATE, x: p.x, y: p.y });
  assert.ok(owns(p.owned, UNLOCKS[1]));
  p.ammo[UNLOCKS[1]] = 0;
  g.pickup(0, { id: 2, kind: ITEM.AMMO, x: p.x, y: p.y });
  assert.ok(p.ammo[UNLOCKS[1]] > 0);
  g.pool = START_OWNED | (1 << UNLOCKS[1]);
  const before = p.owned;
  g.pickup(0, { id: 3, kind: ITEM.CRATE, x: p.x, y: p.y });
  assert.equal(p.owned, before, 'a crate with the pool exhausted only heals and refills');
});

test('a death drops an ammo pack', () => {
  const g = duel();
  g.damage(1, 500, 0, W.pistol, 0, 0, 0, 0);
  assert.ok(g.items.some((c) => c.kind === ITEM.PACK));
});

test('terrain ops replay to the same world on a fresh client sim', () => {
  const g = duel('landing');
  g.grant(0, W.builder);
  g.grant(0, W.rocket);
  const p = g.players[0];
  // Walls and floors, both ways, near and far, from two spots (refunded shots add no op).
  const aims = [-0.3, Math.PI + 0.3, -Math.PI / 4, (-3 * Math.PI) / 4, -Math.PI / 2, Math.PI / 2];
  let s = 0;
  for (const x of [140, 300, 460, 620, 780]) {
    p.x = x;
    p.vx = 0;
    for (let i = 0; i < 20; i++) {
      idle(g, 0, { s: ++s, w: W.builder });
      idle(g, 1);
      g.update();
    }
    for (let i = 0; i < 48; i++) {
      g.applyInput(0, { s: ++s, b: BTN.FIRE, a: aims[(i >> 3) % aims.length], w: W.builder, v: g.tick, k: packBuild(i & 1, 0, 60 + (i % 5) * 40) });
      idle(g, 1);
      g.update();
    }
  }
  g.explode(p.x + 200, p.y - 10, 'rocket', 0);
  for (let i = 0; i < 120; i++) g.update();
  assert.ok(g.opLog.length > 10);
  let built = 0;
  for (const m of g.terrain.mat) if (m === MAT_BUILD) built++;
  assert.ok(built > 50, `builder cells ${built}`);

  const { ops, st } = g.mapState();
  const t = buildMap('landing', 1234).terrain;
  const sim = new TerrainSim(t);
  let k = 0;
  while (sim.t < st) {
    while (k < ops.length && ops[k][0] <= sim.t) sim.apply(ops[k++]);
    sim.step();
  }
  assert.deepEqual(Buffer.from(t.mat), Buffer.from(g.terrain.mat));
});

test('c4 sticks, then detonates on ALT', () => {
  const g = duel('landing');
  g.grant(0, W.c4);
  const p = g.players[0];
  for (let i = 0; i < 30; i++) {
    idle(g, 0, { s: 1 + i, w: W.c4, a: Math.PI / 2 });
    g.update();
  }
  g.applyInput(0, { s: 40, b: BTN.FIRE, a: Math.PI / 2, w: W.c4, v: g.tick });
  for (let i = 0; i < 60; i++) {
    idle(g, 0, { s: 41 + i, a: Math.PI / 2 });
    g.update();
  }
  const c4 = g.projs.find((pr) => pr.o === 0);
  assert.ok(c4 && c4.st === 1, 'charge stuck to the floor');
  g.applyInput(0, { s: 100, b: BTN.ALT, a: 0, w: W.c4, v: g.tick });
  for (let i = 0; i < 3; i++) g.update();
  assert.ok(!g.projs.some((pr) => pr.o === 0));
  assert.ok(p.dead || p.hp < 100);
});
