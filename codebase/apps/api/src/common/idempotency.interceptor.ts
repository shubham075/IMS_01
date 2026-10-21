import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { catchError, from, mergeMap, type Observable, of, throwError } from "rxjs";
import { IDEMPOTENT_KEY } from "../auth/decorators";
import { Db } from "../db/db.service";
import { Errors } from "./errors";
import { sha256Hex } from "./util";

const KEY_FORMAT = /^[A-Za-z0-9_\-:.]{8,128}$/;
const STALE_AFTER_SECONDS = 60;

/**
 * `Idempotency-Key` support for routes marked @Idempotent(). A retry with the same key and the same payload gets the
 * first response back and does nothing twice; the same key with a different payload is rejected (docs/01 §0.3).
 * Registered before the response serializer so the stored body is exactly what the client received.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler())) return next.handle();
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();
    const raw = req.headers["idempotency-key"];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return next.handle();
    if (!KEY_FORMAT.test(key)) {
      throw Errors.validation([{ path: "Idempotency-Key", message: "Use 8-128 letters, digits, - _ : ." }]);
    }
    return from(this.begin(req, key)).pipe(
      mergeMap((state) => {
        if (state.replay) {
          res.status(state.replay.status);
          return of(state.replay.body);
        }
        const status =
          Reflect.getMetadata("__httpCode__", context.getHandler()) ?? (req.method === "POST" ? 201 : 200);
        return next.handle().pipe(
          mergeMap((body) =>
            from(this.finish(state.scope, key, status, body)).pipe(mergeMap(() => of(body))),
          ),
          catchError((err) =>
            from(this.abandon(state.scope, key)).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  private async begin(req: FastifyRequest, key: string) {
    const scope = `${req.auth?.userId ?? "anon"}|${req.method}|${req.url.split("?")[0]}`;
    const requestHash = sha256Hex(JSON.stringify(req.body ?? null));
    const k = this.db.kysely;

    const inserted = await k
      .insertInto("idempotency_key")
      .values({ scope, key, request_hash: requestHash })
      .onConflict((oc) => oc.columns(["scope", "key"]).doNothing())
      .returning("key")
      .executeTakeFirst();
    if (inserted) return { scope, replay: null };

    const existing = await k
      .selectFrom("idempotency_key")
      .selectAll()
      .where("scope", "=", scope)
      .where("key", "=", key)
      .executeTakeFirst();
    if (!existing) return { scope, replay: null }; // deleted between statements: treat as new (rare)
    if (existing.request_hash !== requestHash) throw Errors.idempotencyReused();
    if (existing.response !== null && existing.status_code !== null) {
      return { scope, replay: { status: existing.status_code, body: existing.response } };
    }
    const ageSeconds = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
    if (ageSeconds < STALE_AFTER_SECONDS) throw Errors.idempotencyInProgress();
    // The first attempt died without finishing: take the key over.
    await k
      .updateTable("idempotency_key")
      .set({ created_at: sql<Date>`now()` })
      .where("scope", "=", scope)
      .where("key", "=", key)
      .execute();
    return { scope, replay: null };
  }

  private async finish(scope: string, key: string, status: number, body: unknown) {
    await this.db.kysely
      .updateTable("idempotency_key")
      .set({ status_code: status, response: JSON.stringify(body ?? null) })
      .where("scope", "=", scope)
      .where("key", "=", key)
      .execute();
  }

  private async abandon(scope: string, key: string) {
    await this.db.kysely
      .deleteFrom("idempotency_key")
      .where("scope", "=", scope)
      .where("key", "=", key)
      .execute();
  }
}
