"use server";

import { unwrap } from "@idea01/api-client";
import { createInvitationSchema, type Invitation, type Member, updateMemberSchema } from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import { ORG_COOKIE, refreshCookieMaxAge, tokenCookie } from "@/lib/cookies";
import { authedApi } from "@/lib/server/api";
import { run } from "@/lib/server/run";

export async function inviteAction(
  orgId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<ActionResult<Invitation>> {
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const inv = await unwrap(
      api.POST("/v1/merchant/orgs/{orgId}/invitations", {
        params: { path: { orgId } },
        body: parsed.data,
        headers: { "idempotency-key": idempotencyKey },
      }),
    );
    revalidatePath("/app/team");
    return inv;
  });
}

export async function cancelInvitationAction(orgId: string, invitationId: string): Promise<ActionResult> {
  return run(async () => {
    const api = await authedApi();
    await unwrap(
      api.DELETE("/v1/merchant/orgs/{orgId}/invitations/{invitationId}", {
        params: { path: { orgId, invitationId } },
      }),
    );
    revalidatePath("/app/team");
    return null;
  });
}

export async function updateMemberAction(
  orgId: string,
  membershipId: string,
  input: unknown,
): Promise<ActionResult<Member>> {
  const parsed = updateMemberSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const m = await unwrap(
      api.PATCH("/v1/merchant/orgs/{orgId}/members/{membershipId}", {
        params: { path: { orgId, membershipId } },
        body: parsed.data,
      }),
    );
    revalidatePath("/app/team");
    return m;
  });
}

export async function removeMemberAction(orgId: string, membershipId: string): Promise<ActionResult> {
  return run(async () => {
    const api = await authedApi();
    await unwrap(
      api.DELETE("/v1/merchant/orgs/{orgId}/members/{membershipId}", {
        params: { path: { orgId, membershipId } },
      }),
    );
    revalidatePath("/app/team");
    return null;
  });
}

export async function acceptInvitationAction(invitationId: string): Promise<ActionResult<{ orgId: string }>> {
  return run(async () => {
    const api = await authedApi();
    const m = await unwrap(
      api.POST("/v1/me/invitations/{invitationId}/accept", { params: { path: { invitationId } } }),
    );
    (await cookies()).set(ORG_COOKIE, m.orgId, { ...tokenCookie, maxAge: refreshCookieMaxAge });
    revalidatePath("/", "layout");
    return { orgId: m.orgId };
  });
}

export async function declineInvitationAction(invitationId: string): Promise<ActionResult> {
  return run(async () => {
    const api = await authedApi();
    await unwrap(
      api.POST("/v1/me/invitations/{invitationId}/decline", { params: { path: { invitationId } } }),
    );
    revalidatePath("/", "layout");
    return null;
  });
}
