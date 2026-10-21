import { z } from "zod";
import { isoDateTime, uuidSchema } from "./common";

/** Units a shop can sell in. Fractional quantities only make sense for measured units (kg, litre, metre…). */
export const UNITS = ["pcs", "box", "pack", "dozen", "kg", "g", "litre", "ml", "m"] as const;
export const unitSchema = z.enum(UNITS);
export type Unit = (typeof UNITS)[number];
const FRACTIONAL_UNITS: readonly Unit[] = ["kg", "g", "litre", "ml", "m"];
export const allowsFraction = (unit: Unit): boolean => FRACTIONAL_UNITS.includes(unit);

export const TRACKING_MODES = ["quantity", "status_only"] as const;

const text = (max: number) => z.string().trim().max(max);
const productName = z
  .string()
  .trim()
  .min(2, "Enter the product name (at least 2 letters).")
  .max(120, "Product name is too long.");

/** Integer paise (₹1 = 100 paise); never floating-point money. Max ₹1 crore per unit. */
export const paiseSchema = z
  .number()
  .int("Enter a whole number of paise.")
  .min(0, "Price cannot be negative.")
  .max(1_00_00_000_00, "Price is too high.");

const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-]{4,32}$/, "Barcode must be 4–32 letters or digits.");
const skuSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$/, "Product code can use letters, digits and . _ / - (max 40).");
const aliasSchema = z.string().trim().min(2).max(40);

export const identifierKindSchema = z.enum(["barcode", "sku", "alias", "short_code"]);
export const identifierSchema = z.object({ kind: identifierKindSchema, value: z.string() });
export type Identifier = z.infer<typeof identifierSchema>;

const attrsSchema = z.record(z.string().max(40), z.union([z.string().max(100), z.number(), z.boolean()])).refine(
  (a) => Object.keys(a).length <= 20,
  "Too many attributes.",
);

// Defaults are added only for create (below). A partial() of a field with a default would still inject it.
const productFields = z.object({
  name: productName,
  nameHi: text(120).optional(),
  brand: text(60).optional(),
  model: text(60).optional(),
  description: text(1000).optional(),
  categoryId: uuidSchema,
  unit: unitSchema,
  packSize: text(40).optional(),
  attrs: attrsSchema.optional(),
  trackingMode: z.enum(TRACKING_MODES),
  lowStockThreshold: z.number().min(0).max(1_000_000),
  pricePaise: paiseSchema.nullable().optional(),
  costPaise: paiseSchema.nullable().optional(),
  barcode: barcodeSchema.optional(),
  sku: skuSchema.optional(),
});

export const createProductSchema = productFields.extend({
  unit: productFields.shape.unit.default("pcs"),
  trackingMode: productFields.shape.trackingMode.default("quantity"),
  lowStockThreshold: productFields.shape.lowStockThreshold.default(0),
});
export type CreateProduct = z.infer<typeof createProductSchema>;

/** Updates never inject defaults, so "change the price" cannot silently reset the unit or the threshold. */
export const updateProductSchema = productFields
  .omit({ barcode: true, sku: true })
  .partial()
  .extend({
    nameHi: text(120).nullable().optional(),
    brand: text(60).nullable().optional(),
    model: text(60).nullable().optional(),
    description: text(1000).nullable().optional(),
    packSize: text(40).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateProduct = z.infer<typeof updateProductSchema>;

export const addFromCatalogueSchema = z.object({
  canonicalId: uuidSchema,
  unit: unitSchema.default("pcs"),
  pricePaise: paiseSchema.nullable().optional(),
});
export type AddFromCatalogue = z.infer<typeof addFromCatalogueSchema>;

export const setIdentifiersSchema = z.object({
  barcodes: z.array(barcodeSchema).max(5).default([]),
  skus: z.array(skuSchema).max(5).default([]),
  aliases: z.array(aliasSchema).max(10).default([]),
});
export type SetIdentifiers = z.infer<typeof setIdentifiersSchema>;

export const setListingSchema = z.object({
  isPublished: z.boolean(),
  showPrice: z.boolean().default(false),
  pricePaise: paiseSchema.nullable().optional(),
  temporarilyUnavailable: z.boolean().default(false),
});
export type SetListing = z.infer<typeof setListingSchema>;

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  categoryId: uuidSchema.optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const searchCatalogueQuerySchema = z.object({
  q: z.string().trim().min(1, "Type something to search.").max(80),
  categoryId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchCatalogueQuery = z.infer<typeof searchCatalogueQuerySchema>;

export const categorySchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  nameEn: z.string(),
  nameHi: z.string().nullable(),
  restricted: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;

export const canonicalProductSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  categoryId: uuidSchema.nullable(),
  alreadyAddedProductId: uuidSchema.nullable(),
});
export type CanonicalProduct = z.infer<typeof canonicalProductSchema>;

export const listingSchema = z.object({
  branchId: uuidSchema,
  branchName: z.string(),
  isPublished: z.boolean(),
  showPrice: z.boolean(),
  pricePaise: z.number().int().nullable(),
  temporarilyUnavailable: z.boolean(),
});
export type Listing = z.infer<typeof listingSchema>;

export const productSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  nameHi: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  description: z.string().nullable(),
  categoryId: uuidSchema.nullable(),
  unit: z.string(),
  allowFraction: z.boolean(),
  packSize: z.string().nullable(),
  attrs: z.record(z.string(), z.unknown()),
  trackingMode: z.enum(TRACKING_MODES),
  lowStockThreshold: z.number(),
  pricePaise: z.number().int().nullable(),
  costPaise: z.number().int().nullable().describe("Only for people who can edit the catalogue"),
  status: z.enum(["active", "inactive", "merged"]),
  canonicalId: uuidSchema.nullable(),
  identifiers: z.array(identifierSchema),
  shortCode: z.string().nullable(),
  publishedBranchCount: z.number().int().describe("Branches where shoppers can see this product"),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Product = z.infer<typeof productSchema>;

export const productDetailSchema = productSchema.extend({ listings: z.array(listingSchema) });
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const productPageSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ProductPage = z.infer<typeof productPageSchema>;
