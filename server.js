// Custom Next.js server that adds a WebSocket proxy at /api/deepgram-ws.
//
// Why this exists: in some environments (corporate firewall, ISP-level DPI,
// macOS firewall, browser extension) the browser cannot complete a TLS
// WebSocket handshake to wss://api.deepgram.com — we see code 1006 with
// no reason and wasClean=false, definitively a network-layer block, not
// an application rejection. The same machine has no problem with
// HTTPS REST calls to api.deepgram.com from this Node process.
//
// This server keeps the browser on the loopback (always allowed) and
// proxies the WebSocket to Deepgram from Node. The Deepgram-side socket
// uses the documented `Authorization: Token <key>` header — the same auth
// path that already works for our REST calls.
//
// Shared state with the Next route handler at /api/deepgram lives on
// `globalThis.__deepgramSessionTokens` so the route can issue a token and
// this server can validate it on upgrade. They run in the same Node
// process when launched via `node server.js`.

const { createServer } = require("node:http");
const { parse } = require("node:url");
const next = require("next");
const { WebSocket, WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const app = next({ dev, webpack: true });
const handle = app.getRequestHandler();

// Initialize the shared sessions map. Other modules (the route handler) read
// and write through globalThis so they don't need to import this file.
if (!globalThis.__deepgramSessionTokens) {
  globalThis.__deepgramSessionTokens = new Map();
}
const sessionTokens = globalThis.__deepgramSessionTokens;

// Tell the /api/deepgram route handler (same process) that the loopback proxy
// is live, so it issues proxy tokens instead of direct-Deepgram temp keys. On
// Vercel this file never runs, so the flag stays unset and the route mints temp
// keys — the correct behavior there.
globalThis.__deepgramProxyReady = true;

// One WebSocketServer instance handles all upgrades. `noServer: true` means
// we drive the upgrade manually inside the upgrade event.
const proxyWss = new WebSocketServer({ noServer: true });

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  server.on("upgrade", (req, socket, head) => {
    const url = parse(req.url, true);

    // Only intercept our proxy path. Next.js HMR runs on its own port in dev
    // (not via this HTTP server), so we don't need to forward anything else.
    if (url.pathname !== "/api/deepgram-ws") {
      return;
    }

    const token = typeof url.query.token === "string" ? url.query.token : null;
    const session = token ? sessionTokens.get(token) : null;
    if (!session || session.expiresAt < Date.now()) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"
      );
      socket.destroy();
      return;
    }
    sessionTokens.delete(token); // single-use

    proxyWss.handleUpgrade(req, socket, head, (browserWs) => {
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        browserWs.close(1011, "DEEPGRAM_API_KEY not configured");
        return;
      }

      console.log("[deepgram-proxy] browser connected, opening Deepgram WS:", session.deepgramUrl);
      const dgWs = new WebSocket(session.deepgramUrl, {
        headers: { Authorization: `Token ${apiKey}` },
      });
      let bytesUp = 0;
      let messagesDown = 0;
      // Track the Deepgram leg's real disposition so we can forward a close code
      // the browser CLIENT already classifies (see use-deepgram.ts onclose),
      // instead of masking every failure as a generic 1011 that triggers 6
      // futile reconnect attempts. dgRejectStatus is set on an upgrade rejection.
      let dgEverOpened = false;
      let dgRejectStatus = 0;

      // Buffer browser → Deepgram messages until Deepgram is open. Live
      // recording starts firing audio chunks within ~250ms; the upstream
      // handshake usually finishes in <300ms, but a brief queue keeps us
      // from dropping the first chunk.
      const queue = [];
      let dgOpen = false;

      // Browser → Deepgram: audio is binary (WebM/Opus chunks). The `ws`
      // library gives us isBinary=true; we forward as binary too. Control
      // messages like KeepAlive are JSON text from the browser side and
      // need to forward as text — preserve isBinary in both directions.
      browserWs.on("message", (data, isBinary) => {
        bytesUp += data.length || 0;
        const payload = isBinary ? data : data.toString();
        if (dgOpen && dgWs.readyState === WebSocket.OPEN) {
          dgWs.send(payload, { binary: isBinary });
        } else {
          queue.push({ payload, isBinary });
        }
      });

      dgWs.on("open", () => {
        dgOpen = true;
        dgEverOpened = true;
        console.log(
          "[deepgram-proxy] deepgram ws OPEN — flushing",
          queue.length,
          "queued chunks"
        );
        for (const { payload, isBinary } of queue) {
          if (dgWs.readyState === WebSocket.OPEN)
            dgWs.send(payload, { binary: isBinary });
        }
        queue.length = 0;
      });

      // Deepgram → browser: Deepgram only emits text JSON frames (Results,
      // Metadata, UtteranceEnd, etc.). Convert the Buffer to string before
      // sending so the browser receives it as a text WebSocket frame —
      // otherwise the client's `typeof event.data !== "string"` guard
      // silently drops every transcript.
      dgWs.on("message", (data, isBinary) => {
        messagesDown += 1;
        const text = data.toString();
        if (messagesDown <= 3) {
          console.log(
            "[deepgram-proxy] msg from Deepgram #" + messagesDown + ":",
            text.slice(0, 200)
          );
        }
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(text, { binary: false });
        }
        // If Deepgram ever sends binary (it doesn't today, but defensive):
        void isBinary;
      });

      // Tear down both ends when either side closes or errors.
      let closed = false;
      const closeBoth = (code, reason) => {
        if (closed) return;
        closed = true;
        try {
          if (browserWs.readyState <= 1)
            browserWs.close(code || 1000, reason || "");
        } catch {}
        try {
          if (dgWs.readyState <= 1) dgWs.close(code || 1000, reason || "");
        } catch {}
      };
      browserWs.on("close", (code, reason) => {
        console.log(
          "[deepgram-proxy] browser closed, code=" + code + " bytesUp=" + bytesUp + " msgsDown=" + messagesDown
        );
        closeBoth(code, reason?.toString());
      });
      // Deepgram rejects the WS upgrade (bad key, unsupported param combo, bad
      // model/language) with an HTTP status BEFORE the socket ever opens. Map it
      // to a client-classified close code so the browser stops after one attempt
      // with a real message instead of thrashing 6 reconnects on a 1011:
      //   401/403 -> 1008 (auth failure)   400 -> 1002 (bad request/param)
      dgWs.on("unexpected-response", (_req, res) => {
        dgRejectStatus = (res && res.statusCode) || 0;
        console.error(
          "[deepgram-proxy] deepgram rejected upgrade, status=" + dgRejectStatus
        );
        let code = 1011;
        if (dgRejectStatus === 401 || dgRejectStatus === 403) code = 1008;
        else if (dgRejectStatus === 400) code = 1002;
        closeBoth(code, "deepgram " + dgRejectStatus);
      });
      dgWs.on("close", (code, reason) => {
        console.log(
          "[deepgram-proxy] deepgram closed, code=" + code + " reason=" + (reason?.toString() || "(empty)")
        );
        // Forward Deepgram's real close code when it had opened; otherwise
        // unexpected-response already sent the classified code (closeBoth is
        // idempotent, so this is a no-op in that case).
        closeBoth(code, reason?.toString());
      });
      browserWs.on("error", (e) => {
        console.error("[deepgram-proxy] browser ws error:", e?.message);
        closeBoth(1011, "browser error");
      });
      dgWs.on("error", (e) => {
        // Do NOT closeBoth(1011) here — that would pre-empt the real
        // disposition. On a handshake rejection, 'unexpected-response' already
        // sent the right code; on an open socket, the following 'close' carries
        // Deepgram's real code. Only close here for a pure network failure that
        // produced neither (e.g. ECONNREFUSED/DNS before any response).
        console.error("[deepgram-proxy] deepgram ws error:", e?.message);
        if (!dgEverOpened && dgRejectStatus === 0) {
          closeBoth(1011, "deepgram error");
        }
      });
    });
  });

  server.listen(port, () => {
    console.log(
      `> Ready on http://localhost:${port} (with /api/deepgram-ws proxy)`
    );
  });
});
