import { PHYS } from '/shared/constants.js';
import { MODE_NAMES, STYLE_NAMES, bodyCells, freeCells, packBuild, partHits, planPiece } from '/shared/build.js';
import { BUILD as BUILD_PAL } from '/shared/palette.js';
import { rampTop } from '/shared/sim.js';
import { BUILD, W } from '/shared/weapons.js';

const TEAM_COLORS = 3; // matches BUILD_COLORS on the server
const KEY = 'stick-duel.build';

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { mode: (v.mode | 0) % MODE_NAMES.length, style: (v.style | 0) % STYLE_NAMES.length };
  } catch {
    return { mode: 0, style: 0 };
  }
}

// Builder choice (piece mode, style) and the ghost preview of the next piece (mixin of ClientGame).
export const builder = {
  buildChoice() {
    if (!this.build) this.build = load();
    return this.build;
  },

  // `req` = { piece, style }: summed R / T steps (Shift steps back).
  changeBuild(req) {
    const b = this.buildChoice();
    const wrap = (v, n) => ((v % n) + n) % n;
    b.mode = wrap(b.mode + (req.piece | 0), MODE_NAMES.length);
    b.style = wrap(b.style + (req.style | 0), STYLE_NAMES.length);
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
    } catch {}
    this.sfx.play('switch', this.me.x);
    if (this.wantW !== W.builder && !this.me.dead) this.pickWeapon({ builder: true });
  },

  // Distance from the shoulder to the cursor, world px.
  cursorDist(aimAt) {
    const me = this.me;
    return Math.hypot(aimAt.x - me.x, aimAt.y - (me.y - PHYS.AIM_Y));
  },

  // `k` sent with each input: the server plans the piece from exactly the same choice.
  buildKey(aimAt) {
    const b = this.buildChoice();
    return packBuild(b.mode, b.style, Math.min(BUILD.cursor, this.cursorDist(aimAt)));
  },

  buildColor(style) {
    return BUILD_PAL[style ? style - 1 : this.slot % TEAM_COLORS];
  },

  // Ghost of the piece a click would place, drawn in backbuffer px (1 px = 1 terrain cell).
  // Red when it cannot be built: nothing free, a player in the way or not enough blocks.
  drawBuildPreview(ctx, x, feet) {
    const me = this.me;
    const b = this.buildChoice();
    const aimAt = { x: (this.input.mx + this.camBx) * 2, y: (this.input.my + this.camBy) * 2 };
    const dist = Math.min(BUILD.cursor, this.cursorDist(aimAt));
    const plan = planPiece(this.terrain, x, feet, this.aim, b.mode, dist);
    if (!plan.parts.length) return;
    const ammo = me.ammo[W.builder];
    let ok = freeCells(this.terrain, plan.parts) > 0 && (ammo < 0 || ammo >= plan.cost);
    if (ok) {
      for (let s = 0; s < this.present.length; s++) {
        const p = this.playerAt(s);
        if (!p || p.dead || !this.present[s]) continue;
        const box = bodyCells(p.x, p.y);
        if (plan.parts.some((part) => partHits(part, ...box))) ok = false;
      }
    }
    const [fill, edge] = ok ? this.buildColor(b.style) : ['#ff4d4d', '#c22'];
    const pulse = 0.55 + Math.sin(this.time * 6) * 0.1;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = fill;
    for (const part of plan.parts) {
      if (!part.ramp) {
        ctx.fillRect(part.x, part.y, part.w, part.h);
        continue;
      }
      for (let k = 0; k < part.len; k++) {
        ctx.fillRect(part.x + k, rampTop(part.y, part.len, part.rise, k), 1, part.thick);
      }
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = ok ? edge : '#ff8080';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.lineDashOffset = -this.time * 8;
    const [x0, y0, x1, y1] = plan.box;
    ctx.strokeRect(x0 / 2 + 0.5, y0 / 2 + 0.5, (x1 - x0) / 2 - 1, (y1 - y0) / 2 - 1);
    ctx.restore();
  },

  buildHud() {
    const b = this.buildChoice();
    return { mode: MODE_NAMES[b.mode], style: STYLE_NAMES[b.style], color: this.buildColor(b.style)[0] };
  },
};
