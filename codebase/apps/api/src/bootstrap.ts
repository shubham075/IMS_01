import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { ENV, type Env } from "./config/env";

export const createAdapter = (trustProxy: boolean) =>
  new FastifyAdapter({
    trustProxy,
    bodyLimit: 1_048_576, // 1 MB: JSON only; file uploads go straight to object storage
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

/** Everything that makes the HTTP server safe and consistent. Shared by the real server and the tests. */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const env = app.get<Env>(ENV);
  app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });

  await app.register(helmet, { contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-client-version", "x-request-id"],
    exposedHeaders: ["x-request-id", "retry-after"],
    maxAge: 600,
  });

  // Echo the request id so a user's error report (trace_id) can be found in the logs.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", async (req, reply) => {
      reply.header("x-request-id", String(req.id));
    });
}
