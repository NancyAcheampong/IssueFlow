import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../src/lib/AppError.js";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler.js";

// errorHandler/notFoundHandler are plain functions, so we test them
// directly with fake req/res objects rather than booting a real server -
// this is the "unit" layer of the testing pyramid: fast, no network,
// no database, just proving the logic does what it says.
function createMockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("notFoundHandler", () => {
  it("returns a 404 envelope naming the missing route", () => {
    const req = { method: "GET", originalUrl: "/api/v1/nope" } as Request;
    const res = createMockRes();

    notFoundHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "NOT_FOUND", message: "No route for GET /api/v1/nope" },
    });
  });
});

describe("errorHandler", () => {
  const req = { originalUrl: "/api/v1/whatever", method: "GET" } as Request;

  it("formats an AppError using its own status, code, and message", () => {
    const res = createMockRes();

    errorHandler(AppError.forbidden(), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "FORBIDDEN",
        message: "You do not have access to this resource",
        fields: undefined,
      },
    });
  });

  it("carries field-level details through for validation-style AppErrors", () => {
    const res = createMockRes();
    const err = AppError.badRequest("Invalid input", { email: "must be a valid email" });

    errorHandler(err, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "BAD_REQUEST", message: "Invalid input", fields: { email: "must be a valid email" } },
    });
  });

  it("formats a ZodError as a 400 validation error with per-field messages", () => {
    const res = createMockRes();
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: "not-an-email" });
    if (result.success) throw new Error("expected this parse to fail");

    errorHandler(result.error, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as unknown as { mock: { calls: [{ error: { code: string; fields: Record<string, string> } }][] } })
      .mock.calls[0][0];
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.fields.email).toBeDefined();
  });

  it("falls back to a generic 500 for anything unexpected, without exposing internals", () => {
    const res = createMockRes();

    errorHandler(new Error("some internal failure detail"), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = (res.json as unknown as { mock: { calls: [{ error: { code: string } }][] } }).mock.calls[0][0];
    expect(payload.error.code).toBe("INTERNAL_ERROR");
  });
});
