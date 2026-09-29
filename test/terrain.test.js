import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAT_BEDROCK, MAT_EMPTY, MAT_SOLID } from '../shared/constants.js';
import { buildMap, MAP_IDS, MAPS } from '../shared/maps.js';

test('maps build deterministically', () => {
  for (const id of Object.keys(MAPS)) {
    const a = buildMap(id, 42).terrain;
    const b = buildMap(id, 42).terrain;
    assert.deepEqual(a.mat, b.mat, id);
  }
  assert.ok(MAP_IDS.includes('landing') && MAP_IDS.includes('ridge') && !MAP_IDS.includes('flat'));
});

test('the outpost map is bigger than the screen', () => {
  const { terrain } = buildMap('outpost', 3);
  assert.equal(terrain.worldW, 2400);
  assert.equal(terrain.worldH, 1200);
  assert.equal(terrain.matAt(1200, 1195), MAT_BEDROCK);
  assert.ok(terrain.countSolid() > 100000);
});

test('every spawn resolves to standable ground', () => {
  for (const id of Object.keys(MAPS)) {
    const { terrain, spawns } = buildMap(id, 7);
    for (const [x, y] of spawns) {
      const sy = terrain.findStand(x, y);
      assert.ok(sy > 0 && sy < terrain.worldH - 24, `${id} spawn ${x},${y} -> ${sy}`);
      assert.ok(!terrain.rectSolid(x - 6, sy - 58, x + 6, sy), `${id} spawn inside terrain`);
    }
  }
});

test('carving removes solids but never bedrock', () => {
  const { terrain } = buildMap('flat', 1);
  const before = terrain.countSolid();
  assert.equal(terrain.matAt(800, 820), MAT_SOLID);
  const n = terrain.carveCircle(800, 820, 40);
  assert.ok(n > 0);
  assert.ok(terrain.countSolid() < before);
  assert.equal(terrain.matAt(800, 820), MAT_EMPTY);
  terrain.carveCircle(800, 890, 60);
  assert.equal(terrain.matAt(800, 895), MAT_BEDROCK);
  assert.equal(terrain.matAt(-5, 100), MAT_BEDROCK);
  assert.equal(terrain.matAt(100, -50), MAT_EMPTY);
});
