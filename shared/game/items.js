import { DT, PHYS, RULES } from '../constants.js';
import { GRENADE, UNLOCKS, WEAPONS, owns } from '../weapons.js';

// Item kinds (wire format, 5th field of snapshot `c` entries).
export const ITEM = { CRATE: 0, AMMO: 1, PACK: 2 };
const SIZE = [24, 16, 14];
const GRAV = 1200;
const MAX_ITEMS = 10;
const r1 = (v) => Math.round(v * 10) / 10;

// Pickups falling from the sky or dropped by the dead, plus weapon progression.
export const items = {
  dropItem(kind, x, y = -30) {
    if (this.items.length >= MAX_ITEMS) return;
    x = Math.max(40, Math.min(this.worldW - 40, x));
    this.items.push({ id: this.nextId++, kind, x, y, vy: 0, t: 0 });
    if (kind === ITEM.CRATE) this.emit({ e: 'crate', x: r1(x) });
  },

  dropCrate(x) {
    this.dropItem(ITEM.CRATE, x);
  },

  dropPack(x, y) {
    this.dropItem(ITEM.PACK, x, y);
  },

  randomDropX() {
    const [sx] = this.spawns[Math.floor(this.rng() * this.spawns.length)];
    return sx + (this.rng() - 0.5) * 320;
  },

  // Next weapon of the pool, in unlock order, that `slot` does not own yet, or -1.
  nextLocked(slot) {
    const mask = this.players[slot].owned;
    for (const w of UNLOCKS) if (owns(this.pool, w) && !owns(mask, w)) return w;
    return -1;
  },

  // Gives `slot` weapon `w` with a full magazine and switches to it when it is an upgrade.
  grant(slot, w, silent) {
    const p = this.players[slot];
    if (w < 0 || owns(p.owned, w)) return false;
    p.owned |= 1 << w;
    p.ammo[w] = WEAPONS[w].ammo;
    if (!silent) this.emit({ e: 'u', s: slot, w });
    return true;
  },

  // Everyone present gets the next pool weapon of the global unlock track.
  armoryUnlock() {
    const w = UNLOCKS.find((u) => owns(this.pool, u) && !owns(this.baseOwned, u));
    if (w === undefined) return;
    this.baseOwned |= 1 << w;
    for (let s = 0; s < this.n; s++) if (this.present[s]) this.grant(s, w, true);
    this.emit({ e: 'u', s: -1, w });
  },

  pickup(s, c) {
    const p = this.players[s];
    if (c.kind === ITEM.CRATE) {
      p.hp = Math.min(RULES.HP, p.hp + RULES.CRATE_HEAL);
      for (let w = 0; w < WEAPONS.length; w++) if (owns(p.owned, w)) p.ammo[w] = WEAPONS[w].ammo;
      p.nades = GRENADE.count;
      p.fuel = RULES.FUEL;
      this.grant(s, this.nextLocked(s));
    } else {
      const share = c.kind === ITEM.AMMO ? 0.5 : 0.35;
      for (let w = 0; w < WEAPONS.length; w++) {
        const full = WEAPONS[w].ammo;
        if (full > 0 && owns(p.owned, w)) p.ammo[w] = Math.min(full, p.ammo[w] + Math.ceil(full * share));
      }
      p.nades = Math.min(GRENADE.count, p.nades + 1);
    }
    this.emit({ e: 'k', s, id: c.id, kind: c.kind, x: r1(c.x), y: r1(c.y), hp: Math.round(p.hp) });
  },

  timers() {
    if (this.armoryOn) {
      this.armoryT -= DT;
      if (this.armoryT <= 0) {
        this.armoryT = this.armoryEvery;
        this.armoryUnlock();
      }
    }
    if (!this.cratesOn) return;
    this.crateT -= DT;
    if (this.crateT <= 0) {
      this.crateT = RULES.CRATE_EVERY;
      if (this.items.filter((c) => c.kind === ITEM.CRATE).length < 2) this.dropItem(ITEM.CRATE, this.randomDropX());
    }
    this.ammoT -= DT;
    if (this.ammoT <= 0) {
      this.ammoT = RULES.AMMO_EVERY;
      if (this.items.filter((c) => c.kind === ITEM.AMMO).length < 3) this.dropItem(ITEM.AMMO, this.randomDropX());
    }
  },

  updateItems() {
    this.timers();
    const keep = [];
    const t = this.terrain;
    for (const c of this.items) {
      c.t += DT;
      if (c.t > (c.kind === ITEM.CRATE ? RULES.CRATE_LIFE : RULES.AMMO_LIFE)) continue;
      const half = SIZE[c.kind] / 2;
      // Items rest on anything that blocks shots, so they ride sand piles and fall when the floor goes.
      if (t.rectBlocksShot(c.x - half, c.y - 1, c.x + half, c.y)) c.y -= 1; // buried: pop up
      if (!t.rectBlocksShot(c.x - half, c.y, c.x + half, c.y + 1)) {
        c.vy = Math.min(900, c.vy + GRAV * DT);
        let dy = c.vy * DT;
        while (dy > 0) {
          const s = Math.min(1, dy);
          if (t.rectBlocksShot(c.x - half, c.y + s - 0.01, c.x + half, c.y + s)) {
            c.vy = 0;
            break;
          }
          c.y += s;
          dy -= s;
        }
        if (c.y > this.worldH) continue;
      } else {
        c.vy = 0;
      }
      let taken = false;
      for (let s = 0; s < this.n && !taken; s++) {
        const p = this.players[s];
        if (!this.present[s] || p.dead || !this.canLoot[s]) continue;
        if (Math.abs(p.x - c.x) < half + 8 && c.y > p.y - PHYS.HEIGHT - 2 && c.y - SIZE[c.kind] < p.y + 2) {
          taken = true;
          this.pickup(s, c);
        }
      }
      if (!taken) keep.push(c);
    }
    this.items = keep;
  },
};

export const ITEM_SIZE = SIZE;
