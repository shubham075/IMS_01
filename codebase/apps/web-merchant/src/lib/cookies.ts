/** Cookie names and options, shared by the proxy and by server actions. No secrets, no server-only imports. */
export const ACCESS_COOKIE = "i1_at";
export const REFRESH_COOKIE = "i1_rt";
export const ORG_COOKIE = "i1_org";
export const LOCALE_COOKIE = "NEXT_LOCALE";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const isProd = process.env.NODE_ENV === "production";

/** Tokens live in httpOnly cookies: page scripts (and anything injected into them) can never read them. */
export const tokenCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProd,
  path: "/",
};

export const accessCookieMaxAge = (expiresInSeconds: number) => Math.max(60, expiresInSeconds - 60); // expire early so the proxy refreshes first
export const refreshCookieMaxAge = THIRTY_DAYS;

export const prefCookie = { sameSite: "lax" as const, secure: isProd, path: "/", maxAge: 60 * 60 * 24 * 365 };
