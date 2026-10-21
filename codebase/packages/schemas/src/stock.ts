import { z } from "zod";
import { safeText } from "./catalogue";
import { isoDateTime, uuidSchema } from "./common";

/** What happened to the stock. Each maps to one ledger reason and a fixed direction (adjustment can go either way). */
export const MOVEMENT_KINDS = [
  "opening",
  "receipt",
  "sale",
  "customer_return",
  "supplier_return",
  "adjustment",
  "damage",
  "expiry",
  "loss",
  "found",
] as const;
export const movementKindSchema = z.enum(MOVEMENT_KINDS);
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** +1 adds stock, -1 removes it, 0 means the person chooses (adjustment). */
export const KIND_SIGN: Record<MovementKind, 1 | -1 | 0> = {
  opening: 1,
  receipt: 1,
  sale: -1,
  customer_return: 1,
  supplier_return: -1,
  adjustment: 0,
  damage: -1,
  expiry: -1,
  loss: -1,
  found: 1,
};

/** Recording a sale or a customer return is a counter job; everything else needs stock permission. */
export const COUNTER_KINDS: readonly MovementKind[] = ["sale", "customer_return"];

const quantity = z
  .number()
  .positive("Quantity must be more than zero.")
  .max(10_000_000, "Quantity is too large.")
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, "Use at most 3 decimal places.");

export const recordMovementSchema = z
  .object({
    productId: uuidSchema,
    kind: movementKindSchema,
    quantity,
    direction: z.enum(["in", "out"]).optional().describe("Needed only for an adjustment"),
    returnToUnsellable: z.boolean().default(false).describe("Customer return that cannot be resold"),
    note: safeText(200).optional(),
    occurredAt: isoDateTime.optional().describe("When it happened; defaults to now. At most 30 days back."),
    eventId: uuidSchema.describe("Made once per form; sending it again never counts twice"),
    confirmLarge: z.boolean().default(false).describe("Yes, this unusually large amount is correct"),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "adjustment" && !v.direction) {
      ctx.addIssue({ code: "custom", path: ["direction"], message: "Choose whether stock went up or down." });
    }
    if (v.kind === "adjustment" && !v.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Say why you are adjusting the stock." });
    }
  });
export type RecordMovement = z.infer<typeof recordMovementSchema>;

export const reverseMovementSchema = z.object({
  eventId: uuidSchema,
  note: safeText(200).optional(),
});
export type ReverseMovement = z.infer<typeof reverseMovementSchema>;

export const setStatusSchema = z.object({
  productId: uuidSchema,
  status: z.enum(["in_stock", "out_of_stock"]),
});
export type SetStatus = z.infer<typeof setStatusSchema>;

export const setThresholdSchema = z.object({
  productId: uuidSchema,
  threshold: z.number().min(0).max(1_000_000).nullable().describe("null = use the product's level"),
});
export type SetThreshold = z.infer<typeof setThresholdSchema>;

export const STOCK_FILTERS = ["all", "low", "out", "check"] as const;
export const listStockQuerySchema = z.object({
  productId: uuidSchema.optional(),
  q: z.string().trim().max(80).optional(),
  filter: z.enum(STOCK_FILTERS).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListStockQuery = z.infer<typeof listStockQuerySchema>;

export const listMovementsQuerySchema = z.object({
  productId: uuidSchema.optional(),
  reason: z.string().max(30).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

export const stockLineSchema = z.object({
  productId: uuidSchema,
  name: z.string(),
  nameHi: z.string().nullable(),
  unit: z.string(),
  allowFraction: z.boolean(),
  trackingMode: z.enum(["quantity", "status_only"]),
  code: z.string().nullable().describe("Barcode or quick code, for finding the product"),
  onHand: z.number(),
  unsellable: z.number(),
  sellable: z.number(),
  threshold: z.number().describe("The level that counts as low for this branch"),
  thresholdIsCustom: z.boolean(),
  isLow: z.boolean(),
  isOut: z.boolean(),
  needsCheck: z.boolean().describe("Stock went below zero: counts are probably out of step"),
  statusOverride: z.enum(["in_stock", "out_of_stock"]).nullable(),
  lastMovementAt: isoDateTime.nullable(),
});
export type StockLine = z.infer<typeof stockLineSchema>;

export const stockPageSchema = z.object({
  items: z.array(stockLineSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type StockPage = z.infer<typeof stockPageSchema>;

export const stockSummarySchema = z.object({
  products: z.number().int(),
  low: z.number().int(),
  out: z.number().int(),
  needsCheck: z.number().int(),
});
export type StockSummary = z.infer<typeof stockSummarySchema>;

export const movementSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  occurredAt: isoDateTime,
  reason: z.string(),
  qtyDelta: z.number(),
  bucket: z.enum(["on_hand", "unsellable"]),
  note: z.string().nullable(),
  source: z.string(),
  actorName: z.string().nullable(),
  isReversal: z.boolean(),
  isReversed: z.boolean(),
});
export type Movement = z.infer<typeof movementSchema>;

export const movementPageSchema = z.object({
  items: z.array(movementSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type MovementPage = z.infer<typeof movementPageSchema>;

export const movementResultSchema = z.object({
  movementId: uuidSchema,
  duplicate: z.boolean().describe("true when this eventId had already been recorded"),
  line: stockLineSchema,
});
export type MovementResult = z.infer<typeof movementResultSchema>;
