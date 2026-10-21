import type { ErrorCode } from "@idea01/schemas";

const TITLES: Record<number, string> = {
  400: "Bad request",
  401: "Authentication required",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  422: "Unprocessable request",
  426: "Upgrade required",
  429: "Too many requests",
  500: "Internal error",
  503: "Service unavailable",
};

export interface FieldIssue {
  path: string;
  message: string;
  code?: string;
}

/** Every expected failure is an AppError: a stable `code`, an HTTP status, and a message safe to show users. */
export class AppError extends Error {
  readonly title: string;
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly extra: { retryAfter?: number; errors?: FieldIssue[]; existingId?: string } = {},
  ) {
    super(detail ?? code);
    this.title = TITLES[status] ?? "Error";
  }
}

export const Errors = {
  validation: (errors: FieldIssue[], detail = "The request is not valid.") =>
    new AppError(400, "VALIDATION_FAILED", detail, { errors }),
  authRequired: (detail = "Sign in to continue.") => new AppError(401, "AUTH_REQUIRED", detail),
  tokenExpired: (detail = "Your session has expired. Sign in again.") =>
    new AppError(401, "TOKEN_EXPIRED", detail),
  tokenRevoked: (detail = "This session is no longer valid. Sign in again.") =>
    new AppError(401, "TOKEN_REVOKED", detail),
  otpInvalid: (remaining?: number) =>
    new AppError(
      401,
      "OTP_INVALID",
      remaining === undefined
        ? "That code is not right."
        : `That code is not right. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`,
    ),
  otpExpired: () => new AppError(401, "OTP_EXPIRED", "This code has expired. Ask for a new one."),
  otpLocked: (retryAfter: number) =>
    new AppError(429, "OTP_LOCKED", "Too many wrong codes. Ask for a new code.", { retryAfter }),
  permissionDenied: (detail = "You do not have permission to do this.") =>
    new AppError(403, "PERMISSION_DENIED", detail),
  branchOutOfScope: () => new AppError(403, "BRANCH_OUT_OF_SCOPE", "You do not have access to this branch."),
  entitlement: (detail = "This is not available on the current plan or while the account is read-only.") =>
    new AppError(403, "ENTITLEMENT_REQUIRED", detail),
  suspended: (detail = "This account is suspended. Contact support.") =>
    new AppError(403, "ACCOUNT_SUSPENDED", detail),
  termsRequired: () =>
    new AppError(422, "TERMS_REQUIRED", "Accept the Terms of Use and Privacy Notice to create your account."),
  /** Also used when a resource exists but belongs to another tenant: never reveal that it exists. */
  notFound: (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found.`),
  duplicate: (detail: string) => new AppError(409, "DUPLICATE", detail),
  duplicateIdentifier: (what: string, existingId: string) =>
    new AppError(409, "DUPLICATE_IDENTIFIER", `Another product already uses this ${what}.`, { existingId }),
  restrictedCategory: () =>
    new AppError(422, "RESTRICTED_CATEGORY", "Products in this category cannot be shown to shoppers."),
  branchNotReady: (detail: string) => new AppError(422, "BRANCH_NOT_READY", detail),
  conflict: (detail: string) => new AppError(409, "VERSION_CONFLICT", detail),
  lastOwner: () => new AppError(409, "LAST_OWNER", "An organisation must keep at least one owner."),
  idempotencyReused: () =>
    new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used with a different request.",
    ),
  idempotencyInProgress: () =>
    new AppError(
      409,
      "IDEMPOTENCY_IN_PROGRESS",
      "A request with this Idempotency-Key is still being processed.",
      { retryAfter: 2 },
    ),
  rateLimited: (retryAfter: number, detail = "Too many requests. Please slow down.") =>
    new AppError(429, "RATE_LIMITED", detail, { retryAfter }),
  otpSendLimit: (retryAfter: number) =>
    new AppError(429, "OTP_SEND_LIMIT", "You asked for too many codes. Please try again later.", {
      retryAfter,
    }),
  otpDelivery: () =>
    new AppError(
      503,
      "OTP_DELIVERY_FAILED",
      "We could not send the code right now. Please try again in a minute.",
    ),
  unavailable: (detail = "A service we depend on is unavailable. Try again shortly.") =>
    new AppError(503, "DEPENDENCY_UNAVAILABLE", detail, { retryAfter: 5 }),
};

/** Postgres SQLSTATE helpers (database functions raise errors whose HINT is an API error code). */
export function pgHint(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "hint" in err
    ? String((err as { hint: unknown }).hint)
    : undefined;
}
export function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
