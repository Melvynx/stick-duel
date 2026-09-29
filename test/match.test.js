import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { BTN } from '../shared/constants.js';
import { startServer } from '../server/index.js';

let srv;
before(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1' });
});
after(async () => {
  await srv.close();
});

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const c = { ws, msgs: [], waiters: [], snap: null, room: null, slot: -1, seq: 0 };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 's') c.snap = m;
    if (m.t === 'room') c.room = m;
    if (m.t === 'joined') c.slot = m.slot;
    if (m.t === 'pi') ws.send(JSON.stringify({ t: 'po', n: m.n }));
    c.msgs.push(m);
    c.waiters = c.waiters.filter((w) => !w(m));
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 6000) =>
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
  c.input = (b, a, w) => {
    c.seq++;
    c.send({ t: 'i', l: [[c.seq, b, a, w, c.snap ? c.snap.k : 0]] });
  };
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('two players join a room and the starting pistol scores a kill', async () => {
  const a = client();
  const b = client();
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', name: 'alice', map: 'flat', goal: 3 });
  const joined = await a.wait((m) => m.t === 'joined');
  assert.equal(joined.slot, 0);
  b.send({ t: 'join', name: 'bob', code: joined.code });
  await b.wait((m) => m.t === 'joined');
  await a.wait((m) => m.t === 'room' && m.st === 'countdown');
  assert.deepEqual(a.room.names, ['ALICE', 'BOB']);
  await a.wait((m) => m.t === 'room' && m.st === 'playing', 5000);

  // Everyone starts with the pistol only: tap it at bob until he drops.
  const hits = [];
  const deadline = Date.now() + 9000;
  let fired = 0;
  let released = true;
  while (Date.now() < deadline && !(a.room.scores[0] === 1)) {
    const me = a.snap?.p[0];
    const them = a.snap?.p[1];
    let btn = 0;
    if (me && them && released) {
      btn = BTN.FIRE;
      fired++;
    }
    released = btn === 0;
    const aim = me && them ? Math.atan2(them[1] - me[1], them[0] - me[0]) : 0;
    a.input(btn, aim, 0);
    b.input(0, Math.PI, 0);
    for (const m of a.msgs.splice(0)) if (m.t === 's') for (const e of m.e) if (e.e === 'h') hits.push(e);
    await sleep(1000 / 60);
  }
  assert.ok(fired > 0);
  assert.ok(hits.some((h) => h.s === 1 && h.by === 0 && h.d === 22), `hits ${JSON.stringify(hits)}`);
  assert.equal(a.room.scores[0], 1, `hits ${hits.length} fired ${fired}`);
  a.ws.close();
  b.ws.close();
});

test('quick match pairs two players', async () => {
  const a = client();
  const b = client();
  await Promise.all([a.open, b.open]);
  a.send({ t: 'quick', name: 'q1' });
  const ja = await a.wait((m) => m.t === 'joined');
  b.send({ t: 'quick', name: 'q2' });
  const jb = await b.wait((m) => m.t === 'joined');
  assert.equal(ja.code, jb.code);
  assert.equal(jb.slot, 1);
  a.ws.close();
  b.ws.close();
});
