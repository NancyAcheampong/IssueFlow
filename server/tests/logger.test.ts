import { describe, expect, it } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { LOG_REDACT_CONFIG } from "../src/lib/logger.js";

// Oct 9 ("finalize logging"): found live that every authenticated
// request was writing its full bearer JWT to stdout in plain text -
// pino-http's standard req serializer logs all headers, including
// Authorization, and nothing was telling pino to treat that one
// specially. This tests the actual exported LOG_REDACT_CONFIG (the
// same object the real `logger` is constructed with), not a
// hand-copied duplicate that could quietly drift from what's running.
function captureStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, chunks };
}

describe("logger redaction", () => {
  it("redacts the Authorization header's value, not just the field name", () => {
    const { stream, chunks } = captureStream();
    const testLogger = pino({ redact: LOG_REDACT_CONFIG }, stream);

    testLogger.info(
      { req: { headers: { authorization: "Bearer super-secret-token-value" } } },
      "request completed",
    );

    const logged = chunks.join("");
    expect(logged).not.toContain("super-secret-token-value");
    expect(logged).toContain("[REDACTED]");
  });

  it("redacts a cookie header the same way", () => {
    const { stream, chunks } = captureStream();
    const testLogger = pino({ redact: LOG_REDACT_CONFIG }, stream);

    testLogger.info({ req: { headers: { cookie: "session=secret-session-value" } } }, "request completed");

    const logged = chunks.join("");
    expect(logged).not.toContain("secret-session-value");
    expect(logged).toContain("[REDACTED]");
  });

  it("leaves other request headers untouched", () => {
    const { stream, chunks } = captureStream();
    const testLogger = pino({ redact: LOG_REDACT_CONFIG }, stream);

    testLogger.info({ req: { headers: { "user-agent": "curl/8.5.0" } } }, "request completed");

    expect(chunks.join("")).toContain("curl/8.5.0");
  });
});
