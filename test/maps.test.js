import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CELL, MAT_BEDROCK, MAT_TNT } from '../shared/constants.js';
import { Game } from '../shared/game.js';
import { buildMap, MAPS } from '../shared/maps.js';
import { OP, TerrainSim } from '../shared/sim.js';

const IDS = Object.keys(MAPS);

test('maps carry no explosive clutter, and none near a spawn', () => {
  for (const id of IDS) {
    const { terrain: t, spawns } = buildMap(id, 5);
    let tnt = 0;
    for (let i = 0; i < t.mat.length; i++) {
      if (t.mat[i] !== MAT_TNT) continue;
      tnt++;
      const x = (i % t.w) * CELL;
      const y = ((i / t.w) | 0) * CELL;
      for (const [sx, sy] of spawns) {
        const fy = t.findStand(sx, sy);
        assert.ok(Math.hypot(x - sx, y - fy) > 200, `${id}: explosive at ${x},${y} near spawn ${sx},${fy}`);
      }
    }
    // At most two lone barrels' worth of TNT (a barrel is 70 cells).
    assert.ok(tnt <= 140, `${id}: ${tnt} TNT cells`);
    assert.ok(!t.burn.some((b) => b > 0), `${id}: something burns at match start`);
  }
});

test('nothing collapses or burns away on its own at match start', () => {
  for (const id of IDS) {
    const { terrain } = buildMap(id, 9);
    const sim = new TerrainSim(terrain);
    for (let i = 0; i < 240; i++) sim.step();
    assert.equal(sim.bodies.length, 0, `${id}: pieces falling`);
    assert.equal(sim.destroyed, 0, `${id}: cells lost`);
    assert.equal(sim.triggers.length, 0, `${id}: blasts queued`);
  }
});

test('floating islands and the fort roof have unbreakable cores', () => {
  const cores = Object.fromEntries(IDS.map((id) => [id, buildMap(id, 1).cores.length]));
  assert.ok(cores.ridge >= 6, 'three ridge islands (slab + keel each)');
  assert.ok(cores.outpost >= 11, 'five outpost islands plus the fort');
  assert.ok(cores.landing >= 6, 'feature cards and cookie buttons');
});

test('huge blasts over every core leave it standing and standable', () => {
  for (const id of IDS) {
    const g = new Game(id, 77);
    const { cores } = buildMap(id, 77);
    const t = g.terrain;
    const bedrock = cores.map(([x0, y0, x1, y1]) => {
      const cells = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (t.mat[y * t.w + x] === MAT_BEDROCK) cells.push(y * t.w + x);
      return cells;
    });
    for (const [x0, y0, x1, y1] of cores) {
      for (let y = y0 - 40; y <= y1 + 40; y += 16) {
        for (let x = x0 - 40; x <= x1 + 40; x += 16) g.op(-1, OP.CARVE, x * CELL, y * CELL, 70, 0);
      }
    }
    for (let i = 0; i < 300; i++) g.sim.step();
    cores.forEach(([x0, y0, x1], k) => {
      assert.ok(bedrock[k].length > 0, `${id} core ${k} has bedrock`);
      for (const i of bedrock[k]) assert.equal(t.mat[i], MAT_BEDROCK, `${id} core ${k} lost a cell`);
      const cx = ((x0 + x1) / 2) * CELL;
      const sy = t.findStand(cx, (y0 - 60) * CELL);
      assert.ok(sy <= y0 * CELL && sy > (y0 - 60) * CELL, `${id} core ${k}: stand at ${sy}, core top ${y0 * CELL}`);
    });
    // The floor under the whole map is bedrock: no blast opens a hole to the void.
    for (let x = 0; x < t.w; x++) assert.equal(t.mat[(t.h - 1) * t.w + x], MAT_BEDROCK, `${id} floor at ${x}`);
  }
});
