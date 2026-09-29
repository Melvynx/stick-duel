import { BTN } from '/shared/constants.js';

// Keys use `e.code` (physical position) so ZQSD on AZERTY works like WASD.
const MAP = {
  KeyA: BTN.LEFT,
  ArrowLeft: BTN.LEFT,
  KeyD: BTN.RIGHT,
  ArrowRight: BTN.RIGHT,
  KeyW: BTN.JUMP,
  ArrowUp: BTN.JUMP,
  Space: BTN.JUMP,
  KeyS: BTN.DOWN,
  ArrowDown: BTN.DOWN,
  KeyG: BTN.ALT,
  KeyE: BTN.ALT,
  ShiftLeft: BTN.SPRINT,
  ShiftRight: BTN.SPRINT,
};

// Hotbar keys in unlock order: 1-9, 0, -, = (physical positions, so AZERTY works too).
const BAR = { Minus: 10, Equal: 11, Digit0: 9, Numpad0: 9 };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseBtn = 0;
    this.mx = 400;
    this.my = 225;
    // { bar: numbered hotbar slot }, { builder: true }, { abs: weapon }, { last: true } or { rel: +1/-1 }
    this.weaponReq = null;
    this.handlers = {};
    this.enabled = true;

    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    };

    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (e.code === 'Escape') {
        this.emit('pause');
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyM' && !e.repeat) this.emit('mute');
      if (e.code === 'KeyH' && !e.repeat) this.emit('help');
      if (e.code === 'Tab') e.preventDefault();
      const d = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (d) this.weaponReq = { bar: Number(d[2]) - 1 };
      else if (BAR[e.code] !== undefined) this.weaponReq = { bar: BAR[e.code] };
      if (e.code === 'KeyQ' && !e.repeat) this.weaponReq = { last: true };
      if (e.code === 'KeyB' && !e.repeat) this.weaponReq = { builder: true };
      if (MAP[e.code] !== undefined) {
        this.keys.add(e.code);
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseBtn = 0;
    });

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.emit('gesture');
      if (e.button === 0) this.mouseBtn |= BTN.FIRE;
      if (e.button === 2) this.mouseBtn |= BTN.ALT;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseBtn &= ~BTN.FIRE;
      if (e.button === 2) this.mouseBtn &= ~BTN.ALT;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => this.track(e.clientX, e.clientY));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (Math.abs(e.deltaY) < 4) return;
        this.weaponReq = { rel: e.deltaY > 0 ? 1 : -1 };
      },
      { passive: false },
    );
    window.addEventListener('keydown', () => this.emit('gesture'), { once: false });
  }

  track(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    this.mx = ((cx - r.left) / r.width) * this.canvas.width;
    this.my = ((cy - r.top) / r.height) * this.canvas.height;
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name) {
    const fn = this.handlers[name];
    if (fn) fn();
  }

  buttons() {
    if (!this.enabled) return 0;
    let b = this.mouseBtn;
    for (const k of this.keys) b |= MAP[k] || 0;
    return b;
  }

  releaseAll() {
    this.keys.clear();
    this.mouseBtn = 0;
  }

  // Aim target in world pixels (the backbuffer is half the world resolution).
  aimWorld() {
    return { x: this.mx * 2, y: this.my * 2 };
  }

  takeWeaponRequest() {
    const r = this.weaponReq;
    this.weaponReq = null;
    return r;
  }
}
