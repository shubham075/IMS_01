import { type Permission, type Role, uuidSchema } from "@idea01/schemas";
import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { Errors } from "../common/errors";
import { Db } from "../db/db.service";
import type { OrgContext } from "./auth.types";
import { PERMISSIONS_KEY } from "./decorators";

/**
 * For routes under /merchant/orgs/:orgId. Looks the caller up in that organisation (membership, role, permissions,
 * branch scope) and enforces `@Permissions(...)`. Not a member -> 404, so other tenants' ids are never confirmed.
 * A lapsed (read-only) organisation can still be read but not changed.
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.auth;
    if (!auth) throw Errors.authRequired();

    const orgId = (req.params as { orgId?: string }).orgId;
    if (!orgId || !uuidSchema.safeParse(orgId).success) throw Errors.notFound("Organisation");

    const row = await this.db.tx({ userId: auth.userId, orgId }, (trx) =>
      trx
        .selectFrom("membership as m")
        .innerJoin("organization as o", "o.id", "m.org_id")
        .select([
          "m.id as membership_id",
          "m.role_code",
          "m.status as membership_status",
          "o.status as org_status",
          sql<string[]>`array(select permission_code from role_permission where role_code = m.role_code)`.as(
            "permissions",
          ),
          sql<string[]>`array(select branch_id from membership_branch where membership_id = m.id)`.as(
            "branch_ids",
          ),
        ])
        .where("m.org_id", "=", orgId)
        .where("m.user_id", "=", auth.userId)
        .executeTakeFirst(),
    );
    if (!row || row.membership_status !== "active") throw Errors.notFound("Organisation");
    if (row.org_status === "suspended" || row.org_status === "closed")
      throw Errors.suspended("This organisation is suspended.");

    const org: OrgContext = {
      orgId,
      membershipId: row.membership_id,
      role: row.role_code as Role,
      permissions: row.permissions as Permission[],
      branchIds: row.branch_ids,
      orgStatus: row.org_status as OrgContext["orgStatus"],
    };

    const needed =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const missing = needed.filter((p) => !org.permissions.includes(p));
    if (missing.length) throw Errors.permissionDenied();

    if (req.method !== "GET" && req.method !== "HEAD" && org.orgStatus !== "active") {
      throw Errors.entitlement("This organisation is read-only until the subscription is renewed.");
    }
    req.org = org;
    return true;
  }
}
