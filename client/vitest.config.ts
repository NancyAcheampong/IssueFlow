import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose - see the comment there.
// Deliberately NOT included in any tsconfig project reference (so
// `tsc -b`/`npm run build` never touches it): `vitest/config`
// re-exports its own bundled `vite`, whose Plugin type collides with
// the top-level `vite` package's identical-looking-but-different
// type the moment both show up in one TS program (the Vitest/Vite
// ecosystem's own known type-duplication issue, not a mistake in this
// config). Vite/Vitest both transpile config files with esbuild at
// runtime regardless of what `tsc` would say about them, so this file
// still works correctly - it's just outside the build's own
// type-check pass.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    globals: false,
  },
});
