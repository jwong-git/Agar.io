import { defineConfig } from "vite";
import { CONFIG } from "./shared/config";

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    // forward the WebSocket path to the game server so dev uses the same
    // single-origin connection (`ws://localhost:5173/ws`) as production.
    proxy: {
      "/ws": { target: `ws://localhost:${CONFIG.port}`, ws: true },
    },
  },
});
