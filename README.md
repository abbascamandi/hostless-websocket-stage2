# Hostless WebSocket ingress test — Stage 2

This is a temporary, authenticated WebSocket echo app. It does not proxy traffic and does not expose Aether or Xray. Its only purpose is to test whether a public Hostless App endpoint forwards WebSocket upgrades to the container.

## Deploy

1. Create a separate GitHub repository, for example `hostless-websocket-stage2`, and upload `Dockerfile`, `package.json`, `server.js`, and `README.md` to its root.
2. In Hostless, create an **App** (not a Worker), connect this repository, and choose Dockerfile build.
3. Set the start command to `npm start` or leave it to the Dockerfile's default `CMD`.
4. Add an environment variable named `WS_TEST_TOKEN`. Set its value to a random string of at least 16 characters. A GUID is sufficient for this temporary test.
5. Configure the app's health-check path as `/healthz` if Hostless asks for one. The app listens on `0.0.0.0:$PORT`.
6. Deploy and note the public HTTPS hostname Hostless assigns to the App.

## Test normal HTTP

Open `https://YOUR-APP-HOST/healthz`. Expected response:

```json
{"ok":true,"service":"websocket-ingress-test"}
```

## Test WebSocket in a browser

Open the app's HTTPS origin in Chrome, press F12, choose Console, and run this after replacing the two placeholders:

```javascript
const token = "YOUR_WS_TEST_TOKEN";
const ws = new WebSocket(`wss://YOUR-APP-HOST/ws?token=${encodeURIComponent(token)}`);
ws.onopen = () => { console.log("OPEN"); ws.send("hello-hostless"); };
ws.onmessage = (event) => console.log("MESSAGE:", event.data);
ws.onerror = (event) => console.log("WEBSOCKET ERROR:", event);
ws.onclose = (event) => console.log("CLOSED:", event.code, event.reason);
```

Expected console output includes:

```text
OPEN
MESSAGE: connected
MESSAGE: echo:hello-hostless
```

Expected app logs include `WebSocket connected` and `Received message: hello-hostless`.

If the HTTP health check works but WebSocket does not, send the browser console error and app logs. Do not add Xray yet.

## Cleanup

After testing, delete or stop this temporary App. It is not intended as a production service.
