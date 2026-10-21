import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import { ENV, type Env } from "../config/env";
import type { DB } from "./types";

/** Who is making the request. Becomes `app.*` settings that the row-level security policies read. */
export interface TenantContext {
  userId?: string | null;
  orgId?: string | null;
  phone?: string | null;
}

export type Trx = Transaction<DB>;

const RETRYABLE = new Set(["40001", "40P01"]); // serialization failure, deadlock

// Postgres returns int8/numeric as strings by default (exact); timestamptz parses to Date (pg default).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

@Injectable()
export class Db implements OnModuleDestroy {
  private readonly log = new Logger("Db");
  readonly kysely: Kysely<DB>;
  private readonly pool: pg.Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: 30_000,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    this.pool.on("error", (err) => this.log.error({ err }, "idle database client error"));
    this.kysely = new Kysely<DB>({ dialect: new PostgresDialect({ pool: this.pool }) });
  }

  /**
   * Runs `fn` in one transaction with the tenant context applied (`set_config(..., true)` is transaction-local, so
   * it can never leak to another request on a pooled connection). Retries serialization failures and deadlocks.
   */
  async tx<T>(ctx: TenantContext, fn: (trx: Trx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.kysely.transaction().execute(async (trx) => {
          await Db.setContext(trx, ctx);
          return fn(trx);
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (attempt < 3 && code && RETRYABLE.has(code)) continue;
        throw err;
      }
    }
  }

  /** Changes the tenant context inside an open transaction (e.g. after finding which org an invitation belongs to). */
  static async setContext(trx: Trx, ctx: TenantContext): Promise<void> {
    await sql`select set_config('app.user_id', ${ctx.userId ?? ""}, true),
                     set_config('app.org_id', ${ctx.orgId ?? ""}, true),
                     set_config('app.user_phone', ${ctx.phone ?? ""}, true)`.execute(trx);
  }

  async ping(): Promise<void> {
    await sql`select 1`.execute(this.kysely);
  }

  async onModuleDestroy(): Promise<void> {
    await this.kysely.destroy();
  }
}
