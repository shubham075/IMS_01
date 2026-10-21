import { type NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  accessCookieMaxAge,
  REFRESH_COOKIE,
  refreshCookieMaxAge,
  tokenCookie,
} from "./lib/cookies";

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const PUBLIC_PATHS = ["/login"];

interface Refreshed {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Several requests (page + prefetches) can notice the expired access token at the same moment. They must share one
// refresh call, because a refresh token can be used only once. (Per server process; see docs/slice-1 notes.)
const inflight = new Map<string, Promise<Refreshed | null>>();

async function refresh(refreshToken: string): Promise<Refreshed | null> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      return res.ok ? ((await res.json()) as Refreshed) : null;
    } catch {
      return null;
    } finally {
      setTimeout(() => inflight.delete(refreshToken), 10_000);
    }
  })();
  inflight.set(refreshToken, p);
  return p;
}

function clearSession(res: NextResponse) {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

/**
 * Early redirects and silent token refresh only. It is NOT the security boundary: pages and actions re-check
 * through the data access layer, and the API checks the token and role again on every call.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  let renewed: Refreshed | null = null;
  if (!access && refreshToken) {
    renewed = await refresh(refreshToken);
    if (!renewed) {
      const res = isPublic ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
      return clearSession(res);
    }
    access = renewed.accessToken;
    // Make the new tokens visible to the page being rendered in this same request...
    request.cookies.set(ACCESS_COOKIE, renewed.accessToken);
    request.cookies.set(REFRESH_COOKIE, renewed.refreshToken);
  }

  let response: NextResponse;
  if (!access && !isPublic) response = NextResponse.redirect(new URL("/login", request.url));
  else if (access && pathname === "/login") response = NextResponse.redirect(new URL("/", request.url));
  else response = NextResponse.next({ request });

  // ...and to the browser for the next one.
  if (renewed) {
    response.cookies.set(ACCESS_COOKIE, renewed.accessToken, {
      ...tokenCookie,
      maxAge: accessCookieMaxAge(renewed.expiresIn),
    });
    response.cookies.set(REFRESH_COOKIE, renewed.refreshToken, {
      ...tokenCookie,
      maxAge: refreshCookieMaxAge,
    });
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
