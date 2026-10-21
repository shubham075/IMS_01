"use server";

import { unwrap } from "@idea01/api-client";
import {
  addFromCatalogueSchema,
  type CanonicalProduct,
  createProductSchema,
  type ProductDetail,
  setIdentifiersSchema,
  setListingSchema,
  updateProductSchema,
} from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import { authedApi } from "@/lib/server/api";
import { run } from "@/lib/server/run";

const touch = () => revalidatePath("/app", "layout");

export async function searchCatalogueAction(
  orgId: string,
  q: string,
): Promise<ActionResult<CanonicalProduct[]>> {
  return run(async () => {
    const api = await authedApi();
    return unwrap(
      api.GET("/v1/merchant/orgs/{orgId}/catalogue/search", {
        params: { path: { orgId }, query: { q: q.trim(), limit: 20 } },
      }),
    );
  });
}

export async function createProductAction(
  orgId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<ActionResult<ProductDetail>> {
  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const p = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/products", {
        params: { path: { orgId } },
        body: parsed.data,
        headers: { "idempotency-key": idempotencyKey },
      }),
    );
    touch();
    return p;
  });
}

export async function addFromCatalogueAction(
  orgId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<ActionResult<ProductDetail>> {
  const parsed = addFromCatalogueSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const p = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/products/from-catalogue", {
        params: { path: { orgId } },
        body: parsed.data,
        headers: { "idempotency-key": idempotencyKey },
      }),
    );
    touch();
    return p;
  });
}

export async function updateProductAction(
  orgId: string,
  productId: string,
  input: unknown,
): Promise<ActionResult<ProductDetail>> {
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const p = await unwrap(
      api.PATCH("/v1/merchant/orgs/{orgId}/products/{productId}", {
        params: { path: { orgId, productId } },
        body: parsed.data,
      }),
    );
    touch();
    return p;
  });
}

export async function setIdentifiersAction(
  orgId: string,
  productId: string,
  input: unknown,
): Promise<ActionResult<ProductDetail>> {
  const parsed = setIdentifiersSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const p = await unwrap(
      api.PUT("/v1/merchant/orgs/{orgId}/products/{productId}/identifiers", {
        params: { path: { orgId, productId } },
        body: parsed.data,
      }),
    );
    touch();
    return p;
  });
}

export async function setListingAction(
  orgId: string,
  productId: string,
  branchId: string,
  input: unknown,
): Promise<ActionResult<ProductDetail>> {
  const parsed = setListingSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const p = await unwrap(
      api.PUT("/v1/merchant/orgs/{orgId}/products/{productId}/listings/{branchId}", {
        params: { path: { orgId, productId, branchId } },
        body: parsed.data,
      }),
    );
    touch();
    return p;
  });
}
