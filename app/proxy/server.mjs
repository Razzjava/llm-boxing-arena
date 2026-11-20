#!/usr/bin/env node
// Standalone proxy: `npm run proxy` -> http://localhost:8787/proxy/...
// You only need this if you serve the built app somewhere other than `npm run dev` / `npm run preview`
// (both of those mount the same proxy at /proxy already). Binds to localhost only.
import http from "node:http";
import { createProxyHandler } from "./proxy.mjs";

const port = Number(process.env.PORT || 8787);
const handler = createProxyHandler();
http
  .createServer((req, res) => {
    if (!req.url || !req.url.startsWith("/proxy/")) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("LLM Boxing Arena proxy: use /proxy/<opencode|openai|anthropic|xai>/...\n");
    }
    handler(req, res);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`LLM Boxing Arena proxy on http://localhost:${port}/proxy (stateless; logs method, path and status only)`);
  });
