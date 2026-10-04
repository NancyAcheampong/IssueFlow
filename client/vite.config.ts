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
});
