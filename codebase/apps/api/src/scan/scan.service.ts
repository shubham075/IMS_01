import type {
  Count,
  CountDetail,
  CountLineInput,
  CountPage,
  ListCountsQuery,
  LookupQuery,
  LookupResult,
  StartCount,
} from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { AppError, Errors, pgHint } from "../common/errors";
import { iso, isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";
import { StockService } from "../stock/stock.service";

interface CountRow {
  id: string;
  branch_id: string;
  branch_name: string;
  kind: string;
  status: string;
  started_at: Date;
  expires_at: Date;
  finalized_at: Date | null;
  started_by_name: string | null;
  line_count: string;
}

@Injectable()
export class ScanService {
  constructor(
    private readonly db: Db,
    private readonly stock: StockService,
  ) {}

  /** What is this code? Your own product first; otherwise the shared catalogue, so a new product can be prefilled. */
  async lookup(org: OrgContext, userId: string, q: LookupQuery): Promise<LookupResult> {
    if (q.branchId && org.branchIds.length && !org.branchIds.includes(q.branchId))
      throw Errors.branchOutOfScope();
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const code = q.code.trim();
      if (q.branchId) {
        const b = await trx
          .selectFrom("branch")
          .select("id")
          .where("org_id", "=", org.orgId)
          .where("id", "=", q.branchId)
          .executeTakeFirst();
        if (!b) throw Errors.notFound("Branch");
      }
      const hit = await sql<{
        id: string;
        name: string;
        name_hi: string | null;
        unit: string;
        allow_fraction: boolean;
        tracking_mode: string;
        status: string;
        price_paise: string | null;
      }>`SELECT p.id, p.name, p.name_hi, p.unit, p.allow_fraction, p.tracking_mode, p.status, p.price_paise::text
           FROM product_identifier i JOIN product p ON p.org_id = i.org_id AND p.id = i.product_id
          WHERE i.org_id = ${org.orgId} AND p.status <> 'merged'
            AND ((i.kind IN ('barcode','sku','alias') AND i.value = ${code})
              OR (i.kind = 'short_code' AND upper(i.value) = upper(${code})))
          ORDER BY (p.status = 'active') DESC, (i.kind = 'barcode') DESC LIMIT 1`.execute(trx);
      const p = hit.rows[0];
      if (p) {
        let line = null;
        if (q.branchId && p.status === "active") {
          line = await this.stock.lineFor(trx, org.orgId, q.branchId, p.id);
        }
        return {
          product: {
            id: p.id,
            name: p.name,
            nameHi: p.name_hi,
            unit: p.unit,
            allowFraction: p.allow_fraction,
            trackingMode: p.tracking_mode as "quantity" | "status_only",
            status: p.status as "active" | "inactive" | "merged",
            pricePaise: p.price_paise === null ? null : Number(p.price_paise),
          },
          canonical: null,
          stock: line,
        };
      }
      const c = await trx
        .selectFrom("canonical_product")
        .selectAll()
        .where("barcode", "=", code)
        .limit(1)
        .executeTakeFirst();
      return {
        product: null,
        canonical: c
          ? {
              id: c.id,
              name: c.name,
              brand: c.brand,
              barcode: c.barcode,
              categoryId: c.category_id,
              alreadyAddedProductId: null,
            }
          : null,
        stock: null,
      };
    });
  }

  // ---------- stock counts ----------

  /** Starts a count, or returns the one already in progress at this branch (two people starting at once share it). */
  async start(org: OrgContext, userId: string, branchId: string, dto: StartCount): Promise<CountDetail> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`count:${branchId}`}, 0))`.execute(trx);
      await this.expireOld(trx, org.orgId, branchId);
      const open = await trx
        .selectFrom("stock_count")
        .select("id")
        .where("org_id", "=", org.orgId)
        .where("branch_id", "=", branchId)
        .where("status", "=", "draft")
        .executeTakeFirst();
      if (open) return this.detail(trx, org, open.id);
      const c = await trx
        .insertInto("stock_count")
        .values({ org_id: org.orgId, branch_id: branchId, kind: dto.kind, started_by: userId })
        .returning("id")
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "count.started",
        targetType: "stock_count",
        targetId: c.id,
      });
      return this.detail(trx, org, c.id);
    });
  }

  async list(org: OrgContext, userId: string, branchId: string, q: ListCountsQuery): Promise<CountPage> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      await this.expireOld(trx, org.orgId, branchId);
      const status = q.status ? sql`AND c.status = ${q.status}` : sql``;
      const total = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM stock_count c WHERE c.org_id = ${org.orgId} AND c.branch_id = ${branchId} ${status}`.execute(
        trx,
      );
      const rows =
        await sql<CountRow>`${this.countSelect()} WHERE c.org_id = ${org.orgId} AND c.branch_id = ${branchId} ${status}
        ORDER BY c.started_at DESC, c.id LIMIT ${q.limit} OFFSET ${q.offset}`.execute(trx);
      return {
        items: rows.rows.map(mapCount),
        total: Number(total.rows[0]?.n ?? 0),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  async get(org: OrgContext, userId: string, branchId: string, countId: string): Promise<CountDetail> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      await this.expireOld(trx, org.orgId, branchId);
      await this.load(trx, org, branchId, countId);
      return this.detail(trx, org, countId);
    });
  }

  /** Records the number counted for one product. Every entry is kept; the latest per product wins (docs/01 T5). */
  async addLine(
    org: OrgContext,
    userId: string,
    branchId: string,
    countId: string,
    dto: CountLineInput,
  ): Promise<CountDetail> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      const c = await this.lockDraft(trx, org, branchId, countId);
      const p = await trx
        .selectFrom("product")
        .select(["id", "status", "tracking_mode", "allow_fraction"])
        .where("org_id", "=", org.orgId)
        .where("id", "=", dto.productId)
        .executeTakeFirst();
      if (!p || p.status === "merged") throw Errors.notFound("Product");
      if (p.status !== "active")
        throw Errors.validation([
          { path: "productId", message: "Switch the product on before counting it." },
        ]);
      if (p.tracking_mode !== "quantity")
        throw Errors.validation([
          { path: "productId", message: "This product is not counted, so it is left out of stock counts." },
        ]);
      if (!p.allow_fraction && dto.quantity !== Math.trunc(dto.quantity))
        throw new AppError(422, "QTY_NOT_INTEGRAL", "This product is counted in whole units.");
      await trx
        .insertInto("stock_count_line")
        .values({
          org_id: org.orgId,
          count_id: c.id,
          product_id: dto.productId,
          counted_qty: String(dto.quantity),
          counted_by: userId,
        })
        .execute();
      return this.detail(trx, org, countId);
    });
  }

  /** Corrects the stock to what was counted, as of the moment of counting, so sales made meanwhile are not lost (D-06). */
  async finalize(org: OrgContext, userId: string, branchId: string, countId: string): Promise<CountDetail> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      await this.expireOld(trx, org.orgId, branchId);
      const c = await this.load(trx, org, branchId, countId, true);
      if (c.status === "finalized") return this.detail(trx, org, countId);
      if (c.status === "abandoned")
        throw Errors.conflict("This count expired or was cancelled. Start a new one.");
      const lines = await trx
        .selectFrom("stock_count_line")
        .select("product_id")
        .distinct()
        .where("count_id", "=", countId)
        .execute();
      if (lines.length === 0)
        throw Errors.validation([{ path: "lines", message: "Count at least one product first." }]);
      await guarded(() =>
        sql`SELECT finalize_stock_count(${org.orgId}::uuid, ${countId}::uuid, ${userId}::uuid)`.execute(trx),
      );
      for (const l of lines)
        await sql`SELECT refresh_public_listing(${branchId}::uuid, ${l.product_id}::uuid)`.execute(trx);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "count.finalized",
        targetType: "stock_count",
        targetId: countId,
        meta: { products: lines.length },
      });
      return this.detail(trx, org, countId);
    });
  }

  async abandon(org: OrgContext, userId: string, branchId: string, countId: string): Promise<CountDetail> {
    return this.inBranch(org, userId, branchId, async (trx) => {
      const c = await this.load(trx, org, branchId, countId, true);
      if (c.status === "abandoned") return this.detail(trx, org, countId);
      if (c.status !== "draft") throw Errors.conflict("A finished count cannot be cancelled.");
      await trx.updateTable("stock_count").set({ status: "abandoned" }).where("id", "=", countId).execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "count.abandoned",
        targetType: "stock_count",
        targetId: countId,
      });
      return this.detail(trx, org, countId);
    });
  }

  // ---------- helpers ----------

  private countSelect() {
    return sql`
      SELECT c.id, c.branch_id, b.name AS branch_name, c.kind, c.status, c.started_at, c.expires_at, c.finalized_at,
             u.display_name AS started_by_name,
             (SELECT count(DISTINCT l.product_id) FROM stock_count_line l WHERE l.count_id = c.id) AS line_count
        FROM stock_count c
        JOIN branch b ON b.org_id = c.org_id AND b.id = c.branch_id
        LEFT JOIN app_user u ON u.id = c.started_by`;
  }

  private async load(
    trx: Trx,
    org: OrgContext,
    branchId: string,
    countId: string,
    lock = false,
  ): Promise<CountRow> {
    const r =
      await sql<CountRow>`${this.countSelect()} WHERE c.org_id = ${org.orgId} AND c.branch_id = ${branchId} AND c.id = ${countId}
      ${lock ? sql`FOR UPDATE OF c` : sql``}`.execute(trx);
    const row = r.rows[0];
    if (!row) throw Errors.notFound("Count");
    return row;
  }

  private async lockDraft(trx: Trx, org: OrgContext, branchId: string, countId: string): Promise<CountRow> {
    await this.expireOld(trx, org.orgId, branchId);
    const c = await this.load(trx, org, branchId, countId, true);
    if (c.status !== "draft")
      throw Errors.conflict(
        c.status === "finalized"
          ? "This count is already finished."
          : "This count expired or was cancelled. Start a new one.",
      );
    return c;
  }

  /** A count left open for a week is closed without changing any stock (docs/01 T6). */
  private async expireOld(trx: Trx, orgId: string, branchId: string) {
    await sql`UPDATE stock_count SET status = 'abandoned' WHERE org_id = ${orgId} AND branch_id = ${branchId} AND status = 'draft' AND expires_at < now()`.execute(
      trx,
    );
  }

  private async detail(trx: Trx, org: OrgContext, countId: string): Promise<CountDetail> {
    const r =
      await sql<CountRow>`${this.countSelect()} WHERE c.org_id = ${org.orgId} AND c.id = ${countId}`.execute(
        trx,
      );
    const c = r.rows[0];
    if (!c) throw Errors.notFound("Count");
    const lines = await sql<{
      product_id: string;
      name: string;
      unit: string;
      allow_fraction: boolean;
      counted: string;
      counted_at: Date;
      expected: string;
    }>`SELECT l.product_id, p.name, p.unit, p.allow_fraction, l.counted_qty::text AS counted, l.counted_at,
              COALESCE((SELECT sum(m.qty_delta) FROM stock_movement m
                         WHERE m.org_id = ${org.orgId} AND m.branch_id = ${c.branch_id} AND m.product_id = l.product_id
                           AND m.bucket = 'on_hand' AND m.occurred_at <= l.counted_at), 0)::text AS expected
         FROM (SELECT DISTINCT ON (product_id) product_id, counted_qty, counted_at FROM stock_count_line
                WHERE count_id = ${countId} ORDER BY product_id, counted_at DESC, id) l
         JOIN product p ON p.org_id = ${org.orgId} AND p.id = l.product_id
        ORDER BY l.counted_at DESC, p.name`.execute(trx);
    const mapped = lines.rows.map((l) => {
      const counted = Number(l.counted);
      const expected = Number(l.expected);
      return {
        productId: l.product_id,
        name: l.name,
        unit: l.unit,
        allowFraction: l.allow_fraction,
        counted,
        countedAt: isoReq(l.counted_at),
        expected,
        difference: Math.round((counted - expected) * 1000) / 1000,
      };
    });
    return { ...mapCount(c), lines: mapped, corrections: mapped.filter((l) => l.difference !== 0).length };
  }

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
}

function mapCount(r: CountRow): Count {
  return {
    id: r.id,
    branchId: r.branch_id,
    branchName: r.branch_name,
    kind: r.kind as Count["kind"],
    status: r.status as Count["status"],
    startedAt: isoReq(r.started_at),
    expiresAt: isoReq(r.expires_at),
    finalizedAt: iso(r.finalized_at),
    startedByName: r.started_by_name,
    lineCount: Number(r.line_count),
  };
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (pgHint(err) === "VERSION_CONFLICT") throw Errors.conflict("This count was already closed.");
    const mapped = Errors.fromHint(pgHint(err), err instanceof Error ? err.message : "");
    throw mapped ?? err;
  }
}
