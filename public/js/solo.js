import { SURVIVAL_MAP, SURVIVAL_SLOTS, Survival } from '/shared/survival.js';

const PLAYER = 0;

// Local stand-in for the online server in solo survival: runs shared/survival.js in the browser
// with one human and hands snapshots (plus the survival state `sv` / events `se`, exactly like a
// co-op room) straight to the ClientGame. `onSnapshot(snap)` lets main.js drive the wave HUD.
export class SoloServer {
  constructor(client, { onSnapshot } = {}) {
    this.client = client;
    this.onSnapshot = onSnapshot;
    this.active = false;
    this.paused = false;
    this.run = null;
  }

  get game() {
    return this.run?.game ?? null;
  }

  start(name) {
    const seed = (Math.random() * 2 ** 31) | 0;
    this.run = new Survival(seed);
    this.queue = [];
    const c = this.client;
    c.setSlot(PLAYER);
    c.names = new Array(SURVIVAL_SLOTS).fill('');
    c.names[PLAYER] = name;
    c.interp = 2;
    c.roomState = 'playing';
    c.offset = null;
    c.loadMap({ id: SURVIVAL_MAP, seed }, this.run.game); // shares the authority's terrain and sandbox
    // Inputs sent before this run belong to an older simulation: treat them as acknowledged.
    c.pending = [];
    this.ack = c.seq;
    this.run.addHuman(PLAYER);
    this.active = true;
    this.paused = false;
    this.flush();
  }

  stop() {
    this.active = false;
    this.paused = false;
    this.run = null;
    this.queue = [];
  }

  // Same interface as Net: the ClientGame sends its inputs here.
  send(msg) {
    if (!this.active || msg.t !== 'i') return;
    for (const [s, b, a, w, v, k = 0] of msg.l) this.queue.push({ s, b, a, w, v, k });
  }

  // One simulation tick, run right after ClientGame.tick() queued the player's input.
  step() {
    if (!this.active || this.paused) return;
    for (const inp of this.queue) {
      this.run.applyInput(PLAYER, inp);
      this.ack = inp.s;
    }
    this.queue = [];
    this.run.step();
    this.client.sync.afterStep();
    this.flush();
  }

  flush() {
    const snap = this.run.game.snapshot();
    snap.a = this.ack;
    snap.sv = this.run.state();
    snap.se = this.run.takeEvents();
    this.onSnapshot?.(snap);
    this.client.onSnapshot(snap);
  }
}
