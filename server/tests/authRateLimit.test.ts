import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { authRateLimit, createAuthRateLimit } from "../src/middleware/authRateLimit.js";

// Security review (Oct 6): proves the limiter actually enforces its
// threshold, not just that it's wired into a route. env.NODE_ENV is
// fixed for the life of this process (loaded once at startup), so
// there's no way to exercise the real "it blocks" path through the
// default export, which skips in test - createAuthRateLimit({ skip:
// false }) mounts a genuine copy of the same config with that skip
// forced off instead.
describe("authRateLimit", () => {
  it("allows requests up to the limit, then 429s the next one", async () => {
    const app = express();
    app.get("/test", createAuthRateLimit({ skip: false }), (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 20; i++) {
      const response = await request(app).get("/test");
      expect(response.status).toBe(200);
    }

    const blocked = await request(app).get("/test");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("is skipped by default in the test environment (so the rest of this suite isn't flaky)", async () => {
    const app = express();
    app.get("/test", authRateLimit, (_req, res) => res.json({ ok: true }));

    // More than the configured limit (20) - none of these should be
    // blocked, which is the whole point of skipping in test.
    for (let i = 0; i < 25; i++) {
      const response = await request(app).get("/test");
      expect(response.status).toBe(200);
    }
  });
});
