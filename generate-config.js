'use strict';

const fs = require('node:fs');

const uuid = process.env.VLESS_UUID || '';
const wsPath = process.env.WS_PATH || '';
const xrayPort = Number.parseInt(process.env.XRAY_LOCAL_PORT || '10000', 10);
const output = process.env.XRAY_CONFIG_FILE || '/tmp/xray-config.json';

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
  throw new Error('VLESS_UUID must be a UUID such as 11111111-2222-4333-8444-555555555555.');
}
if (!/^\/[A-Za-z0-9_-]{24,100}$/.test(wsPath)) {
  throw new Error('WS_PATH must start with / and contain 24–100 letters, digits, _ or - characters.');
}
if (!Number.isInteger(xrayPort) || xrayPort < 1 || xrayPort > 65535) {
  throw new Error('XRAY_LOCAL_PORT must be an integer from 1 to 65535.');
}

const config = {
  log: { loglevel: 'warning' },
  inbounds: [
    {
      tag: 'vless-ws-in',
      listen: '127.0.0.1',
      port: xrayPort,
      protocol: 'vless',
      settings: {
        clients: [{ id: uuid, email: 'hostless-aether-client' }],
        decryption: 'none'
      },
      streamSettings: {
        network: 'ws',
        security: 'none',
        wsSettings: {
          path: wsPath,
          heartbeatPeriod: 30
        }
      }
    }
  ],
  outbounds: [
    {
      tag: 'warp-socks',
      protocol: 'socks',
      settings: {
        address: '127.0.0.1',
        port: 1819
      }
    }
  ],
  routing: {
    domainStrategy: 'AsIs',
    rules: [
      {
        type: 'field',
        inboundTag: ['vless-ws-in'],
        outboundTag: 'warp-socks'
      }
    ]
  }
};

fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log('[config] Xray VLESS/WebSocket config generated. Credentials are not printed.');
