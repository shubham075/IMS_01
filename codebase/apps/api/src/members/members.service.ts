import { type CreateInvitation, type Invitation, type Member, ROLE_RANK, type Role } from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { Errors } from "../common/errors";
import { iso, isoReq, randomToken, sha256Hex } from "../common/util";
import { Db, type Trx } from "../db/db.service";

type UpdateMember = { role?: Exclude<Role, "owner">; branchIds?: string[]; status?: "active" | "suspended" };

/**
 * Team management. Two rules protect the organisation from privilege escalation:
 *  - you can only grant, change or remove roles that rank below your own (an owner is never touched here);
 *  - a person limited to some branches can only hand out access to a subset of their own branches.
 */
@Injectable()
export class MembersService {
  constructor(private readonly db: Db) {}

  async listMembers(org: OrgContext, userId: string): Promise<Member[]> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const rows = await trx
        .selectFrom("membership as m")
        .innerJoin("app_user as u", "u.id", "m.user_id")
        .select([
          "m.id",
          "m.user_id",
          "m.role_code",
          "m.status",
          "u.display_name",
          "u.phone_e164",
          "u.last_active_at",
          sql<string[]>`array(select branch_id from membership_branch where membership_id = m.id)`.as(
            "branch_ids",
          ),
        ])
        .where("m.org_id", "=", org.orgId)
        .where("m.status", "!=", "removed")
        .orderBy("m.created_at")
        .execute();
      return rows.map((r) => ({
        membershipId: r.id,
        userId: r.user_id,
        displayName: r.display_name,
        phone: r.phone_e164,
        role: r.role_code as Role,
        status: r.status as Member["status"],
        branchIds: r.branch_ids,
        lastActiveAt: iso(r.last_active_at),
      }));
    });
  }

  async updateMember(
    org: OrgContext,
    userId: string,
    membershipId: string,
    dto: UpdateMember,
  ): Promise<Member> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const target = await this.target(trx, org, membershipId);
      if (target.user_id === userId) throw Errors.permissionDenied("You cannot change your own access.");
      this.assertOutranks(org, target.role_code as Role);
      if (dto.role) this.assertOutranks(org, dto.role);
      if (dto.branchIds) await this.assertBranches(trx, org, dto.branchIds);

      const patch: Record<string, unknown> = {};
      if (dto.role) patch.role_code = dto.role;
      if (dto.status) patch.status = dto.status;
      if (Object.keys(patch).length)
        await trx.updateTable("membership").set(patch).where("id", "=", membershipId).execute();
      if (dto.branchIds) await this.setBranches(trx, org.orgId, membershipId, dto.branchIds);

      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: dto.role && dto.role !== target.role_code ? "role.changed" : "member.updated",
        targetType: "membership",
        targetId: membershipId,
        meta: { from: target.role_code, to: dto.role, status: dto.status, branches: dto.branchIds?.length },
      });
      return this.loadMember(trx, org.orgId, membershipId);
    });
  }

  /** Removal takes effect on the person's very next request. Their offline work goes to review (decision D-02, later slice). */
  async removeMember(org: OrgContext, userId: string, membershipId: string): Promise<void> {
    await this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const target = await this.target(trx, org, membershipId);
      if (target.user_id === userId)
        throw Errors.permissionDenied("You cannot remove yourself. Ask an owner.");
      this.assertOutranks(org, target.role_code as Role);
      await trx.updateTable("membership").set({ status: "removed" }).where("id", "=", membershipId).execute();
      await trx.deleteFrom("membership_branch").where("membership_id", "=", membershipId).execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "staff.removed",
        targetType: "membership",
        targetId: membershipId,
        meta: { role: target.role_code },
      });
    });
  }

  async listInvitations(org: OrgContext, userId: string): Promise<Invitation[]> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const rows = await trx
        .selectFrom("invitation")
        .selectAll()
        .where("org_id", "=", org.orgId)
        .where("accepted_at", "is", null)
        .orderBy("created_at", "desc")
        .execute();
      return rows.map(mapInvitation);
    });
  }

  async invite(org: OrgContext, userId: string, dto: CreateInvitation): Promise<Invitation> {
    this.assertOutranks(org, dto.role);
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      await this.assertBranches(trx, org, dto.branchIds);

      const user = await trx
        .selectFrom("app_user")
        .select("id")
        .where("phone_e164", "=", dto.phone)
        .executeTakeFirst();
      if (user) {
        const m = await trx
          .selectFrom("membership")
          .select("status")
          .where("org_id", "=", org.orgId)
          .where("user_id", "=", user.id)
          .executeTakeFirst();
        if (m && m.status !== "removed") throw Errors.duplicate("This person is already part of the team.");
      }
      // An expired, never-accepted invitation must not block a fresh one.
      await trx
        .deleteFrom("invitation")
        .where("org_id", "=", org.orgId)
        .where("phone_e164", "=", dto.phone)
        .where("accepted_at", "is", null)
        .where("expires_at", "<=", sql<Date>`now()`)
        .execute();
      const open = await trx
        .selectFrom("invitation")
        .select("id")
        .where("org_id", "=", org.orgId)
        .where("phone_e164", "=", dto.phone)
        .where("accepted_at", "is", null)
        .executeTakeFirst();
      if (open)
        throw Errors.duplicate(
          "This number already has an open invitation. Cancel it first to send a new one.",
        );

      const row = await trx
        .insertInto("invitation")
        .values({
          org_id: org.orgId,
          phone_e164: dto.phone,
          role_code: dto.role,
          branch_ids: dto.branchIds,
          // The token is for a future deep link in the SMS; acceptance today works by phone number after OTP login.
          token_hash: sha256Hex(randomToken(32)),
          invited_by: userId,
        })
        .returning(["id", "phone_e164", "role_code", "branch_ids", "expires_at", "created_at", "accepted_at"])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "invitation.created",
        targetType: "invitation",
        targetId: row.id,
        meta: { role: dto.role },
      });
      return mapInvitation(row);
    });
  }

  async cancelInvitation(org: OrgContext, userId: string, invitationId: string): Promise<void> {
    await this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const inv = await trx
        .selectFrom("invitation")
        .select("role_code")
        .where("org_id", "=", org.orgId)
        .where("id", "=", invitationId)
        .where("accepted_at", "is", null)
        .executeTakeFirst();
      if (!inv) throw Errors.notFound("Invitation");
      this.assertOutranks(org, inv.role_code as Role);
      await trx.deleteFrom("invitation").where("id", "=", invitationId).execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "invitation.cancelled",
        targetType: "invitation",
        targetId: invitationId,
      });
    });
  }

  /* ---------------- helpers ---------------- */
  private assertOutranks(org: OrgContext, role: Role) {
    if (ROLE_RANK[role] >= ROLE_RANK[org.role])
      throw Errors.permissionDenied("You can only manage roles below your own.");
  }

  private async target(trx: Trx, org: OrgContext, membershipId: string) {
    const t = await trx
      .selectFrom("membership")
      .select(["id", "user_id", "role_code", "status"])
      .where("org_id", "=", org.orgId)
      .where("id", "=", membershipId)
      .where("status", "!=", "removed")
      .executeTakeFirst();
    if (!t) throw Errors.notFound("Team member");
    if (t.role_code === "owner")
      throw Errors.permissionDenied("An owner's access can only be changed through ownership transfer.");
    return t;
  }

  /** Branch ids must exist in this org; a branch-limited actor can only grant a non-empty subset of their own branches. */
  private async assertBranches(trx: Trx, org: OrgContext, branchIds: string[]) {
    if (org.branchIds.length) {
      if (!branchIds.length) throw Errors.branchOutOfScope();
      if (branchIds.some((b) => !org.branchIds.includes(b))) throw Errors.branchOutOfScope();
    }
    if (!branchIds.length) return;
    const found = await trx
      .selectFrom("branch")
      .select("id")
      .where("org_id", "=", org.orgId)
      .where("id", "in", branchIds)
      .execute();
    if (found.length !== new Set(branchIds).size)
      throw Errors.validation([{ path: "branchIds", message: "One or more branches do not exist." }]);
  }

  private async setBranches(trx: Trx, orgId: string, membershipId: string, branchIds: string[]) {
    await trx.deleteFrom("membership_branch").where("membership_id", "=", membershipId).execute();
    if (branchIds.length) {
      await trx
        .insertInto("membership_branch")
        .values(
          [...new Set(branchIds)].map((b) => ({ org_id: orgId, membership_id: membershipId, branch_id: b })),
        )
        .execute();
    }
  }

  private async loadMember(trx: Trx, orgId: string, membershipId: string): Promise<Member> {
    const r = await trx
      .selectFrom("membership as m")
      .innerJoin("app_user as u", "u.id", "m.user_id")
      .select([
        "m.id",
        "m.user_id",
        "m.role_code",
        "m.status",
        "u.display_name",
        "u.phone_e164",
        "u.last_active_at",
        sql<string[]>`array(select branch_id from membership_branch where membership_id = m.id)`.as(
          "branch_ids",
        ),
      ])
      .where("m.org_id", "=", orgId)
      .where("m.id", "=", membershipId)
      .executeTakeFirstOrThrow();
    return {
      membershipId: r.id,
      userId: r.user_id,
      displayName: r.display_name,
      phone: r.phone_e164,
      role: r.role_code as Role,
      status: r.status as Member["status"],
      branchIds: r.branch_ids,
      lastActiveAt: iso(r.last_active_at),
    };
  }
}

export function mapInvitation(r: {
  id: string;
  phone_e164: string;
  role_code: string;
  branch_ids: string[];
  expires_at: Date;
  created_at: Date;
  accepted_at: Date | null;
}): Invitation {
  const expired = new Date(r.expires_at).getTime() <= Date.now();
  return {
    id: r.id,
    phone: r.phone_e164,
    role: r.role_code as Role,
    branchIds: r.branch_ids,
    expiresAt: isoReq(r.expires_at),
    createdAt: isoReq(r.created_at),
    status: r.accepted_at ? "accepted" : expired ? "expired" : "pending",
  };
}
