import { MODE_NAMES } from '/shared/build.js';
import { CONTINUOUS, FULL_POOL, KILL_NAMES, W, WEAPONS, owns, poolBar } from '/shared/weapons.js';
import { GUNS, NADE_ICON } from '../sprites.js';
import { LOCK } from '../sprites-tools.js';

// In-match HUD widgets driven by ClientGame.hud(): hotbar (the match's weapon pool in unlock order,
// keys 1..n, builder on B; only the next locked weapon is shown), weapon-unlock banner, stamina bar,
// armory countdown and kill feed.

const $ = (sel) => document.querySelector(sel);
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const keyOf = (bar, w) => (w === W.builder ? 'B' : KEYS[bar.nums.indexOf(w)] ?? '');

function setText(el, v) {
  const t = String(v);
  if (el.textContent !== t) el.textContent = t;
}

function iconCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  c.style.setProperty('--sw', img.width);
  c.style.setProperty('--sh', img.height);
  return c;
}

// `showYou()`: survival modes label the local player YOU in the kill feed.
export function createHud({ game, sfx, showYou }) {
  const hotbar = $('#hotbar');
  const tip = document.createElement('div');
  tip.className = 'tip hidden';
  let tipTimer = 0;
  let lastW = -1;
  let pool = -1;
  let bar = poolBar(FULL_POOL);
  let slots = [];
  let nade = null;

  function makeSlot(img, key, onClick, cls = '') {
    const el = document.createElement('div');
    el.className = `slot${cls}`;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = key;
    const a = document.createElement('span');
    a.className = 'a';
    const lock = iconCanvas(LOCK);
    lock.className = 'lock';
    el.append(iconCanvas(img), n, a, lock);
    if (onClick) el.addEventListener('click', onClick);
    hotbar.appendChild(el);
    return { el, a };
  }

  // One slot per pool weapon, rebuilt whenever the match's pool changes.
  function buildBar(next) {
    pool = next;
    bar = poolBar(pool);
    hotbar.textContent = '';
    slots = bar.slots.map((w) => {
      const builder = w === W.builder;
      const pick = builder ? { builder: true } : { bar: bar.nums.indexOf(w) };
      return { w, ...makeSlot(GUNS[w].img, keyOf(bar, w), () => game.pickWeapon(pick), builder ? ' build' : '') };
    });
    nade = makeSlot(NADE_ICON, 'R', null, ' nade');
    tip.classList.add('hidden');
    hotbar.appendChild(tip);
    lastW = -1;
  }

  function showTip(text, el) {
    tip.textContent = text;
    el.appendChild(tip);
    tip.classList.remove('hidden');
    tipTimer = 1.1;
  }

  function updateHotbar(h) {
    if (h.pool !== pool) buildBar(h.pool);
    // Locked weapons stay out of the way: only the next reward shows, as a teaser.
    const next = slots.find((q) => q.w !== W.builder && !owns(h.owned, q.w));
    for (const s of slots) {
      const ammo = h.ammo[s.w];
      const locked = !owns(h.owned, s.w);
      s.el.classList.toggle('on', s.w === h.w);
      s.el.classList.toggle('locked', locked);
      s.el.classList.toggle('gone', locked && s !== next);
      s.el.classList.toggle('empty', !locked && ammo === 0);
      const W = WEAPONS[s.w];
      let txt = locked || ammo < 0 ? '' : String(ammo);
      if (!locked && CONTINUOUS.has(W.kind) && ammo > 0) txt = `${Math.ceil((ammo / W.ammo) * 100)}%`;
      setText(s.a, txt);
      s.a.classList.toggle('zero', !locked && ammo === 0);
    }
    setText(nade.a, h.nades);
    nade.a.classList.toggle('zero', h.nades === 0);
    nade.el.classList.toggle('empty', h.nades === 0);

    if (h.w !== lastW) {
      const s = slots.find((q) => q.w === h.w);
      if (lastW !== -1 && s) showTip(WEAPONS[h.w].name, s.el);
      lastW = h.w;
    }
  }

  // ---------- unlock banner ----------

  const banner = $('#unlock');
  const bannerIcon = $('#unlock-icon');
  let bannerTimer = null;

  function unlocked(w, everyone) {
    const img = GUNS[w].img;
    bannerIcon.width = img.width;
    bannerIcon.height = img.height;
    bannerIcon.style.setProperty('--sw', img.width);
    bannerIcon.style.setProperty('--sh', img.height);
    const c = bannerIcon.getContext('2d');
    c.clearRect(0, 0, img.width, img.height);
    c.drawImage(img, 0, 0);
    setText($('#unlock-name'), WEAPONS[w].name);
    setText($('#unlock-sub'), everyone ? 'ARMORY DROP - EVERYONE GOT IT' : `NEW WEAPON - PRESS ${keyOf(bar, w)}`);
    banner.classList.remove('hidden', 'pop');
    void banner.offsetWidth;
    banner.classList.add('pop');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add('hidden'), 2600);
  }

  // ---------- kill feed ----------

  const feed = $('#killfeed');

  function onFeed(by, victim, w) {
    const row = document.createElement('div');
    row.className = 'kf';
    const name = (s) => {
      const sp = document.createElement('span');
      sp.textContent = s === game.slot && showYou() ? 'YOU' : game.names[s] || `P${s + 1}`;
      sp.style.color = game.color(s);
      return sp;
    };
    const ws = document.createElement('span');
    ws.className = 'w';
    if (by >= 0 && by !== victim) {
      ws.textContent = ` ${KILL_NAMES[w] || '?'} `;
      row.append(name(by), ws, name(victim));
    } else {
      ws.textContent = by === victim ? ' SELF-DESTRUCTED' : ` ${KILL_NAMES[w] ? `BY ${KILL_NAMES[w]}` : 'DIED'}`;
      row.append(name(victim), ws);
    }
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 4000);
    setTimeout(() => row.remove(), 4600);
  }

  // ---------- builder choice ----------

  const buildbar = $('#buildbar');
  const chips = MODE_NAMES.map((name) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = name;
    $('#bb-modes').appendChild(c);
    return c;
  });
  let lastBuild = '';

  function updateBuild(b) {
    buildbar.classList.toggle('hidden', !b || game.me.dead);
    if (!b) return;
    const key = `${b.mode}|${b.style}|${b.color}`;
    if (key === lastBuild) return;
    lastBuild = key;
    chips.forEach((c, i) => c.classList.toggle('on', MODE_NAMES[i] === b.mode));
    setText($('#bb-style'), b.style);
    $('#bb-swatch').style.background = b.color;
  }

  // ---------- per frame ----------

  const stam = $('.bar.stam');
  const stamFill = $('.bar.stam i');
  const armory = $('#armory');
  let lastArmory = -2;

  function update(h, dt) {
    updateHotbar(h);
    updateBuild(h.build);
    if (tipTimer > 0) {
      tipTimer -= dt;
      if (tipTimer <= 0) tip.classList.add('hidden');
    }
    stamFill.style.width = `${Math.max(0, h.stamina)}%`;
    stam.classList.toggle('on', !!h.sprinting);
    stam.classList.toggle('low', h.stamina < 25);
    const ar = h.armory;
    if (ar !== lastArmory) {
      armory.classList.toggle('hidden', ar < 0);
      if (ar >= 0) setText($('#armory-t'), `${ar}S`);
      if (ar >= 0 && ar <= 3 && ar < lastArmory) sfx.play('beep', sfx.earX);
      lastArmory = ar;
    }
  }

  function reset() {
    lastW = -1;
    lastArmory = -2;
    feed.textContent = '';
    banner.classList.add('hidden');
  }

  return { update, reset, unlocked, onFeed };
}
