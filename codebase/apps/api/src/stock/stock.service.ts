import {
  COUNTER_KINDS,
  KIND_SIGN,
  type ListMovementsQuery,
  type ListStockQuery,
  type Movement,
  type MovementPage,
  type MovementResult,
  type RecordMovement,
  type ReverseMovement,
  type SetStatus,
  type SetThreshold,
  type StockLine,
  type StockPage,
  type StockSummary,
} from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { type RawBuilder, sql } from "kysely";
import type { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { AppError, Errors, pgHint } from "../common/errors";
import { iso, isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface LineRow {
  product_id: string;
  name: string;
  name_hi: string | null;
  unit: string;
  allow_fraction: boolean;
  tracking_mode: string;
  code: string | null;
  on_hand: number;
  unsellable: number;
  sellable: number;
  threshold: number;
  custom: boolean;
  is_low: boolean;
  is_out: boolean;
  needs_check: boolean;
  status_override: string | null;
  last_movement_at: Date | null;
}

/** Runs a database function and turns the errors it raises on purpose (HINT = API code) into API errors. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    const mapped = Errors.fromHint(pgHint(err), err instanceof Error ? err.message : "");
    throw mapped ?? err;
  }
}

@Injectable()
export class StockService {
  constructor(private readonly db: Db) {}

  async list(org: OrgContext, userId: string, branchId: string, q: ListStockQuery): Promise<StockPage> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      const rows = await this.lines(trx, org.orgId, branchId, {
        q: q.q,
        productId: q.productId,
        filter: q.filter,
        limit: q.limit,
        offset: q.offset,
      });
      const total = await this.lines(trx, org.orgId, branchId, {
        q: q.q,
        productId: q.productId,
        filter: q.filter,
        count: true,
      });
      return {
        items: rows.map(mapLine),
        total: Number((total[0] as unknown as { n: string } | undefined)?.n ?? 0),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  async summary(org: OrgContext, userId: string, branchId: string): Promise<StockSummary> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      const r = await sql<{ products: string; low: string; out: string; check: string }>`
        WITH t AS (${this.base(org.orgId, branchId, {})})
        SELECT count(*) AS products, count(*) FILTER (WHERE is_low) AS low,
               count(*) FILTER (WHERE is_out) AS out, count(*) FILTER (WHERE needs_check) AS check
        FROM t`.execute(trx);
      const row = r.rows[0];
      return {
        products: Number(row?.products ?? 0),
        low: Number(row?.low ?? 0),
        out: Number(row?.out ?? 0),
        needsCheck: Number(row?.check ?? 0),
      };
    });
  }

  async record(
    org: OrgContext,
    userId: string,
    branchId: string,
    dto: RecordMovement,
  ): Promise<MovementResult> {
    const counter = COUNTER_KINDS.includes(dto.kind);
    if (!org.permissions.includes(counter ? "sale.record" : "stock.write")) throw Errors.permissionDenied();
    return this.inBranch(org, userId, branchId, async (trx) => {
      // One writer at a time per product and branch: two people opening the same stock cannot both pass the checks below.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${branchId}:${dto.productId}`}, 0))`.execute(
        trx,
      );

      const sign = KIND_SIGN[dto.kind] || (dto.direction === "out" ? -1 : 1);
      const qty = sign * dto.quantity;
      const bucket = dto.kind === "customer_return" && dto.returnToUnsellable ? "unsellable" : "on_hand";

      // A retry of something already recorded gets the same answer, whatever has happened since (opening stock is
      // "already set" only for a different request). The same event id with different content is a mistake: refuse.
      const seen = await this.seenEvent(trx, org.orgId, dto.eventId);
      if (seen) {
        const same =
          seen.branch_id === branchId &&
          seen.product_id === dto.productId &&
          seen.reason === dto.kind &&
          seen.bucket === bucket &&
          Number(seen.qty_delta) === qty;
        if (!same) throw Errors.idempotencyReused();
        return {
          movementId: seen.id,
          duplicate: true,
          line: await this.lineFor(trx, org.orgId, branchId, dto.productId),
        };
      }

      const product = await trx
        .selectFrom("product")
        .select(["id", "status", "tracking_mode"])
        .where("org_id", "=", org.orgId)
        .where("id", "=", dto.productId)
        .executeTakeFirst();
      if (!product || product.status === "merged") throw Errors.notFound("Product");
      if (product.tracking_mode === "status_only")
        throw Errors.validation([
          {
            path: "productId",
            message: "This product is not counted. Mark it in stock or out of stock instead.",
          },
        ]);

      if (dto.kind === "opening") {
        const any = await trx
          .selectFrom("stock_movement")
          .select("id")
          .where("org_id", "=", org.orgId)
          .where("branch_id", "=", branchId)
          .where("product_id", "=", dto.productId)
          .limit(1)
          .executeTakeFirst();
        if (any) throw Errors.openingAlreadySet();
      } else if (!dto.confirmLarge) {
        const typical = await sql<{ n: string; avg: number | null }>`
          SELECT count(*) AS n, avg(abs(qty_delta))::float8 AS avg FROM (
            SELECT qty_delta FROM stock_movement
             WHERE org_id = ${org.orgId} AND branch_id = ${branchId} AND product_id = ${dto.productId}
               AND bucket = 'on_hand' AND reason NOT IN ('opening','reversal','import_snapshot')
             ORDER BY occurred_at DESC LIMIT 20) recent`.execute(trx);
        const { n, avg } = typical.rows[0] ?? { n: "0", avg: null };
        if (Number(n) >= 3 && avg && dto.quantity > 10 * avg) throw Errors.confirmRequired();
      }

      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const res = await guarded(() =>
        sql<{ o_movement_id: string; o_duplicate: boolean }>`
          SELECT * FROM apply_stock_movement(
            ${org.orgId}::uuid, ${branchId}::uuid, ${dto.productId}::uuid, ${qty}::numeric, ${bucket}, ${dto.kind},
            'manual', ${dto.eventId}, ${occurredAt}::timestamptz, ${userId}::uuid, NULL, NULL, ${dto.note ?? null})`.execute(
          trx,
        ),
      );
      const r = res.rows[0];
      if (!r) throw Errors.unavailable();
      await this.refreshListing(trx, branchId, dto.productId);
      return {
        movementId: r.o_movement_id,
        duplicate: r.o_duplicate,
        line: await this.lineFor(trx, org.orgId, branchId, dto.productId),
      };
    });
  }

  async reverse(
    org: OrgContext,
    userId: string,
    branchId: string,
    movementId: string,
    dto: ReverseMovement,
  ): Promise<MovementResult> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${movementId}, 0))`.execute(trx);
      const seen = await this.seenEvent(trx, org.orgId, dto.eventId);
      if (seen) {
        if (seen.reverses_movement_id !== movementId) throw Errors.idempotencyReused();
        return {
          movementId: seen.id,
          duplicate: true,
          line: await this.lineFor(trx, org.orgId, branchId, seen.product_id),
        };
      }
      const m = await sql<{ product_id: string; branch_id: string }>`
        SELECT product_id, branch_id FROM stock_movement WHERE org_id = ${org.orgId} AND id = ${movementId}`.execute(
        trx,
      );
      const found = m.rows[0];
      if (!found || found.branch_id !== branchId) throw Errors.notFound("Stock entry");
      const res = await guarded(() =>
        sql<{ o_movement_id: string; o_duplicate: boolean }>`
          SELECT * FROM reverse_stock_movement(${org.orgId}::uuid, ${movementId}::uuid, ${userId}::uuid, ${dto.eventId}, ${dto.note ?? null})`.execute(
          trx,
        ),
      );
      const r = res.rows[0];
      if (!r) throw Errors.unavailable();
      await this.refreshListing(trx, branchId, found.product_id);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "stock.reversed",
        targetType: "stock_movement",
        targetId: movementId,
        meta: { branchId },
      });
      return {
        movementId: r.o_movement_id,
        duplicate: r.o_duplicate,
        line: await this.lineFor(trx, org.orgId, branchId, found.product_id),
      };
    });
  }

  async setStatus(org: OrgContext, userId: string, branchId: string, dto: SetStatus): Promise<StockLine> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      const product = await trx
        .selectFrom("product")
        .select(["id", "status", "tracking_mode"])
        .where("org_id", "=", org.orgId)
        .where("id", "=", dto.productId)
        .executeTakeFirst();
      if (!product || product.status === "merged") throw Errors.notFound("Product");
      if (product.tracking_mode !== "status_only")
        throw Errors.validation([
          { path: "productId", message: "This product is counted. Record stock in or out instead." },
        ]);
      await guarded(() =>
        sql`SELECT set_stock_status(${org.orgId}::uuid, ${branchId}::uuid, ${dto.productId}::uuid, ${dto.status}, ${userId}::uuid)`.execute(
          trx,
        ),
      );
      await this.refreshListing(trx, branchId, dto.productId);
      return this.lineFor(trx, org.orgId, branchId, dto.productId);
    });
  }

  async setThreshold(
    org: OrgContext,
    userId: string,
    branchId: string,
    dto: SetThreshold,
  ): Promise<StockLine> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      const product = await trx
        .selectFrom("product")
        .select(["id", "status"])
        .where("org_id", "=", org.orgId)
        .where("id", "=", dto.productId)
        .executeTakeFirst();
      if (!product || product.status === "merged") throw Errors.notFound("Product");
      await trx
        .insertInto("inventory_balance")
        .values({
          org_id: org.orgId,
          branch_id: branchId,
          product_id: dto.productId,
          low_stock_threshold: dto.threshold === null ? null : String(dto.threshold),
        })
        .onConflict((oc) =>
          oc.columns(["branch_id", "product_id"]).doUpdateSet({
            low_stock_threshold: dto.threshold === null ? null : String(dto.threshold),
          }),
        )
        .execute();
      await this.refreshListing(trx, branchId, dto.productId);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "stock.threshold_changed",
        targetType: "product",
        targetId: dto.productId,
        meta: { branchId, threshold: dto.threshold },
      });
      return this.lineFor(trx, org.orgId, branchId, dto.productId);
    });
  }

  async movements(
    org: OrgContext,
    userId: string,
    branchId: string,
    q: ListMovementsQuery,
  ): Promise<MovementPage> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      const where = sql`m.org_id = ${org.orgId} AND m.branch_id = ${branchId}
        ${q.productId ? sql`AND m.product_id = ${q.productId}` : sql``}
        ${q.reason ? sql`AND m.reason = ${q.reason}` : sql``}
        ${q.from ? sql`AND m.occurred_at >= ${new Date(q.from)}` : sql``}
        ${q.to ? sql`AND m.occurred_at <= ${new Date(q.to)}` : sql``}`;
      const total = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM stock_movement m WHERE ${where}`.execute(trx);
      const rows = await sql<{
        id: string;
        product_id: string;
        product_name: string;
        occurred_at: Date;
        reason: string;
        qty_delta: string;
        bucket: string;
        note: string | null;
        source: string;
        actor_name: string | null;
        is_reversal: boolean;
        is_reversed: boolean;
      }>`
        SELECT m.id, m.product_id, p.name AS product_name, m.occurred_at, m.reason, m.qty_delta::text, m.bucket, m.note, m.source,
               u.display_name AS actor_name, (m.reverses_movement_id IS NOT NULL) AS is_reversal,
               (rm.movement_id IS NOT NULL) AS is_reversed
          FROM stock_movement m
          JOIN product p ON p.org_id = m.org_id AND p.id = m.product_id
          LEFT JOIN app_user u ON u.id = m.actor_user_id
          LEFT JOIN reversed_movement rm ON rm.org_id = m.org_id AND rm.movement_id = m.id
         WHERE ${where}
         ORDER BY m.occurred_at DESC, m.ingested_at DESC, m.id
         LIMIT ${q.limit} OFFSET ${q.offset}`.execute(trx);
      return {
        items: rows.rows.map(
          (r): Movement => ({
            id: r.id,
            productId: r.product_id,
            productName: r.product_name,
            occurredAt: isoReq(r.occurred_at),
            reason: r.reason,
            qtyDelta: Number(r.qty_delta),
            bucket: r.bucket as Movement["bucket"],
            note: r.note,
            source: r.source,
            actorName: r.actor_name,
            isReversal: r.is_reversal,
            isReversed: r.is_reversed,
          }),
        ),
        total: Number(total.rows[0]?.n ?? 0),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  // ---------- helpers ----------

  /** The ledger entry already recorded for this event id, if any. */
  private async seenEvent(trx: Trx, orgId: string, eventId: string) {
    const r = await sql<{
      id: string;
      branch_id: string;
      product_id: string;
      reason: string;
      bucket: string;
      qty_delta: string;
      reverses_movement_id: string | null;
    }>`SELECT m.id, m.branch_id, m.product_id, m.reason, m.bucket, m.qty_delta::text, m.reverses_movement_id
         FROM stock_event_key k JOIN stock_movement m ON m.id = k.movement_id
        WHERE k.org_id = ${orgId} AND k.source = 'manual' AND k.source_event_id = ${eventId}
        LIMIT 1`.execute(trx);
    return r.rows[0] ?? null;
  }

  /** Runs in a transaction after checking the branch belongs to the shop and the person may use it. */
  private async inBranch<T>(
    org: OrgContext,
    userId: string,
    branchId: string,
    fn: (trx: Trx) => Promise<T>,
  ): Promise<T> {
    if (org.branchIds.length && !org.branchIds.includes(branchId)) throw Errors.branchOutOfScope();
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const b = await trx
        .selectFrom("branch")
        .select("id")
        .where("org_id", "=", org.orgId)
        .where("id", "=", branchId)
        .executeTakeFirst();
      if (!b) throw Errors.notFound("Branch");
      return fn(trx);
    });
  }

  /** One row per active product with its balance at this branch. A product never stocked is "not counted yet", not "out". */
  private base(orgId: string, branchId: string, o: { q?: string; productId?: string }): RawBuilder<unknown> {
    const term = o.q ? `%${likeEscape(o.q.toLowerCase())}%` : null;
    return sql`
      SELECT p.id AS product_id, p.name, p.name_hi, p.unit, p.allow_fraction, p.tracking_mode,
             (SELECT i.value FROM product_identifier i WHERE i.product_id = p.id AND i.kind IN ('barcode','short_code')
               ORDER BY (i.kind = 'barcode') DESC, i.value LIMIT 1) AS code,
             COALESCE(ib.on_hand, 0)::float8 AS on_hand, COALESCE(ib.unsellable, 0)::float8 AS unsellable,
             (COALESCE(ib.on_hand, 0) - COALESCE(ib.reserved, 0) - COALESCE(ib.unsellable, 0))::float8 AS sellable,
             COALESCE(ib.low_stock_threshold, p.low_stock_threshold)::float8 AS threshold,
             (ib.low_stock_threshold IS NOT NULL) AS custom,
             COALESCE(p.tracking_mode = 'quantity' AND ib.last_movement_at IS NOT NULL
               AND (COALESCE(ib.on_hand, 0) - COALESCE(ib.reserved, 0) - COALESCE(ib.unsellable, 0)) > 0
               AND COALESCE(ib.low_stock_threshold, p.low_stock_threshold) > 0
               AND (COALESCE(ib.on_hand, 0) - COALESCE(ib.reserved, 0) - COALESCE(ib.unsellable, 0))
                   <= COALESCE(ib.low_stock_threshold, p.low_stock_threshold), false) AS is_low,
             (CASE WHEN p.tracking_mode = 'status_only' THEN COALESCE(ib.status_override = 'out_of_stock', false)
                   ELSE COALESCE(ib.last_movement_at IS NOT NULL
                        AND (COALESCE(ib.on_hand, 0) - COALESCE(ib.reserved, 0) - COALESCE(ib.unsellable, 0)) <= 0, false) END) AS is_out,
             COALESCE(ib.discrepancy, false) AS needs_check, ib.status_override, ib.last_movement_at
        FROM product p
        LEFT JOIN inventory_balance ib ON ib.product_id = p.id AND ib.branch_id = ${branchId}
       WHERE p.org_id = ${orgId} AND p.status = 'active'
         ${o.productId ? sql`AND p.id = ${o.productId}` : sql``}
         ${
           term
             ? sql`AND (f_unaccent(lower(p.name)) LIKE ${term} OR lower(coalesce(p.name_hi, '')) LIKE ${term}
                    OR EXISTS (SELECT 1 FROM product_identifier i WHERE i.product_id = p.id AND lower(i.value) LIKE ${term}))`
             : sql``
         }`;
  }

  private async lines(
    trx: Trx,
    orgId: string,
    branchId: string,
    o: { q?: string; filter?: string; limit?: number; offset?: number; productId?: string; count?: boolean },
  ): Promise<LineRow[]> {
    const filter =
      o.filter === "low"
        ? sql`WHERE is_low`
        : o.filter === "out"
          ? sql`WHERE is_out`
          : o.filter === "check"
            ? sql`WHERE needs_check`
            : sql``;
    const base = this.base(orgId, branchId, o);
    const res = o.count
      ? await sql`WITH t AS (${base}) SELECT count(*) AS n FROM t ${filter}`.execute(trx)
      : await sql`WITH t AS (${base}) SELECT * FROM t ${filter}
                   ORDER BY (needs_check OR is_out OR is_low) DESC, lower(name), product_id
                   LIMIT ${o.limit ?? 30} OFFSET ${o.offset ?? 0}`.execute(trx);
    return res.rows as LineRow[];
  }

  async lineFor(trx: Trx, orgId: string, branchId: string, productId: string): Promise<StockLine> {
    const [row] = await this.lines(trx, orgId, branchId, { productId, limit: 1 });
    if (!row) throw Errors.notFound("Product");
    return mapLine(row);
  }

  /** Keeps the shopper-facing status in step with the stock (it only ever carries in/low/out, never a number). */
  private async refreshListing(trx: Trx, branchId: string, productId: string) {
    await sql`SELECT refresh_public_listing(${branchId}::uuid, ${productId}::uuid)`.execute(trx);
  }
}

function mapLine(r: LineRow): StockLine {
  return {
    productId: r.product_id,
    name: r.name,
    nameHi: r.name_hi,
    unit: r.unit,
    allowFraction: r.allow_fraction,
    trackingMode: r.tracking_mode as StockLine["trackingMode"],
    code: r.code,
    onHand: r.on_hand,
    unsellable: r.unsellable,
    sellable: r.sellable,
    threshold: r.threshold,
    thresholdIsCustom: r.custom,
    isLow: r.is_low,
    isOut: r.is_out,
    needsCheck: r.needs_check,
    statusOverride: r.status_override as StockLine["statusOverride"],
    lastMovementAt: iso(r.last_movement_at),
  };
}
