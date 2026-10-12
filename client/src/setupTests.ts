import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts sets globals: false (so test APIs have to be
// imported explicitly, not injected as globals) - but
// @testing-library/react's own automatic-cleanup-between-tests relies
// on detecting a *global* afterEach to hook into, which never fires
// under that setting. Without this, every render() across every test
// in a file stacks into the same jsdom document instead of being
// unmounted, and anything querying via `screen` (which searches the
// whole document, not just what the current test rendered) starts
// matching leftover elements from earlier tests - found live via
// SignupPage.test.tsx's very first run (Oct 8).
afterEach(() => {
  cleanup();
});

