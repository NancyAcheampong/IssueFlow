import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { allowedOrigins } from "../src/config/env.js";

// Oct 9 ("finalize ... CORS lockdown"): CORS is enforced by the
// browser, not the server - a disallowed origin still gets an HTTP
// response (the `cors` middleware never 403s), it's just missing the
// `Access-Control-Allow-Origin` header, which is what makes the
// browser refuse to hand the response to that page's JavaScript. This
// test checks the header the server actually produces, the one real
// lever it has - not whether some other origin's browser would
// enforce it (it would, by spec, as long as this header is right).
describe("CORS", () => {
  const app = createApp();
  // Not hardcoded - reads the exact origin(s) this environment is
  // actually configured with (ALLOWED_ORIGIN), so the test keeps
  // asserting something true even if that value ever changes.
  const configuredOrigin = allowedOrigins[0] as string;

  it("echoes Access-Control-Allow-Origin for the configured origin", async () => {
    const response = await request(app)
      .options("/api/v1/me")
      .set("Origin", configuredOrigin)
      .set("Access-Control-Request-Method", "GET");

    expect(response.headers["access-control-allow-origin"]).toBe(configuredOrigin);
  });

  it("omits Access-Control-Allow-Origin for an arbitrary, non-configured origin", async () => {
    const response = await request(app)
      .options("/api/v1/me")
      .set("Origin", "http://evil.example")
      .set("Access-Control-Request-Method", "GET");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends Access-Control-Allow-Credentials, required for the Authorization-header auth model to work cross-origin", async () => {
    const response = await request(app)
      .options("/api/v1/me")
      .set("Origin", configuredOrigin)
      .set("Access-Control-Request-Method", "GET");

    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
