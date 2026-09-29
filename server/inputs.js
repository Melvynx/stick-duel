import { BTN_MASK } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';

const MAX_QUEUE = 90;
const STARVE_CLEAR = 12;

// Input queues shared by every room type: validation on receipt, then 1-3 inputs per tick per
// client (more when it runs behind), repeating the last one while a client starves.

export function send(client, msg) {
  if (client && client.ws.readyState === 1) client.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

export function resetInputs(client, slot, aim = 0) {
  client.slot = slot;
  client.queue = [];
  client.last = { s: 0, b: 0, a: aim, w: 0, v: 0 };
  client.lastSeq = 0;
  client.ack = 0;
  client.starve = 0;
}

// Validates and queues inputs `[s, b, a, w, v]` from a client.
export function queueInputs(client, list) {
  if (!Array.isArray(list)) return;
  for (const it of list.slice(0, 30)) {
    if (!Array.isArray(it) || it.length < 5) continue;
    const [s, b, a, w, v] = it;
    if (!Number.isInteger(s) || s <= client.lastSeq) continue;
    if (!Number.isInteger(b) || b < 0 || b > BTN_MASK) continue;
    if (typeof a !== 'number' || !Number.isFinite(a) || Math.abs(a) > 10) continue;
    if (!Number.isInteger(w) || w < 0 || w >= WEAPONS.length) continue;
    if (!Number.isInteger(v)) continue;
    client.lastSeq = s;
    client.queue.push({ s, b, a, w, v });
  }
  if (client.queue.length > MAX_QUEUE) client.queue.splice(0, client.queue.length - MAX_QUEUE);
}

// `apply(slot, input)` feeds the simulation.
export function processInputs(clients, apply) {
  for (const c of clients) {
    if (!c) continue;
    const q = c.queue;
    if (q.length === 0) {
      c.starve++;
      const last = c.last;
      apply(c.slot, { s: last.s, b: c.starve > STARVE_CLEAR ? 0 : last.b, a: last.a, w: last.w, v: last.v + c.starve });
      continue;
    }
    c.starve = 0;
    const n = q.length > 8 ? 3 : q.length > 4 ? 2 : 1;
    for (let i = 0; i < n && q.length; i++) {
      const inp = q.shift();
      c.last = inp;
      c.ack = inp.s;
      apply(c.slot, inp);
    }
  }
}

// Serialises the snapshot once and splices each client's ack in.
export function sendSnapshot(clients, snap) {
  snap.t = 's';
  snap.r = clients.map((c) => (c ? Math.round(c.rtt) : 0));
  const base = JSON.stringify(snap);
  for (const c of clients) if (c) send(c, `{"a":${c.ack},${base.slice(1)}`);
}
