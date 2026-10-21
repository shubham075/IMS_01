import type { Branch, CreateBranch, Hours } from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { type Expression, sql } from "kysely";
import type { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { Errors } from "../common/errors";
import { isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";

type UpdateBranch = Partial<CreateBranch>;

const point = (lat: number, lng: number): Expression<string> =>
  sql<string>`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

@Injectable()
export class BranchesService {
  constructor(private readonly db: Db) {}

  async list(org: OrgContext, userId: string): Promise<Branch[]> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      let q = this.select(trx).where("b.org_id", "=", org.orgId).orderBy("b.created_at");
      if (org.branchIds.length) q = q.where("b.id", "in", org.branchIds);
      return (await q.execute()).map(mapBranch);
    });
  }

  async get(org: OrgContext, userId: string, branchId: string): Promise<Branch> {
    this.assertScope(org, branchId);
    return this.db.tx({ userId, orgId: org.orgId }, (trx) => this.load(trx, org.orgId, branchId));
  }

  async create(org: OrgContext, userId: string, dto: CreateBranch): Promise<Branch> {
    // A person limited to some branches cannot create new ones (and does not hold branch.manage in practice).
    if (org.branchIds.length) throw Errors.permissionDenied();
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const row = await trx
        .insertInto("branch")
        .values({
          org_id: org.orgId,
          name: dto.name,
          address_line: dto.addressLine,
          area: dto.area ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          pincode: dto.pincode,
          geo: dto.location ? point(dto.location.lat, dto.location.lng) : null,
          hours: JSON.stringify(dto.hours ?? {}),
          hours_verified: dto.hours !== undefined, // verified = the merchant confirmed them
          phone_public: dto.phonePublic ?? null,
          whatsapp_public: dto.contactOptions.includes("whatsapp") ? (dto.phonePublic ?? null) : null,
          contact_options: dto.contactOptions,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "branch.created",
        targetType: "branch",
        targetId: row.id,
      });
      return this.load(trx, org.orgId, row.id);
    });
  }

  async update(org: OrgContext, userId: string, branchId: string, dto: UpdateBranch): Promise<Branch> {
    this.assertScope(org, branchId);
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const patch: Record<string, unknown> = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.addressLine !== undefined) patch.address_line = dto.addressLine;
      if (dto.area !== undefined) patch.area = dto.area;
      if (dto.city !== undefined) patch.city = dto.city;
      if (dto.state !== undefined) patch.state = dto.state;
      if (dto.pincode !== undefined) patch.pincode = dto.pincode;
      if (dto.location !== undefined)
        patch.geo = dto.location ? point(dto.location.lat, dto.location.lng) : null;
      if (dto.hours !== undefined) {
        patch.hours = JSON.stringify(dto.hours);
        patch.hours_verified = true;
      }
      if (dto.phonePublic !== undefined) patch.phone_public = dto.phonePublic;
      if (dto.contactOptions !== undefined) patch.contact_options = dto.contactOptions;
      if (dto.phonePublic !== undefined || dto.contactOptions !== undefined) {
        const cur = await trx
          .selectFrom("branch")
          .select(["phone_public", "contact_options"])
          .where("id", "=", branchId)
          .executeTakeFirst();
        if (!cur) throw Errors.notFound("Branch");
        const phone = dto.phonePublic !== undefined ? dto.phonePublic : cur.phone_public;
        const options = dto.contactOptions ?? cur.contact_options;
        patch.whatsapp_public = options.includes("whatsapp") ? phone : null;
      }
      const done = await trx
        .updateTable("branch")
        .set(patch)
        .where("id", "=", branchId)
        .returning("id")
        .executeTakeFirst();
      if (!done) throw Errors.notFound("Branch");
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "branch.updated",
        targetType: "branch",
        targetId: branchId,
        meta: { fields: Object.keys(patch) },
      });
      return this.load(trx, org.orgId, branchId);
    });
  }

  private assertScope(org: OrgContext, branchId: string) {
    if (org.branchIds.length && !org.branchIds.includes(branchId)) throw Errors.branchOutOfScope();
  }

  private select(trx: Trx) {
    return trx
      .selectFrom("branch as b")
      .selectAll("b")
      .select([
        sql<number | null>`ST_Y(b.geo::geometry)`.as("lat"),
        sql<number | null>`ST_X(b.geo::geometry)`.as("lng"),
      ]);
  }

  private async load(trx: Trx, orgId: string, branchId: string): Promise<Branch> {
    const row = await this.select(trx)
      .where("b.org_id", "=", orgId)
      .where("b.id", "=", branchId)
      .executeTakeFirst();
    if (!row) throw Errors.notFound("Branch");
    return mapBranch(row);
  }
}

type BranchRow = Awaited<ReturnType<ReturnType<BranchesService["select"]>["execute"]>>[number];

function mapBranch(r: BranchRow): Branch {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    addressLine: r.address_line,
    area: r.area,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    location: r.lat !== null && r.lng !== null ? { lat: Number(r.lat), lng: Number(r.lng) } : null,
    hours: (r.hours ?? {}) as Hours,
    hoursVerified: r.hours_verified,
    phonePublic: r.phone_public,
    contactOptions: r.contact_options as Branch["contactOptions"],
    isPublished: r.is_published,
    status: r.status as Branch["status"],
    createdAt: isoReq(r.created_at),
  };
}
