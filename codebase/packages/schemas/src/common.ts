import { z } from "zod";

/** Stable API error codes (docs/01_Exception_Handling.md §0.2). Clients switch on these, never on messages. */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNIT_NOT_CONVERTIBLE",
  "QTY_NOT_INTEGRAL",
  "DATE_OUT_OF_RANGE",
  "AUTH_REQUIRED",
  "TOKEN_EXPIRED",
  "TOKEN_REVOKED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_LOCKED",
  "PERMISSION_DENIED",
  "BRANCH_OUT_OF_SCOPE",
  "ENTITLEMENT_REQUIRED",
  "ACCOUNT_SUSPENDED",
  "STEP_UP_REQUIRED",
  "TERMS_REQUIRED",
  "NOT_FOUND",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_IN_PROGRESS",
  "VERSION_CONFLICT",
  "DUPLICATE",
  "DUPLICATE_IDENTIFIER",
  "RESTRICTED_CATEGORY",
  "BRANCH_NOT_READY",
  "LAST_OWNER",
  "PRODUCT_INACTIVE",
  "CLIENT_UPGRADE_REQUIRED",
  "RATE_LIMITED",
  "OTP_SEND_LIMIT",
  "OTP_DELIVERY_FAILED",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** RFC 7807 problem details returned for every error. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  trace_id: z.string().optional(),
  retry_after: z.number().int().optional(),
  existing_id: z.string().optional().describe("Id of the record that already exists (duplicate errors)"),
  errors: z
    .array(z.object({ path: z.string(), message: z.string(), code: z.string().optional() }))
    .optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const uuidSchema = z.uuid();

/** Indian mobile number: accepts 9876543210, 919876543210, +91 98765 43210; normalises to +919876543210. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = normalizeIndianPhone(v);
    if (!p) ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit Indian mobile number." });
    return p ?? z.NEVER;
  });

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_REGEX, "This GSTIN does not look right. Check the 15 characters.");

export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export const pincodeSchema = z.string().trim().regex(PINCODE_REGEX, "PIN code must be 6 digits.");

export const isoDateTime = z.iso.datetime({ offset: true });
