import { z } from "zod";
import { canonicalProductSchema } from "./catalogue";
import { isoDateTime, uuidSchema } from "./common";
import { stockLineSchema } from "./stock";

/** Barcode / quick code / product code as typed or scanned. Letters, digits and a few separators only. */
export const scanCodeSchema = z
  .string()
  .trim()
  .min(1, "Type or scan a code.")
  .max(64, "That code is too long.")
  .regex(/^[0-9A-Za-z][0-9A-Za-z._/\- ]*$/, "That code has characters we do not recognise.");

export const lookupQuerySchema = z.object({
  code: scanCodeSchema,
  branchId: uuidSchema.optional().describe("Include this branch's stock for the product"),
});
export type LookupQuery = z.infer<typeof lookupQuerySchema>;

export const lookupResultSchema = z.object({
  product: z
    .object({
      id: uuidSchema,
      name: z.string(),
      nameHi: z.string().nullable(),
      unit: z.string(),
      allowFraction: z.boolean(),
      trackingMode: z.enum(["quantity", "status_only"]),
      status: z.enum(["active", "inactive", "merged"]),
      pricePaise: z.number().int().nullable(),
    })
    .nullable()
    .describe("Your product with this code, if any"),
  canonical: canonicalProductSchema
    .nullable()
    .describe("A shared-catalogue match when you have no product with this code"),
  stock: stockLineSchema.nullable().describe("Stock at the branch asked for"),
});
export type LookupResult = z.infer<typeof lookupResultSchema>;

// ---------- stock counts (FR-INV-12) ----------
export const COUNT_KINDS = ["cycle", "full"] as const;
export const startCountSchema = z.object({ kind: z.enum(COUNT_KINDS).default("cycle") });
export type StartCount = z.infer<typeof startCountSchema>;

export const countLineInputSchema = z.object({
  productId: uuidSchema,
  quantity: z
    .number()
    .min(0, "Quantity cannot be negative.")
    .max(10_000_000, "Quantity is too large.")
    .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, "Use at most 3 decimal places."),
});
export type CountLineInput = z.infer<typeof countLineInputSchema>;

export const countLineSchema = z.object({
  productId: uuidSchema,
  name: z.string(),
  unit: z.string(),
  allowFraction: z.boolean(),
  counted: z.number(),
  countedAt: isoDateTime,
  expected: z.number().describe("What the records say there was at the moment of counting"),
  difference: z.number().describe("counted minus expected: what finishing the count will correct"),
});

export const countSchema = z.object({
  id: uuidSchema,
  branchId: uuidSchema,
  branchName: z.string(),
  kind: z.enum(COUNT_KINDS),
  status: z.enum(["draft", "finalized", "abandoned"]),
  startedAt: isoDateTime,
  expiresAt: isoDateTime,
  finalizedAt: isoDateTime.nullable(),
  startedByName: z.string().nullable(),
  lineCount: z.number().int(),
});
export type Count = z.infer<typeof countSchema>;

export const countDetailSchema = countSchema.extend({
  lines: z.array(countLineSchema),
  corrections: z.number().int().describe("Products whose stock will change when the count is finished"),
});
export type CountDetail = z.infer<typeof countDetailSchema>;

export const listCountsQuerySchema = z.object({
  status: z.enum(["draft", "finalized", "abandoned"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListCountsQuery = z.infer<typeof listCountsQuerySchema>;

export const countPageSchema = z.object({
  items: z.array(countSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type CountPage = z.infer<typeof countPageSchema>;
