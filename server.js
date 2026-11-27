'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');

const port = Number.parseInt(process.env.PORT || '8080', 10);
const xrayPort = Number.parseInt(process.env.XRAY_LOCAL_PORT || '10000', 10);
const wsPath = process.env.WS_PATH || '';
const readyFile = '/tmp/xray-ready';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
if (!Number.isInteger(xrayPort) || xrayPort < 1 || xrayPort > 65535) {
  throw new Error(`Invalid XRAY_LOCAL_PORT: ${process.env.XRAY_LOCAL_PORT}`);
}
if (!/^\/[A-Za-z0-9_-]{24,100}$/.test(wsPath)) {
  throw new Error('WS_PATH must start with / and contain 24–100 letters, digits, _ or - characters.');
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', 'http://127.0.0.1');
  } catch {
    send(res, 400, JSON.stringify({ ok: false, error: 'bad_request' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    // Hostless liveness check: keep this independent of WARP/Xray readiness.
    send(res, 200, JSON.stringify({ ok: true, service: 'aether-xray-gateway' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/readyz') {
    const ready = fs.existsSync(readyFile) && fs.existsSync('/tmp/aether-ready');
    send(res, ready ? 200 : 503, JSON.stringify({ ok: ready, aether: fs.existsSync('/tmp/aether-ready'), xray: fs.existsSync(readyFile) }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Aether + Xray gateway is running.\n');
    return;
  }

  send(res, 404, JSON.stringify({ ok: false, error: 'not_found' }));
});

server.on('upgrade', (req, clientSocket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  } catch {
    clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }

  if (req.method !== 'GET' || pathname !== wsPath) {
    clientSocket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  if (!fs.existsSync(readyFile)) {
    clientSocket.end('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 10\r\nConnection: close\r\n\r\n');
    return;
  }

  const upstream = net.connect({ host: '127.0.0.1', port: xrayPort });
  let connected = false;
  const connectTimer = setTimeout(() => {
    if (!connected) {
      upstream.destroy();
      if (!clientSocket.destroyed) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      }
    }
  }, 5000);

  upstream.once('connect', () => {
    connected = true;
    clearTimeout(connectTimer);

    // Forward the original HTTP Upgrade request to Xray without terminating
    // or interpreting the VLESS/WebSocket byte stream in this gateway.
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head && head.length > 0) upstream.write(head);

    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });

  upstream.on('error', (err) => {
    clearTimeout(connectTimer);
    console.error('[gateway] Xray upstream error:', err.message);
    if (!clientSocket.destroyed) {
      if (!connected) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      else clientSocket.destroy();
    }
  });

  clientSocket.on('error', (err) => {
    console.warn('[gateway] Client socket error:', err.message);
    upstream.destroy();
  });
  clientSocket.on('close', () => {
    clearTimeout(connectTimer);
    upstream.destroy();
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[gateway] HTTP server listening on 0.0.0.0:${port}`);
  console.log('[gateway] Health endpoint: /healthz');
  console.log('[gateway] Readiness endpoint: /readyz');
  console.log('[gateway] WebSocket route is configured (path not printed).');
});

function shutdown(signal) {
  console.log(`[gateway] Received ${signal}; shutting down HTTP gateway.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
