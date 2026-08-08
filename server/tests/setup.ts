// Runs before every test file. Provides safe fake config so src/config/env.ts
// (which validates and exits the process if anything required is missing)
// never blocks the test suite from starting, and so no test accidentally
// touches a real database or secret.
process.env.NODE_ENV ??= "test";
process.env.PORT ??= "4000";
process.env.DATABASE_URL ??= "postgresql://issueflow:issueflow@localhost:5432/issueflow_test?schema=public";
process.env.JWT_SECRET ??= "test-only-secret-do-not-use-in-prod";
process.env.ALLOWED_ORIGIN ??= "http://localhost:5173";
process.env.LOG_LEVEL ??= "silent";
