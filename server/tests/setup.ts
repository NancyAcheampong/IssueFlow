import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Optional: if server/.env.test exists (gitignored, same idea as .env),
// load it first - e.g. to point tests at a hosted database like Neon
// instead of a local Postgres install. Silently does nothing if the file
// isn't there, so local-only setups are unaffected.
config({ path: resolve(__dirname, "../.env.test") });

// Runs before every test file. Provides safe fake config so src/config/env.ts
// (which validates and exits the process if anything required is missing)
// never blocks the test suite from starting, and so no test accidentally
// touches a real database or secret. Anything already set by .env.test above
// is left alone (??=) - these are just the fallback for local Postgres.
process.env.NODE_ENV ??= "test";
process.env.PORT ??= "4000";
process.env.DATABASE_URL ??= "postgresql://issueflow:issueflow@localhost:5432/issueflow_test?schema=public";
process.env.JWT_SECRET ??= "test-only-secret-do-not-use-in-prod";
process.env.ALLOWED_ORIGIN ??= "http://localhost:5173";
process.env.LOG_LEVEL ??= "silent";
