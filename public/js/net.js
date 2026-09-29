// Thin WebSocket wrapper with automatic reconnect. Messages are JSON objects tagged by `t`.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.open = false;
    this.retry = 0;
    this.connect();
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect() {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.retry = 0;
      this.fire('open');
    };
    ws.onclose = () => {
      const was = this.open;
      this.open = false;
      if (this.ws !== ws) return;
      this.fire('close', was);
      const wait = Math.min(4000, 400 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'pi') {
        this.send({ t: 'po', n: msg.n });
        return;
      }
      this.fire(msg.t, msg);
    };
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }

  fire(type, msg) {
    const fn = this.handlers.get(type);
    if (fn) fn(msg);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
