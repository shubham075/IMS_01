import { ApiError } from "@idea01/api-client";
import type { ZodError } from "zod";

/** What every server action returns: data, or a stable error code the UI translates (plus field errors for forms). */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: Record<string, string>;
      retryAfter?: number;
      traceId?: string;
    };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export function failFromError(err: unknown): ActionResult<never> {
  if (err instanceof ApiError) {
    return {
      ok: false,
      code: err.code,
      message: err.message,
      fieldErrors: err.fieldErrors,
      retryAfter: err.retryAfter,
      traceId: err.traceId,
    };
  }
  console.error("server action failed", err);
  return { ok: false, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." };
}

export function failFromZod(error: ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const i of error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
  return { ok: false, code: "VALIDATION_FAILED", message: "The form is not valid.", fieldErrors };
}
