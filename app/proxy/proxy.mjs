// Tiny stateless pass-through proxy for providers that refuse browser (CORS) calls.
// - Forwards only to an allow-list of upstreams (OpenCode /inference/* and /zen/*, plus the direct
//   providers for the optional "Send via local proxy" switch).
// - Passes the viewer's own auth header through untouched. Stores nothing.
// - Logs at most "METHOD /route/path -> status". Never headers, bodies or query strings.
// No dependencies: Node 18+ (global fetch).

export const ROUTES = {
  opencode: { origin: "https://opencode.ai", allow: [/^\/inference\//, /^\/zen\//] },
  openai: { origin: "https://api.openai.com", allow: [/^\/v1\//] },
  anthropic: { origin: "https://api.anthropic.com", allow: [/^\/v1\//] },
  xai: { origin: "https://api.x.ai", allow: [/^\/v1\//] },
};

const FORWARD_REQUEST_HEADERS = ["authorization", "x-api-key", "content-type", "accept", "anthropic-version", "x-opencode-session"];
const FORWARD_RESPONSE_HEADERS = ["content-type"];
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_BODY = 1_000_000;
export const USER_AGENT = "llm-boxing-arena/0.1";

/**
 * Returns a Node/Connect style (req, res) handler. Works mounted at /proxy (Vite middleware strips the
 * prefix) or standalone (prefix still on the URL).
 */
export function createProxyHandler({ fetchImpl = globalThis.fetch, log = (line) => console.log(line) } = {}) {
  return async function proxy(req, res) {
    const origin = req.headers.origin;
    const corsHeaders = {};
    if (typeof origin === "string" && ALLOWED_ORIGIN.test(origin)) {
      corsHeaders["access-control-allow-origin"] = origin;
      corsHeaders["vary"] = "Origin";
      corsHeaders["access-control-allow-headers"] = FORWARD_REQUEST_HEADERS.concat("x-opencode-client").join(", ");
      corsHeaders["access-control-allow-methods"] = "GET, POST, OPTIONS";
      corsHeaders["access-control-max-age"] = "600";
    }
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { ...corsHeaders, ...headers });
      res.end(body);
    };

    const rawUrl = (req.url || "/").replace(/^\/proxy(?=\/)/, "");
    const pathOnly = rawUrl.split("?")[0];
    const match = pathOnly.match(/^\/([a-z]+)(\/.*)$/);
    const route = match && ROUTES[match[1]];
    const logLine = (status) => log(`${req.method} /${match ? match[1] : "?"}${match ? match[2] : pathOnly} -> ${status}`);

    if (req.method === "OPTIONS") {
      logLine(204);
      return send(204, "");
    }
    if (!route || !route.allow.some((re) => re.test(match[2])) || match[2].includes("..")) {
      logLine(403);
      return send(403, JSON.stringify({ error: { message: "proxy: route not allowed" } }), { "content-type": "application/json" });
    }
    if (req.method !== "GET" && req.method !== "POST") {
      logLine(405);
      return send(405, JSON.stringify({ error: { message: "proxy: method not allowed" } }), { "content-type": "application/json" });
    }

    let body;
    if (req.method === "POST") {
      try {
        body = await readBody(req);
      } catch {
        logLine(413);
        return send(413, JSON.stringify({ error: { message: "proxy: body too large" } }), { "content-type": "application/json" });
      }
    }

    const headers = { "user-agent": USER_AGENT };
    for (const h of FORWARD_REQUEST_HEADERS) {
      const v = req.headers[h];
      if (typeof v === "string") headers[h] = v;
    }
    const query = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
    try {
      const upstream = await fetchImpl(route.origin + match[2] + query, { method: req.method, headers, body });
      const out = {};
      for (const h of FORWARD_RESPONSE_HEADERS) {
        const v = upstream.headers.get(h);
        if (v) out[h] = v;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      logLine(upstream.status);
      return send(upstream.status, buf, out);
    } catch {
      logLine(502);
      return send(502, JSON.stringify({ error: { message: "proxy: upstream unreachable" } }), { "content-type": "application/json" });
    }
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
