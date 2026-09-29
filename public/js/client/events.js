import { PALETTE } from '/shared/maps.js';
import { ITEM } from '/shared/game/items.js';
import { WEAPONS } from '/shared/weapons.js';
import { stickSegments } from '../render.js';

const PICKUP_TEXT = { [ITEM.AMMO]: ['+AMMO', '#ffd23f'], [ITEM.PACK]: ['+AMMO', '#e8c77e'] };

// Server events turned into effects, sounds, HUD callbacks and local unlocks (mixin of ClientGame).
export const events = {
  onEvent(ev, k) {
    const fx = this.fx;
    const sfx = this.sfx;
    const mine = this.slot;
    switch (ev.e) {
      case 'f':
        this.lastFireK[ev.s] = ev.k;
        if (ev.s !== mine) this.delay(ev.k, ev);
        break;
      case 'n':
        if (ev.s !== mine) this.delay(ev.k, ev);
        break;
      case 'r':
        if (ev.s !== mine) this.delay(this.lastFireK[ev.s] || k, ev);
        break;
      case 'i':
        if (ev.sh) {
          fx.shieldHit(ev.x, ev.y);
          sfx.play('shield', ev.x);
        } else {
          fx.impact(ev.x, ev.y, ev.a, this.colorsNear(ev.x + Math.cos(ev.a) * 2, ev.y + Math.sin(ev.a) * 2), 5);
          sfx.play('impact', ev.x);
        }
        break;
      case 'h': {
        const col = this.color(ev.s);
        const by = this.playerAt(ev.by);
        const dir = (by && Math.sign(ev.x - by.x)) || 1;
        fx.hit(ev.x, ev.y, col, dir, Math.min(14, 3 + Math.round(ev.d / 6)));
        fx.text(ev.x + (Math.random() - 0.5) * 16, ev.y - 20, String(Math.max(1, Math.round(ev.d))), ev.by === mine ? '#ffffff' : col, 1, 0.8);
        if (ev.by === mine && ev.s !== mine) {
          sfx.play('hit', ev.x);
          this.hitFlash = 0.14;
        }
        if (ev.s === mine) {
          sfx.play('hurt', ev.x);
          fx.shake(Math.min(0.5, 0.1 + ev.d / 120));
          if (this.onHurt) this.onHurt(ev);
        }
        break;
      }
      case 'b': {
        fx.explosion(ev.x, ev.y, ev.r);
        const d = Math.hypot(ev.x - this.me.x, ev.y - this.me.y);
        fx.shake(Math.max(0.12, 0.75 - d / 900) * (ev.r / 46));
        sfx.play('boom', ev.x, ev.r / 46);
        break;
      }
      case 'd': {
        const { segs, head } = stickSegments();
        fx.gib(ev.x, ev.y, ev.vx, ev.vy, segs, this.color(ev.s), head);
        if (ev.by === mine && ev.s !== mine) sfx.play('kill', ev.x);
        sfx.play('die', ev.x);
        if (ev.s === mine) fx.shake(0.4);
        if (this.onFeed) this.onFeed(ev.by, ev.s, ev.w);
        break;
      }
      case 'spawn':
        fx.spawnFx(ev.x, ev.y, this.color(ev.s));
        sfx.play('spawn', ev.x);
        if (ev.s === mine) this.pickWeapon({ abs: 0 });
        break;
      case 'split':
        fx.explosion(ev.x, ev.y, 16);
        sfx.play('pop', ev.x);
        break;
      case 'crate':
        sfx.play('crate', ev.x);
        break;
      case 'k':
        this.pickupFx(ev);
        break;
      case 'u':
        this.unlockFx(ev);
        break;
      case 'det':
        if (ev.s !== mine) sfx.play('det', this.playerAt(ev.s)?.x);
        break;
      case 'bl':
        fx.puff(ev.x, ev.y, ev.w || 12, this.color(ev.s), ev.h || 12);
        sfx.play('place', ev.x);
        break;
      default:
        break;
    }
  },

  pickupFx(ev) {
    const [label, col] = PICKUP_TEXT[ev.kind] || ['+HP +AMMO', '#45d483'];
    this.fx.text(ev.x, ev.y - 40, label, col, 1, 1.1);
    this.fx.ring(ev.x, ev.y - 12, 6, 40, col, 0.35);
    this.sfx.play(ev.kind === ITEM.CRATE ? 'pickup' : 'ammo', ev.x);
  },

  // A weapon became available: to one player (crate, wave reward) or to everyone (s = -1, armory).
  unlockFx(ev) {
    const me = this.me;
    const W = WEAPONS[ev.w];
    const forMe = ev.s === this.slot || ev.s === -1;
    if (forMe) {
      me.owned |= 1 << ev.w;
      me.ammo[ev.w] = W.ammo;
      this.sfx.play('unlock');
      if (!me.dead) this.fx.unlockFx(me.x, me.y, this.color(this.slot));
      if (this.onUnlock) this.onUnlock(ev.w, ev.s === -1);
      if (ev.s === this.slot && !me.dead) this.pickWeapon({ abs: ev.w });
    } else {
      const p = this.playerAt(ev.s);
      if (p && !p.dead) this.fx.unlockFx(p.x, p.y, this.color(ev.s));
    }
  },

  delay(k, ev) {
    const q = this.delayed;
    let i = q.length;
    while (i > 0 && q[i - 1].k > k) i--;
    q.splice(i, 0, { k, ev });
    if (q.length > 200) q.shift();
  },

  // Remote shots are played when the interpolated opponent reaches the tick they fired on.
  playRemote(ev) {
    if (ev.e === 'f') {
      this.shotFx(ev.s, ev.w, ev.a, ev.x, ev.y, ev.sq, false);
    } else if (ev.e === 'r') {
      this.fx.rail(ev.x1, ev.y1, ev.x2, ev.y2, this.color(ev.s));
    } else if (ev.e === 'n') {
      const r = this.remotes[ev.s];
      this.sfx.play('nade', r ? r.x : this.me.x);
    }
  },

  colorsNear(x, y) {
    const t = this.terrain;
    const out = [];
    for (let oy = -2; oy <= 2; oy += 2) {
      for (let ox = -2; ox <= 2; ox += 2) {
        const cx = Math.floor((x + ox) / 2);
        const cy = Math.floor((y + oy) / 2);
        if (cx < 0 || cy < 0 || cx >= t.w || cy >= t.h) continue;
        const i = cy * t.w + cx;
        if (t.mat[i]) out.push(PALETTE[t.col[i]]);
      }
    }
    return out;
  },

  dust(x, y) {
    const colors = this.colorsNear(x, y + 3);
    if (colors.length) this.fx.debris(x, y - 1, colors, 5);
  },
};
