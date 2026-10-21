import { randomUUID } from "node:crypto";
import type { CreateOrg, Org, Permission, Role } from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { type Selectable, sql } from "kysely";
import { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { Errors } from "../common/errors";
import { isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";
import type { Organization } from "../db/types";

type UpdateOrg = Partial<{
  name: string;
  legalName: string | null;
  category: string;
  gstin: string | null;
  contactPhone: string | null;
}>;

const DEFAULT_ADJUSTMENT_REASONS: Array<[string, "damage" | "expiry" | "adjustment" | "loss" | "found"]> = [
  ["Damaged in shop", "damage"],
  ["Expired", "expiry"],
  ["Counting mistake", "adjustment"],
  ["Lost / theft", "loss"],
  ["Found extra", "found"],
];

@Injectable()
export class OrgsService {
  constructor(private readonly db: Db) {}

  /** Creates the organisation, makes the caller its owner, starts it on the Free plan. One transaction, audited. */
  async create(user: { userId: string; phone: string | null }, dto: CreateOrg): Promise<Org> {
    const orgId = randomUUID();
    return this.db.tx({ userId: user.userId, orgId, phone: user.phone }, async (trx) => {
      await trx
        .insertInto("organization")
        .values({
          id: orgId,
          name: dto.name,
          category: dto.category,
          gstin: dto.gstin ?? null,
          contact_phone: dto.contactPhone ?? user.phone,
          created_by: user.userId,
        })
        .execute();
      await trx
        .insertInto("membership")
        .values({ org_id: orgId, user_id: user.userId, role_code: "owner" })
        .execute();
      await trx
        .insertInto("subscription")
        .values({ org_id: orgId, plan_id: "free", status: "active" })
        .execute();
      await trx
        .insertInto("adjustment_reason")
        .values(DEFAULT_ADJUSTMENT_REASONS.map(([label, reason]) => ({ org_id: orgId, label, reason })))
        .execute();
      await writeAudit(trx, {
        orgId,
        actorUserId: user.userId,
        action: "org.created",
        targetType: "organization",
        targetId: orgId,
        meta: { category: dto.category },
      });
      return this.load(trx, orgId, user.userId);
    });
  }

  /** Organisations the caller belongs to. */
  async listMine(userId: string): Promise<Org[]> {
    const rows = await this.db.tx({ userId }, (trx) =>
      trx
        .selectFrom("membership as m")
        .select("m.org_id")
        .where("m.user_id", "=", userId)
        .where("m.status", "=", "active")
        .orderBy("m.created_at")
        .execute(),
    );
    const out: Org[] = [];
    for (const r of rows) {
      // each org is read under its own context so row-level security evaluates per organisation
      const org = await this.db.tx({ userId, orgId: r.org_id }, (t) => this.load(t, r.org_id, userId));
      if (org.status !== "closed") out.push(org);
    }
    return out;
  }

  async get(org: OrgContext, userId: string): Promise<Org> {
    return this.db.tx({ userId, orgId: org.orgId }, (trx) => this.load(trx, org.orgId, userId));
  }

  async update(org: OrgContext, userId: string, dto: UpdateOrg): Promise<Org> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const patch: Record<string, unknown> = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.legalName !== undefined) patch.legal_name = dto.legalName;
      if (dto.category !== undefined) patch.category = dto.category;
      if (dto.gstin !== undefined) patch.gstin = dto.gstin;
      if (dto.contactPhone !== undefined) patch.contact_phone = dto.contactPhone;
      const done = await trx
        .updateTable("organization")
        .set(patch)
        .where("id", "=", org.orgId)
        .returning("id")
        .executeTakeFirst();
      if (!done) throw Errors.notFound("Organisation");
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "org.updated",
        targetType: "organization",
        targetId: org.orgId,
        meta: { fields: Object.keys(patch) },
      });
      return this.load(trx, org.orgId, userId);
    });
  }

  private async load(trx: Trx, orgId: string, userId: string): Promise<Org> {
    const row = await trx
      .selectFrom("organization as o")
      .innerJoin("membership as m", (j) => j.onRef("m.org_id", "=", "o.id").on("m.user_id", "=", userId))
      .selectAll("o")
      .select([
        "m.role_code",
        sql<
          string[]
        >`array(select permission_code from role_permission where role_code = m.role_code order by 1)`.as(
          "permissions",
        ),
      ])
      .where("o.id", "=", orgId)
      .executeTakeFirst();
    if (!row) throw Errors.notFound("Organisation");
    return mapOrg(row, row.role_code as Role, row.permissions as Permission[]);
  }
}

export function mapOrg(o: Selectable<Organization>, role: Role, permissions: Permission[]): Org {
  return {
    id: o.id,
    name: o.name,
    legalName: o.legal_name,
    category: o.category,
    gstin: o.gstin,
    contactPhone: o.contact_phone,
    status: o.status as Org["status"],
    createdAt: isoReq(o.created_at),
    myRole: role,
    permissions,
  };
}
