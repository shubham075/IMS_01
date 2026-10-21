import type {
  CreateTransfer,
  ListTransfersQuery,
  ReceiveTransfer,
  SetTransferLines,
  Transfer,
  TransferDetail,
  TransferPage,
} from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { AppError, Errors, pgHint } from "../common/errors";
import { iso, isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";

interface Row {
  id: string;
  org_id: string;
  from_branch: string;
  to_branch: string;
  from_name: string;
  to_name: string;
  status: string;
  note: string | null;
  created_at: Date;
  dispatched_at: Date | null;
  received_at: Date | null;
  created_by_name: string | null;
  line_count: string;
}

/** Branch transfers: draft -> sent (stock leaves the source, "in transit") -> received (what arrived; a shortage is booked as a loss). */
@Injectable()
export class TransfersService {
  constructor(private readonly db: Db) {}

  async list(org: OrgContext, userId: string, q: ListTransfersQuery): Promise<TransferPage> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const scope = org.branchIds.length
        ? sql`AND (t.from_branch IN (${sql.join(org.branchIds)}) OR t.to_branch IN (${sql.join(org.branchIds)}))`
        : sql``;
      const where = sql`t.org_id = ${org.orgId} ${scope}
        ${q.status ? sql`AND t.status = ${q.status}` : sql``}
        ${q.branchId ? sql`AND (t.from_branch = ${q.branchId} OR t.to_branch = ${q.branchId})` : sql``}`;
      const total = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM stock_transfer t WHERE ${where}`.execute(trx);
      const rows = await sql<Row>`
        ${this.selectSql()} WHERE ${where} ORDER BY t.created_at DESC, t.id LIMIT ${q.limit} OFFSET ${q.offset}`.execute(
        trx,
      );
      return {
        items: rows.rows.map(mapTransfer),
        total: Number(total.rows[0]?.n ?? 0),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  async get(org: OrgContext, userId: string, id: string): Promise<TransferDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const t = await this.load(trx, org, id);
      this.assertEither(org, t);
      return this.detail(trx, org, id);
    });
  }

  async create(org: OrgContext, userId: string, dto: CreateTransfer): Promise<TransferDetail> {
    this.assertBranch(org, dto.fromBranchId);
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      await this.assertBranches(trx, org.orgId, [dto.fromBranchId, dto.toBranchId]);
      await this.assertLines(trx, org.orgId, dto.lines);
      const t = await trx
        .insertInto("stock_transfer")
        .values({
          org_id: org.orgId,
          from_branch: dto.fromBranchId,
          to_branch: dto.toBranchId,
          note: dto.note ?? null,
          created_by: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await this.writeLines(trx, org.orgId, t.id, dto.lines);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "transfer.created",
        targetType: "stock_transfer",
        targetId: t.id,
      });
      return this.detail(trx, org, t.id);
    });
  }

  async setLines(
    org: OrgContext,
    userId: string,
    id: string,
    dto: SetTransferLines,
  ): Promise<TransferDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const t = await this.load(trx, org, id, true);
      this.assertBranch(org, t.from_branch);
      if (t.status !== "draft") throw Errors.conflict("Only a draft transfer can be changed.");
      await this.assertLines(trx, org.orgId, dto.lines);
      await trx.deleteFrom("stock_transfer_line").where("transfer_id", "=", id).execute();
      await this.writeLines(trx, org.orgId, id, dto.lines);
      return this.detail(trx, org, id);
    });
  }

  async cancel(org: OrgContext, userId: string, id: string): Promise<TransferDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const t = await this.load(trx, org, id, true);
      this.assertBranch(org, t.from_branch);
      if (t.status === "cancelled") return this.detail(trx, org, id);
      if (t.status !== "draft")
        throw Errors.conflict("Only a draft transfer can be cancelled. Stock already left.");
      await trx.updateTable("stock_transfer").set({ status: "cancelled" }).where("id", "=", id).execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "transfer.cancelled",
        targetType: "stock_transfer",
        targetId: id,
      });
      return this.detail(trx, org, id);
    });
  }

  /** Stock leaves the sending branch. It may go negative there (flagged for a check, like any sale). */
  async dispatch(org: OrgContext, userId: string, id: string): Promise<TransferDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const t = await this.load(trx, org, id, true);
      this.assertBranch(org, t.from_branch);
      if (t.status === "dispatched" || t.status === "received") return this.detail(trx, org, id); // a retry
      if (t.status !== "draft") throw Errors.conflict("This transfer was cancelled.");
      const n = await trx
        .selectFrom("stock_transfer_line")
        .select(sql<string>`count(*)`.as("n"))
        .where("transfer_id", "=", id)
        .executeTakeFirstOrThrow();
      if (Number(n.n) === 0)
        throw Errors.validation([{ path: "lines", message: "Add at least one product." }]);
      await this.assertLinesActive(trx, org.orgId, id);
      await guarded(() =>
        sql`SELECT dispatch_stock_transfer(${org.orgId}::uuid, ${id}::uuid, ${userId}::uuid)`.execute(trx),
      );
      await this.refreshListings(trx, id, [t.from_branch]);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "transfer.dispatched",
        targetType: "stock_transfer",
        targetId: id,
      });
      return this.detail(trx, org, id);
    });
  }

  /** The receiving branch says what arrived. Nothing can arrive that was not sent; the rest is booked as a shortage. */
  async receive(org: OrgContext, userId: string, id: string, dto: ReceiveTransfer): Promise<TransferDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const t = await this.load(trx, org, id, true);
      this.assertBranch(org, t.to_branch);
      if (t.status === "received") return this.detail(trx, org, id); // a retry
      if (t.status !== "dispatched")
        throw Errors.conflict("This transfer has not been sent yet, or was cancelled.");
      const lines = await trx
        .selectFrom("stock_transfer_line as l")
        .innerJoin("product as p", (j) =>
          j.onRef("p.org_id", "=", "l.org_id").onRef("p.id", "=", "l.product_id"),
        )
        .select(["l.product_id", "l.qty_sent", "p.allow_fraction", "p.name"])
        .where("l.transfer_id", "=", id)
        .execute();
      const byId = new Map(lines.map((l) => [l.product_id, l]));
      const received: Record<string, number> = {};
      const problems: Array<{ path: string; message: string }> = [];
      for (const r of dto.received) {
        const line = byId.get(r.productId);
        if (!line) {
          problems.push({
            path: `received.${r.productId}`,
            message: "This product is not part of the transfer.",
          });
          continue;
        }
        if (received[r.productId] !== undefined)
          problems.push({ path: `received.${r.productId}`, message: "This product is listed twice." });
        if (r.quantity > Number(line.qty_sent))
          problems.push({
            path: `received.${r.productId}`,
            message: `More arrived than was sent (${line.qty_sent}). Fix the sent amount first.`,
          });
        if (!line.allow_fraction && r.quantity !== Math.trunc(r.quantity))
          problems.push({
            path: `received.${r.productId}`,
            message: "This product is counted in whole units.",
          });
        if (Math.abs(r.quantity * 1000 - Math.round(r.quantity * 1000)) > 1e-6)
          problems.push({ path: `received.${r.productId}`, message: "Use at most 3 decimal places." });
        received[r.productId] = r.quantity;
      }
      if (problems.length) throw Errors.validation(problems);
      await guarded(() =>
        sql`SELECT receive_stock_transfer(${org.orgId}::uuid, ${id}::uuid, ${userId}::uuid, ${JSON.stringify(received)}::jsonb)`.execute(
          trx,
        ),
      );
      await this.refreshListings(trx, id, [t.from_branch, t.to_branch]);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "transfer.received",
        targetType: "stock_transfer",
        targetId: id,
        meta: {
          shortages: lines.filter((l) => (received[l.product_id] ?? Number(l.qty_sent)) < Number(l.qty_sent))
            .length,
        },
      });
      return this.detail(trx, org, id);
    });
  }

  // ---------- helpers ----------

  private selectSql() {
    return sql`
      SELECT t.id, t.org_id, t.from_branch, t.to_branch, fb.name AS from_name, tb.name AS to_name, t.status, t.note,
             t.created_at, t.dispatched_at, t.received_at, u.display_name AS created_by_name,
             (SELECT count(*) FROM stock_transfer_line l WHERE l.transfer_id = t.id) AS line_count
        FROM stock_transfer t
        JOIN branch fb ON fb.org_id = t.org_id AND fb.id = t.from_branch
        JOIN branch tb ON tb.org_id = t.org_id AND tb.id = t.to_branch
        LEFT JOIN app_user u ON u.id = t.created_by`;
  }

  private async load(trx: Trx, org: OrgContext, id: string, lock = false): Promise<Row> {
    const r = await sql<Row>`${this.selectSql()} WHERE t.org_id = ${org.orgId} AND t.id = ${id} ${
      lock ? sql`FOR UPDATE OF t` : sql``
    }`.execute(trx);
    const row = r.rows[0];
    if (!row) throw Errors.notFound("Transfer");
    // A person limited to some branches cannot even see transfers between other branches.
    if (
      org.branchIds.length &&
      !org.branchIds.includes(row.from_branch) &&
      !org.branchIds.includes(row.to_branch)
    )
      throw Errors.notFound("Transfer");
    return row;
  }

  private async detail(trx: Trx, org: OrgContext, id: string): Promise<TransferDetail> {
    const t = await this.load(trx, org, id);
    const lines = await sql<{
      product_id: string;
      name: string;
      unit: string;
      allow_fraction: boolean;
      qty_sent: string;
      qty_received: string | null;
      source_on_hand: string | null;
    }>`SELECT l.product_id, p.name, p.unit, p.allow_fraction, l.qty_sent::text, l.qty_received::text,
              ib.on_hand::text AS source_on_hand
         FROM stock_transfer_line l
         JOIN product p ON p.org_id = l.org_id AND p.id = l.product_id
         LEFT JOIN inventory_balance ib ON ib.branch_id = ${t.from_branch} AND ib.product_id = l.product_id
        WHERE l.transfer_id = ${id} ORDER BY lower(p.name), l.product_id`.execute(trx);
    return {
      ...mapTransfer(t),
      note: t.note,
      createdByName: t.created_by_name,
      lines: lines.rows.map((l) => ({
        productId: l.product_id,
        name: l.name,
        unit: l.unit,
        allowFraction: l.allow_fraction,
        qtySent: Number(l.qty_sent),
        qtyReceived: l.qty_received === null ? null : Number(l.qty_received),
        sourceOnHand: Number(l.source_on_hand ?? 0),
      })),
    };
  }

  private assertBranch(org: OrgContext, branchId: string) {
    if (org.branchIds.length && !org.branchIds.includes(branchId)) throw Errors.branchOutOfScope();
  }
  private assertEither(org: OrgContext, t: Row) {
    if (
      org.branchIds.length &&
      !org.branchIds.includes(t.from_branch) &&
      !org.branchIds.includes(t.to_branch)
    )
      throw Errors.notFound("Transfer");
  }

  private async assertBranches(trx: Trx, orgId: string, ids: string[]) {
    const found = await trx
      .selectFrom("branch")
      .select(["id", "status"])
      .where("org_id", "=", orgId)
      .where("id", "in", ids)
      .execute();
    if (found.length !== new Set(ids).size) throw Errors.notFound("Branch");
    if (found.some((b) => b.status !== "active"))
      throw Errors.validation([
        { path: "toBranchId", message: "A switched-off branch cannot take part in a transfer." },
      ]);
  }

  /** Every product must be a counted, active product of this shop, in a unit that allows the quantity. */
  private async assertLines(trx: Trx, orgId: string, lines: Array<{ productId: string; quantity: number }>) {
    const ps = await trx
      .selectFrom("product")
      .select(["id", "status", "tracking_mode", "allow_fraction"])
      .where("org_id", "=", orgId)
      .where(
        "id",
        "in",
        lines.map((l) => l.productId),
      )
      .execute();
    const byId = new Map(ps.map((p) => [p.id, p]));
    const problems: Array<{ path: string; message: string }> = [];
    lines.forEach((l, i) => {
      const p = byId.get(l.productId);
      if (!p || p.status === "merged")
        problems.push({ path: `lines.${i}.productId`, message: "Product not found." });
      else if (p.status !== "active")
        problems.push({
          path: `lines.${i}.productId`,
          message: "Switch the product on before transferring it.",
        });
      else if (p.tracking_mode !== "quantity")
        problems.push({
          path: `lines.${i}.productId`,
          message: "This product is not counted, so it cannot be transferred.",
        });
      else if (!p.allow_fraction && l.quantity !== Math.trunc(l.quantity))
        problems.push({ path: `lines.${i}.quantity`, message: "This product is counted in whole units." });
    });
    if (problems.length) throw Errors.validation(problems);
  }

  private async assertLinesActive(trx: Trx, orgId: string, id: string) {
    const bad = await trx
      .selectFrom("stock_transfer_line as l")
      .innerJoin("product as p", (j) =>
        j.onRef("p.org_id", "=", "l.org_id").onRef("p.id", "=", "l.product_id"),
      )
      .select("p.name")
      .where("l.transfer_id", "=", id)
      .where("l.org_id", "=", orgId)
      .where((eb) => eb.or([eb("p.status", "<>", "active"), eb("p.tracking_mode", "<>", "quantity")]))
      .execute();
    if (bad.length)
      throw Errors.validation([
        {
          path: "lines",
          message: `These products are switched off or not counted now: ${bad.map((b) => b.name).join(", ")}.`,
        },
      ]);
  }

  private async writeLines(
    trx: Trx,
    orgId: string,
    id: string,
    lines: Array<{ productId: string; quantity: number }>,
  ) {
    await trx
      .insertInto("stock_transfer_line")
      .values(
        lines.map((l) => ({
          org_id: orgId,
          transfer_id: id,
          product_id: l.productId,
          qty_sent: String(l.quantity),
        })),
      )
      .execute();
  }

  private async refreshListings(trx: Trx, transferId: string, branchIds: string[]) {
    const ps = await trx
      .selectFrom("stock_transfer_line")
      .select("product_id")
      .where("transfer_id", "=", transferId)
      .execute();
    for (const b of branchIds)
      for (const p of ps)
        await sql`SELECT refresh_public_listing(${b}::uuid, ${p.product_id}::uuid)`.execute(trx);
  }
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (pgHint(err) === "VERSION_CONFLICT")
      throw Errors.conflict("This transfer changed in the meantime. Refresh and try again.");
    const mapped = Errors.fromHint(pgHint(err), err instanceof Error ? err.message : "");
    throw mapped ?? err;
  }
}

function mapTransfer(r: Row): Transfer {
  return {
    id: r.id,
    fromBranchId: r.from_branch,
    fromBranchName: r.from_name,
    toBranchId: r.to_branch,
    toBranchName: r.to_name,
    status: r.status as Transfer["status"],
    lineCount: Number(r.line_count),
    createdAt: isoReq(r.created_at),
    dispatchedAt: iso(r.dispatched_at),
    receivedAt: iso(r.received_at),
  };
}
