import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../app.module";
import { configureApp, createAdapter } from "../bootstrap";
import { buildOpenApi } from "../openapi";

/** Writes apps/api/openapi/openapi.json (the API contract). The database is never contacted. */
async function main() {
  // The document does not depend on these values; defaults let this run on a bare CI machine.
  process.env.DATABASE_URL ??= "postgres://idea01_app:x@localhost:5432/idea01";
  process.env.JWT_SECRET ??= "openapi-export-only-secret-openapi-export-only";
  process.env.OTP_HMAC_SECRET ??= "openapi-export-only-otp-openapi-export-only";
  process.env.LOG_LEVEL = "silent";

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(false), {
    logger: false,
  });
  await configureApp(app);
  await app.init();
  const doc = buildOpenApi(app);
  const out = path.resolve(__dirname, "../../openapi/openapi.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  await app.close();
  console.log(`wrote ${out} (${Object.keys(doc.paths).length} paths)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
