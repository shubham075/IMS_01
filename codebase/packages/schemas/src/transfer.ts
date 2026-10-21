import { z } from "zod";
import { safeText } from "./catalogue";
import { isoDateTime, uuidSchema } from "./common";

const quantity = z
  .number()
  .positive("Quantity must be more than zero.")
  .max(10_000_000, "Quantity is too large.")
  .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, "Use at most 3 decimal places.");

export const transferLineInputSchema = z.object({ productId: uuidSchema, quantity });

const lines = z
  .array(transferLineInputSchema)
  .min(1, "Add at least one product.")
  .max(100, "A transfer can have at most 100 products.")
  .refine(
    (ls) => new Set(ls.map((l) => l.productId)).size === ls.length,
    "Each product can appear only once.",
  );

export const createTransferSchema = z
  .object({
    fromBranchId: uuidSchema,
    toBranchId: uuidSchema,
    note: safeText(200).optional(),
    lines,
  })
  .refine((v) => v.fromBranchId !== v.toBranchId, {
    path: ["toBranchId"],
    message: "Choose two different branches.",
  });
export type CreateTransfer = z.infer<typeof createTransferSchema>;

export const setTransferLinesSchema = z.object({ lines });
export type SetTransferLines = z.infer<typeof setTransferLinesSchema>;

/** What actually arrived. A product left out is taken as fully received. Nothing can arrive that was not sent. */
export const receiveTransferSchema = z.object({
  received: z
    .array(z.object({ productId: uuidSchema, quantity: z.number().min(0).max(10_000_000) }))
    .max(100)
    .default([]),
});
export type ReceiveTransfer = z.infer<typeof receiveTransferSchema>;

export const TRANSFER_STATUSES = ["draft", "dispatched", "received", "cancelled"] as const;
export const listTransfersQuerySchema = z.object({
  status: z.enum(TRANSFER_STATUSES).optional(),
  branchId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;

export const transferLineSchema = z.object({
  productId: uuidSchema,
  name: z.string(),
  unit: z.string(),
  allowFraction: z.boolean(),
  qtySent: z.number(),
  qtyReceived: z.number().nullable(),
  sourceOnHand: z.number().describe("What the sending branch has now"),
});

export const transferSchema = z.object({
  id: uuidSchema,
  fromBranchId: uuidSchema,
  fromBranchName: z.string(),
  toBranchId: uuidSchema,
  toBranchName: z.string(),
  status: z.enum(TRANSFER_STATUSES),
  lineCount: z.number().int(),
  createdAt: isoDateTime,
  dispatchedAt: isoDateTime.nullable(),
  receivedAt: isoDateTime.nullable(),
});
export type Transfer = z.infer<typeof transferSchema>;

export const transferDetailSchema = transferSchema.extend({
  note: z.string().nullable(),
  createdByName: z.string().nullable(),
  lines: z.array(transferLineSchema),
});
export type TransferDetail = z.infer<typeof transferDetailSchema>;

export const transferPageSchema = z.object({
  items: z.array(transferSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type TransferPage = z.infer<typeof transferPageSchema>;
