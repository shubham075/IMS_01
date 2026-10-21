import "server-only";
import { type ApiClient, createApiClient } from "@idea01/api-client";
import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "../cookies";
import { env } from "./env";

const CLIENT_VERSION = "web/0.1.0";

/** API client for server code. Calls are never cached: every answer depends on who is asking. */
export function apiClient(accessToken?: string): ApiClient {
  return createApiClient(env.API_URL, {
    headers: {
      "x-client-version": CLIENT_VERSION,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    // The body is buffered: passing a streaming Request to Node's fetch fails with "expected non-null body source"
    // when the API answers 401, which would hide errors such as a wrong OTP behind a fake network error.
    fetch: async (request) => {
      const body = request.body ? await request.arrayBuffer() : undefined;
      return fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        cache: "no-store",
      });
    },
  });
}

/** API client acting as the signed-in user (token comes from the httpOnly cookie, kept fresh by proxy.ts). */
export async function authedApi(): Promise<ApiClient> {
  const jar = await cookies();
  return apiClient(jar.get(ACCESS_COOKIE)?.value);
}
