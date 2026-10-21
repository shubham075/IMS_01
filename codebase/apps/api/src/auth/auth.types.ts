import type { Permission, Role } from "@idea01/schemas";

/** Set by AuthGuard on every authenticated request. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  phone: string | null;
}

/** Set by OrgAccessGuard on routes under /merchant/orgs/:orgId. */
export interface OrgContext {
  orgId: string;
  membershipId: string;
  role: Role;
  permissions: Permission[];
  /** Empty = all branches. */
  branchIds: string[];
  orgStatus: "active" | "read_only" | "suspended" | "closing" | "closed";
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    org?: OrgContext;
  }
}
