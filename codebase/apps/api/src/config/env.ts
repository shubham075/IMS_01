import { z } from "zod";

const csv = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().default("0.0.0.0"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    TRUST_PROXY: z.stringbool().default(false),

    DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).default(8000),

    CORS_ORIGINS: csv,

    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    OTP_PROVIDER: z.enum(["mock"]).default("mock"),
    OTP_HMAC_SECRET: z.string().min(32, "OTP_HMAC_SECRET must be at least 32 characters"),
    OTP_MOCK_FIXED_CODE: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    ),
    OTP_MOCK_FAIL_CHANNELS: csv,

    RATE_LIMIT_ENABLED: z.stringbool().default(true),

    MIN_VERSION_WEB: z.string().default("0.0.0"),
    MIN_VERSION_ANDROID: z.string().default("0.0.0"),
    MIN_VERSION_IOS: z.string().default("0.0.0"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    if (env.OTP_PROVIDER === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["OTP_PROVIDER"],
        message: "the mock OTP provider must not be used in production",
      });
    }
    if (env.OTP_MOCK_FIXED_CODE) {
      ctx.addIssue({
        code: "custom",
        path: ["OTP_MOCK_FIXED_CODE"],
        message: "a fixed OTP code must not be set in production",
      });
    }
    if (/dev-only|test-/i.test(env.JWT_SECRET) || /dev-only|test-/i.test(env.OTP_HMAC_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "development secrets must not be used in production",
      });
    }
    if (!env.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_ENABLED"],
        message: "rate limiting must be enabled in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol("ENV");

/** Validates the environment once at start-up. Fails fast with a readable list of problems. */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
  overrides: Record<string, string> = {},
): Env {
  const parsed = envSchema.safeParse({ ...source, ...overrides });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
