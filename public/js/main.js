import { CREW_COLORS, INTERP_TICKS, PLAYER_COLORS, TICK_MS } from '/shared/constants.js';
import { ENEMIES, MAX_HUMANS, SURVIVAL_SLOTS } from '/shared/survival.js';
import { POOLS, POOL_IDS, sanitizePool } from '/shared/weapons.js';
import { Sfx } from './audio.js';
import { Fx, drawText } from './fx.js';
import { ClientGame } from './game.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { SoloServer } from './solo.js';
import { createFeel } from './ui/feel.js';
import { createHud } from './ui/hud.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#view');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const net = new Net();
const input = new Input(canvas);
const fx = new Fx();
const sfx = new Sfx();
const game = new ClientGame({ net, input, fx, sfx });
const solo = new SoloServer(game, { onSnapshot: (snap) => survivalSnapshot(snap) });

const ui = {
  menu: $('#menu'),
  hud: $('#hud'),
  pause: $('#pause'),
  over: $('#over'),
  waiting: $('#waiting'),
  help: $('#help'),
  center: $('#center-msg'),
  sub: $('#sub-msg'),
  conn: $('#conn'),
  name: $('#name'),
  code: $('#code'),
  toast: $('#toast'),
  hpBar: $('.bar.hp'),
  hpFill: $('.bar.hp i'),
  hpText: $('#hp-text'),
  fuelFill: $('.bar.fuel i'),
  netinfo: $('#netinfo'),
  killfeed: $('#killfeed'),
  scoreboard: $('#scoreboard'),
  wavebar: $('#wavebar'),
  soloOver: $('#solo-over'),
  coopWait: $('#coop-wait'),
};

let maps = [];
// Weapon picker data (from the server hello, with local defaults so the menu renders offline).
let poolPresets = POOL_IDS.map((id) => ({ id, name: POOLS[id].name, mask: POOLS[id].mask }));
// 'menu' | 'duel' (1v1 room) | 'solo' (local waves) | 'coop' (online waves)
let mode = 'menu';
let coop = null; // last co-op room info
let sv = null; // last survival state, solo or co-op
let crewNames = [];
let room = null;
let mapName = '';
let lastState = '';
let countdownEnd = 0;
let lastBeep = -1;
let overTimer = null;
let overMap = null;
let inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode) inviteCode = inviteCode.toUpperCase().slice(0, 4);

// ---------- helpers ----------

function show(el, on) {
  el.classList.toggle('hidden', !on);
}

let toastTimer = null;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
}

function center(text, sub = '', pop = true) {
  if (ui.center.textContent !== text) {
    ui.center.textContent = text;
    if (pop && text) {
      ui.center.classList.remove('pop');
      void ui.center.offsetWidth;
      ui.center.classList.add('pop');
    }
  }
  if (ui.sub.textContent !== sub) ui.sub.textContent = sub;
}

function playerName() {
  const v = ui.name.value.trim().toUpperCase().slice(0, 12);
  return v || 'PLAYER';
}

function inviteLink(code) {
  return `${location.origin}/?room=${code}`;
}

async function copyInvite() {
  const code = room?.code ?? coop?.code;
  if (!code) return;
  const link = inviteLink(code);
  try {
    await navigator.clipboard.writeText(link);
    toast('INVITE LINK COPIED');
  } catch {
    toast(link);
  }
}

function chips(el, items, selected, onPick) {
  el.textContent = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${it.id === selected ? ' on' : ''}`;
    b.textContent = it.name;
    b.addEventListener('click', () => onPick(it.id));
    el.appendChild(b);
  }
}

// ---------- menu ----------

try {
  ui.name.value = localStorage.getItem('sd-name') || '';
} catch {
  /* storage blocked */
}
ui.name.addEventListener('input', () => {
  try {
    localStorage.setItem('sd-name', ui.name.value.trim());
  } catch {
    /* storage blocked */
  }
});
ui.code.addEventListener('input', () => {
  ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
ui.code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join(ui.code.value);
});

// Weapons setting: just ALL WEAPONS or BASIC. `onChange(mask)` gets a sanitized pool.
function poolPicker(el, mask, onChange) {
  el.textContent = '';
  const row = document.createElement('div');
  row.className = 'chips pool-presets';
  const label = document.createElement('span');
  label.className = 'pool-label';
  label.textContent = 'WEAPONS';
  row.appendChild(label);
  for (const p of poolPresets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${p.mask === mask ? ' on' : ''}`;
    b.textContent = p.name;
    b.addEventListener('click', () => onChange(sanitizePool(p.mask)));
    row.appendChild(b);
  }
  el.appendChild(row);
}

function join(code) {
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) {
    toast('ENTER A 4-LETTER CODE');
    return;
  }
  sfx.unlock();
  net.send({ t: 'join', name: playerName(), code });
}

$('#btn-quick').addEventListener('click', () => {
  sfx.unlock();
  net.send({ t: 'quick', name: playerName() });
});
$('#btn-create').addEventListener('click', () => {
  sfx.unlock();
  net.send({ t: 'create', name: playerName() }); // map and weapons are picked in the waiting room
});
$('#btn-coop').addEventListener('click', () => {
  sfx.unlock();
  net.send({ t: 'coop', name: playerName() });
});
$('#btn-coop-start').addEventListener('click', () => net.send({ t: 'start' }));
$('#btn-copy3').addEventListener('click', copyInvite);
$('#btn-join').addEventListener('click', () => join(ui.code.value));
$('#btn-join-invite').addEventListener('click', () => join(inviteCode));
if (inviteCode) {
  $('#invite-code').textContent = inviteCode;
  show($('#invite'), true);
  ui.code.value = inviteCode;
}

// ---------- solo ----------

const BEST_KEY = 'sd-solo-best';
let centerTimer = null;

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function renderBest() {
  const best = loadBest();
  $('#solo-best').textContent = best ? `BEST SCORE ${best}` : '';
}

function flash(text, sub, ms) {
  center(text, sub);
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => {
    if (ui.center.textContent === text) center('', '', false);
  }, ms);
}

// Shared by solo and co-op: survival HUD, per-slot names/colors/teams from the enemy roster.
function enterSurvival(m) {
  mode = m;
  sv = null;
  clearTimeout(centerTimer);
  game.names = new Array(SURVIVAL_SLOTS).fill('');
  game.colors = new Array(SURVIVAL_SLOTS).fill('#ffffff');
  game.team = Array.from({ length: SURVIVAL_SLOTS }, (_, s) => (s < MAX_HUMANS ? 0 : 1));
  show(ui.menu, false);
  show(ui.waiting, false);
  show(ui.over, false);
  show(ui.soloOver, false);
  show(ui.pause, false);
  show(ui.hud, true);
  show(ui.scoreboard, false);
  show(ui.wavebar, true);
  show($('#btn-copy2'), m === 'coop');
  show($('#so-best-row'), m === 'solo');
  $('#pause-note').textContent = m === 'solo' ? 'THE GAME IS PAUSED' : 'THE RUN KEEPS GOING';
  $('#btn-leave').textContent = 'QUIT TO MENU';
  $('#btn-retry').textContent = m === 'solo' ? 'TRY AGAIN' : 'PLAY AGAIN';
  ui.killfeed.textContent = '';
  input.enabled = true;
  input.releaseAll();
  hud.reset();
  feel.reset();
  helpOnStart();
  center('', '', false);
}

function startSolo() {
  sfx.unlock();
  enterSurvival('solo');
  crewNames = [playerName()];
  game.net = solo;
  solo.start(playerName());
  ui.netinfo.textContent = 'SOLO';
  flash('GET READY', 'DEFEND THE OUTPOST', 1300);
}

function exitSolo() {
  solo.stop();
  game.net = net;
  renderBest();
  toMenu();
}

const crewName = (s) => crewNames[s] || `P${s + 1}`;

function survivalSnapshot(snap) {
  sv = snap.sv;
  const r = sv.r;
  for (let s = 0; s < r.length; s++) {
    if (s < MAX_HUMANS) {
      game.names[s] = crewName(s);
      game.colors[s] = CREW_COLORS[s];
    } else if (r[s]) {
      game.names[s] = ENEMIES[r[s]].name;
      game.colors[s] = ENEMIES[r[s]].color;
    }
  }
  for (const ev of snap.se) survivalEvent(ev);
}

function survivalEvent(ev) {
  const me = ev.s === game.slot;
  switch (ev.e) {
    case 'wave':
      soloWave(ev.n, ev.count, ev.boss);
      break;
    case 'clear':
      soloClear(ev.n, ev.bonus);
      break;
    case 'down':
      if (me) flash('DOWN!', `BACK IN A SEC - ${ev.lives} ${ev.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`, 2400);
      else toast(`${crewName(ev.s)} IS DOWN`);
      break;
    case 'out':
      if (!me) toast(`${crewName(ev.s)} IS OUT - CLEAR THE WAVE`);
      else if (mode === 'solo' || !sv || sv.over) center('YOU DIED', '');
      else center('YOU ARE OUT', 'BACK WHEN YOUR TEAM CLEARS THE WAVE');
      break;
    case 'revive':
      if (!me) break;
      sfx.play('spawn', sfx.earX);
      if (ui.center.textContent === 'YOU ARE OUT') center('', '', false);
      break;
    case 'life':
      toast(`+1 LIFE (${ev.lives})`);
      break;
    case 'pts':
      fx.text(ev.x, ev.y - 74, `+${ev.pts}`, '#ffe07a', 1, 1);
      break;
    case 'over':
      soloOver(ev);
      break;
    default:
      break;
  }
}

function soloWave(n, count, boss) {
  sfx.play('go', sfx.earX);
  flash(`WAVE ${n}`, boss ? 'BOSS INCOMING' : `${count} ENEMIES`, 1800);
}

function soloClear(n, bonus) {
  sfx.play('win', sfx.earX);
  flash('WAVE CLEAR', `+${bonus} BONUS - HP AND AMMO RESTORED`, 2200);
}

function soloOver(stats) {
  const best = loadBest();
  const isNew = mode === 'solo' && stats.score > best;
  if (isNew) {
    try {
      localStorage.setItem(BEST_KEY, String(stats.score));
    } catch {
      /* storage blocked */
    }
  }
  $('#so-wave').textContent = stats.wave;
  $('#so-kills').textContent = stats.kills;
  $('#so-score').textContent = stats.score;
  $('#so-best').textContent = Math.max(best, stats.score);
  show($('#so-new'), isNew && stats.score > 0);
  sfx.play('lose', sfx.earX);
  center('', '', false);
  show(ui.pause, false);
  show(ui.soloOver, true);
  input.enabled = false;
  input.releaseAll();
}

// ---------- co-op ----------

function applyCoop(msg) {
  const prev = coop;
  coop = msg;
  crewNames = msg.names.map((n) => n || '');
  const lobby = msg.st === 'lobby';
  show(ui.coopWait, lobby);
  if (lobby) {
    $('#cw-code').textContent = msg.code;
    const list = $('#cw-players');
    list.textContent = '';
    msg.names.forEach((n, s) => {
      if (!n) return;
      const row = document.createElement('span');
      row.textContent = s === game.slot ? `${n} (YOU)` : n;
      row.style.color = CREW_COLORS[s];
      list.appendChild(row);
    });
    setText($('#cw-count'), `${msg.names.filter(Boolean).length}/${MAX_HUMANS}`);
    poolPicker($('#cw-pool'), msg.pool, (pool) => net.send({ t: 'setopts', pool }));
    game.setPool(msg.pool);
  }
  if (msg.st === 'playing' && prev && prev.st !== 'playing') {
    show(ui.soloOver, false);
    show(ui.pause, false);
    hud.reset();
    feel.reset();
    helpOnStart();
    input.enabled = true;
    input.releaseAll();
    flash('GET READY', 'DEFEND THE OUTPOST TOGETHER', 1300);
  }
}

if (new URLSearchParams(location.search).has('debug')) window.sd = { game, solo };
$('#btn-solo').addEventListener('click', startSolo);
$('#btn-retry').addEventListener('click', () => (mode === 'coop' ? net.send({ t: 'start' }) : startSolo()));
$('#btn-solo-menu').addEventListener('click', leave);
renderBest();

// ---------- pause / over ----------

function setPaused(on) {
  if (!game.active) return;
  show(ui.pause, on);
  input.enabled = !on && ui.over.classList.contains('hidden') && ui.soloOver.classList.contains('hidden');
  if (on) input.releaseAll();
  if (solo.active) solo.paused = on;
}

// ---------- settings (pause menu, remembered per browser) ----------

const prefs = { shake: true, help: false, helpSeen: false };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem('sd-prefs') || '{}'));
} catch {
  /* storage blocked */
}
function savePrefs() {
  try {
    localStorage.setItem('sd-prefs', JSON.stringify(prefs));
  } catch {
    /* storage blocked */
  }
}
function toggleLabel(id, on) {
  const b = $(`${id} b`);
  b.textContent = on ? 'ON' : 'OFF';
  b.classList.toggle('off', !on);
}
function applyPrefs() {
  fx.shakeMul = prefs.shake ? 1 : 0;
  toggleLabel('#btn-shake', prefs.shake);
  toggleLabel('#btn-help', !ui.help.classList.contains('hidden'));
}
function setHelp(on, remember = true) {
  ui.help.classList.toggle('hidden', !on);
  if (remember) prefs.help = on;
  savePrefs();
  applyPrefs();
}
// The controls panel shows on your very first match, then stays tucked away unless you want it.
function helpOnStart() {
  if (!prefs.helpSeen) {
    prefs.helpSeen = true;
    setHelp(true, false);
    setTimeout(() => setHelp(prefs.help, false), 15000);
  } else setHelp(prefs.help, false);
}
$('#btn-shake').addEventListener('click', () => {
  prefs.shake = !prefs.shake;
  savePrefs();
  applyPrefs();
});
$('#btn-help').addEventListener('click', () => setHelp(ui.help.classList.contains('hidden')));
applyPrefs();

function updateMuteLabel() {
  toggleLabel('#btn-mute', !sfx.muted);
}

function leave() {
  if (solo.active) {
    exitSolo();
    return;
  }
  net.send({ t: 'leave' });
  toMenu();
}

// Back to the menu from any mode, restoring the 1v1 HUD defaults.
function toMenu() {
  mode = 'menu';
  room = null;
  coop = null;
  sv = null;
  clearTimeout(centerTimer);
  game.leave();
  game.net = net;
  game.team = [0, 1];
  game.colors = PLAYER_COLORS.slice();
  game.names = ['P1', 'P2'];
  game.interp = INTERP_TICKS;
  show(ui.soloOver, false);
  show(ui.coopWait, false);
  show(ui.waiting, false);
  show(ui.scoreboard, true);
  show(ui.wavebar, false);
  show($('#btn-copy2'), true);
  $('#pause-note').textContent = 'THE MATCH KEEPS RUNNING';
  $('#btn-leave').textContent = 'LEAVE MATCH';
  center('', '', false);
  show(ui.hud, false);
  show(ui.pause, false);
  show(ui.over, false);
  show(ui.menu, true);
  clearTimeout(overTimer);
  history.replaceState(null, '', '/');
  input.enabled = false;
}

$('#btn-resume').addEventListener('click', () => setPaused(false));
$('#btn-copy').addEventListener('click', copyInvite);
$('#btn-copy2').addEventListener('click', copyInvite);
$('#btn-mute').addEventListener('click', () => {
  sfx.setMuted(!sfx.muted);
  updateMuteLabel();
});
$('#btn-leave').addEventListener('click', leave);
$('#btn-leave2').addEventListener('click', leave);
$('#btn-rematch').addEventListener('click', () => {
  sfx.unlock();
  net.send({ t: 'rematch', map: overMap });
});

input.on('pause', () => {
  if (!game.active) return;
  if (!ui.over.classList.contains('hidden') || !ui.soloOver.classList.contains('hidden')) return;
  setPaused(ui.pause.classList.contains('hidden'));
});
input.on('mute', () => {
  sfx.setMuted(!sfx.muted);
  updateMuteLabel();
  toast(sfx.muted ? 'SOUND OFF' : 'SOUND ON');
});
input.on('help', () => setHelp(ui.help.classList.contains('hidden')));
input.on('gesture', () => sfx.unlock());
window.addEventListener('pointerdown', () => sfx.unlock());
updateMuteLabel();

// ---------- hud ----------

const survivalMode = () => mode === 'solo' || mode === 'coop';
const hud = createHud({ game, sfx, showYou: survivalMode });
const feel = createFeel({ game, sfx, survival: survivalMode });
game.onFeed = (by, victim, w) => {
  hud.onFeed(by, victim, w);
  feel.onDeath(by, victim, w);
};
game.onHurt = feel.hurtFrom;
game.onUnlock = hud.unlocked;
game.onToast = (text) => toast(text);

// ---------- room state ----------

function applyRoom(msg) {
  const prev = room;
  room = msg;
  game.roomState = msg.st;
  game.names = msg.names.map((n, i) => n || `P${i + 1}`);
  if (msg.pool !== undefined) game.setPool(msg.pool);

  const sb = $('#scoreboard');
  for (let s = 0; s < 2; s++) {
    const side = sb.querySelector(`.s${s}`);
    side.querySelector('.nm').textContent = msg.names[s] || '...';
    side.querySelector('.sc').textContent = msg.scores[s];
    side.classList.toggle('me', s === game.slot);
  }
  $('#goal-text').textContent = `FIRST TO ${msg.goal}`;
  const m = maps.find((x) => x.id === msg.map);
  mapName = m ? m.name : msg.map;
  $('#map-text').textContent = mapName;

  const waiting = msg.st === 'waiting';
  show(ui.waiting, waiting);
  if (waiting) {
    $('#w-code').textContent = msg.code;
    chips($('#w-maps'), maps, msg.map, (id) => net.send({ t: 'setmap', map: id }));
    poolPicker($('#w-pool'), msg.pool, (pool) => net.send({ t: 'setopts', pool }));
  }

  if (msg.st === 'countdown' && (!prev || prev.st !== 'countdown')) {
    countdownEnd = performance.now() + msg.timer * 1000;
    lastBeep = -1;
  }
  if (msg.st === 'playing' && prev && prev.st === 'countdown') {
    sfx.play('go', 800);
    center('FIGHT!', '');
    setTimeout(() => {
      if (room && room.st === 'playing' && ui.center.textContent === 'FIGHT!') center('', '', false);
    }, 900);
  }

  if (msg.st === 'over') {
    if (lastState !== 'over') {
      const won = msg.winner === game.slot;
      overMap = msg.map;
      clearTimeout(overTimer);
      center(won ? 'VICTORY' : 'DEFEAT', '');
      overTimer = setTimeout(() => {
        if (!room || room.st !== 'over') return;
        sfx.play(won ? 'win' : 'lose', 800);
        center('', '', false);
        setPaused(false);
        show(ui.over, true);
        input.enabled = false;
        input.releaseAll();
      }, 1200);
    }
    renderOver(msg);
  } else {
    clearTimeout(overTimer);
    if (!ui.over.classList.contains('hidden')) {
      show(ui.over, false);
      input.enabled = ui.pause.classList.contains('hidden');
    }
  }
  lastState = msg.st;
}

function renderOver(msg) {
  const won = msg.winner === game.slot;
  $('#over-title').textContent = won ? 'YOU WIN' : 'YOU LOSE';
  const sc = $('#over-score');
  sc.textContent = '';
  for (let s = 0; s < 2; s++) {
    const sp = document.createElement('span');
    sp.className = `s${s}`;
    sp.textContent = msg.scores[s];
    sc.appendChild(sp);
    if (s === 0) {
      const dash = document.createElement('span');
      dash.textContent = '-';
      sc.appendChild(dash);
    }
  }
  chips($('#over-maps'), maps, overMap, (id) => {
    overMap = id;
    renderOver(room);
  });
  const other = 1 - game.slot;
  const status = $('#over-status');
  const btn = $('#btn-rematch');
  if (!msg.names[other]) {
    status.textContent = 'OPPONENT LEFT';
    btn.disabled = true;
  } else if (msg.rematch[game.slot]) {
    status.textContent = 'WAITING FOR OPPONENT...';
    btn.disabled = true;
  } else {
    status.textContent = msg.rematch[other] ? `${msg.names[other]} WANTS A REMATCH` : '';
    btn.disabled = false;
  }
}

// ---------- network ----------

net.on('open', () => {
  ui.conn.textContent = 'CONNECTED';
  ui.conn.classList.remove('bad');
});
net.on('close', () => {
  ui.conn.textContent = 'RECONNECTING...';
  ui.conn.classList.add('bad');
  if (game.active && !solo.active) {
    toMenu();
    toast('CONNECTION LOST');
  }
});
net.on('hello', (msg) => {
  maps = msg.maps;
  if (msg.pools?.length) poolPresets = msg.pools;
});
net.on('joined', (msg) => {
  if (msg.mode === 'coop') {
    enterSurvival('coop');
    game.roomState = 'playing';
    coop = null;
    crewNames = [];
  } else {
    if (mode !== 'duel') toMenu();
    mode = 'duel';
  }
  game.setSlot(msg.slot);
  history.replaceState(null, '', `/?room=${msg.code}`);
  inviteCode = null;
  show($('#invite'), false);
  show(ui.menu, false);
  show(ui.hud, true);
  show(ui.over, false);
  show(ui.pause, false);
  input.enabled = true;
  input.releaseAll();
  lastState = '';
  hud.reset();
  feel.reset();
  helpOnStart();
  center('', '', false);
});
net.on('map', (msg) => {
  game.loadMap(msg);
});
net.on('room', applyRoom);
net.on('coop', applyCoop);
net.on('s', (msg) => {
  if (msg.sv && mode === 'coop') survivalSnapshot(msg);
  game.onSnapshot(msg);
});
net.on('err', (msg) => toast(msg.m));
net.on('left', (msg) => {
  if (msg.slot !== game.slot) toast(`${game.names[msg.slot] || 'OPPONENT'} LEFT`);
});
net.on('lobby', () => {
  if (game.active && !solo.active) toMenu();
});

// ---------- logo ----------

(function drawLogo() {
  const lg = $('#logo').getContext('2d');
  lg.imageSmoothingEnabled = false;
  lg.clearRect(0, 0, 200, 40);
  drawText(lg, 'STICK', 52, 6, PLAYER_COLORS[0], 3);
  drawText(lg, 'DUEL', 146, 6, PLAYER_COLORS[1], 3);
})();

// ---------- per-frame HUD ----------

function updateHud(dt) {
  if (!game.active || mode === 'menu' || (mode === 'duel' && !room)) return;
  const h = game.hud();
  const hp = Math.max(0, h.hp);
  ui.hpFill.style.width = `${hp}%`;
  const hpTxt = String(Math.ceil(hp));
  if (ui.hpText.textContent !== hpTxt) ui.hpText.textContent = hpTxt;
  ui.hpBar.classList.toggle('low', hp <= 25);
  ui.hpBar.classList.toggle('mid', hp > 25 && hp <= 50);
  ui.fuelFill.style.width = `${Math.max(0, h.fuel)}%`;
  hud.update(h, dt);
  feel.update(h, dt);
  if (mode !== 'solo') setText(ui.netinfo, `${Math.round(h.rtt)} MS`);
  if (mode === 'solo' || mode === 'coop') {
    updateWaveHud();
    return;
  }

  if (room.st === 'countdown') {
    const left = (countdownEnd - performance.now()) / 1000;
    const n = Math.max(1, Math.ceil(left));
    if (n !== lastBeep && left > 0) {
      lastBeep = n;
      sfx.play('beep', 800);
      center(String(n), 'GET READY');
    }
  } else if (room.st === 'playing' || room.st === 'waiting') {
    if (h.dead && game.present[game.slot] && ui.center.textContent !== 'FIGHT!') {
      const t = Math.max(0, h.respawnT);
      center('', t > 0 ? `RESPAWN IN ${t.toFixed(1)}` : '', false);
    } else if (!h.dead && ui.sub.textContent.startsWith('RESPAWN')) {
      center(ui.center.textContent === 'FIGHT!' ? 'FIGHT!' : '', '', false);
    }
  }
}

function setText(el, v) {
  const t = String(v);
  if (el.textContent !== t) el.textContent = t;
}

let lastBreakBeep = -1;
function updateWaveHud() {
  const w = sv;
  if (!w) return;
  setText($('#wb-wave'), w.wave || '-');
  setText($('#wb-left'), w.left);
  setText($('#wb-score'), w.score);
  setText($('#wb-lives'), w.st === 'lobby' ? '-' : w.lives > 6 ? `♥x${w.lives}` : '♥'.repeat(Math.max(0, w.lives)) || '0');
  if (w.over || w.st !== 'break' || w.wave === 0) {
    lastBreakBeep = -1;
    return;
  }
  const n = Math.ceil(w.timer);
  if (n <= 3 && n >= 1 && n !== lastBreakBeep) {
    lastBreakBeep = n;
    sfx.play('beep', sfx.earX);
    if (ui.center.textContent !== 'WAVE CLEAR') center('', `NEXT WAVE IN ${n}`, false);
  }
}

// ---------- main loop ----------

input.enabled = false;
let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt * 1000;
  let steps = 0;
  const frozen = solo.active && solo.paused;
  if (frozen) acc = 0;
  while (acc >= TICK_MS && steps < 15) {
    game.tick();
    solo.step();
    acc -= TICK_MS;
    steps++;
  }
  if (steps === 15) acc = 0;
  if (!frozen) fx.update(dt);
  game.render(ctx, acc / TICK_MS, frozen ? 0 : dt);
  updateHud(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
