import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { ZodSerializerInterceptor, ZodValidationPipe } from "nestjs-zod";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { BranchesModule } from "./branches/branches.module";
import { CatalogueModule } from "./catalogue/catalogue.module";
import { IdempotencyInterceptor } from "./common/idempotency.interceptor";
import { ProblemFilter } from "./common/problem.filter";
import { ThrottleGuard } from "./common/throttle.guard";
import { ConfigModule } from "./config/config.module";
import { ENV, type Env } from "./config/env";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";
import { ImportsModule } from "./imports/imports.module";
import { MeModule } from "./me/me.module";
import { MembersModule } from "./members/members.module";
import { OrgsModule } from "./orgs/orgs.module";
import { StockModule } from "./stock/stock.module";
import { TransfersModule } from "./transfers/transfers.module";

export function createAppModule(testEnv?: Record<string, string>) {
  @Module({
    imports: [
      testEnv ? ConfigModule.forTest(testEnv) : ConfigModule,
      LoggerModule.forRootAsync({
        inject: [ENV],
        useFactory: (env: Env) => ({
          pinoHttp: {
            level: env.LOG_LEVEL,
            // Never log credentials; log the path without the query string; request id comes from Fastify.
            redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url.split("?")[0],
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            autoLogging: {
              ignore: (req: { url?: string }) => req.url === "/healthz" || req.url === "/readyz",
            },
            transport:
              env.NODE_ENV === "development"
                ? { target: "pino-pretty", options: { singleLine: true, colorize: true } }
                : undefined,
          },
        }),
      }),
      DbModule,
      AuthModule,
      MeModule,
      OrgsModule,
      BranchesModule,
      CatalogueModule,
      StockModule,
      TransfersModule,
      ImportsModule,
      MembersModule,
    ],
    controllers: [HealthController],
    providers: [
      // Order matters: rate-limit first, then authenticate.
      { provide: APP_GUARD, useClass: ThrottleGuard },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      // Idempotency is registered before the serializer so it stores exactly what the client receives.
      { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      { provide: APP_FILTER, useClass: ProblemFilter },
    ],
  })
  class AppModule {}
  return AppModule;
}

export const AppModule = createAppModule();
