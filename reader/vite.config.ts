import { defineConfig } from 'vite';

// Vaelkeep owns :8787 and a Vite server already sits on :5173, so the paper
// takes :5174 for the dev server and :8791 for the API.
const API = 'http://127.0.0.1:8791';

export default defineConfig({
  // Relative asset URLs. GitHub Pages serves a project repo under a subpath
  // (/vael-paper/), and the same build must also work at the root of the
  // FastAPI server, so nothing in the bundle may assume where it is mounted.
  base: './',
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
