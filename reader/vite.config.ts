import { defineConfig } from 'vite';

// Vaelkeep owns :8787 and a Vite server already sits on :5173, so the paper
// takes :5174 for the dev server and :8791 for the API.
const API = 'http://127.0.0.1:8791';

export default defineConfig({
  server: {
    port: 5174,
    host: true, // reachable from the iPad over Tailscale
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/editions': { target: API, changeOrigin: true },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
