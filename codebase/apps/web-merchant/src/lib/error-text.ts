import type { useTranslations } from "next-intl";

type T = ReturnType<typeof useTranslations>;
export interface FailedResult {
  code: string;
  message: string;
  retryAfter?: number;
}

/** Turns an API error code into a sentence in the user's language. Codes are stable; server messages are English only. */
export function errorText(t: T, e: FailedResult): string {
  if (e.code === "OTP_INVALID") {
    const left = /(\d+)\s+tr/.exec(e.message);
    if (left) return t("errors.otpInvalidLeft", { n: Number(left[1]) });
  }
  if (e.code === "RATE_LIMITED" || e.code === "OTP_LOCKED") {
    return t("errors.rateLimited", { seconds: e.retryAfter ?? 30 });
  }
  if (e.code === "OTP_SEND_LIMIT") {
    return t("errors.otpSendLimit", { minutes: Math.max(1, Math.ceil((e.retryAfter ?? 3600) / 60)) });
  }
  const key = `errors.codes.${e.code}`;
  return t.has(key) ? t(key) : t("errors.codes.UNKNOWN");
}

/** Codes that mean "this session is over": the UI sends the person back to sign in. */
export const SESSION_ERRORS = new Set(["AUTH_REQUIRED", "TOKEN_EXPIRED", "TOKEN_REVOKED"]);
