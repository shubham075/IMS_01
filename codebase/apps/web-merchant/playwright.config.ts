import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real API and the real web app (production build) against their own throwaway database
 * (`idea01_e2e`) on their own ports, so they never touch development data and can run next to the dev servers.
 */
const WEB_PORT = 3100;
const API_PORT = 3101;
const SERVER = process.env.PG_SERVER_URL ?? "postgres://postgres:postgres@localhost:5432";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: [
    {
      command: "pnpm --dir ../api build && pnpm --dir ../api start",
      url: `http://localhost:${API_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        API_PORT: String(API_PORT),
        DATABASE_URL: "postgres://idea01_app:idea01_app_dev@localhost:5432/idea01_e2e",
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-123456",
        OTP_HMAC_SECRET: "e2e-otp-secret-e2e-otp-secret-123456",
        OTP_PROVIDER: "mock",
        OTP_MOCK_FIXED_CODE: "123456",
        RATE_LIMIT_ENABLED: "false",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "pnpm exec next build && pnpm exec next start --port 3100",
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        NODE_ENV: "production",
        NEXT_DIST_DIR: ".next-e2e",
        API_URL: `http://localhost:${API_PORT}`,
        NEXT_PUBLIC_SHOW_DEV_OTP_HINT: "false",
        PG_SERVER_URL: SERVER,
      },
    },
  ],
});
