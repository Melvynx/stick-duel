import { DT } from '/shared/constants.js';
import { ALIVE, HIT_WALL, PROJ, stepProj } from '/shared/projectiles.js';

const PROJ_BLEND = 0.35; // s: remote projectiles catch up from the remote timeline to ours

function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

// Remote players and items interpolated between snapshots; projectiles extrapolated (mixin of ClientGame).
export const interp = {
  remoteState(rt) {
    const snaps = this.snaps;
    if (!snaps.length) {
      this.remotes = [];
      this.items = [];
      return;
    }
    let a = snaps[0];
    let b = snaps[0];
    if (rt >= snaps[snaps.length - 1].k) {
      a = b = snaps[snaps.length - 1];
    } else if (rt > snaps[0].k) {
      for (let i = snaps.length - 1; i > 0; i--) {
        if (snaps[i - 1].k <= rt) {
          a = snaps[i - 1];
          b = snaps[i];
          break;
        }
      }
    }
    const f = b.k === a.k ? 1 : Math.max(0, Math.min(1, (rt - a.k) / (b.k - a.k)));
    const remotes = new Array(b.p.length).fill(null);
    for (let s = 0; s < b.p.length; s++) {
      if (s === this.slot) continue;
      const pa = a.p[s];
      const pb = b.p[s];
      if (!pb) continue;
      const out = { ...pb };
      if (pa && !pa.dead && !pb.dead && Math.hypot(pb.x - pa.x, pb.y - pa.y) < 120) {
        out.x = pa.x + (pb.x - pa.x) * f;
        out.y = pa.y + (pb.y - pa.y) * f;
        out.vx = pa.vx + (pb.vx - pa.vx) * f;
        out.vy = pa.vy + (pb.vy - pa.vy) * f;
        out.aim = lerpAngle(pa.aim, pb.aim, f);
        out.jetK = pa.jetK + (pb.jetK - pa.jetK) * f;
        out.flipT = pb.flipT >= 0 && pa.flipT >= 0 ? pa.flipT + (pb.flipT - pa.flipT) * f : pb.flipT;
      }
      remotes[s] = out;
    }
    this.remotes = remotes;
    // Items interpolate on the same timeline. Entry: [id, x, y, age, kind].
    this.items = (b.c || []).map((c) => {
      const prev = (a.c || []).find((q) => q[0] === c[0]);
      const y = prev ? prev[2] + (c[2] - prev[2]) * f : c[2];
      return { x: c[1], y, t: c[3], kind: c[4] | 0, falling: !!prev && c[2] - prev[2] > 0.5 };
    });
  },

  // Own projectiles are shown on our predicted timeline, the opponent's start on the remote
  // timeline and catch up so they leave the muzzle we see and still land on time.
  updateProjDisplay(rt) {
    const next = new Map();
    const mineAhead = this.seq - this.ack;
    for (const pr of this.projs) {
      let ahead = mineAhead;
      if (pr.o !== this.slot) {
        const back = rt - this.projK;
        const f = Math.min(1, pr.t / PROJ_BLEND);
        ahead = back + (mineAhead - back) * f;
      }
      const d = this.simulate(pr, ahead);
      if (!d) continue;
      const old = this.projDisp.get(pr.id);
      d.px = old ? old.x : d.x;
      d.py = old ? old.y : d.y;
      next.set(pr.id, d);
    }
    for (const g of this.ghosts) {
      if (g.done) continue;
      const id = `g${g.sq}`;
      const old = this.projDisp.get(id);
      next.set(id, { ...g.pr, px: old ? old.x : g.pr.x, py: old ? old.y : g.pr.y });
    }
    this.projDisp = next;
    for (const d of next.values()) {
      const back = (len) => {
        const a = Math.atan2(d.vy, d.vx);
        return [d.x - Math.cos(a) * len, d.y - Math.sin(a) * len];
      };
      if (d.k === PROJ.ROCKET) this.fx.trail(...back(10), 1);
      else if (d.k === PROJ.MIRV) this.fx.trail(...back(12), 1.4);
      else if (d.k === PROJ.QUAKE && Math.random() < 0.6) this.fx.trail(...back(8), 0.8);
      else if (d.k === PROJ.BOMBLET && Math.random() < 0.3) this.fx.trail(d.x, d.y, 0.5);
    }
  },

  simulate(pr, ahead) {
    const c = { ...pr };
    if (c.k === PROJ.C4 && c.st) return c; // stuck charges do not move
    if (ahead <= 0) {
      c.x -= c.vx * -ahead * DT;
      c.y -= c.vy * -ahead * DT;
      return c;
    }
    const n = Math.min(40, Math.floor(ahead));
    for (let i = 0; i < n; i++) {
      const res = stepProj(c, this.terrain, DT);
      if (res === ALIVE) continue;
      if (c.k === PROJ.GRENADE || c.k === PROJ.C4) return c;
      return res === HIT_WALL ? null : c;
    }
    const frac = ahead - n;
    if (c.k !== PROJ.GRENADE && !(c.k === PROJ.C4 && c.st)) {
      c.x += c.vx * frac * DT;
      c.y += c.vy * frac * DT;
    }
    return c;
  },
};
