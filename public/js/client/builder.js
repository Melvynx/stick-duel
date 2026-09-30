import { PHYS } from '/shared/constants.js';
import { MODE_NAMES, STYLE_NAMES, bodyCells, freeCells, packBuild, partHits, planPiece } from '/shared/build.js';
import { BUILD as BUILD_PAL } from '/shared/palette.js';
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

  // `req` = { piece, style }: summed R / T steps (Shift steps back). R flips WALL / FLOOR.
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

  // Ghost of the piece a click would place, drawn in backbuffer px (1 px = 1 terrain cell), over a
  // faint patch of the build grid. Red when it cannot be built: nothing free or a player in the way.
  drawBuildPreview(ctx, x, feet) {
    const b = this.buildChoice();
    const aimAt = { x: (this.input.mx + this.camBx) * 2, y: (this.input.my + this.camBy) * 2 };
    const dist = Math.min(BUILD.cursor, this.cursorDist(aimAt));
    const plan = planPiece(this.terrain, x, feet, this.aim, b.mode, dist);
    const part = plan.parts[0];
    if (!part) return;
    let ok = freeCells(this.terrain, plan.parts) > 0;
    const bodies = [[x, feet]];
    for (let s = 0; s < this.present.length; s++) {
      const p = s === this.slot ? null : this.playerAt(s);
      if (p && !p.dead && this.present[s]) bodies.push([p.x, p.y]);
    }
    if (ok && bodies.some(([bx, by]) => partHits(part, ...bodyCells(bx, by)))) ok = false;

    const tile = BUILD.tile * BUILD.block;
    const gx = Math.floor((part.x + part.w / 2) / tile) * tile;
    const gy = Math.floor((part.y + part.h / 2) / tile) * tile;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#ffffff';
    for (let k = -1; k <= 2; k++) {
      ctx.fillRect(gx + k * tile, gy - tile, 1, tile * 3);
      ctx.fillRect(gx - tile, gy + k * tile, tile * 3, 1);
    }
    const [fill, edge] = ok ? this.buildColor(b.style) : ['#ff4d4d', '#c22'];
    ctx.globalAlpha = 0.55 + Math.sin(this.time * 6) * 0.1;
    ctx.fillStyle = fill;
    ctx.fillRect(part.x, part.y, part.w, part.h);
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = ok ? edge : '#ff8080';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.lineDashOffset = -this.time * 8;
    ctx.strokeRect(part.x - 0.5, part.y - 0.5, part.w + 1, part.h + 1);
    ctx.restore();
  },

  buildHud() {
    const b = this.buildChoice();
    return { mode: MODE_NAMES[b.mode], style: STYLE_NAMES[b.style], color: this.buildColor(b.style)[0] };
  },
};
