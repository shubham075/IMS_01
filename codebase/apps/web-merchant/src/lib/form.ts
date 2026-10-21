import type { useTranslations } from "next-intl";
import type { ZodError } from "zod";
import { validationText } from "./validation-text";

type T = ReturnType<typeof useTranslations>;

/** Trims text and turns empty strings into "not provided" (an empty optional field is not an invalid GSTIN). */
export function clean(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string") {
      const s = v.trim();
      if (s !== "") out[k] = s;
    } else if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/** Field path -> message in the user's language (first message per field). */
export function localizedErrors(t: T, error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    out[path] ??= validationText(t, issue.message) ?? issue.message;
  }
  return out;
}

/** Server-reported field errors, localized the same way. */
export function localizedFieldErrors(
  t: T,
  fieldErrors: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fieldErrors ?? {}).map(([k, v]) => [k, validationText(t, v) ?? v]),
  );
}

export const newKey = () => crypto.randomUUID();
