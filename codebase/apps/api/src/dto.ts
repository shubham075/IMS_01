import {
  addFromCatalogueSchema,
  canonicalProductSchema,
  categorySchema,
  createProductSchema,
  listProductsQuerySchema,
  productDetailSchema,
  productPageSchema,
  searchCatalogueQuerySchema,
  setIdentifiersSchema,
  setListingSchema,
  updateProductSchema,
  branchSchema,
  createBranchSchema,
  createInvitationSchema,
  createOrgSchema,
  invitationSchema,
  logoutRequestSchema,
  memberSchema,
  membershipSummarySchema,
  meResponseSchema,
  orgSchema,
  otpRequestResponseSchema,
  otpRequestSchema,
  otpVerifySchema,
  problemSchema,
  refreshRequestSchema,
  tokenResponseSchema,
  updateBranchSchema,
  updateMemberSchema,
  updateOrgSchema,
  updateProfileSchema,
  userProfileSchema,
} from "@idea01/schemas";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** HTTP DTOs: thin classes over the shared Zod schemas so request validation, response checking and OpenAPI agree. */
export class OtpRequestDto extends createZodDto(otpRequestSchema) {}
export class OtpRequestResponseDto extends createZodDto(otpRequestResponseSchema) {}
export class OtpVerifyDto extends createZodDto(otpVerifySchema) {}
export class RefreshRequestDto extends createZodDto(refreshRequestSchema) {}
export class LogoutRequestDto extends createZodDto(logoutRequestSchema) {}
export class TokenResponseDto extends createZodDto(tokenResponseSchema) {}
export class UserProfileDto extends createZodDto(userProfileSchema) {}
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
export class MeResponseDto extends createZodDto(meResponseSchema) {}
export class MembershipSummaryDto extends createZodDto(membershipSummarySchema) {}

export class CreateOrgDto extends createZodDto(createOrgSchema) {}
export class UpdateOrgDto extends createZodDto(updateOrgSchema) {}
export class OrgDto extends createZodDto(orgSchema) {}
export class OrgListDto extends createZodDto(z.array(orgSchema)) {}

export class CreateBranchDto extends createZodDto(createBranchSchema) {}
export class UpdateBranchDto extends createZodDto(updateBranchSchema) {}
export class BranchDto extends createZodDto(branchSchema) {}

export class MemberDto extends createZodDto(memberSchema) {}
export class UpdateMemberDto extends createZodDto(updateMemberSchema) {}
export class CreateInvitationDto extends createZodDto(createInvitationSchema) {}
export class InvitationDto extends createZodDto(invitationSchema) {}

export class CategoryDto extends createZodDto(categorySchema) {}
export class CanonicalProductDto extends createZodDto(canonicalProductSchema) {}
export class CreateProductDto extends createZodDto(createProductSchema) {}
export class UpdateProductDto extends createZodDto(updateProductSchema) {}
export class AddFromCatalogueDto extends createZodDto(addFromCatalogueSchema) {}
export class SetIdentifiersDto extends createZodDto(setIdentifiersSchema) {}
export class SetListingDto extends createZodDto(setListingSchema) {}
export class ListProductsQueryDto extends createZodDto(listProductsQuerySchema) {}
export class SearchCatalogueQueryDto extends createZodDto(searchCatalogueQuerySchema) {}
export class ProductDetailDto extends createZodDto(productDetailSchema) {}
export class ProductPageDto extends createZodDto(productPageSchema) {}

export class ProblemDto extends createZodDto(problemSchema) {}

export class HealthDto extends createZodDto(
  z.object({ status: z.literal("ok"), uptimeSeconds: z.number() }),
) {}
export class MinVersionsDto extends createZodDto(
  z.object({ web: z.string(), android: z.string(), ios: z.string() }),
) {}
