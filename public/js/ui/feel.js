import { KILL_NAMES } from '/shared/weapons.js';

// Game-feel widgets on top of the HUD: low-health vignette + heartbeat, hit direction arcs,
// kill streak callouts and the "killed by" recap while dead.

const $ = (sel) => document.querySelector(sel);
const LOW_HP = 35;
const MULTI_WINDOW = 3.2; // s between kills to chain a multi-kill
const MULTI = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'RAMPAGE'];
// Streak milestones since your last death; survival kills come fast so its steps are wider.
const STREAKS_DUEL = { 3: 'ON FIRE', 5: 'UNSTOPPABLE', 8: 'GODLIKE' };
const STREAKS_WAVES = { 8: 'ON FIRE', 15: 'UNSTOPPABLE', 25: 'GODLIKE', 40: 'LEGENDARY' };

export function createFeel({ game, sfx, survival }) {
  const vignette = $('#vignette');
  const dirs = $('#dmgdir');
  const callout = $('#callout');
  const recap = $('#recap');
  let beatT = 0;
  let streak = 0;
  let multi = 0;
  let lastKill = -99;
  let clock = 0;
  let calloutTimer = null;
  let killer = null; // { name, color, weapon } of whoever killed me last

  function shout(text, color) {
    callout.textContent = text;
    callout.style.color = color;
    callout.classList.remove('hidden', 'pop');
    void callout.offsetWidth;
    callout.classList.add('pop');
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => callout.classList.add('hidden'), 1500);
  }

  // A red arc on the side the damage came from (only for hits from another player).
  function hurtFrom(ev) {
    if (ev.by < 0 || ev.by === game.slot) return;
    const src = game.playerAt(ev.by);
    const me = game.me;
    if (!src || !me) return;
    const ang = Math.atan2(src.y - 30 - (me.y - 30), src.x - me.x);
    const el = document.createElement('i');
    el.style.setProperty('--a', `${ang}rad`);
    el.style.setProperty('--k', Math.min(1, 0.45 + ev.d / 40));
    dirs.appendChild(el);
    setTimeout(() => el.remove(), 900);
    while (dirs.children.length > 6) dirs.firstChild.remove();
  }

  function onDeath(by, victim, w) {
    const mine = game.slot;
    if (victim === mine) {
      streak = 0;
      multi = 0;
      const other = by >= 0 && by !== mine;
      killer = {
        name: other ? game.names[by] || `P${by + 1}` : by === mine ? 'YOURSELF' : 'THE WORLD',
        color: other ? game.color(by) : '#9a93b8',
        weapon: KILL_NAMES[w] || '',
      };
      return;
    }
    if (by !== mine) return;
    streak++;
    multi = clock - lastKill <= MULTI_WINDOW ? multi + 1 : 1;
    lastKill = clock;
    const streaks = survival() ? STREAKS_WAVES : STREAKS_DUEL;
    if (multi >= 2) {
      shout(MULTI[Math.min(multi, MULTI.length - 1)], '#ffe07a');
      sfx.play('streak', sfx.earX, 0.8 + multi * 0.1);
    } else if (streaks[streak]) {
      shout(streaks[streak], '#ff7a3d');
      sfx.play('streak', sfx.earX, 1.1);
    }
  }

  function update(h, dt) {
    clock += dt;
    // Keep the hit arcs around the player (1 backbuffer px = --u, the world is drawn at 1/2).
    const me = game.me;
    if (me && dirs.children.length) {
      dirs.style.left = `calc(var(--u) * ${me.x / 2 - game.camBx})`;
      dirs.style.top = `calc(var(--u) * ${(me.y - 30) / 2 - game.camBy})`;
    }
    const alive = !h.dead;
    const hp = Math.max(0, h.hp);
    const low = alive && hp < LOW_HP ? 1 - hp / LOW_HP : 0;
    vignette.style.opacity = (0.25 + low * 0.75) * (low > 0 ? 1 : 0);
    vignette.classList.toggle('beat', low > 0);
    if (low > 0) {
      beatT -= dt;
      if (beatT <= 0) {
        sfx.play('beat', sfx.earX, 0.5 + low * 0.5);
        beatT = 1 - low * 0.45;
      }
    } else {
      beatT = 0;
    }
    const showRecap = h.dead && killer;
    recap.classList.toggle('hidden', !showRecap);
    if (showRecap && recap.dataset.k !== `${killer.name}|${killer.weapon}`) {
      recap.dataset.k = `${killer.name}|${killer.weapon}`;
      recap.textContent = '';
      const by = document.createElement('span');
      by.textContent = 'KILLED BY ';
      const nm = document.createElement('b');
      nm.textContent = killer.name;
      nm.style.color = killer.color;
      recap.append(by, nm);
      if (killer.weapon && killer.name !== 'YOURSELF') {
        const wp = document.createElement('span');
        wp.className = 'w';
        wp.textContent = killer.weapon;
        recap.append(wp);
      }
    }
    if (alive) killer = null;
  }

  function reset() {
    streak = 0;
    multi = 0;
    killer = null;
    dirs.textContent = '';
    callout.classList.add('hidden');
    recap.classList.add('hidden');
    vignette.style.opacity = 0;
  }

  return { hurtFrom, onDeath, update, reset };
}
