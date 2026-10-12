import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
//
// Test config lives in vitest.config.ts, not here: `defineConfig`
// from "vitest/config" re-exports its own bundled `vite`, and mixing
// that with the top-level `vite` package (different copies of the
// same types) produces an unresolvable Plugin-type conflict under
// `tsc -b`. Two small config files avoids it entirely.
export default defineConfig({
  plugins: [react()],
  // strictPort: the server's CORS allowlist (ALLOWED_ORIGIN) is pinned
  // to http://localhost:5173 - if that port's taken, Vite's default
  // behavior is to silently move to 5174+, which then makes every API
  // call fail with an unhelpful CORS error instead of a clear "port in
  // use" one. Failing loudly here is strictly better: it's immediately
  // obvious what to fix (free port 5173, or stop another process using
  // it) instead of a confusing silent breakage two layers away.
  server: {
    port: 5173,
    strictPort: true,
  },
});
