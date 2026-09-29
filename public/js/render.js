import { GRID_H, GRID_W, MAT_DECOR, MAT_EMPTY, PHYS } from '/shared/constants.js';
import { PALETTE } from '/shared/maps.js';
import { CHUNK } from '/shared/terrain.js';
import { BOMBLET as BOMBLET_P, PROJ } from '/shared/projectiles.js';
import { WEAPONS } from '/shared/weapons.js';
import { drawText, hexToRgb, pxCircle, pxLine, shade } from './fx.js';
import { BOMBLET, CHUTE, CRATE, CRATE_CHUTE, GRENADE, GUNS, JETPACK, MIRV, ROCKET } from './sprites.js';
import { AMMO_BOX, C4_CHARGE, PACK, QUAKE_SHELL } from './sprites-tools.js';

// Everything draws into the 800x450 backbuffer: 1 backbuffer px = 2 world px = 1 terrain cell.

const OUTLINE = '#0e0b1c';
const EMBER = ['#ffd23f', '#ff9a1f', '#ff5a1f', '#c8321e', '#ff9a1f', '#fff3a8', '#ff5a1f', '#8a2a1e'].map(hexToRgb);

// ---------- sky ----------

export function makeSky() {
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 450;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 450);
  grad.addColorStop(0, '#120d2a');
  grad.addColorStop(0.55, '#221a45');
  grad.addColorStop(1, '#3a2356');
  g.fillStyle = grad;
  g.fillRect(0, 0, 800, 450);
  // Dither the gradient into bands so it reads as pixel art.
  const img = g.getImageData(0, 0, 800, 450);
  const d = img.data;
  for (let y = 0; y < 450; y++) {
    for (let x = 0; x < 800; x++) {
      const i = (y * 800 + x) * 4;
      const n = ((x ^ y) & 1) * 3;
      for (let k = 0; k < 3; k++) d[i + k] = Math.floor((d[i + k] + n) / 6) * 6;
    }
  }
  g.putImageData(img, 0, 0);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rnd() * 800);
    const y = Math.floor(rnd() * 260);
    g.fillStyle = rnd() < 0.2 ? '#ffffff' : rnd() < 0.5 ? '#8d86c6' : '#5d5690';
    g.fillRect(x, y, 1, 1);
    if (rnd() < 0.06) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
  }
  g.fillStyle = '#3a3370';
  pxCircle(g, 660, 70, 22);
  g.fillStyle = '#4d4590';
  pxCircle(g, 656, 66, 18);
  g.fillStyle = '#3a3370';
  pxCircle(g, 650, 60, 4);
  pxCircle(g, 664, 76, 3);
  return c;
}

// ---------- terrain ----------

export class TerrainView {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pal = [];
    this.palLen = 0;
    this.t = null;
    this.frame = 0;
    this.resize(GRID_W, GRID_H);
  }

  resize(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
    this.scorchMap = new Uint8Array(w * h);
  }

  palette() {
    if (this.palLen !== PALETTE.length) {
      this.pal = PALETTE.map((hex) => {
        const [r, g, b] = hexToRgb(hex);
        return [r, g, b];
      });
      this.palLen = PALETTE.length;
    }
    return this.pal;
  }

  setTerrain(t) {
    this.resize(t.w, t.h);
    this.t = t;
    this.scorchMap.fill(0);
    this.redraw(0, 0, t.w - 1, t.h - 1);
  }

  // Redraws cells in the inclusive rectangle and uploads it.
  redraw(x0, y0, x1, y1) {
    const t = this.t;
    if (!t) return;
    x0 = Math.max(0, x0 | 0);
    y0 = Math.max(0, y0 | 0);
    const W = this.w;
    x1 = Math.min(W - 1, x1 | 0);
    y1 = Math.min(this.h - 1, y1 | 0);
    if (x1 < x0 || y1 < y0) return;
    const pal = this.palette();
    const px = this.px;
    const mat = t.mat;
    const col = t.col;
    const burn = t.burn;
    const sc = this.scorchMap;
    for (let y = y0; y <= y1; y++) {
      let i = y * W + x0;
      for (let x = x0; x <= x1; x++, i++) {
        const m = mat[i];
        if (m === MAT_EMPTY) {
          px[i] = 0;
          continue;
        }
        const c = pal[col[i]] || pal[0];
        if (burn[i]) {
          // Burning cells flicker between embers and flame.
          const e = EMBER[(i * 7 + (this.frame >> 2) + (i >> 3)) % EMBER.length];
          px[i] = 0xff000000 | (e[2] << 16) | (e[1] << 8) | e[0];
          continue;
        }
        let k = 1 - sc[i] / 360;
        if (m === MAT_DECOR) k *= 0.82;
        // Exposed top edges get a 1px highlight, freshly carved holes a dark rim.
        const up = i >= W ? mat[i - W] : 1;
        if (up === MAT_EMPTY && m !== MAT_DECOR) k *= 1.18;
        const r = Math.min(255, c[0] * k) | 0;
        const g = Math.min(255, c[1] * k) | 0;
        const b = Math.min(255, c[2] * k) | 0;
        px[i] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  // Redraws every chunk the simulation touched since the last frame.
  flush() {
    const t = this.t;
    if (!t) return;
    this.frame = (this.frame + 1) | 0;
    const d = t.dirty;
    for (let cy = 0; cy < t.ch; cy++) {
      for (let cx = 0; cx < t.cw; cx++) {
        const k = cy * t.cw + cx;
        if (!d[k]) continue;
        d[k] = 0;
        // Merge a horizontal run of dirty chunks into one upload.
        let end = cx;
        while (end + 1 < t.cw && d[k + end + 1 - cx]) d[k + ++end - cx] = 0;
        this.redraw(cx * CHUNK, cy * CHUNK, (end + 1) * CHUNK - 1, (cy + 1) * CHUNK - 1);
        cx = end;
      }
    }
  }

  // Lifts the scorch marks under freshly placed cells.
  unscorch(x0, y0, x1, y1) {
    for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) {
      this.scorchMap.fill(0, y * this.w + Math.max(0, x0), y * this.w + Math.min(this.w - 1, x1) + 1);
    }
  }

  // Darkens the ground around a hole (cells), strength 0-255.
  scorch(cx, cy, r, strength) {
    const sc = this.scorchMap;
    const R = r + 3;
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(this.h - 1, Math.ceil(cy + R)); y++) {
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(this.w - 1, Math.ceil(cx + R)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > R) continue;
        const i = y * this.w + x;
        const v = Math.round(strength * Math.min(1, (R - d) / 3 + 0.2) * (0.75 + ((x * 7 + y * 13) % 5) * 0.08));
        if (v > sc[i]) sc[i] = Math.min(255, v);
      }
    }
  }
}

// ---------- guns ----------

// Backbuffer position of a gun anchor ('grip' | 'fore' | 'muzzle') for a player whose feet are at
// world (x, y), aiming at `a`. `kick` pushes the gun back along the aim (recoil animation).
export function gunPoint(x, y, a, w, which, kick = 0) {
  const G = GUNS[w];
  const W = WEAPONS[w];
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const face = ca >= 0 ? 1 : -1;
  const hold = W.hold / 2 - kick;
  const gx = x / 2 + ca * hold;
  const gy = (y - PHYS.AIM_Y) / 2 + sa * hold;
  const anchor = G[which];
  const u = anchor[0] - G.grip[0];
  const v = (anchor[1] - G.grip[1]) * face;
  return { x: gx + ca * u - sa * v, y: gy + sa * u + ca * v };
}

// World position of the muzzle, used to spawn flashes and tracers.
export function muzzleWorld(x, y, a, w) {
  const p = gunPoint(x, y, a, w, 'muzzle');
  return { x: p.x * 2, y: p.y * 2 };
}

function drawGun(ctx, x, y, a, w, kick) {
  const G = GUNS[w];
  const grip = gunPoint(x, y, a, w, 'grip', kick);
  const face = Math.cos(a) >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(Math.round(grip.x), Math.round(grip.y));
  ctx.rotate(a);
  if (face < 0) ctx.scale(1, -1);
  ctx.drawImage(G.img, -G.grip[0], -G.grip[1]);
  ctx.restore();
}

// ---------- stickman ----------

// Two-bone IK: elbow/knee for a joint at `a`, target `b`, bones l1 and l2, bending toward `bend` (+1/-1).
function ik(ax, ay, bx, by, l1, l2, bend) {
  const dx = bx - ax;
  const dy = by - ay;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: ax, y: ay + l1 };
  const maxD = l1 + l2 - 0.01;
  if (d > maxD) {
    const k = l1 / d;
    return { x: ax + dx * k, y: ay + dy * k };
  }
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const ang = Math.atan2(dy, dx) + bend * Math.acos(Math.max(-1, Math.min(1, cosA)));
  return { x: ax + Math.cos(ang) * l1, y: ay + Math.sin(ang) * l1 };
}

// Pose of the body in backbuffer px relative to the feet, facing right (mirrored later).
function bodyPose(s) {
  const t = s.time;
  const speed = Math.abs(s.vx);
  const moving = s.grounded && speed > 25;
  const back = Math.sign(s.vx) === -s.face;
  let lean = 0;
  let bob = 0;
  let feet;
  if (s.grounded) {
    if (moving) {
      const ph = s.phase;
      const stride = Math.min(1, speed / 220);
      const f1 = Math.sin(ph) * 5.5 * stride;
      const f2 = Math.sin(ph + Math.PI) * 5.5 * stride;
      const l1 = Math.max(0, Math.cos(ph)) * 3.2 * stride;
      const l2 = Math.max(0, Math.cos(ph + Math.PI)) * 3.2 * stride;
      const dir = back ? -1 : 1;
      feet = [
        [f1 * dir, -l1],
        [f2 * dir, -l2],
      ];
      bob = Math.abs(Math.sin(ph)) * 1.2 * stride;
      lean = (back ? -1 : 1.5) * stride;
    } else {
      const breathe = Math.sin(t * 2.2) * 0.4;
      feet = [
        [-3, 0],
        [3.5, 0],
      ];
      bob = -breathe;
    }
  } else if (s.jet > 0.1) {
    const sw = Math.sin(t * 9) * 1;
    feet = [
      [-3 + sw, -1],
      [1 - sw, -2],
    ];
    lean = 1;
  } else if (s.vy < 0) {
    feet = [
      [-2, -5],
      [3, -3],
    ];
  } else {
    feet = [
      [-4, -1],
      [4, -2.5],
    ];
  }
  const hipY = -12 + bob;
  return {
    hip: [0, hipY],
    neck: [lean, hipY - 10],
    head: [lean * 1.2, hipY - 13.5],
    feet,
  };
}

// Draws a stickman. `s` = { x, y, aim, w, vx, vy, grounded, jet, flipT, face, phase, time,
// color, kick, shield, alpha, jetpack }.
export function drawStick(ctx, s) {
  const X = Math.round(s.x / 2);
  const Y = Math.round(s.y / 2);
  const face = s.face;
  const pose = bodyPose(s);
  const rot = s.flipT >= 0 ? (s.flipT / PHYS.FLIP_TIME) * Math.PI * 2 * face : 0;
  const cx = 0;
  const cy = -14;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  // Local (facing-right) point -> backbuffer.
  const P = (p) => {
    const lx = p[0] * face - cx;
    const ly = p[1] - cy;
    return [X + cx + lx * cr - ly * sr, Y + cy + lx * sr + ly * cr];
  };
  const hip = P(pose.hip);
  const neck = P(pose.neck);
  const head = P(pose.head);
  const feet = pose.feet.map((f) => P(f));
  const knees = feet.map((f) => {
    const k = ik(hip[0], hip[1], f[0], f[1], 6.5, 6.5, face * (rot ? 1 : 1) * -1);
    return [k.x, k.y];
  });
  // Knees bend toward the facing direction.
  for (let i = 0; i < 2; i++) {
    const k = ik(hip[0], hip[1], feet[i][0], feet[i][1], 6.5, 6.5, -face);
    knees[i] = [k.x, k.y];
  }
  const shoulder = [neck[0] + (hip[0] - neck[0]) * 0.2, neck[1] + (hip[1] - neck[1]) * 0.2];
  const grip = gunPoint(s.x, s.y, s.aim, s.w, 'grip', s.kick);
  const fore = gunPoint(s.x, s.y, s.aim, s.w, 'fore', s.kick);
  const elbowDir = Math.cos(s.aim) >= 0 ? 1 : -1;
  const eNear = ik(shoulder[0], shoulder[1], grip.x, grip.y, 5.5, 5.5, elbowDir);
  const eFar = ik(shoulder[0], shoulder[1], fore.x, fore.y, 6, 6, elbowDir);

  const col = s.color;
  const dark = shade(col, 0.62);
  const blink = s.shield > 0 && Math.floor(s.time * 12) % 2 === 0;
  ctx.globalAlpha = (s.alpha ?? 1) * (blink ? 0.45 : 1);

  const limb = (a, b, c) => {
    pxLine(ctx, a[0], a[1], b[0], b[1], 2);
    if (c) pxLine(ctx, b[0], b[1], c[0], c[1], 2);
  };
  const jetpack = () => {
    const jx = neck[0] - face * 5;
    const jy = neck[1] + 1;
    ctx.save();
    ctx.translate(Math.round(jx), Math.round(jy));
    if (face < 0) ctx.scale(-1, 1);
    ctx.drawImage(JETPACK, -3, 0);
    ctx.restore();
  };

  // Outline pass keeps the figure readable against any terrain.
  ctx.fillStyle = OUTLINE;
  const olimb = (a, b, c) => {
    pxLine(ctx, a[0], a[1], b[0], b[1], 4);
    if (c) pxLine(ctx, b[0], b[1], c[0], c[1], 4);
  };
  olimb(hip, knees[0], feet[0]);
  olimb(hip, knees[1], feet[1]);
  olimb(neck, hip);
  olimb(shoulder, [eFar.x, eFar.y], [fore.x, fore.y]);
  olimb(shoulder, [eNear.x, eNear.y], [grip.x, grip.y]);
  pxCircle(ctx, head[0], head[1], 4.6);

  if (s.jetpack) jetpack();

  // Far side.
  ctx.fillStyle = dark;
  limb(hip, knees[0], feet[0]);
  limb(shoulder, [eFar.x, eFar.y], [fore.x, fore.y]);

  // Torso, head, near leg.
  ctx.fillStyle = col;
  limb(neck, hip);
  limb(hip, knees[1], feet[1]);
  pxCircle(ctx, head[0], head[1], 3.5);
  // Visor slit gives the head a facing direction.
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(Math.round(head[0] + face * 1) + (face > 0 ? 0 : -2), Math.round(head[1] - 1), 3, 1);

  drawGun(ctx, s.x, s.y, s.aim, s.w, s.kick);

  ctx.fillStyle = col;
  limb(shoulder, [eNear.x, eNear.y], [grip.x, grip.y]);
  ctx.globalAlpha = 1;

  if (s.shield > 0) {
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(s.time * 20);
    ctx.fillStyle = '#3ee6ff';
    const r = 19;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + s.time * 2;
      ctx.fillRect(Math.round(X + Math.cos(a) * r * 0.62), Math.round(Y - 14 + Math.sin(a) * r), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  return { head, neck, hip, feet, knees };
}

// World-space segments of a standing stickman (relative to the feet) for death gibs.
export function stickSegments() {
  return {
    segs: [
      [0, -44, 0, -24],
      [0, -24, -6, -12],
      [-6, -12, -6, 0],
      [0, -24, 6, -12],
      [6, -12, 7, 0],
      [0, -40, 9, -32],
      [9, -32, 18, -38],
      [0, -40, -8, -32],
    ],
    head: [0, -51],
  };
}

// World position of the jetpack nozzle, for exhaust particles.
export function jetNozzle(x, y, face) {
  return { x: x - face * 10, y: y - 20 };
}

// ---------- labels ----------

export function drawNameTag(ctx, x, y, name, color, hp, showHp) {
  const X = Math.round(x / 2);
  const Y = Math.round(y / 2);
  drawText(ctx, name, X, Y - 44, color, 1);
  if (showHp) {
    const w = 18;
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(X - w / 2 - 1, Y - 35, w + 2, 4);
    ctx.fillStyle = '#3a2a36';
    ctx.fillRect(X - w / 2, Y - 34, w, 2);
    ctx.fillStyle = hp > 50 ? '#45d483' : hp > 25 ? '#ffd23f' : '#ff3b3b';
    ctx.fillRect(X - w / 2, Y - 34, Math.max(0, Math.round((w * hp) / 100)), 2);
  }
}

// Arrow at the top edge when a player flies above the screen.
// Edge marker for a player outside the view. (sx, sy): screen position (backbuffer px) of their feet.
export function drawOffscreen(ctx, sx, sy, color) {
  const top = sy - 29;
  const over = Math.max(-top, sy - 450, -6 - sx, sx - 806);
  if (over <= 0) return;
  const X = Math.max(6, Math.min(794, Math.round(sx)));
  const Y = Math.max(6, Math.min(444, Math.round(sy - 15)));
  const label = String(Math.max(1, Math.round(over / 10)));
  ctx.fillStyle = OUTLINE;
  if (top < 0 && sx >= -6 && sx <= 806) {
    ctx.fillRect(X - 4, 1, 9, 6);
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) ctx.fillRect(X - i, 2 + i, i * 2 + 1, 1);
    drawText(ctx, label, X, 8, color, 1);
  } else if (sy > 450 && sx >= -6 && sx <= 806) {
    ctx.fillRect(X - 4, 443, 9, 6);
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) ctx.fillRect(X - i, 447 - i, i * 2 + 1, 1);
    drawText(ctx, label, X, 435, color, 1);
  } else if (sx < 0) {
    ctx.fillRect(1, Y - 4, 6, 9);
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) ctx.fillRect(2 + i, Y - i, 1, i * 2 + 1);
    drawText(ctx, label, 9, Y - 3, color, 1, 'left');
  } else {
    ctx.fillRect(793, Y - 4, 6, 9);
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) ctx.fillRect(797 - i, Y - i, 1, i * 2 + 1);
    drawText(ctx, label, 791, Y - 3, color, 1, 'right');
  }
}

export function drawCrosshair(ctx, x, y, color, hit) {
  const X = Math.round(x);
  const Y = Math.round(y);
  const g = hit > 0 ? 3 : 2;
  const arms = [
    [X - g - 3, Y, 3, 1],
    [X + g + 1, Y, 3, 1],
    [X, Y - g - 3, 1, 3],
    [X, Y + g + 1, 1, 3],
  ];
  ctx.fillStyle = OUTLINE;
  for (const [ax, ay, w, h] of arms) ctx.fillRect(ax - 1, ay - 1, w + 2, h + 2);
  ctx.fillRect(X - 1, Y - 1, 3, 3);
  ctx.fillStyle = hit > 0 ? '#ff3b3b' : '#ffffff';
  for (const [ax, ay, w, h] of arms) ctx.fillRect(ax, ay, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(X, Y, 1, 1);
}

// ---------- projectiles & crates ----------

function drawRotated(ctx, img, x, y, a) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(a);
  ctx.drawImage(img, -Math.floor(img.width / 2), -Math.floor(img.height / 2));
  ctx.restore();
}

export function drawProjectile(ctx, pr) {
  const x = pr.x / 2;
  const y = pr.y / 2;
  switch (pr.k) {
    case PROJ.ROCKET:
      drawRotated(ctx, ROCKET, x, y, Math.atan2(pr.vy, pr.vx));
      break;
    case PROJ.MIRV:
      drawRotated(ctx, MIRV, x, y, Math.atan2(pr.vy, pr.vx));
      break;
    case PROJ.GRENADE: {
      const spin = Math.round((pr.t * pr.vx) / 60) * (Math.PI / 4);
      drawRotated(ctx, GRENADE, x, y - 1, spin);
      if (pr.t > 1.1 && Math.floor(pr.t * 16) % 2 === 0) {
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(Math.round(x), Math.round(y) - 5, 1, 1);
      }
      break;
    }
    case PROJ.QUAKE:
      drawRotated(ctx, QUAKE_SHELL, x, y, Math.atan2(pr.vy, pr.vx));
      break;
    case PROJ.C4: {
      drawRotated(ctx, C4_CHARGE, x, y, pr.st ? 0 : pr.t * 9);
      // The light blinks faster the longer the charge has been armed.
      const rate = pr.st ? 3 + Math.min(9, pr.t * 1.5) : 12;
      if (Math.floor(pr.t * rate) % 2 === 0) {
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(Math.round(x), Math.round(y) - 3, 1, 1);
      }
      break;
    }
    case PROJ.BOMBLET:
      if (pr.t > BOMBLET_P.chute) {
        const sway = Math.round(Math.sin(pr.t * 3 + pr.id) * 1.5);
        ctx.drawImage(CHUTE, Math.round(x - 5 + sway), Math.round(y - 9));
      }
      ctx.drawImage(BOMBLET, Math.round(x - 2), Math.round(y - 2));
      break;
    default:
      break;
  }
}

const ITEM_SPRITES = [null, AMMO_BOX, PACK];

// Pickup of `kind` (0 crate, 1 ammo box, 2 pack) whose bottom-centre is (x, y) in world px.
export function drawItem(ctx, kind, x, y, falling, t) {
  if (!kind) return drawCrate(ctx, x, y, falling, t);
  const img = ITEM_SPRITES[kind];
  const X = Math.round(x / 2);
  const Y = Math.round(y / 2) - (falling ? 0 : Math.round(Math.max(0, Math.sin(t * 4)) * 1.5));
  if (falling && kind === 1) ctx.drawImage(CHUTE, X - 5, Y - img.height - 9);
  ctx.drawImage(img, X - (img.width >> 1), Y - img.height);
  if (!falling && Math.floor(t * 3) % 3 === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(X + (img.width >> 1), Y - img.height - 1, 1, 1);
  }
}

// Crate position is the bottom-centre in world px.
export function drawCrate(ctx, x, y, falling, t) {
  const X = Math.round(x / 2);
  const Y = Math.round(y / 2);
  if (falling) ctx.drawImage(CRATE_CHUTE, X - 8, Y - 12 - 8);
  ctx.drawImage(CRATE, X - 6, Y - 12);
  if (!falling && Math.floor(t * 3) % 2 === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(X - 7, Y - 13, 1, 1);
    ctx.fillRect(X + 6, Y - 13, 1, 1);
  }
}
