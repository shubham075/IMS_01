"use server";

import { unwrap } from "@idea01/api-client";
import {
  type Branch,
  type CreateBranch,
  createBranchSchema,
  createOrgSchema,
  type Org,
  updateBranchSchema,
  updateOrgSchema,
} from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import { ORG_COOKIE, refreshCookieMaxAge, tokenCookie } from "@/lib/cookies";
import { authedApi } from "@/lib/server/api";
import { run } from "@/lib/server/run";

/** `idempotencyKey` is generated once per form, so a double-click or a retry never creates two shops. */
export async function createOrgAction(input: unknown, idempotencyKey: string): Promise<ActionResult<Org>> {
  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const org = await unwrap(
      api.POST("/v1/merchant/orgs", { body: parsed.data, headers: { "idempotency-key": idempotencyKey } }),
    );
    (await cookies()).set(ORG_COOKIE, org.id, { ...tokenCookie, maxAge: refreshCookieMaxAge });
    revalidatePath("/", "layout");
    return org;
  });
}

export async function updateOrgAction(orgId: string, input: unknown): Promise<ActionResult<Org>> {
  const parsed = updateOrgSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const org = await unwrap(
      api.PATCH("/v1/merchant/orgs/{orgId}", { params: { path: { orgId } }, body: parsed.data }),
    );
    revalidatePath("/app", "layout");
    return org;
  });
}

export async function createBranchAction(
  orgId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<ActionResult<Branch>> {
  const parsed = createBranchSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const branch = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/branches", {
        params: { path: { orgId } },
        body: parsed.data as CreateBranch,
        headers: { "idempotency-key": idempotencyKey },
      }),
    );
    revalidatePath("/app", "layout");
    return branch;
  });
}

export async function updateBranchAction(
  orgId: string,
  branchId: string,
  input: unknown,
): Promise<ActionResult<Branch>> {
  const parsed = updateBranchSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const branch = await unwrap(
      api.PATCH("/v1/merchant/orgs/{orgId}/branches/{branchId}", {
        params: { path: { orgId, branchId } },
        body: parsed.data,
      }),
    );
    revalidatePath("/app", "layout");
    return branch;
  });
}
