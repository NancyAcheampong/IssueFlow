import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "../src/middleware/requireAuth.js";
import { signAccessToken } from "../src/lib/jwt.js";
import { env } from "../src/config/env.js";

// Unit tests: requireAuth is a plain function, tested directly with fake
// req/res/next objects - same "unit" layer as errorHandler.test.ts. No
// server, no database; just proving the auth-decision logic itself.
function createMockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe("requireAuth", () => {
  it("rejects a request with no Authorization header at all", () => {
    const req = createMockReq();
    const next = vi.fn();

    requireAuth(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
  });

  it("rejects a header that isn't a Bearer token", () => {
    const req = createMockReq({ authorization: "Basic dXNlcjpwYXNz" });
    const next = vi.fn();

    requireAuth(req, {} as Response, next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects a malformed/garbage token", () => {
    const req = createMockReq({ authorization: "Bearer not-a-real-token" });
    const next = vi.fn();

    requireAuth(req, {} as Response, next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects an expired token", () => {
    // Negative expiresIn produces a token whose exp is already in the
    // past the moment it's signed - no need to actually wait for one to
    // expire in real time.
    const expiredToken = jwt.sign({ sub: "some-user-id" }, env.JWT_SECRET, { expiresIn: -10 });
    const req = createMockReq({ authorization: `Bearer ${expiredToken}` });
    const next = vi.fn();

    requireAuth(req, {} as Response, next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects a token signed with a different secret", () => {
    const forgedToken = jwt.sign({ sub: "some-user-id" }, "a-completely-different-secret", { expiresIn: "1d" });
    const req = createMockReq({ authorization: `Bearer ${forgedToken}` });
    const next = vi.fn();

    requireAuth(req, {} as Response, next);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it("accepts a valid token, calls next() with no error, and attaches userId", () => {
    const token = signAccessToken({ sub: "user-123" });
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const next = vi.fn();

    requireAuth(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(); // called with zero arguments = no error
    expect(req.userId).toBe("user-123");
  });
});
