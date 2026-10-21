import { z } from "zod";
import { isoDateTime, phoneSchema, pincodeSchema, uuidSchema } from "./common";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
const slot = z.tuple([hhmm, hhmm]);

/** Weekly opening hours: a missing or empty day means closed. Slots must close after they open and must not overlap. */
export const hoursSchema = z
  .partialRecord(z.enum(WEEKDAYS), z.array(slot).max(4))
  .superRefine((hours, ctx) => {
    for (const [day, slots] of Object.entries(hours)) {
      const sorted = [...(slots ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
      sorted.forEach(([from, to], i) => {
        if (to <= from) {
          ctx.addIssue({
            code: "custom",
            path: [day],
            message: `Closing time must be after opening time for ${day}.`,
          });
        }
        const prev = sorted[i - 1];
        if (prev && from < prev[1]) {
          ctx.addIssue({ code: "custom", path: [day], message: `Time slots overlap on ${day}.` });
        }
      });
    }
  });
export type Hours = z.infer<typeof hoursSchema>;

export const locationSchema = z.object({
  lat: z.number().min(6).max(37.5).describe("Latitude (India bounds)"),
  lng: z.number().min(68).max(98).describe("Longitude (India bounds)"),
});
export type Location = z.infer<typeof locationSchema>;

export const CONTACT_OPTIONS = ["call", "whatsapp"] as const;

/** Fields shared by create and update. Defaults live ONLY on create: a default inside a partial update would silently overwrite data. */
const branchFields = z.object({
  name: z.string().trim().min(2, "Enter a branch name (at least 2 letters).").max(100),
  addressLine: z.string().trim().min(3, "Enter the address.").max(200),
  area: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema,
  location: locationSchema.nullable().optional(),
  hours: hoursSchema.optional(),
  phonePublic: phoneSchema.nullable().optional(),
  contactOptions: z.array(z.enum(CONTACT_OPTIONS)).min(1).max(2),
});

export const createBranchSchema = branchFields.extend({
  contactOptions: branchFields.shape.contactOptions.default(["call"]),
});
export type CreateBranch = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = branchFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const branchSchema = z.object({
  id: uuidSchema,
  orgId: uuidSchema,
  name: z.string(),
  addressLine: z.string().nullable(),
  area: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  pincode: z.string().nullable(),
  location: locationSchema.nullable(),
  hours: hoursSchema,
  hoursVerified: z.boolean(),
  phonePublic: z.string().nullable(),
  contactOptions: z.array(z.enum(CONTACT_OPTIONS)),
  isPublished: z.boolean(),
  status: z.enum(["active", "inactive"]),
  createdAt: isoDateTime,
});
export type Branch = z.infer<typeof branchSchema>;
