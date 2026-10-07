import { PLAYER_COLORS } from '/shared/constants.js';
import { GROUP_MODES, MODES, TEAM_COLORS, TEAM_NAMES } from '/shared/modes.js';
import { chips, poolPicker, settingRow } from './controls.js';

// Online room panels driven by the server `room` info: the waiting room (duel and group lobby),
// the top scoreboard, the TAB scoreboard and the results panel.

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setText(e, v) {
  const t = String(v);
  if (e.textContent !== t) e.textContent = t;
}

export const isGroup = (msg) => !!msg && msg.mode !== 'duel';

export function slotColor(msg, s) {
  if (msg.mode === 'teams' && msg.teams[s] >= 0) return TEAM_COLORS[msg.teams[s]];
  return PLAYER_COLORS[s % PLAYER_COLORS.length];
}

// Size tag from the map area: one screen is SMALL.
export function sizeTag(m) {
  if (!m.w) return '';
  const screens = (m.w * m.h) / (1600 * 900);
  return screens <= 1.05 ? 'SMALL' : screens <= 2.2 ? 'LARGE' : 'HUGE';
}

// Present slots, best first (kills, then fewest deaths).
export function ranking(msg) {
  const out = [];
  msg.names.forEach((n, s) => n && out.push(s));
  const lead = msg.mode === 'teams' ? (msg.teamScores[1] > msg.teamScores[0] ? 1 : 0) : -1;
  const side = (s) => (lead < 0 ? 0 : msg.teams[s] === lead ? 0 : 1);
  return out.sort(
    (a, b) =>
      side(a) - side(b) ||
      msg.scores[b] - msg.scores[a] ||
      (msg.deaths?.[a] ?? 0) - (msg.deaths?.[b] ?? 0) ||
      a - b,
  );
}

function canPlay(msg) {
  const n = msg.names.filter(Boolean).length;
  if (n < 2) return false;
  if (msg.mode !== 'teams') return true;
  return [0, 1].every((t) => msg.names.some((nm, s) => nm && msg.teams[s] === t));
}

export function createRoomUi({ game, net, maps, pools, onCopy }) {
  const name = (msg, s) => msg.names[s] || `P${s + 1}`;
  // The waiting panel can fold away to free the warm-up; a new room opens it again.
  let foldedCode = null;
  const fold = $('#btn-fold');
  const setFolded = (on) => {
    $('#waiting').classList.toggle('folded', on);
    fold.textContent = on ? 'SHOW' : 'HIDE';
    fold.setAttribute('aria-expanded', String(!on));
  };
  fold.addEventListener('click', () => setFolded(!$('#waiting').classList.contains('folded')));
  const mapItems = () => maps().map((m) => ({ id: m.id, name: m.name, tag: sizeTag(m) }));

  function playerTag(msg, s) {
    const row = el('span', 'pl');
    row.style.setProperty('--c', slotColor(msg, s));
    row.append(el('i'), el('span', 'nm', name(msg, s)));
    if (s === game.slot) row.append(el('small', 'you', 'YOU'));
    if (isGroup(msg) && s === msg.host) row.append(el('small', 'host', 'HOST'));
    return row;
  }

  function renderPlayers(msg) {
    const box = $('#w-players');
    box.textContent = '';
    box.classList.toggle('teams', msg.mode === 'teams');
    if (msg.mode !== 'teams') {
      msg.names.forEach((n, s) => n && box.appendChild(playerTag(msg, s)));
      return;
    }
    for (const t of [0, 1]) {
      const col = el('div', 'team');
      col.style.setProperty('--c', TEAM_COLORS[t]);
      const members = msg.names.map((n, s) => (n && msg.teams[s] === t ? s : -1)).filter((s) => s >= 0);
      const head = el('div', 'team-head');
      head.append(el('b', '', TEAM_NAMES[t]), el('span', 'dim', String(members.length)));
      if (msg.teams[game.slot] !== t) {
        const join = el('button', 'btn small', 'JOIN');
        join.type = 'button';
        join.addEventListener('click', () => net.send({ t: 'team', team: t }));
        head.appendChild(join);
      }
      col.appendChild(head);
      for (const s of members) col.appendChild(playerTag(msg, s));
      if (!members.length) col.appendChild(el('span', 'dim empty', 'NOBODY YET'));
      box.appendChild(col);
    }
  }

  // Duel: waiting for the opponent (both can change the map and weapons).
  // Group: lobby with the player list; only the host edits the settings and starts.
  function waiting(msg) {
    if (msg.code !== foldedCode) setFolded(false);
    foldedCode = msg.code;
    const group = isGroup(msg);
    const host = !group || msg.host === game.slot;
    const title = $('#w-title');
    title.textContent = group ? `${MODES[msg.mode].name}` : msg.pub ? 'FINDING AN OPPONENT' : 'WAITING FOR OPPONENT';
    title.classList.toggle('dots', !group);
    const n = msg.names.filter(Boolean).length;
    setText($('#w-count'), group ? `${n}/${msg.max} PLAYERS` : '');
    setText($('#w-code'), msg.code);
    $('#w-players').classList.toggle('hidden', !group);
    if (group) renderPlayers(msg);

    const modeRow = $('#w-mode');
    modeRow.classList.toggle('hidden', !group);
    if (group) {
      const items = GROUP_MODES.map((id) => ({ id, name: MODES[id].name }));
      settingRow(modeRow, 'MODE', items, msg.mode, (mode) => net.send({ t: 'setopts', mode }), !host);
    }
    settingRow($('#w-maps'), 'MAP', mapItems(), msg.map, (id) => net.send({ t: 'setmap', map: id }), !host);
    const goals = MODES[msg.mode].goals.map((g) => ({ id: g, name: String(g) }));
    const goalLabel = { duel: 'POINTS TO WIN', ffa: 'KILLS TO WIN', teams: 'TEAM KILLS' }[msg.mode];
    settingRow($('#w-goal'), goalLabel, goals, msg.goal, (goal) => net.send({ t: 'setopts', goal }), !host);
    poolPicker($('#w-pool'), pools(), msg.pool, (pool) => net.send({ t: 'setopts', pool }), !host);

    const start = $('#btn-start');
    const ready = canPlay(msg);
    start.classList.toggle('hidden', !group || !host);
    start.disabled = !ready;
    let hint = msg.pub ? 'THE NEXT PLAYER TO PICK QUICK DUEL JOINS YOU - OR SEND THE LINK' : 'SEND THE LINK TO A FRIEND - WARM UP MEANWHILE';
    if (group && !host) hint = `WAITING FOR ${name(msg, msg.host)} TO START`;
    else if (group && !ready) hint = n < 2 ? 'SHARE THE INVITE LINK - 2 PLAYERS MINIMUM' : 'EACH TEAM NEEDS AT LEAST ONE PLAYER';
    else if (group) hint = 'EVERYONE WARMS UP UNTIL YOU START';
    setText($('#w-hint'), hint);
  }

  // Top scoreboard. Duel: both players. FFA: you against the leader (or the runner-up when you
  // lead). Teams: both team totals.
  function scoreboard(msg) {
    const sb = $('#scoreboard');
    const sides = [sb.querySelector('.s0'), sb.querySelector('.s1')];
    const fill = (side, label, score, color, me) => {
      setText(side.querySelector('.nm'), label);
      setText(side.querySelector('.sc'), score);
      side.style.setProperty('--c', color);
      side.classList.toggle('me', me);
    };
    if (msg.mode === 'teams') {
      const mine = msg.teams[game.slot];
      for (const t of [0, 1]) fill(sides[t], TEAM_NAMES[t], msg.teamScores[t], TEAM_COLORS[t], t === mine);
    } else if (msg.mode === 'ffa') {
      const rank = ranking(msg);
      const me = game.slot;
      const rival = rank[0] === me ? rank[1] : rank[0];
      fill(sides[0], `#${rank.indexOf(me) + 1} ${name(msg, me)}`, msg.scores[me], slotColor(msg, me), true);
      if (rival === undefined) fill(sides[1], 'NOBODY', '-', '#9c95c4', false);
      else fill(sides[1], `#${rank.indexOf(rival) + 1} ${name(msg, rival)}`, msg.scores[rival], slotColor(msg, rival), false);
    } else {
      for (let s = 0; s < 2; s++) fill(sides[s], msg.names[s] || '...', msg.scores[s], PLAYER_COLORS[s], s === game.slot);
    }
    const goal = msg.st === 'waiting' ? 'WARM-UP - NOTHING COUNTS' : `FIRST TO ${msg.goal}`;
    setText($('#goal-text'), `${isGroup(msg) && msg.st !== 'waiting' ? `${MODES[msg.mode].name} - ` : ''}${goal}`);
    const m = maps().find((x) => x.id === msg.map);
    setText($('#map-text'), m ? m.name : msg.map);
    $('#board-hint').classList.toggle('hidden', !isGroup(msg));
  }

  // Ranked table: TAB scoreboard and group results.
  function table(box, msg) {
    box.textContent = '';
    const head = el('div', 'row head');
    head.append(el('span', 'rk', '#'), el('span', 'who', 'PLAYER'), el('span', 'k', 'K'), el('span', 'd', 'D'));
    box.appendChild(head);
    ranking(msg).forEach((s, i) => {
      const row = el('div', `row${s === game.slot ? ' me' : ''}`);
      const who = el('span', 'who');
      who.appendChild(playerTag(msg, s));
      row.append(el('span', 'rk', String(i + 1)), who, el('span', 'k', String(msg.scores[s])), el('span', 'd', String(msg.deaths?.[s] ?? 0)));
      box.appendChild(row);
    });
  }

  function board(msg, show) {
    const box = $('#board');
    box.classList.toggle('hidden', !show || !msg);
    if (!show || !msg) return;
    const title = el('div', 'board-title', `${MODES[msg.mode].name} - FIRST TO ${msg.goal}`);
    const list = el('div', 'table');
    table(list, msg);
    box.textContent = '';
    box.append(title, list);
    if (msg.mode === 'teams') {
      const t = el('div', 'board-teams');
      for (const k of [0, 1]) {
        const b = el('b', '', `${TEAM_NAMES[k]} ${msg.teamScores[k]}`);
        b.style.color = TEAM_COLORS[k];
        t.appendChild(b);
      }
      box.insertBefore(t, list);
    }
  }

  function won(msg) {
    return msg.mode === 'teams' ? msg.winner === msg.teams[game.slot] : msg.winner === game.slot;
  }

  function winnerText(msg) {
    if (won(msg)) return msg.mode === 'teams' ? 'YOUR TEAM WINS' : 'YOU WIN';
    if (msg.mode === 'teams') return `${TEAM_NAMES[msg.winner]} WINS`;
    if (msg.mode === 'ffa') return `${name(msg, msg.winner)} WINS`;
    return 'YOU LOSE';
  }

  // Results panel. `overMap` is the duel's locally picked next map; in group rooms the host
  // picks it for everyone.
  function over(msg, overMap, pickMap) {
    const group = isGroup(msg);
    const host = !group || msg.host === game.slot;
    setText($('#over-title'), winnerText(msg));
    const sc = $('#over-score');
    const rank = $('#over-rank');
    sc.classList.toggle('hidden', group);
    rank.classList.toggle('hidden', !group);
    if (group) {
      table(rank, msg);
      if (msg.mode === 'teams') {
        const t = el('div', 'board-teams');
        for (const k of [0, 1]) {
          const b = el('b', '', `${TEAM_NAMES[k]} ${msg.teamScores[k]}`);
          b.style.color = TEAM_COLORS[k];
          t.appendChild(b);
        }
        rank.prepend(t);
      }
    } else {
      sc.textContent = '';
      for (let s = 0; s < 2; s++) {
        const sp = el('span', `s${s}`, String(msg.scores[s]));
        sc.appendChild(sp);
        if (s === 0) sc.appendChild(el('span', '', '-'));
      }
    }
    const next = group ? msg.map : overMap;
    chips($('#over-maps'), mapItems(), next, group ? (id) => net.send({ t: 'setmap', map: id }) : pickMap, !host);

    const status = $('#over-status');
    const btn = $('#btn-rematch');
    const present = msg.names.filter(Boolean).length;
    if (group) {
      const readyN = msg.names.filter((n, s) => n && msg.rematch[s]).length;
      btn.textContent = host ? 'PLAY AGAIN' : msg.rematch[game.slot] ? 'READY' : "I'M READY";
      btn.disabled = present < 2 || (!host && msg.rematch[game.slot]);
      if (present < 2) status.textContent = 'EVERYONE ELSE LEFT';
      else if (host) status.textContent = `${readyN}/${present} READY - START WHENEVER YOU WANT`;
      else status.textContent = `WAITING FOR ${name(msg, msg.host)} - ${readyN}/${present} READY`;
      return;
    }
    const other = 1 - game.slot;
    btn.textContent = 'REMATCH';
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

  $('#btn-start').addEventListener('click', () => net.send({ t: 'start' }));
  $('#btn-copy').addEventListener('click', onCopy);

  return { waiting, scoreboard, board, over, won, winnerText };
}
