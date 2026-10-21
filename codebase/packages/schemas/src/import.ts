import { z } from "zod";
import { isoDateTime, uuidSchema } from "./common";

/** One import: a CSV of products, optionally with opening stock for one branch. Nothing changes until it is applied. */
export const IMPORT_MAX_BYTES = 900_000; // the API accepts 1 MB request bodies
export const IMPORT_MAX_ROWS = 2000;

export const previewImportSchema = z.object({
  branchId: uuidSchema.describe("Opening stock goes to this branch"),
  fileName: z.string().trim().max(200).optional(),
  csv: z.string().min(1, "The file is empty.").max(IMPORT_MAX_BYTES, "The file is too large."),
  defaultCategoryId: uuidSchema.optional().describe("Used for rows without a category column"),
});
export type PreviewImport = z.infer<typeof previewImportSchema>;

export const IMPORT_FIELDS = [
  "name",
  "name_hi",
  "category",
  "unit",
  "price",
  "cost",
  "barcode",
  "sku",
  "brand",
  "pack_size",
  "stock",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_ERROR_CODES = [
  "MISSING_NAME",
  "UNKNOWN_CATEGORY",
  "BAD_UNIT",
  "BAD_PRICE",
  "BAD_STOCK",
  "BAD_BARCODE",
  "BAD_SKU",
  "TOO_LONG",
  "FORMULA",
  "DUPLICATE_IN_FILE",
  "ALREADY_EXISTS",
  "INVALID",
] as const;

export const importRowSchema = z.object({
  rowNo: z.number().int().describe("Row number in the file; the header is row 1"),
  status: z.enum(["pending", "ok", "error", "skipped", "applied"]),
  name: z.string().nullable(),
  stock: z.number().nullable(),
  errorCode: z.enum(IMPORT_ERROR_CODES).nullable(),
  field: z.string().nullable(),
  detail: z.string().nullable().describe("The value or the other row that caused the problem"),
  existingProductId: uuidSchema.nullable(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importJobSchema = z.object({
  id: uuidSchema,
  branchId: uuidSchema.nullable(),
  branchName: z.string().nullable(),
  fileName: z.string().nullable(),
  kind: z.enum(["products", "opening_stock"]),
  status: z.enum(["validated", "applying", "applied", "failed", "undone"]),
  totalRows: z.number().int(),
  okRows: z.number().int(),
  skippedRows: z.number().int(),
  errorRows: z.number().int(),
  appliedRows: z.number().int(),
  createdAt: isoDateTime,
  appliedAt: isoDateTime.nullable(),
  undoneAt: isoDateTime.nullable(),
  createdByName: z.string().nullable(),
});
export type ImportJob = z.infer<typeof importJobSchema>;

export const importPreviewSchema = z.object({
  job: importJobSchema,
  recognised: z.array(z.object({ column: z.string(), field: z.enum(IMPORT_FIELDS) })),
  ignored: z.array(z.string()).describe("Columns we did not recognise; they are not imported"),
  rows: z.array(importRowSchema).describe("The first 50 rows, problems first"),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const listImportRowsQuerySchema = z.object({
  status: z.enum(["ok", "error", "skipped", "applied"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListImportRowsQuery = z.infer<typeof listImportRowsQuerySchema>;

export const importRowPageSchema = z.object({
  items: z.array(importRowSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ImportRowPage = z.infer<typeof importRowPageSchema>;

export const listImportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;

export const importPageSchema = z.object({
  items: z.array(importJobSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ImportPage = z.infer<typeof importPageSchema>;
