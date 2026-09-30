import { PHYS } from '/shared/constants.js';
import { PIECE, PIECE_NAMES, STYLE_NAMES, bodyCells, freeCells, packBuild, partHits, planPiece } from '/shared/build.js';
import { BUILD as BUILD_PAL } from '/shared/palette.js';
import { BUILD, W } from '/shared/weapons.js';

const TEAM_COLORS = 3; // matches BUILD_COLORS on the server
const KEY = 'stick-duel.build';

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { style: (v.style | 0) % STYLE_NAMES.length };
  } catch {
    return { style: 0 };
  }
}

// Builder style and the ghost preview of the next piece (mixin of ClientGame). The piece itself is
// automatic: aiming sideways builds a wall, aiming up or down a floor (see `autoPiece`).
export const builder = {
  buildChoice() {
    if (!this.build) this.build = load();
    return this.build;
  },

  // `req` = { style }: summed T steps (Shift steps back).
  changeBuild(req) {
    const b = this.buildChoice();
    const n = STYLE_NAMES.length;
    b.style = (((b.style + (req.style | 0)) % n) + n) % n;
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
    return packBuild(PIECE.AUTO, this.buildChoice().style, Math.min(BUILD.cursor, this.cursorDist(aimAt)));
  },

  buildColor(style) {
    return BUILD_PAL[style ? style - 1 : this.slot % TEAM_COLORS];
  },

  // Ghost of the piece a click would place, drawn in backbuffer px (1 px = 1 terrain cell): it glides
  // to each new grid spot, glows in the style colour (red when blocked) and shows the grid corners
  // around it as fading dots.
  drawBuildPreview(ctx, x, feet) {
    const b = this.buildChoice();
    const aimAt = { x: (this.input.mx + this.camBx) * 2, y: (this.input.my + this.camBy) * 2 };
    const dist = Math.min(BUILD.cursor, this.cursorDist(aimAt));
    const plan = planPiece(this.terrain, x, feet, this.aim, PIECE.AUTO, dist);
    this.buildKind = plan.kind;
    const part = plan.parts[0];
    if (!part) {
      this.ghost = null;
      return;
    }
    let ok = freeCells(this.terrain, plan.parts) > 0;
    const bodies = [[x, feet]];
    for (let s = 0; s < this.present.length; s++) {
      const p = s === this.slot ? null : this.playerAt(s);
      if (p && !p.dead && this.present[s]) bodies.push([p.x, p.y]);
    }
    if (ok && bodies.some(([bx, by]) => partHits(part, ...bodyCells(bx, by)))) ok = false;

    // Glide from the previous spot; snap when the piece kind flips.
    const g = this.ghost;
    const glide = g && g.kind === plan.kind ? 0.45 : 1;
    const lerp = (a, c) => a + (c - a) * glide;
    this.ghost = g && glide < 1
      ? { kind: plan.kind, x: lerp(g.x, part.x), y: lerp(g.y, part.y), w: part.w, h: part.h }
      : { kind: plan.kind, ...part };
    const gh = this.ghost;

    const tile = BUILD.tile * BUILD.block;
    const cx = part.x + part.w / 2;
    const cy = part.y + part.h / 2;
    const [fill, edge] = ok ? this.buildColor(b.style) : ['#ff4d4d', '#ff8080'];
    ctx.save();
    ctx.fillStyle = '#ffffff';
    const gx = Math.round(cx / tile);
    const gy = Math.round((part.y + (plan.kind === PIECE.WALL ? part.h : 0)) / tile);
    const oy = (part.y + (plan.kind === PIECE.WALL ? part.h : 0)) - gy * tile; // levels follow the ground
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const px = (gx + i) * tile;
        const py = (gy + j) * tile + oy;
        const f = 1 - Math.hypot(px - cx, py - cy) / (tile * 2.2);
        if (f <= 0) continue;
        ctx.globalAlpha = 0.5 * f;
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }
    }
    ctx.shadowColor = fill;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = ok ? 0.4 + Math.sin(this.time * 5) * 0.08 : 0.35;
    ctx.fillStyle = fill;
    ctx.fillRect(gh.x, gh.y, gh.w, gh.h);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? fill : edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(gh.x - 0.5, gh.y - 0.5, gh.w + 1, gh.h + 1);
    // Corner brackets just outside the piece.
    const L = 4;
    const x0 = gh.x - 2.5;
    const y0 = gh.y - 2.5;
    const x1 = gh.x + gh.w + 2.5;
    const y1 = gh.y + gh.h + 2.5;
    ctx.beginPath();
    for (const [px, py, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.moveTo(px + sx * L, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + sy * L);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();
  },

  buildHud() {
    const b = this.buildChoice();
    return { piece: PIECE_NAMES[this.buildKind ?? PIECE.WALL], style: STYLE_NAMES[b.style], color: this.buildColor(b.style)[0] };
  },
};
