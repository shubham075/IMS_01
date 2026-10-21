import "server-only";
import { ApiError, unwrap } from "@idea01/api-client";
import type { Branch, Invitation, Member, MeResponse, Org } from "@idea01/schemas";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ACCESS_COOKIE, ORG_COOKIE } from "../cookies";
import { authedApi } from "./api";

/**
 * Data access layer. This is where authentication is actually enforced (proxy.ts only does early redirects):
 * every page and action asks here, and the API re-checks the token and the caller's role on every call.
 */
export const getSession = cache(async (): Promise<MeResponse | null> => {
  const jar = await cookies();
  if (!jar.get(ACCESS_COOKIE)?.value) return null;
  try {
    const api = await authedApi();
    return await unwrap(api.GET("/v1/me"));
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
});

export async function requireSession(): Promise<MeResponse> {
  const me = await getSession();
  if (!me) redirect("/login");
  return me;
}

export type Membership = MeResponse["memberships"][number];

/** The organisation the user is working in: the remembered one if they still belong to it, else their first. */
export async function activeMembership(me: MeResponse): Promise<Membership | null> {
  const jar = await cookies();
  const wanted = jar.get(ORG_COOKIE)?.value;
  return me.memberships.find((m) => m.orgId === wanted) ?? me.memberships[0] ?? null;
}

/** For console pages: a signed-in user who belongs to an organisation. Others are sent where they can continue. */
export async function requireOrg(): Promise<{ me: MeResponse; membership: Membership }> {
  const me = await requireSession();
  const membership = await activeMembership(me);
  if (!membership) redirect(me.pendingInvitations.length ? "/join" : "/onboarding/shop");
  return { me, membership };
}

export const loadOrg = cache(async (orgId: string): Promise<Org> => {
  const api = await authedApi();
  return unwrap(api.GET("/v1/merchant/orgs/{orgId}", { params: { path: { orgId } } }));
});

export const loadBranches = cache(async (orgId: string): Promise<Branch[]> => {
  const api = await authedApi();
  return unwrap(api.GET("/v1/merchant/orgs/{orgId}/branches", { params: { path: { orgId } } }));
});

export async function loadBranch(orgId: string, branchId: string): Promise<Branch> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/branches/{branchId}", { params: { path: { orgId, branchId } } }),
  );
}

export async function loadTeam(orgId: string): Promise<{ members: Member[]; invitations: Invitation[] }> {
  const api = await authedApi();
  const [members, invitations] = await Promise.all([
    unwrap(api.GET("/v1/merchant/orgs/{orgId}/members", { params: { path: { orgId } } })),
    unwrap(api.GET("/v1/merchant/orgs/{orgId}/invitations", { params: { path: { orgId } } })),
  ]);
  return { members, invitations };
}
