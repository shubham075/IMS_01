"use server";

import { unwrap } from "@idea01/api-client";
import { type ImportJob, type ImportPreview, previewImportSchema } from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import { authedApi } from "@/lib/server/api";
import { run } from "@/lib/server/run";

const touch = () => revalidatePath("/app", "layout");

export async function previewImportAction(
  orgId: string,
  input: unknown,
): Promise<ActionResult<ImportPreview>> {
  const parsed = previewImportSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    return unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/imports/preview", {
        params: { path: { orgId } },
        body: parsed.data,
      }),
    );
  });
}

export async function applyImportAction(orgId: string, importId: string): Promise<ActionResult<ImportJob>> {
  return run(async () => {
    const api = await authedApi();
    const j = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/imports/{importId}/apply", {
        params: { path: { orgId, importId } },
      }),
    );
    touch();
    return j;
  });
}

export async function undoImportAction(orgId: string, importId: string): Promise<ActionResult<ImportJob>> {
  return run(async () => {
    const api = await authedApi();
    const j = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/imports/{importId}/undo", {
        params: { path: { orgId, importId } },
      }),
    );
    touch();
    return j;
  });
}
