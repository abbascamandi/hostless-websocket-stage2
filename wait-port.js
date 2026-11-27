'use strict';

const net = require('node:net');

const host = process.argv[2] || '127.0.0.1';
const port = Number.parseInt(process.argv[3] || '10000', 10);
const timeoutMs = Number.parseInt(process.argv[4] || '30000', 10);
const deadline = Date.now() + timeoutMs;

function probe() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

(async () => {
  while (Date.now() < deadline) {
    if (await probe()) {
      console.log(`[startup] Xray is listening on ${host}:${port}.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.error(`[startup] Timed out waiting for Xray on ${host}:${port}.`);
  process.exit(1);
})().catch((err) => {
  console.error('[startup] Port wait failed:', err.message);
  process.exit(1);
});
