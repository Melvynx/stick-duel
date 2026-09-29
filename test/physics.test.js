import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BTN, MAT_PLATFORM, PHYS } from '../shared/constants.js';
import { buildMap } from '../shared/maps.js';
import { createPlayer, packPlayer, stepPlayer, unpackPlayer } from '../shared/player.js';

const flat = () => buildMap('flat', 1).terrain;

function spawnOn(t, x = 400) {
  const p = createPlayer(0);
  p.dead = false;
  p.x = x;
  p.y = 600;
  return p;
}

function run(p, t, b, n, out) {
  for (let i = 0; i < n; i++) stepPlayer(p, { b, a: 0, w: 0 }, t, out);
}

test('player falls and rests on the ground', () => {
  const t = flat();
  const p = spawnOn(t);
  run(p, t, 0, 90);
  assert.equal(p.y, 800);
  assert.ok(p.grounded);
  assert.equal(p.vy, 0);
});

test('running reaches run speed', () => {
  const t = flat();
  const p = spawnOn(t);
  run(p, t, 0, 90);
  run(p, t, BTN.RIGHT, 30);
  assert.ok(Math.abs(p.vx - PHYS.RUN) < 1e-6, `vx ${p.vx}`);
  assert.ok(p.x > 450);
});

test('jump, flip and jetpack gain height', () => {
  const t = flat();
  const p = spawnOn(t);
  run(p, t, 0, 90);
  const out = [];
  let minY = p.y;
  stepPlayer(p, { b: BTN.JUMP, a: 0, w: 0 }, t, out);
  for (let i = 0; i < 40; i++) {
    stepPlayer(p, { b: BTN.JUMP, a: 0, w: 0 }, t, out);
    minY = Math.min(minY, p.y);
  }
  assert.ok(out.some((e) => e.k === 'jump'));
  assert.ok(800 - minY > 100, `jump height ${800 - minY}`);
  // Keep holding: the jetpack takes over.
  for (let i = 0; i < 60; i++) {
    stepPlayer(p, { b: BTN.JUMP, a: 0, w: 0 }, t, out);
    minY = Math.min(minY, p.y);
  }
  assert.ok(out.some((e) => e.k === 'jet'));
  assert.ok(p.fuel < 100);
  assert.ok(800 - minY > 200, `jet height ${800 - minY}`);
});

test('one-way platforms: jump through from below, land on top, drop with S', () => {
  const t = flat();
  for (let cx = 150; cx < 250; cx++) for (let cy = 360; cy < 362; cy++) t.set(cx, cy, MAT_PLATFORM, 1);
  const p = spawnOn(t, 400);
  run(p, t, 0, 90);
  run(p, t, BTN.JUMP, 1);
  run(p, t, BTN.JUMP, 20);
  run(p, t, 0, 60);
  assert.equal(p.y, 720, 'landed on platform top');
  assert.ok(p.grounded);
  run(p, t, BTN.DOWN, 1);
  run(p, t, 0, 60);
  assert.equal(p.y, 800, 'dropped through to the ground');
});

test('firing respects cooldown and ammo; pack round-trips', () => {
  const t = flat();
  const p = spawnOn(t);
  run(p, t, 0, 60);
  const out = [];
  stepPlayer(p, { b: 0, a: 0, w: 1 }, t, out);
  assert.equal(p.w, 0, 'the smg is locked at spawn');
  p.owned |= 1 << 1;
  for (let i = 0; i < 60; i++) stepPlayer(p, { b: BTN.FIRE, a: 0, w: 1 }, t, out);
  const shots = out.filter((e) => e.k === 'fire').length;
  assert.ok(shots >= 14 && shots <= 16, `smg shots ${shots}`);
  assert.equal(p.ammo[1], 120 - shots);
  const q = unpackPlayer(JSON.parse(JSON.stringify(packPlayer(p))), createPlayer(0));
  assert.equal(q.ammo[1], p.ammo[1]);
  assert.equal(q.w, 1);
  assert.equal(q.owned, p.owned);
});
