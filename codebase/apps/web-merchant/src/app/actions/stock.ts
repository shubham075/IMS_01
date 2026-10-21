"use server";

import { unwrap } from "@idea01/api-client";
import {
  type MovementResult,
  recordMovementSchema,
  reverseMovementSchema,
  type StockLine,
  setStatusSchema,
  setThresholdSchema,
} from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import { authedApi } from "@/lib/server/api";
import { run } from "@/lib/server/run";

const touch = () => revalidatePath("/app", "layout");

export async function recordMovementAction(
  orgId: string,
  branchId: string,
  input: unknown,
): Promise<ActionResult<MovementResult>> {
  const parsed = recordMovementSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const r = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/branches/{branchId}/stock/movements", {
        params: { path: { orgId, branchId } },
        body: parsed.data,
      }),
    );
    touch();
    return r;
  });
}

export async function reverseMovementAction(
  orgId: string,
  branchId: string,
  movementId: string,
  input: unknown,
): Promise<ActionResult<MovementResult>> {
  const parsed = reverseMovementSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const r = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/branches/{branchId}/stock/movements/{movementId}/reverse", {
        params: { path: { orgId, branchId, movementId } },
        body: parsed.data,
      }),
    );
    touch();
    return r;
  });
}

export async function setStatusAction(
  orgId: string,
  branchId: string,
  input: unknown,
): Promise<ActionResult<StockLine>> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const r = await unwrap(
      api.PUT("/v1/merchant/orgs/{orgId}/branches/{branchId}/stock/status", {
        params: { path: { orgId, branchId } },
        body: parsed.data,
      }),
    );
    touch();
    return r;
  });
}

export async function setThresholdAction(
  orgId: string,
  branchId: string,
  input: unknown,
): Promise<ActionResult<StockLine>> {
  const parsed = setThresholdSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const r = await unwrap(
      api.PUT("/v1/merchant/orgs/{orgId}/branches/{branchId}/stock/threshold", {
        params: { path: { orgId, branchId } },
        body: parsed.data,
      }),
    );
    touch();
    return r;
  });
}
