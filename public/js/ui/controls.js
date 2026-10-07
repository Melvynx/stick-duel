import { sanitizePool } from '/shared/weapons.js';

// Small DOM controls shared by the menus and the room panels.

// Toggle chips: `items` = [{ id, name, tag? }]. `locked` shows the choice without letting it change
// (settings only the host can edit).
export function chips(el, items, selected, onPick, locked = false) {
  el.textContent = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${it.id === selected ? ' on' : ''}`;
    b.textContent = it.name;
    if (it.tag) {
      const tag = document.createElement('small');
      tag.textContent = it.tag;
      b.appendChild(tag);
    }
    b.disabled = locked;
    b.setAttribute('aria-pressed', String(it.id === selected));
    if (!locked) b.addEventListener('click', () => onPick(it.id));
    el.appendChild(b);
  }
}

// Labelled row of chips.
export function settingRow(el, label, items, selected, onPick, locked = false) {
  el.textContent = '';
  el.classList.add('setting');
  const name = document.createElement('span');
  name.className = 'setting-label';
  name.textContent = label;
  const row = document.createElement('div');
  row.className = 'chips';
  chips(row, items, selected, onPick, locked);
  el.append(name, row);
}

// Weapons setting: the pool presets (ALL WEAPONS, BASIC...). `onChange(mask)` gets a sanitized pool.
export function poolPicker(el, presets, mask, onChange, locked = false) {
  const items = presets.map((p) => ({ id: p.mask, name: p.name }));
  settingRow(el, 'WEAPONS', items, mask, (m) => onChange(sanitizePool(m)), locked);
}
