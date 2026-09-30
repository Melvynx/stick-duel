import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIECE, packBuild, planPiece } from '../shared/build.js';
import { BTN, MAT_BUILD, PHYS } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import { buildMap } from '../shared/maps.js';
import { TerrainSim } from '../shared/sim.js';
import { BUILD, W } from '../shared/weapons.js';

const T = BUILD.tile * BUILD.block;
const TH = BUILD.thick;
const GROUND = 400; // top ground row of the flat map
const FLOOR = (dist) => packBuild(PIECE.FLOOR, 0, dist);

function builderGame() {
  const g = new Game('flat', 99, 2);
  g.addPlayer(0, 0);
  g.addPlayer(1, 1);
  const p = g.players[0];
  p.owned |= 1 << W.builder;
  p.w = W.builder;
  p.ammo[W.builder] = 60;
  const seq = { n: 0 };
  const input = (b, a, k = 0) => {
    g.applyInput(0, { s: ++seq.n, b, a, w: W.builder, v: g.tick, k });
    g.applyInput(1, { s: seq.n, b: 0, a: Math.PI, w: g.players[1].w, v: g.tick });
    g.update();
  };
  for (let i = 0; i < 30; i++) input(0, 0);
  return { g, p, input };
}

// Fires one builder shot at `a`, then lets the cooldown run out.
function shoot(ctx, a, k = 0) {
  ctx.input(BTN.FIRE, a, k);
  for (let i = 0; i < 12; i++) ctx.input(0, a, k);
}

function built(g) {
  const t = g.terrain;
  const cells = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < t.mat.length; i++) {
    if (t.mat[i] !== MAT_BUILD) continue;
    cells.push(i);
    const x = i % t.w;
    const y = (i / t.w) | 0;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { cells, w: x1 - x0 + 1, h: y1 - y0 + 1, x0, y0, x1, y1 };
}

const settle = (ctx, ticks = 180) => {
  for (let i = 0; i < ticks; i++) ctx.input(0, 0);
};

test('a wall stands on the ground on a grid line, one tile tall, and stays put', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  const ammo = p.ammo[W.builder];
  shoot(ctx, 0);
  const a = built(g);
  assert.equal(p.ammo[W.builder], ammo - 1);
  assert.equal(a.w, TH);
  assert.equal(a.h, T);
  assert.equal((a.x0 + TH / 2) % T, 0, 'on a grid line');
  assert.ok(a.x0 * 2 > p.x, 'in front of the builder');
  assert.equal(a.y1 + 1, GROUND, 'stands on the ground');
  assert.ok(a.h * 2 > 58, 'taller than a player');
  settle(ctx);
  assert.deepEqual(built(g).cells, a.cells, 'the wall did not move');
});

test('holding fire at the same spot does not waste ammo', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  shoot(ctx, 0);
  const n = built(g).cells.length;
  const ammo = p.ammo[W.builder];
  shoot(ctx, 0);
  shoot(ctx, 0);
  assert.equal(built(g).cells.length, n);
  assert.equal(p.ammo[W.builder], ammo);
});

test('a wall never cuts through the builder', () => {
  const { g, p } = builderGame();
  for (let dx = -40; dx <= 40; dx += 4) {
    const plan = planPiece(g.terrain, p.x + dx, p.y, 0, PIECE.WALL, 8);
    const part = plan.parts[0];
    assert.ok(part.x * 2 >= p.x + dx + 6 || (part.x + part.w) * 2 <= p.x + dx - 6, `clear of the body at ${dx}`);
  }
});

test('a floor aimed above the head lands one tile up, flush with the walls', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  shoot(ctx, 0);
  const wall = built(g);
  const cells = new Set(wall.cells);
  shoot(ctx, -Math.PI / 2, FLOOR(40));
  const t = g.terrain;
  const floor = built(g).cells.filter((i) => !cells.has(i));
  const ys = floor.map((i) => (i / t.w) | 0);
  const xs = floor.map((i) => i % t.w);
  assert.equal(Math.min(...ys), GROUND - T, 'top of the floor is one tile up');
  assert.equal(Math.min(...ys), wall.y0, 'flush with the wall top');
  assert.equal(Math.max(...ys) - Math.min(...ys) + 1, TH);
  assert.equal(Math.min(...xs) % T, 0, 'on the grid');
  assert.ok((GROUND - T + TH) * 2 <= GROUND * 2 - 58, 'a player fits under it');
  settle(ctx);
  assert.equal(built(g).cells.length, wall.cells.length + floor.length, 'the floor does not fall');
});

test('pieces stack storey by storey: a wall on a floor, a wall on a wall', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  shoot(ctx, 0);
  const wall = built(g);
  // In the air, aiming just over the first wall: the next one sits on it.
  const plan = planPiece(g.terrain, p.x, wall.y0 * 2 + PHYS.AIM_Y - 6, 0);
  assert.equal(plan.parts[0].x, wall.x0);
  assert.equal(plan.parts[0].y + plan.parts[0].h, wall.y0, 'on top of the first wall');
  // Aimed at the bottom half of the wall there is nothing to build.
  assert.equal(planPiece(g.terrain, p.x, p.y, 0).parts.length, 0);
  // A wall aimed a storey up over flat ground lines up with the one below.
  const up = planPiece(g.terrain, p.x, p.y, -0.35, PIECE.WALL, 240).parts[0];
  assert.equal(Math.abs((up.y + up.h - GROUND) % T), 0, 'on a storey line');
});

test('pieces are refunded instead of burying another player', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  const q = g.players[1];
  const part = planPiece(g.terrain, p.x, p.y, 0).parts[0];
  q.x = (part.x + part.w / 2) * 2;
  q.y = p.y;
  const ammo = p.ammo[W.builder];
  shoot(ctx, 0);
  assert.equal(built(g).cells.length, 0);
  assert.equal(p.ammo[W.builder], ammo);
});

test('walls are destructible and ops replay identically on a fresh sim', () => {
  const ctx = builderGame();
  const { g } = ctx;
  shoot(ctx, 0);
  const wall = built(g);
  shoot(ctx, -Math.PI / 2, FLOOR(40));
  const before = built(g);
  g.explode(wall.x0 * 2 + 6, wall.y0 + wall.y1, 'rocket', 1);
  settle(ctx, 30);
  assert.ok(built(g).cells.length < before.cells.length, 'the rocket broke the wall');

  const { ops, st } = g.mapState();
  const t = buildMap('flat', 99).terrain;
  const sim = new TerrainSim(t);
  let k = 0;
  while (sim.t < st) {
    while (k < ops.length && ops[k][0] <= sim.t) sim.apply(ops[k++]);
    sim.step();
  }
  assert.deepEqual(Buffer.from(t.mat), Buffer.from(g.terrain.mat));
});
