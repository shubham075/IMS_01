"use server";

import { unwrap } from "@idea01/api-client";
import {
  createTransferSchema,
  type ProductPage,
  receiveTransferSchema,
  setTransferLinesSchema,
  type TransferDetail,
} from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import { authedApi } from "@/lib/server/api";
import { run } from "@/lib/server/run";

const touch = () => revalidatePath("/app", "layout");

/** Product search for the transfer screen: counted, switched-on products only. */
export async function searchProductsAction(orgId: string, q: string): Promise<ActionResult<ProductPage>> {
  return run(async () => {
    const api = await authedApi();
    return unwrap(
      api.GET("/v1/merchant/orgs/{orgId}/products", {
        params: { path: { orgId }, query: { q: q.trim().slice(0, 80), status: "active", limit: 8 } },
      }),
    );
  });
}

export async function createTransferAction(
  orgId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<ActionResult<TransferDetail>> {
  const parsed = createTransferSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const t = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/transfers", {
        params: { path: { orgId } },
        body: parsed.data,
        headers: { "idempotency-key": idempotencyKey },
      }),
    );
    touch();
    return t;
  });
}

export async function setTransferLinesAction(
  orgId: string,
  transferId: string,
  input: unknown,
): Promise<ActionResult<TransferDetail>> {
  const parsed = setTransferLinesSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const t = await unwrap(
      api.PUT("/v1/merchant/orgs/{orgId}/transfers/{transferId}/lines", {
        params: { path: { orgId, transferId } },
        body: parsed.data,
      }),
    );
    touch();
    return t;
  });
}

type Step = "dispatch" | "cancel";
async function step(orgId: string, transferId: string, what: Step): Promise<ActionResult<TransferDetail>> {
  return run(async () => {
    const api = await authedApi();
    const path =
      what === "dispatch"
        ? "/v1/merchant/orgs/{orgId}/transfers/{transferId}/dispatch"
        : "/v1/merchant/orgs/{orgId}/transfers/{transferId}/cancel";
    const t = await unwrap(api.POST(path, { params: { path: { orgId, transferId } } }));
    touch();
    return t;
  });
}
export async function dispatchTransferAction(
  orgId: string,
  transferId: string,
): Promise<ActionResult<TransferDetail>> {
  return step(orgId, transferId, "dispatch");
}
export async function cancelTransferAction(
  orgId: string,
  transferId: string,
): Promise<ActionResult<TransferDetail>> {
  return step(orgId, transferId, "cancel");
}

export async function receiveTransferAction(
  orgId: string,
  transferId: string,
  input: unknown,
): Promise<ActionResult<TransferDetail>> {
  const parsed = receiveTransferSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const t = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/transfers/{transferId}/receive", {
        params: { path: { orgId, transferId } },
        body: parsed.data,
      }),
    );
    touch();
    return t;
  });
}
