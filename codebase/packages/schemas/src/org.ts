import { z } from "zod";
import { userProfileSchema } from "./auth";
import { gstinSchema, isoDateTime, phoneSchema, uuidSchema } from "./common";

export const ROLES = [
  "owner",
  "org_admin",
  "branch_manager",
  "inventory_operator",
  "sales_operator",
  "auditor",
] as const;
export const roleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];
/** A higher rank can manage lower ranks only. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  org_admin: 3,
  branch_manager: 2,
  inventory_operator: 1,
  sales_operator: 1,
  auditor: 1,
};

export const PERMISSIONS = [
  "billing.manage",
  "org.manage",
  "org.export",
  "branch.manage",
  "staff.manage",
  "apikey.manage",
  "catalogue.write",
  "stock.write",
  "sale.record",
  "count.run",
  "transfer.manage",
  "import.run",
  "publication.manage",
  "report.view",
  "report.stock",
  "audit.view",
  "review.approve",
] as const;
export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = (typeof PERMISSIONS)[number];

export const ORG_CATEGORIES = [
  "hardware",
  "electrical",
  "stationery",
  "electronics",
  "pharmacy",
  "other",
] as const;
export const orgCategorySchema = z.enum(ORG_CATEGORIES);

const orgName = z.string().trim().min(2, "Enter your shop name (at least 2 letters).").max(100);

export const createOrgSchema = z.object({
  name: orgName,
  category: orgCategorySchema,
  gstin: gstinSchema.optional(),
  contactPhone: phoneSchema.optional(),
});
export type CreateOrg = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z
  .object({
    name: orgName.optional(),
    legalName: z.string().trim().min(2).max(120).nullable().optional(),
    category: orgCategorySchema.optional(),
    gstin: gstinSchema.nullable().optional(),
    contactPhone: phoneSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const orgSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  legalName: z.string().nullable(),
  category: z.string().nullable(),
  gstin: z.string().nullable(),
  contactPhone: z.string().nullable(),
  status: z.enum(["active", "read_only", "suspended", "closing", "closed"]),
  createdAt: isoDateTime,
  myRole: roleSchema,
  permissions: z.array(permissionSchema),
});
export type Org = z.infer<typeof orgSchema>;

export const membershipSummarySchema = z.object({
  orgId: uuidSchema,
  orgName: z.string(),
  role: roleSchema,
  branchIds: z.array(uuidSchema).describe("Empty = all branches"),
});

export const pendingInvitationSchema = z.object({
  id: uuidSchema,
  orgId: uuidSchema,
  orgName: z.string(),
  role: roleSchema,
  expiresAt: isoDateTime,
});

export const meResponseSchema = z.object({
  user: userProfileSchema,
  memberships: z.array(membershipSummarySchema),
  pendingInvitations: z.array(pendingInvitationSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/* ---------------- members & invitations ---------------- */
export const memberSchema = z.object({
  membershipId: uuidSchema,
  userId: uuidSchema,
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  role: roleSchema,
  status: z.enum(["active", "suspended", "removed"]),
  branchIds: z.array(uuidSchema),
  lastActiveAt: isoDateTime.nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const createInvitationSchema = z.object({
  phone: phoneSchema,
  role: roleSchema.exclude(["owner"]),
  branchIds: z.array(uuidSchema).max(50).default([]),
});
export type CreateInvitation = z.infer<typeof createInvitationSchema>;

export const invitationSchema = z.object({
  id: uuidSchema,
  phone: z.string(),
  role: roleSchema,
  branchIds: z.array(uuidSchema),
  expiresAt: isoDateTime,
  createdAt: isoDateTime,
  status: z.enum(["pending", "accepted", "expired"]),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const updateMemberSchema = z
  .object({
    role: roleSchema.exclude(["owner"]).optional(),
    branchIds: z.array(uuidSchema).max(50).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
