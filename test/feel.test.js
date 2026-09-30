import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIECE, packBuild, unpackBuild } from '../shared/build.js';
import { BTN, MAT_BEDROCK, MAT_BUILD, MAT_SOLID, PHYS, RULES } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import { BUILD, W } from '../shared/weapons.js';

const B = BUILD.block;

// Two players on the flat map; `input(b, a, k)` drives player 0 for one tick.
function duel(w = 0) {
  const g = new Game('flat', 99, 2);
  g.addPlayer(0, 0);
  g.addPlayer(1, 1);
  const p = g.players[0];
  const q = g.players[1];
  p.owned |= 1 << w;
  p.w = w;
  let s = 0;
  const input = (b, a = 0, k = 0) => {
    g.applyInput(0, { s: ++s, b, a, w, v: g.tick, k });
    g.applyInput(1, { s, b: 0, a: Math.PI, w: q.w, v: g.tick });
    g.update();
  };
  for (let i = 0; i < 30; i++) input(0);
  p.shield = 0;
  q.shield = 0;
  return { g, p, q, input };
}

function count(t, cx0, cy0, cx1, cy1, m) {
  let n = 0;
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) if (t.cell(x, y) === m) n++;
  return n;
}

function fill(t, cx0, cy0, cx1, cy1, m) {
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) t.set(x, y, m, 1);
}

test('builder choice packs mode, style and cursor distance into one input field', () => {
  const k = packBuild(PIECE.FLOOR, 6, 150);
  assert.ok(k >= 0 && k < 4096);
  assert.deepEqual(unpackBuild(k), { mode: PIECE.FLOOR, style: 6, dist: 152 });
  assert.equal(unpackBuild(packBuild(0, 0, 9999)).dist, 252, 'distance saturates');
});

test('walls and floors snap to the build grid near the cursor', () => {
  const T = BUILD.tile * B;
  for (const [kind, w, h] of [[PIECE.WALL, BUILD.thick, T], [PIECE.FLOOR, T, BUILD.thick]]) {
    const { g, p, input } = duel(W.builder);
    p.ammo[W.builder] = 10;
    input(BTN.FIRE, -0.3, packBuild(kind, 5, 160));
    let x0 = Infinity;
    let x1 = -1;
    let y0 = Infinity;
    let y1 = -1;
    let n = 0;
    const t = g.terrain;
    for (let i = 0; i < t.mat.length; i++) {
      if (t.mat[i] !== MAT_BUILD) continue;
      n++;
      x0 = Math.min(x0, i % t.w);
      x1 = Math.max(x1, i % t.w);
      y0 = Math.min(y0, (i / t.w) | 0);
      y1 = Math.max(y1, (i / t.w) | 0);
    }
    assert.equal(n, w * h, `piece ${kind} size`);
    assert.equal(x1 - x0 + 1, w);
    assert.equal(y1 - y0 + 1, h);
    assert.equal((kind === PIECE.WALL ? x0 + BUILD.thick / 2 : x0) % T, 0, 'on the grid');
    const cx = (x0 + x1 + 1) / 2 * 2;
    assert.ok(Math.abs(cx - (p.x + Math.cos(-0.3) * 160)) <= T * 2, 'near the cursor');
  }
});

test('F breaks the terrain in front and shoves the enemy; bedrock holds', () => {
  const { g, p, q, input } = duel();
  const t = g.terrain;
  const cx = Math.floor((p.x + PHYS.HALF_W) / 2) + 2;
  const cy0 = Math.floor((p.y - PHYS.HEIGHT) / 2);
  const cy1 = Math.floor(p.y / 2) - 1;
  fill(t, cx, cy0, cx + 6, cy1, MAT_SOLID);
  const before = count(t, cx, cy0, cx + 6, cy1, MAT_SOLID);
  input(BTN.MELEE, 0);
  assert.ok(count(t, cx, cy0, cx + 6, cy1, MAT_SOLID) < before * 0.5, 'the wall in front is punched open');

  fill(t, cx, cy0, cx + 6, cy1, MAT_BEDROCK);
  for (let i = 0; i < 30; i++) input(0);
  input(BTN.MELEE, 0);
  assert.equal(count(t, cx, cy0, cx + 6, cy1, MAT_BEDROCK), before, 'bedrock is never broken');

  fill(t, cx, cy0, cx + 6, cy1, 0);
  q.x = p.x + 30;
  q.y = p.y;
  const hp = q.hp;
  for (let i = 0; i < 30; i++) input(0);
  q.x = p.x + 30;
  q.y = p.y;
  input(BTN.MELEE, 0);
  assert.ok(q.hp < hp, 'the enemy took the hit');
  assert.ok(q.vx > 100, 'and was shoved away');
});

test('walking into a loose scrap brushes it aside; a real wall stays', () => {
  const { g, p, input } = duel();
  const t = g.terrain;
  const cx = Math.floor((p.x + PHYS.HALF_W) / 2) + 1;
  const cy = Math.floor((p.y - PHYS.HEIGHT + 10) / 2);
  fill(t, cx, cy, cx + 2, cy + 3, MAT_SOLID);
  for (let i = 0; i < 20; i++) input(BTN.RIGHT);
  assert.equal(count(t, cx, cy, cx + 2, cy + 3, MAT_SOLID), 0, 'the scrap is gone');

  const wx = Math.floor((p.x + PHYS.HALF_W) / 2) + 1;
  fill(t, wx, 300, wx + 10, 399, MAT_SOLID);
  const n = count(t, wx, 300, wx + 10, 399, MAT_SOLID);
  for (let i = 0; i < 20; i++) input(BTN.RIGHT);
  assert.equal(count(t, wx, 300, wx + 10, 399, MAT_SOLID), n, 'a big wall is not brushed');
});

test('world fire never takes a player below the floor', () => {
  const { g, p } = duel();
  p.hp = RULES.HP;
  for (let i = 0; i < 20; i++) g.damage(0, 30, -1, 0, 0, 0, p.x, p.y, true);
  assert.equal(p.hp, RULES.WORLD_FLOOR);
  assert.equal(p.dead, false);
});

test('the sniper one-shots on a headshot and not on a body shot', () => {
  for (const [dy, dies] of [[PHYS.HEIGHT - 8, true], [PHYS.HEIGHT * 0.4, false]]) {
    const { p, q, input } = duel(W.sniper);
    p.ammo[W.sniper] = 5;
    q.x = p.x + 300;
    q.y = p.y;
    q.vx = 0;
    const a = Math.atan2(q.y - dy - (p.y - PHYS.AIM_Y), q.x - p.x);
    input(BTN.FIRE, a);
    for (let i = 0; i < 20; i++) {
      q.x = p.x + 300;
      input(0, a);
    }
    assert.equal(q.dead, dies, dies ? 'headshot kills' : 'body shot leaves them standing');
    if (!dies) assert.ok(q.hp < RULES.HP, 'but it hit');
  }
});
