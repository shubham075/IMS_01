import type { MeResponse, Role } from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { AuthService } from "../auth/auth.service";
import type { AuthContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { Errors } from "../common/errors";
import { isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";

@Injectable()
export class MeService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  async me(auth: AuthContext): Promise<MeResponse> {
    const ctx = { userId: auth.userId, phone: auth.phone };
    const user = await this.auth.profile(this.db.kysely, auth.userId);
    const memberships = await this.db.tx(ctx, (trx) =>
      trx
        .selectFrom("membership as m")
        .select(["m.id", "m.org_id", "m.role_code"])
        .where("m.user_id", "=", auth.userId)
        .where("m.status", "=", "active")
        .orderBy("m.created_at")
        .execute(),
    );
    const named: MeResponse["memberships"] = [];
    for (const m of memberships) {
      // Branch scope rows are tenant data: they are only visible with that organisation's context set.
      const detail = await this.db.tx({ ...ctx, orgId: m.org_id }, async (t) => ({
        org: await t.selectFrom("organization").select("name").where("id", "=", m.org_id).executeTakeFirst(),
        branches: await t
          .selectFrom("membership_branch")
          .select("branch_id")
          .where("membership_id", "=", m.id)
          .execute(),
      }));
      if (detail.org)
        named.push({
          orgId: m.org_id,
          orgName: detail.org.name,
          role: m.role_code as Role,
          branchIds: detail.branches.map((b) => b.branch_id),
        });
    }
    return { user, memberships: named, pendingInvitations: await this.pendingInvitations(auth) };
  }

  async updateProfile(auth: AuthContext, patch: { displayName?: string; locale?: "en" | "hi" }) {
    await this.db.tx({ userId: auth.userId }, async (trx) => {
      const set: Record<string, unknown> = {};
      if (patch.displayName !== undefined) set.display_name = patch.displayName;
      if (patch.locale !== undefined) set.locale = patch.locale;
      await trx.updateTable("app_user").set(set).where("id", "=", auth.userId).execute();
      await writeAudit(trx, {
        actorUserId: auth.userId,
        action: "profile.updated",
        meta: { fields: Object.keys(set) },
      });
    });
    return this.auth.profile(this.db.kysely, auth.userId);
  }

  async pendingInvitations(auth: AuthContext): Promise<MeResponse["pendingInvitations"]> {
    if (!auth.phone) return [];
    return this.db.tx({ userId: auth.userId, phone: auth.phone }, async (trx) => {
      const rows = await trx
        .selectFrom("invitation as i")
        .innerJoin("organization as o", "o.id", "i.org_id")
        .select(["i.id", "i.org_id", "o.name as org_name", "i.role_code", "i.expires_at"])
        .where("i.accepted_at", "is", null)
        .where("i.expires_at", ">", sql<Date>`now()`)
        .orderBy("i.created_at", "desc")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        orgId: r.org_id,
        orgName: r.org_name,
        role: r.role_code as Role,
        expiresAt: isoReq(r.expires_at),
      }));
    });
  }

  /** The invitee proves they own the number by having logged in with an OTP; the invitation row is only visible to that phone. */
  async acceptInvitation(
    auth: AuthContext,
    invitationId: string,
  ): Promise<MeResponse["memberships"][number]> {
    if (!auth.phone) throw Errors.notFound("Invitation");
    return this.db.tx({ userId: auth.userId, phone: auth.phone }, async (trx) => {
      const inv = await trx
        .selectFrom("invitation")
        .selectAll()
        .where("id", "=", invitationId)
        .where("accepted_at", "is", null)
        .executeTakeFirst();
      if (!inv) throw Errors.notFound("Invitation");
      if (new Date(inv.expires_at).getTime() <= Date.now())
        throw Errors.conflict("This invitation has expired. Ask for a new one.");

      await Db.setContext(trx, { userId: auth.userId, phone: auth.phone, orgId: inv.org_id });
      const member = await this.activateMembership(
        trx,
        inv.org_id,
        auth.userId,
        inv.role_code,
        inv.branch_ids,
      );
      await trx
        .updateTable("invitation")
        .set({ accepted_at: sql<Date>`now()` })
        .where("id", "=", inv.id)
        .execute();
      await writeAudit(trx, {
        orgId: inv.org_id,
        actorUserId: auth.userId,
        action: "invitation.accepted",
        targetType: "invitation",
        targetId: inv.id,
        meta: { role: inv.role_code },
      });
      const org = await trx
        .selectFrom("organization")
        .select("name")
        .where("id", "=", inv.org_id)
        .executeTakeFirstOrThrow();
      return {
        orgId: inv.org_id,
        orgName: org.name,
        role: inv.role_code as Role,
        branchIds: member.branchIds,
      };
    });
  }

  async declineInvitation(auth: AuthContext, invitationId: string): Promise<void> {
    if (!auth.phone) throw Errors.notFound("Invitation");
    await this.db.tx({ userId: auth.userId, phone: auth.phone }, async (trx) => {
      const done = await trx
        .updateTable("invitation")
        .set({ expires_at: sql<Date>`now()` })
        .where("id", "=", invitationId)
        .where("accepted_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!done) throw Errors.notFound("Invitation");
    });
  }

  private async activateMembership(
    trx: Trx,
    orgId: string,
    userId: string,
    role: string,
    branchIds: string[],
  ) {
    // Re-joining after removal re-activates the old row; an already-active member is never downgraded by an invitation.
    const row = await trx
      .insertInto("membership")
      .values({ org_id: orgId, user_id: userId, role_code: role, status: "active" })
      .onConflict((oc) =>
        oc
          .columns(["org_id", "user_id"])
          .doUpdateSet({ role_code: role, status: "active" })
          .where("membership.status", "!=", "active"),
      )
      .returning("id")
      .executeTakeFirst();
    if (!row) throw Errors.duplicate("You are already part of this team.");
    await trx.deleteFrom("membership_branch").where("membership_id", "=", row.id).execute();
    if (branchIds.length) {
      await trx
        .insertInto("membership_branch")
        .values(branchIds.map((b) => ({ org_id: orgId, membership_id: row.id, branch_id: b })))
        .execute();
    }
    return { membershipId: row.id, branchIds };
  }
}
