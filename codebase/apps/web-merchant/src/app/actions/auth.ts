"use server";

import { unwrap } from "@idea01/api-client";
import {
  localeSchema,
  type OtpRequestResponse,
  otpRequestSchema,
  otpVerifySchema,
  type UserProfile,
  updateProfileSchema,
} from "@idea01/schemas";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionResult, failFromZod } from "@/lib/action-result";
import {
  ACCESS_COOKIE,
  accessCookieMaxAge,
  LOCALE_COOKIE,
  ORG_COOKIE,
  prefCookie,
  REFRESH_COOKIE,
  refreshCookieMaxAge,
  tokenCookie,
} from "@/lib/cookies";
import { apiClient, authedApi } from "@/lib/server/api";
import { clientIpHeaders, run } from "@/lib/server/run";

export async function requestOtpAction(input: unknown): Promise<ActionResult<OtpRequestResponse>> {
  const parsed = otpRequestSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = apiClient();
    return unwrap(api.POST("/v1/auth/otp/request", { body: parsed.data, headers: await clientIpHeaders() }));
  });
}

/** Verifies the code, stores the session in httpOnly cookies, and says where the user should land next. */
export async function verifyOtpAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = otpVerifySchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = apiClient();
    const ua = (await headers()).get("user-agent") ?? "";
    const tokens = await unwrap(
      api.POST("/v1/auth/otp/verify", {
        body: { ...parsed.data, device: { platform: "web", label: ua.slice(0, 80) } },
        headers: await clientIpHeaders(),
      }),
    );

    const jar = await cookies();
    jar.set(ACCESS_COOKIE, tokens.accessToken, {
      ...tokenCookie,
      maxAge: accessCookieMaxAge(tokens.expiresIn),
    });
    jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...tokenCookie, maxAge: refreshCookieMaxAge });
    jar.set(LOCALE_COOKIE, tokens.user.locale, prefCookie);

    const me = await unwrap(apiClient(tokens.accessToken).GET("/v1/me"));
    const first = me.memberships[0];
    if (first) jar.set(ORG_COOKIE, first.orgId, { ...tokenCookie, maxAge: refreshCookieMaxAge });
    const redirectTo = first ? "/app" : me.pendingInvitations.length ? "/join" : "/onboarding/shop";
    return { redirectTo };
  });
}

export async function logoutAction(): Promise<never> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (token) {
    try {
      await apiClient(token).POST("/v1/auth/logout"); // best effort: the cookies are cleared either way
    } catch {
      /* the API being unreachable must not trap someone in a signed-in state */
    }
  }
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, ORG_COOKIE]) jar.delete(name);
  redirect("/login");
}

export async function setLocaleAction(locale: string): Promise<void> {
  const parsed = localeSchema.safeParse(locale);
  if (!parsed.success) return;
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, parsed.data, prefCookie);
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (token) {
    try {
      await apiClient(token).PATCH("/v1/me", { body: { locale: parsed.data } });
    } catch {
      /* the preference is already stored in the cookie */
    }
  }
  revalidatePath("/", "layout");
}

export async function switchOrgAction(orgId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ORG_COOKIE, orgId, { ...tokenCookie, maxAge: refreshCookieMaxAge });
  revalidatePath("/", "layout");
}

export async function updateProfileAction(input: unknown): Promise<ActionResult<UserProfile>> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) return failFromZod(parsed.error);
  return run(async () => {
    const api = await authedApi();
    const user = await unwrap(api.PATCH("/v1/me", { body: parsed.data }));
    revalidatePath("/", "layout");
    return user;
  });
}
