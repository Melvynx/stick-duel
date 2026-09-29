import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIECE, planPiece } from '../shared/build.js';
import { BTN, MAT_BUILD } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import { buildMap } from '../shared/maps.js';
import { TerrainSim } from '../shared/sim.js';
import { BUILD, W } from '../shared/weapons.js';

const B = BUILD.block;

function builderGame() {
  const g = new Game('flat', 99, 2);
  g.addPlayer(0, 0);
  g.addPlayer(1, 1);
  const p = g.players[0];
  p.owned |= 1 << W.builder;
  p.w = W.builder;
  p.ammo[W.builder] = 60;
  const seq = { n: 0 };
  const input = (b, a) => {
    g.applyInput(0, { s: ++seq.n, b, a, w: W.builder, v: g.tick });
    g.applyInput(1, { s: seq.n, b: 0, a: Math.PI, w: g.players[1].w, v: g.tick });
    g.update();
  };
  for (let i = 0; i < 30; i++) input(0, 0);
  return { g, p, input };
}

// Fires one builder shot at `a`, then lets the cooldown run out.
function shoot(ctx, a) {
  ctx.input(BTN.FIRE, a);
  for (let i = 0; i < 12; i++) ctx.input(0, a);
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

test('a flat shot raises a tall wall on the ground that stays put', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  const ammo = p.ammo[W.builder];
  shoot(ctx, 0);
  const a = built(g);
  assert.equal(p.ammo[W.builder], ammo - 1);
  assert.equal(a.w, B);
  assert.ok(a.h >= BUILD.wallH * B - B, `wall height ${a.h}`);
  assert.ok(a.h * 2 > 58 * 1.5, 'taller than 1.5 players');
  assert.ok(a.x0 * 2 > p.x, 'in front of the builder');
  assert.equal(a.y1 + 1, 400, 'stands on the ground');
  settle(ctx);
  const b = built(g);
  assert.deepEqual(b.cells, a.cells, 'the wall did not move');
});

test('holding fire at the same spot does not waste ammo', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  shoot(ctx, 0);
  shoot(ctx, 0); // a second layer thickens the wall
  const n = built(g).cells.length;
  const ammo = p.ammo[W.builder];
  shoot(ctx, 0);
  shoot(ctx, 0);
  assert.equal(built(g).cells.length, n);
  assert.equal(p.ammo[W.builder], ammo);
});

test('aiming straight up builds a floor above the head that does not fall', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  shoot(ctx, -Math.PI / 2);
  const a = built(g);
  assert.equal(a.w, BUILD.floor * B);
  assert.equal(a.h, B);
  assert.ok(a.y1 * 2 < p.y - 58, 'above the head');
  settle(ctx);
  assert.deepEqual(built(g).cells, a.cells);
});

test('aiming down in the air builds a floor under the feet', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  p.y -= 200;
  const plan = planPiece(g.terrain, p.x, p.y, Math.PI / 2);
  assert.equal(plan.kind, PIECE.FLOOR);
  assert.ok(plan.parts[0].y * 2 >= p.y, 'below the feet');
});

test('a flat shot at the top edge of a wall stacks a new wall on it', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  shoot(ctx, 0);
  let wall = built(g);
  // In the air, aiming just over the wall's top edge.
  let plan = planPiece(g.terrain, p.x, wall.y0 * 2 + 36, 0);
  assert.equal(plan.kind, PIECE.WALL);
  assert.equal(plan.parts[0].x, wall.x0);
  assert.equal(plan.parts[0].y + plan.parts[0].h, wall.y0, 'sits right on top of the first wall');
  // Once the wall is two layers thick, aiming at its face near the top also stacks.
  shoot(ctx, 0);
  wall = built(g);
  plan = planPiece(g.terrain, p.x, wall.y0 * 2 + 46, 0);
  assert.equal(plan.parts[0].x, wall.x0);
  assert.equal(plan.parts[0].y + plan.parts[0].h, wall.y0);
  // Aimed at the middle of the wall there is nothing to build (refunded).
  assert.equal(planPiece(g.terrain, p.x, p.y, 0).parts.length, 0);
});

test('a diagonal shot builds a ramp the builder can run up', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  const y0 = p.y;
  shoot(ctx, -Math.PI / 4);
  const a = built(g);
  assert.ok(a.w > BUILD.ramp * B - B && a.w <= BUILD.ramp * B, `ramp run ${a.w}`);
  assert.ok(a.h >= BUILD.ramp * B - B, `ramp rises ${a.h}`);
  let top = p.y;
  for (let i = 0; i < 40; i++) {
    ctx.input(BTN.RIGHT, 0);
    top = Math.min(top, p.y);
  }
  assert.ok(top < y0 - 40, `climbed from ${y0} to ${top}`);
  settle(ctx);
  assert.deepEqual(built(g).cells, a.cells);
});

test('aiming straight down on the ground boxes the builder in', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  const ammo = p.ammo[W.builder];
  shoot(ctx, Math.PI / 2);
  const t = g.terrain;
  const cx = Math.floor(p.x / 2);
  const mid = Math.floor((p.y - 20) / 2);
  const at = (x, y) => t.mat[y * t.w + x];
  let left = cx;
  while (left > cx - 30 && at(left, mid) !== MAT_BUILD) left--;
  let right = cx;
  while (right < cx + 30 && at(right, mid) !== MAT_BUILD) right++;
  assert.equal(at(left, mid), MAT_BUILD, 'left wall');
  assert.equal(at(right, mid), MAT_BUILD, 'right wall');
  let roof = mid;
  while (roof > mid - 60 && at(cx, roof) !== MAT_BUILD) roof--;
  assert.equal(at(cx, roof), MAT_BUILD, 'roof');
  assert.equal(p.ammo[W.builder], ammo - BUILD.bunkerCost);
  assert.ok(!t.rectSolid(p.x - 6, p.y - 58, p.x + 6, p.y), 'builder not buried');
});

test('pieces are refunded instead of burying another player', () => {
  const ctx = builderGame();
  const { g, p } = ctx;
  const q = g.players[1];
  q.x = p.x + 30;
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
  shoot(ctx, -Math.PI / 2);
  shoot(ctx, Math.PI / 2);
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
