"use server";

import { unwrap } from "@idea01/api-client";
import {
  type CountDetail,
  countLineInputSchema,
  type LookupResult,
  scanCodeSchema,
  startCountSchema,
} from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import { authedApi } from "@/lib/server/api";
import { run } from "@/lib/server/run";

const touch = () => revalidatePath("/app", "layout");

export async function lookupCodeAction(
  orgId: string,
  code: string,
  branchId?: string,
): Promise<ActionResult<LookupResult>> {
  const parsed = scanCodeSchema.safeParse(code);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    return unwrap(
      api.GET("/v1/merchant/orgs/{orgId}/catalogue/lookup", {
        params: { path: { orgId }, query: { code: parsed.data, ...(branchId ? { branchId } : {}) } },
      }),
    );
  });
}

export async function startCountAction(
  orgId: string,
  branchId: string,
  input: unknown,
): Promise<ActionResult<CountDetail>> {
  const parsed = startCountSchema.safeParse(input ?? {});
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const c = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/branches/{branchId}/counts", {
        params: { path: { orgId, branchId } },
        body: parsed.data,
      }),
    );
    touch();
    return c;
  });
}

export async function addCountLineAction(
  orgId: string,
  branchId: string,
  countId: string,
  input: unknown,
): Promise<ActionResult<CountDetail>> {
  const parsed = countLineInputSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    return unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/branches/{branchId}/counts/{countId}/lines", {
        params: { path: { orgId, branchId, countId } },
        body: parsed.data,
      }),
    );
  });
}

async function countStep(
  orgId: string,
  branchId: string,
  countId: string,
  what: "finalize" | "abandon",
): Promise<ActionResult<CountDetail>> {
  return run(async () => {
    const api = await authedApi();
    const path =
      what === "finalize"
        ? "/v1/merchant/orgs/{orgId}/branches/{branchId}/counts/{countId}/finalize"
        : "/v1/merchant/orgs/{orgId}/branches/{branchId}/counts/{countId}/abandon";
    const c = await unwrap(api.POST(path, { params: { path: { orgId, branchId, countId } } }));
    touch();
    return c;
  });
}

export async function finalizeCountAction(orgId: string, branchId: string, countId: string) {
  return countStep(orgId, branchId, countId, "finalize");
}
export async function abandonCountAction(orgId: string, branchId: string, countId: string) {
  return countStep(orgId, branchId, countId, "abandon");
}
