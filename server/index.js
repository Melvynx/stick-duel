import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const SHARED = join(ROOT, 'shared');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolveStatic(urlPath) {
  let base = PUBLIC;
  let rel = urlPath;
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.startsWith('/shared/')) {
    base = SHARED;
    rel = rel.slice('/shared'.length);
  }
  const file = normalize(join(base, decodeURIComponent(rel)));
  if (!file.startsWith(base + sep)) return null;
  return file;
}

export function startServer({ port = Number(process.env.PORT) || 3030, host = process.env.HOST || '0.0.0.0' } = {}) {
  const lobby = new Lobby();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...lobby.stats() }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let file;
    try {
      file = resolveStatic(url.pathname);
    } catch {
      file = null;
    }
    let st = null;
    try {
      st = file && statSync(file);
    } catch {
      st = null;
    }
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });
  wss.on('connection', (ws) => {
    ws._socket?.setNoDelay?.(true);
    lobby.connect(ws);
  });

  lobby.start();

  return new Promise((resolveStart) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolveStart({
        port: addr.port,
        server,
        lobby,
        close: () =>
          new Promise((done) => {
            lobby.stop();
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            server.close(() => done());
          }),
      });
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then(({ port }) => {
    console.log(`stick-duel listening on http://localhost:${port}`);
  });
}
