import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BTN, DT, PHYS, RULES } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import { buildMap } from '../shared/maps.js';
import { createPlayer, packPlayer, stepPlayer, unpackPlayer } from '../shared/player.js';
import { W } from '../shared/weapons.js';

// Double jump and 1v1 pace. The flat map's floor is at y = 800.

const flat = () => buildMap('flat', 1).terrain;

function grounded(t) {
  const p = createPlayer(0);
  p.dead = false;
  p.x = 400;
  p.y = 600;
  for (let i = 0; i < 90; i++) stepPlayer(p, { b: 0, a: 0, w: 0 }, t);
  assert.ok(p.grounded);
  return p;
}

// Plays a list of [buttons, ticks] and returns the highest point reached (px above the floor).
function play(p, t, script, out = []) {
  let minY = p.y;
  for (const [b, n] of script) {
    for (let i = 0; i < n; i++) {
      stepPlayer(p, { b, a: 0, w: 0 }, t, out);
      minY = Math.min(minY, p.y);
    }
  }
  return 800 - minY;
}

const J = BTN.JUMP;

test('a quick tap in the air is a full double jump, not cut on release', () => {
  const t = flat();
  const single = play(grounded(t), t, [[J, 8], [0, 120]]);
  // Held almost to the apex (the jetpack would take over a couple of ticks later).
  const heldSingle = play(grounded(t), t, [[J, 15], [0, 120]]);

  const p = grounded(t);
  const out = [];
  play(p, t, [[J, 8], [0, 10]], out);
  assert.ok(!p.grounded);
  const vyBefore = p.vy;
  stepPlayer(p, { b: J, a: 0, w: 0 }, t, out);
  assert.ok(out.some((e) => e.k === 'flip'), 'flip event (animation)');
  assert.equal(p.flipT, 0);
  assert.ok(p.vy < -PHYS.FLIP_V * 0.9 && p.vy < vyBefore, `boost vy ${p.vy}`);
  stepPlayer(p, { b: J, a: 0, w: 0 }, t, out); // 2-tick tap
  stepPlayer(p, { b: 0, a: 0, w: 0 }, t, out); // release
  assert.ok(p.vy < -PHYS.FLIP_V * 0.8, `release must not cut the air jump (vy ${p.vy})`);
  const dbl = play(p, t, [[0, 120]], out);
  assert.ok(p.grounded, 'landed');
  assert.ok(dbl > single + 60, `double ${dbl} vs single ${single}`);
  assert.ok(dbl > heldSingle, `double ${dbl} vs held single ${heldSingle}`);
});

test('a tapped first jump then a tapped air jump climbs about two jumps', () => {
  const t = flat();
  const hop = play(grounded(t), t, [[J, 2], [0, 120]]);
  const p = grounded(t);
  const out = [];
  const h = play(p, t, [[J, 2], [0, 6], [J, 2], [0, 120]], out);
  assert.equal(out.filter((e) => e.k === 'jump').length, 1);
  assert.equal(out.filter((e) => e.k === 'flip').length, 1);
  assert.ok(h > hop + 90, `tap-tap ${h} vs hop ${hop}`);
});

test('only one air jump before landing, refilled on landing', () => {
  const t = flat();
  const p = grounded(t);
  const out = [];
  play(p, t, [[J, 4], [0, 6], [J, 2], [0, 6]], out);
  assert.equal(p.flips, 0);
  const vy = p.vy;
  play(p, t, [[J, 2]], out);
  assert.equal(out.filter((e) => e.k === 'flip').length, 1, 'no second air jump');
  assert.ok(p.vy >= vy, 'third press gives no boost');
  play(p, t, [[0, 180]], out);
  assert.ok(p.grounded);
  assert.equal(p.flips, PHYS.FLIPS);
  play(p, t, [[J, 4], [0, 6], [J, 2], [0, 4]], out);
  assert.equal(out.filter((e) => e.k === 'flip').length, 2, 'air jump available again after landing');
});

test('holding jump in the air still engages the jetpack', () => {
  const t = flat();
  // Hold the ground jump.
  const a = grounded(t);
  const outA = [];
  play(a, t, [[J, 45]], outA);
  assert.ok(a.jetOn && outA.some((e) => e.k === 'jet'), 'held ground jump -> jet');

  // Tap to jump, then press and hold in the air: flip first, then the jetpack takes over.
  const b = grounded(t);
  const outB = [];
  const h = play(b, t, [[J, 4], [0, 6], [J, 60]], outB);
  assert.ok(outB.some((e) => e.k === 'flip'));
  assert.ok(b.jetOn && outB.some((e) => e.k === 'jet'), 'held air jump -> jet');
  assert.ok(b.fuel < RULES.FUEL);
  assert.ok(h > 200, `flip + jet height ${h}`);
});

test('double jump survives a pack/unpack mid-air (client prediction replay)', () => {
  const t = flat();
  const script = [[J, 4], [0, 6], [J, 2], [0, 30]];
  const a = grounded(t);
  play(a, t, script);
  const b = grounded(t);
  play(b, t, script.slice(0, 3));
  const c = unpackPlayer(JSON.parse(JSON.stringify(packPlayer(b))), createPlayer(0));
  play(b, t, script.slice(3));
  play(c, t, script.slice(3));
  assert.ok(Math.abs(b.y - a.y) < 1e-9);
  assert.ok(Math.abs(c.y - a.y) < 0.05, `replayed y ${c.y} vs ${a.y}`);
});

test('1v1 pace: fast respawn with a short spawn shield', () => {
  assert.ok(RULES.RESPAWN <= 2);
  const g = new Game('flat', 1234);
  g.addPlayer(0, 0);
  g.addPlayer(1, 1);
  for (const p of g.players) p.shield = 0;
  g.damage(1, 500, 0, W.pistol, 0, 0, 0, 0);
  assert.ok(g.players[1].dead);
  for (let i = 0; i < Math.ceil(RULES.RESPAWN / DT) + 2; i++) g.update();
  assert.ok(!g.players[1].dead, 'respawned');
  assert.ok(g.players[1].shield > 0 && g.players[1].shield <= RULES.SHIELD);
});

test('falling debris never damages players', async () => {
  const { OP } = await import('../shared/sim.js');
  const { MAT_SOLID } = await import('../shared/constants.js');
  const g = new Game('flat', 7, 2);
  g.addPlayer(0);
  const p = g.players[0];
  for (let i = 0; i < 90; i++) g.update(); // settle, spawn shield wears off
  p.shield = 0;
  const hp = p.hp;
  // A loose brick slab right above the head: it has no support and falls onto the player.
  const cx = Math.floor(p.x / 2);
  const cy = Math.floor((p.y - 150) / 2);
  g.op(-1, OP.PLACE, cx - 10, cy, 20, 8, MAT_SOLID, 0);
  let landed = false;
  for (let i = 0; i < 150; i++) {
    g.update();
    if (g.sim.landings.length) landed = true;
  }
  assert.ok(landed, 'the slab fell');
  assert.equal(p.dead, false);
  assert.equal(p.hp, hp);
});

test('world hazards never finish a player and TNT spares whoever set it off', async () => {
  const { FIRE_W } = await import('../shared/weapons.js');
  const g = new Game('flat', 7, 2);
  g.addPlayer(0);
  g.addPlayer(1);
  const p = g.players[0];
  p.shield = 0;
  p.hp = 80;
  g.damage(0, 500, 1, FIRE_W, 0, 0, p.x, p.y, true);
  assert.equal(p.hp, RULES.WORLD_FLOOR, 'fire and hazards stop at the floor');
  g.damage(0, 500, 1, FIRE_W, 0, 0, p.x, p.y, true);
  assert.equal(p.hp, RULES.WORLD_FLOOR);
  p.hp = 12;
  g.damage(0, 500, 1, FIRE_W, 0, 0, p.x, p.y, true);
  assert.equal(p.hp, 12, 'already below the floor: hazards take nothing more');
  assert.equal(p.dead, false);
  p.hp = RULES.HP;
  g.explode(p.x, p.y - 20, 'tnt', 0, 40);
  assert.equal(p.hp, RULES.HP, 'own TNT chain does no damage');
});
