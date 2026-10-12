import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

// Security review (Oct 6): signup/login had no rate limiting at all -
// an attacker (or just a buggy client in a retry loop) could throw an
// unlimited number of password guesses at /auth/login with nothing to
// slow them down. 20 requests per 15 minutes per IP is generous enough
// for a real person who mistypes their password a few times, tight
// enough to meaningfully blunt a brute-force/credential-stuffing
// attempt.
//
// A factory, not just a pre-built middleware, so tests/authRateLimit.test.ts
// can mount a *real* copy with the test-environment skip forced off and
// actually prove the threshold is enforced (fire N+1 requests, assert
// the last one 429s) - env.NODE_ENV is read once at process startup and
// never changes within a test run, so there'd be no other way to
// exercise the "blocks after the limit" path at all.
export function createAuthRateLimit(options?: { skip?: boolean }) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    // `skip` in test (the default path, `options` omitted): this suite
    // creates and logs in dozens of accounts across a single `npm test`
    // run, often from what looks like the same IP to Supertest's
    // in-process requests - a limiter tuned for real traffic would trip
    // constantly and make the suite flaky for reasons that have nothing
    // to do with the code being tested. Disabling it in test is the
    // standard pattern for exactly this reason, not a gap in coverage:
    // this is a trusted library's own logic (window, threshold)
    // reachable through one app.use() call, not business logic this
    // project owns and needs to re-verify itself live every run - that
    // live verification happens once, directly, in
    // tests/authRateLimit.test.ts, with the skip forced off.
    skip: () => options?.skip ?? env.NODE_ENV === "test",
    // Builds the same `{ error: { code, message } }` envelope as
    // errorHandler.ts, even though this response never actually
    // reaches it - express-rate-limit short-circuits the request
    // itself, so this is the one place in the codebase allowed to
    // write that shape by hand instead of throwing an AppError.
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." },
      });
    },
  });
}

export const authRateLimit = createAuthRateLimit();
