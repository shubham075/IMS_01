import "server-only";
import { ApiError, unwrap } from "@idea01/api-client";
import type {
  Branch,
  Category,
  CountDetail,
  CountPage,
  ImportJob,
  ImportPage,
  ImportRowPage,
  Invitation,
  ListProductsQuery,
  Member,
  MeResponse,
  MovementPage,
  Org,
  ProductDetail,
  ProductPage,
  StockPage,
  StockSummary,
  TransferDetail,
  TransferPage,
} from "@idea01/schemas";
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

export const loadCategories = cache(async (orgId: string): Promise<Category[]> => {
  const api = await authedApi();
  return unwrap(api.GET("/v1/merchant/orgs/{orgId}/categories", { params: { path: { orgId } } }));
});

export async function loadProducts(orgId: string, query: Partial<ListProductsQuery>): Promise<ProductPage> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/products", {
      params: { path: { orgId }, query: query as Record<string, string | number | undefined> },
    }),
  );
}

export async function loadProduct(orgId: string, productId: string): Promise<ProductDetail> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/products/{productId}", { params: { path: { orgId, productId } } }),
  );
}

export async function loadStock(
  orgId: string,
  branchId: string,
  query: { q?: string; productId?: string; filter?: string; limit?: number; offset?: number },
): Promise<StockPage> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/branches/{branchId}/stock", {
      params: { path: { orgId, branchId }, query: query as Record<string, string | number | undefined> },
    }),
  );
}

export async function loadStockSummary(orgId: string, branchId: string): Promise<StockSummary> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/branches/{branchId}/stock/summary", {
      params: { path: { orgId, branchId } },
    }),
  );
}

export async function loadMovements(
  orgId: string,
  branchId: string,
  query: { productId?: string; limit?: number; offset?: number },
): Promise<MovementPage> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/branches/{branchId}/stock/movements", {
      params: { path: { orgId, branchId }, query },
    }),
  );
}

export async function loadTransfers(
  orgId: string,
  query: { status?: string; limit?: number; offset?: number },
): Promise<TransferPage> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/transfers", {
      params: { path: { orgId }, query: query as Record<string, string | number | undefined> },
    }),
  );
}

export async function loadTransfer(orgId: string, transferId: string): Promise<TransferDetail> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/transfers/{transferId}", { params: { path: { orgId, transferId } } }),
  );
}

export async function loadImports(
  orgId: string,
  query: { limit?: number; offset?: number },
): Promise<ImportPage> {
  const api = await authedApi();
  return unwrap(api.GET("/v1/merchant/orgs/{orgId}/imports", { params: { path: { orgId }, query } }));
}

export async function loadImport(orgId: string, importId: string): Promise<ImportJob> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/imports/{importId}", { params: { path: { orgId, importId } } }),
  );
}

export async function loadImportRows(
  orgId: string,
  importId: string,
  query: { status?: string; limit?: number; offset?: number },
): Promise<ImportRowPage> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/imports/{importId}/rows", {
      params: { path: { orgId, importId }, query: query as Record<string, string | number | undefined> },
    }),
  );
}

export async function loadCounts(
  orgId: string,
  branchId: string,
  query: { status?: string; limit?: number },
): Promise<CountPage> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/branches/{branchId}/counts", {
      params: { path: { orgId, branchId }, query: query as Record<string, string | number | undefined> },
    }),
  );
}

export async function loadCount(orgId: string, branchId: string, countId: string): Promise<CountDetail> {
  const api = await authedApi();
  return unwrap(
    api.GET("/v1/merchant/orgs/{orgId}/branches/{branchId}/counts/{countId}", {
      params: { path: { orgId, branchId, countId } },
    }),
  );
}
