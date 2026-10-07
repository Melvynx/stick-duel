import { performance } from 'node:perf_hooks';
import { RULES, TICK_MS } from '../shared/constants.js';
import { MAPS, MAP_IDS, mapSize } from '../shared/maps.js';
import { MODES } from '../shared/modes.js';
import { POOLS, POOL_IDS, SELECTABLE, WEAPONS } from '../shared/weapons.js';
import { CoopRoom } from './coop.js';
import { Room } from './room.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_MSGS_PER_SEC = 240;
const PING_EVERY_MS = 1000;

export function cleanName(name) {
  const n = String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return n || 'PLAYER';
}

// Owns every connection and room, and drives all rooms from one fixed 60 Hz loop.
export class Lobby {
  constructor() {
    this.rooms = new Map();
    this.clients = new Set();
    this.nextClientId = 1;
    this.running = false;
  }

  start() {
    this.running = true;
    let last = performance.now();
    let acc = 0;
    let lastPing = 0;
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      acc += now - last;
      last = now;
      let steps = 0;
      while (acc >= TICK_MS && steps < 5) {
        for (const room of this.rooms.values()) room.tick();
        acc -= TICK_MS;
        steps++;
      }
      if (acc > TICK_MS * 5) acc = 0;
      if (now - lastPing > PING_EVERY_MS) {
        lastPing = now;
        this.pingAll(now);
      }
      this.timer = setTimeout(loop, Math.max(1, TICK_MS - acc - 1));
    };
    loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  stats() {
    return { rooms: this.rooms.size, players: this.clients.size };
  }

  pingAll(now) {
    const msg = JSON.stringify({ t: 'pi', n: Math.round(now) });
    for (const c of this.clients) if (c.ws.readyState === 1) c.ws.send(msg);
  }

  newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  send(client, msg) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  }

  connect(ws) {
    const client = {
      id: this.nextClientId++, ws, name: 'PLAYER', room: null, slot: -1, rtt: 80,
      msgCount: 0, msgWindow: performance.now(),
    };
    this.clients.add(client);
    this.send(client, {
      t: 'hello',
      maps: MAP_IDS.map((id) => ({ id, name: MAPS[id].name, w: mapSize(id).w, h: mapSize(id).h })),
      goals: RULES.GOALS,
      modes: Object.entries(MODES).map(([id, m]) => ({ id, name: m.name, max: m.max, goals: m.goals })),
      weapons: SELECTABLE.map((w) => ({ w, name: WEAPONS[w].name })),
      pools: POOL_IDS.map((id) => ({ id, name: POOLS[id].name, mask: POOLS[id].mask })),
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = performance.now();
      if (now - client.msgWindow > 1000) {
        client.msgWindow = now;
        client.msgCount = 0;
      }
      if (++client.msgCount > MAX_MSGS_PER_SEC) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg && typeof msg === 'object') this.handle(client, msg);
    });
    ws.on('close', () => this.disconnect(client));
    ws.on('error', () => this.disconnect(client));
  }

  disconnect(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    this.leaveRoom(client);
  }

  leaveRoom(client) {
    const room = client.room;
    if (!room) return;
    room.leave(client);
    if (room.count === 0) this.rooms.delete(room.code);
  }

  createRoom(opts) {
    const room = opts.coop ? new CoopRoom(this.newCode(), opts) : new Room(this.newCode(), opts);
    this.rooms.set(room.code, room);
    return room;
  }

  handle(client, msg) {
    switch (msg.t) {
      case 'i':
        if (client.room) client.room.queueInputs(client, msg.l);
        break;
      case 'po':
        if (Number.isFinite(msg.n)) {
          const rtt = Math.max(0, Math.min(2000, performance.now() - msg.n));
          client.rtt = client.rtt * 0.7 + rtt * 0.3;
        }
        break;
      case 'create': {
        this.leaveRoom(client);
        client.name = cleanName(msg.name);
        const room = this.createRoom({ pub: false, map: msg.map, goal: Number(msg.goal), pool: msg.pool, mode: msg.mode });
        room.join(client);
        break;
      }
      case 'coop': {
        this.leaveRoom(client);
        client.name = cleanName(msg.name);
        this.createRoom({ coop: true, pool: msg.pool }).join(client);
        break;
      }
      case 'start':
        if (client.room) client.room.begin(client);
        break;
      case 'setopts':
        if (client.room) client.room.setOpts?.(client, { pool: msg.pool, goal: msg.goal, mode: msg.mode });
        break;
      case 'team':
        if (client.room instanceof Room) client.room.setTeam(client, msg.team);
        break;
      case 'join': {
        const code = String(msg.code ?? '').toUpperCase().trim();
        const room = this.rooms.get(code);
        if (!room) return this.send(client, { t: 'err', m: 'ROOM NOT FOUND' });
        if (room === client.room) return;
        if (room.full) return this.send(client, { t: 'err', m: 'ROOM IS FULL' });
        this.leaveRoom(client);
        client.name = cleanName(msg.name);
        room.join(client);
        break;
      }
      case 'quick': {
        this.leaveRoom(client);
        client.name = cleanName(msg.name);
        let room = null;
        for (const r of this.rooms.values()) {
          if (r instanceof Room && r.mode === 'duel' && r.pub && r.count === 1 && r.state === 'waiting') {
            room = r;
            break;
          }
        }
        if (!room) room = this.createRoom({ pub: true, map: MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)], goal: 5 });
        room.join(client);
        break;
      }
      case 'rematch':
        if (client.room instanceof Room) client.room.requestRematch(client, msg.map);
        break;
      case 'setmap':
        if (client.room instanceof Room) client.room.setMap(client, String(msg.map ?? ''));
        break;
      case 'leave':
        this.leaveRoom(client);
        this.send(client, { t: 'lobby' });
        break;
      default:
        break;
    }
  }
}
