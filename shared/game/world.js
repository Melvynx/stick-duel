import { DT, PHYS } from '../constants.js';
import { playerBox } from '../geom.js';
import { FIRE_W } from '../weapons.js';

const FIRE_DPS = 30;
const FIRE_EVERY = 6;

// Sandbox world glue: every terrain change goes through `op` so clients replay it in lockstep.
export const world = {
  // Applies a terrain op now (tagged with the current sim tick) and logs it for clients.
  // `owner` is remembered so collapses and TNT chains are credited to whoever started them.
  op(owner, type, ...args) {
    const o = [this.sim.t, type];
    for (const a of args) o.push(Math.round(a));
    const removed = this.sim.apply(o);
    this.opLog.push(o);
    if (this.onOp) this.onOp(o, removed);
    if (owner >= 0) this.culprit = owner;
    return o;
  },

  // Blasts queued by the automaton (TNT chains) since the last step.
  worldTriggers() {
    const trig = this.sim.triggers;
    if (!trig.length) return;
    this.sim.triggers = [];
    for (const t of trig) this.explode(t.x, t.y, 'tnt', this.culprit, t.r);
  },

  // Credits a world kill to the last player who touched the terrain, unless they are a friend.
  worldBlame(v) {
    const c = this.culprit;
    return c >= 0 && (c === v || this.hostile(c, v)) ? c : v;
  },

  stepWorld() {
    this.sim.landings.length = 0;
    this.sim.step();
    for (let s = 0; s < this.n; s++) {
      const p = this.players[s];
      if (!this.present[s] || p.dead) continue;
      const [x0, y0, x1, y1] = playerBox(p.x, p.y);
      const hz = this.hazard[s];
      // Falling debris never hurts: collapses are scenery, only weapons, blasts and fire deal damage.
      if (this.sim.burningIn(x0, y0, x1, y1)) hz.fire += FIRE_DPS * DT;
      if (hz.fire > 0 && this.tick % FIRE_EVERY === 0) {
        const d = hz.fire;
        hz.fire = 0;
        this.damage(s, d, this.worldBlame(s), FIRE_W, 0, -30, p.x, p.y - PHYS.HEIGHT / 2, true);
      }
    }
  },
};
