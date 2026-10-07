import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapSize } from '../shared/maps.js';
import { Lobby } from '../server/lobby.js';

// Fake connections: the lobby only needs `ws.readyState` and `ws.send`.
function fake(name) {
  const c = { name, msgs: [] };
  c.ws = { readyState: 1, send: (raw) => c.msgs.push(JSON.parse(raw)), on() {} };
  c.got = (t) => c.msgs.filter((m) => m.t === t).at(-1);
  return c;
}

function group(n, mode = 'ffa', map = 'canyon') {
  const lobby = new Lobby();
  const cs = Array.from({ length: n }, (_, i) => fake(`p${i}`));
  lobby.handle(cs[0], { t: 'create', name: 'host', mode, map });
  const room = cs[0].room;
  for (const c of cs.slice(1)) lobby.handle(c, { t: 'join', name: c.name, code: room.code });
  return { lobby, cs, room };
}

function play(room) {
  room.state = 'playing';
  room.applyRules();
}

test('a group room holds up to 8 players, warms up until the host starts', () => {
  const { lobby, cs, room } = group(3);
  assert.equal(room.mode, 'ffa');
  assert.equal(room.max, 8);
  assert.equal(room.game.n, 8);
  assert.equal(room.state, 'waiting', 'no auto start with 2+ players');
  assert.equal(room.host, 0);
  assert.deepEqual(cs[2].got('room').names.slice(0, 3), ['HOST', 'P1', 'P2']);
  const twin = fake('twin');
  lobby.handle(twin, { t: 'join', name: 'p1', code: room.code });
  assert.equal(twin.name, 'P1-2', 'names stay unique in a room');
  lobby.leaveRoom(twin);
  assert.ok(room.game.present[2], 'late players warm up in the world');

  lobby.handle(cs[1], { t: 'start' });
  assert.equal(room.state, 'waiting', 'only the host starts');
  lobby.handle(cs[1], { t: 'setmap', map: 'ridge' });
  assert.equal(room.mapId, 'canyon', 'only the host changes the map');

  lobby.handle(cs[0], { t: 'start' });
  assert.equal(room.state, 'countdown');
  const spots = [0, 1, 2].map((s) => `${Math.round(room.game.players[s].x)}`);
  assert.equal(new Set(spots).size, 3, `everyone starts on a different spawn: ${spots}`);
});

test('free for all: first to the goal wins, suicides cost a point', () => {
  const { lobby, cs, room } = group(3);
  lobby.handle(cs[0], { t: 'setopts', goal: 5 });
  assert.equal(room.goal, 5);
  lobby.handle(cs[0], { t: 'start' });
  play(room);
  room.onKill(1, 1);
  assert.equal(room.scores[1], 0, 'never below zero');
  room.onKill(0, 2);
  room.onKill(0, 2);
  room.onKill(2, 2);
  assert.equal(room.scores[2], 1);
  assert.deepEqual(room.deaths.slice(0, 3), [2, 1, 1]);
  for (let i = 0; i < 4; i++) room.onKill(1, 2);
  assert.equal(room.state, 'over');
  assert.equal(room.winner, 2);
});

test('teams: balanced on join, switchable, both sides needed, team kills win', () => {
  const { lobby, cs, room } = group(4, 'teams');
  assert.deepEqual(room.teams.slice(0, 4), [0, 1, 0, 1]);
  assert.equal(room.goal, 20);
  assert.ok(!room.game.hostile(0, 2) && room.game.hostile(0, 1), 'teammates never hurt each other');

  for (const c of cs.slice(1)) lobby.handle(c, { t: 'team', team: 0 });
  lobby.handle(cs[0], { t: 'start' });
  assert.equal(room.state, 'waiting');
  assert.equal(cs[0].got('err').m, 'EACH TEAM NEEDS A PLAYER');

  lobby.handle(cs[3], { t: 'team', team: 1 });
  lobby.handle(cs[0], { t: 'setopts', goal: 10 });
  lobby.handle(cs[0], { t: 'start' });
  assert.equal(room.state, 'countdown');
  assert.ok(room.game.players[3].x > room.game.players[0].x, 'teams start on opposite halves');
  play(room);
  for (let i = 0; i < 9; i++) room.onKill(3, i % 2 ? 2 : 0);
  room.onKill(0, 0); // a suicide scores for the other team
  assert.deepEqual(room.teamScores, [9, 1]);
  assert.deepEqual(room.scores.slice(0, 4), [5, 0, 4, 0]);
  room.onKill(3, 1);
  assert.equal(room.state, 'over');
  assert.equal(room.winner, 0);
});

test('switching FFA <-> teams in the lobby keeps a valid goal', () => {
  const { lobby, cs, room } = group(3);
  lobby.handle(cs[0], { t: 'setopts', goal: 20 });
  lobby.handle(cs[0], { t: 'setopts', mode: 'teams' });
  assert.equal(room.mode, 'teams');
  assert.equal(room.goal, 20);
  assert.deepEqual(room.teams.slice(0, 3), [0, 1, 0]);
  lobby.handle(cs[0], { t: 'setopts', mode: 'duel' });
  assert.equal(room.mode, 'teams', 'a group room never turns into a duel');
});

test('leaving: the host role moves on, too few players fall back to the warm-up', () => {
  const { lobby, cs, room } = group(3);
  lobby.handle(cs[0], { t: 'start' });
  play(room);
  room.onKill(1, 2);
  lobby.leaveRoom(cs[0]);
  assert.equal(room.host, 1);
  assert.equal(room.state, 'playing', 'two players left: the match goes on');
  lobby.leaveRoom(cs[1]);
  assert.equal(room.state, 'waiting');
  assert.equal(room.scores[2], 0);
});

test('friends can join a running match and a full room turns people away', () => {
  const { lobby, cs, room } = group(2);
  lobby.handle(cs[0], { t: 'start' });
  play(room);
  const late = fake('late');
  lobby.handle(late, { t: 'join', name: 'late', code: room.code });
  assert.equal(late.room, room);
  assert.equal(room.state, 'playing');
  assert.ok(room.game.present[2] && !room.game.players[2].dead);
  assert.ok(late.got('map'), 'the late player gets the current world');
  for (let i = 3; i < 8; i++) lobby.handle(fake(`x${i}`), { t: 'join', name: 'x', code: room.code });
  assert.equal(room.count, 8);
  const extra = fake('extra');
  lobby.handle(extra, { t: 'join', name: 'extra', code: room.code });
  assert.equal(extra.got('err').m, 'ROOM IS FULL');
});

test('results: the others get ready, the host restarts on the map they picked', () => {
  const { lobby, cs, room } = group(3);
  lobby.handle(cs[0], { t: 'setopts', goal: 5 });
  lobby.handle(cs[0], { t: 'start' });
  play(room);
  for (let i = 0; i < 5; i++) room.onKill(1, 0);
  assert.equal(room.state, 'over');
  lobby.handle(cs[1], { t: 'rematch' });
  assert.equal(room.state, 'over', 'one ready player is not enough');
  lobby.handle(cs[0], { t: 'setmap', map: 'outpost' });
  lobby.handle(cs[0], { t: 'rematch' });
  assert.equal(room.state, 'countdown');
  assert.equal(room.mapId, 'outpost');
  assert.deepEqual(room.scores.slice(0, 3), [0, 0, 0]);
});

test('results: people leaving send the room back to the warm-up, the host hears why', () => {
  const { lobby, cs, room } = group(3, 'teams');
  lobby.handle(cs[0], { t: 'setopts', goal: 10 });
  lobby.handle(cs[0], { t: 'start' });
  play(room);
  for (let i = 0; i < 10; i++) room.onKill(1, 0);
  assert.equal(room.state, 'over');
  lobby.handle(cs[1], { t: 'team', team: 0 });
  lobby.handle(cs[0], { t: 'rematch' });
  assert.equal(room.state, 'over');
  assert.equal(cs[0].got('err').m, 'EACH TEAM NEEDS A PLAYER');
  lobby.handle(cs[1], { t: 'team', team: 1 });
  lobby.leaveRoom(cs[1]);
  assert.equal(room.state, 'waiting', 'blue is empty: no rematch possible, back to the lobby');

  const g = group(2);
  g.lobby.handle(g.cs[0], { t: 'setopts', goal: 5 });
  g.lobby.handle(g.cs[0], { t: 'start' });
  play(g.room);
  for (let i = 0; i < 5; i++) g.room.onKill(1, 0);
  g.lobby.leaveRoom(g.cs[1]);
  assert.equal(g.room.state, 'waiting');
});

test('crowded starts: nobody shares a spot, each team stays on its own half', () => {
  for (const map of ['ridge', 'landing', 'canyon']) {
    const { lobby, cs, room } = group(8, 'ffa', map);
    lobby.handle(cs[0], { t: 'start' });
    const spots = cs.map((c) => `${Math.round(room.game.players[c.slot].x)},${Math.round(room.game.players[c.slot].y)}`);
    assert.equal(new Set(spots).size, 8, `${map}: ${spots}`);

    const t = group(8, 'teams', map);
    t.lobby.handle(t.cs[0], { t: 'start' });
    const mid = t.room.game.worldW / 2;
    for (const c of t.cs) {
      const x = t.room.game.players[c.slot].x;
      assert.ok(t.room.teams[c.slot] === 0 ? x < mid : x >= mid, `${map}: slot ${c.slot} team ${t.room.teams[c.slot]} at ${x}`);
    }
  }
});

test('private duels can pick the points to win; group rooms keep host-only settings', () => {
  const lobby = new Lobby();
  const a = fake('a');
  const b = fake('b');
  lobby.handle(a, { t: 'create', name: 'a' });
  lobby.handle(a, { t: 'setopts', goal: 10 });
  assert.equal(a.room.goal, 10);
  lobby.handle(b, { t: 'join', name: 'b', code: a.room.code });
  assert.equal(a.room.state, 'countdown');
  lobby.handle(b, { t: 'setopts', goal: 3 });
  assert.equal(a.room.goal, 10, 'no change mid-match');
  lobby.handle(a, { t: 'setopts', goal: 7 });
  assert.equal(a.room.goal, 10, 'only the listed goals');
});

test('quick match never drops you into a group room; duels still auto-start', () => {
  const lobby = new Lobby();
  const a = fake('a');
  lobby.handle(a, { t: 'create', name: 'a', mode: 'ffa' });
  const q = fake('q');
  lobby.handle(q, { t: 'quick', name: 'q' });
  assert.notEqual(q.room, a.room);
  assert.equal(q.room.mode, 'duel');
  const q2 = fake('q2');
  lobby.handle(q2, { t: 'quick', name: 'q2' });
  assert.equal(q2.room, q.room);
  assert.equal(q.room.state, 'countdown');
  assert.deepEqual(q.room.scores, [0, 0]);
});

test('hello lists modes and map sizes; group rooms default to the huge canyon', () => {
  const lobby = new Lobby();
  const c = fake('c');
  lobby.connect(c.ws);
  const hello = c.msgs.find((m) => m.t === 'hello');
  assert.deepEqual(hello.modes.map((m) => m.id), ['duel', 'ffa', 'teams']);
  const canyon = hello.maps.find((m) => m.id === 'canyon');
  assert.deepEqual([canyon.w, canyon.h], [3600, 1400]);
  assert.deepEqual(mapSize('landing'), { w: 1600, h: 900 });
  const { room } = group(1);
  assert.equal(room.mapId, 'canyon');
});
