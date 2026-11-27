'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');

const port = Number.parseInt(process.env.PORT || '8080', 10);
const testToken = process.env.WS_TEST_TOKEN || '';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}
if (testToken.length < 16) {
  throw new Error('Set WS_TEST_TOKEN to a random string at least 16 characters long.');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'websocket-ingress-test' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Hostless WebSocket test app is running. Connect to /ws with the configured token.\n');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url || '/', 'http://127.0.0.1');
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== '/ws' || url.searchParams.get('token') !== testToken) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    console.warn('[ws-test] Rejected WebSocket upgrade: bad path or token.');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  console.log('[ws-test] WebSocket connected.');
  ws.send('connected');

  ws.on('message', (data, isBinary) => {
    const value = isBinary ? `<${data.length} binary bytes>` : data.toString('utf8');
    console.log(`[ws-test] Received message: ${value.slice(0, 200)}`);
    ws.send(isBinary ? data : `echo:${value}`);
  });

  ws.on('close', () => console.log('[ws-test] WebSocket closed.'));
  ws.on('error', (err) => console.error('[ws-test] WebSocket error:', err.message));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[ws-test] HTTP server listening on 0.0.0.0:${port}`);
  console.log('[ws-test] Health check: GET /healthz');
  console.log('[ws-test] WebSocket endpoint: /ws (token required)');
});

function shutdown(signal) {
  console.log(`[ws-test] Received ${signal}; shutting down.`);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
