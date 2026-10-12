import { z } from "zod";

// We validate process.env once, at startup, instead of trusting raw
// strings everywhere. If something required is missing or malformed,
// the process should refuse to start rather than fail weirdly later
// (this is NFR-08 in the spec: "the service starts only after required
// configuration is present").
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("1d"),
  // Oct 12: IssueFlow provisions accounts admin-first, not via public
  // signup - these seed the one ADMIN account at startup (see
  // lib/seedAdmin.ts). Required, same NFR-08 "refuse to start rather
  // than fail weirdly later" reasoning as every other required value
  // here - there'd be no way to create a second account otherwise.
  ADMIN_EMAIL: z.string().trim().toLowerCase().email("ADMIN_EMAIL must be a valid email address"),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters"),
  ALLOWED_ORIGIN: z.string().min(1, "ALLOWED_ORIGIN is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

// ALLOWED_ORIGIN can be a comma-separated list for multiple deployed
// frontends (e.g. staging + production).
export const allowedOrigins = env.ALLOWED_ORIGIN.split(",").map((origin) => origin.trim());
