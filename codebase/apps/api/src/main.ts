import "reflect-metadata";
import { Logger as NestLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp, createAdapter } from "./bootstrap";
import { ENV, type Env, loadEnv } from "./config/env";
import { buildOpenApi, serveDocs } from "./openapi";

async function main() {
  const env = loadEnv(); // fail fast, before anything starts, with a readable list of what is wrong
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(env.TRUST_PROXY), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await configureApp(app);
  if (app.get<Env>(ENV).NODE_ENV !== "production") serveDocs(app, buildOpenApi(app));
  app.enableShutdownHooks(); // SIGTERM: stop accepting requests, finish in-flight ones, close the database pool
  await app.listen(env.API_PORT, env.API_HOST);
  NestLogger.log(`API listening on http://${env.API_HOST}:${env.API_PORT} (${env.NODE_ENV})`, "Bootstrap");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
