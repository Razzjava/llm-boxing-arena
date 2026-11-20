/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createProxyHandler } from "./proxy/proxy.mjs";

// The same stateless proxy as `npm run proxy`, mounted at /proxy for `npm run dev` and `npm run preview`.
function arenaProxy(): Plugin {
  const handler = createProxyHandler({ log: (line) => console.log(`[proxy] ${line}`) });
  return {
    name: "arena-proxy",
    configureServer(server) {
      server.middlewares.use("/proxy", (req, res) => void handler(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/proxy", (req, res) => void handler(req, res));
    },
  };
}

export default defineConfig({
  plugins: [react(), arenaProxy()],
  server: { host: "localhost", port: 5173 },
  preview: { host: "localhost", port: 4173 },
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
