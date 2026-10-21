import type { Permission } from "@idea01/schemas";
import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthContext, OrgContext } from "./auth.types";

export const IS_PUBLIC = "idea01:public";
export const PERMISSIONS_KEY = "idea01:permissions";
export const RATE_LIMIT_KEY = "idea01:rate-limit";
export const IDEMPOTENT_KEY = "idea01:idempotent";

/** Opt out of the global authentication guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Require these permissions in the organisation named by `:orgId` (checked by OrgAccessGuard). */
export const Permissions = (...p: Permission[]) => SetMetadata(PERMISSIONS_KEY, p);
/** Per-client-IP limit for a route (the global default applies otherwise). */
export const RateLimit = (limit: number, windowSeconds: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSeconds });
/** Honour the `Idempotency-Key` header on this POST (replays the first response for the same key and payload). */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

const req = (ctx: ExecutionContext) => ctx.switchToHttp().getRequest<FastifyRequest>();
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => req(ctx).auth!,
);
export const CurrentOrg = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OrgContext => req(ctx).org!,
);
