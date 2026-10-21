import {
  addFromCatalogueSchema,
  branchSchema,
  canonicalProductSchema,
  categorySchema,
  createBranchSchema,
  createInvitationSchema,
  createOrgSchema,
  createProductSchema,
  createTransferSchema,
  importJobSchema,
  importPageSchema,
  importPreviewSchema,
  importRowPageSchema,
  invitationSchema,
  listImportRowsQuerySchema,
  listImportsQuerySchema,
  listMovementsQuerySchema,
  listProductsQuerySchema,
  listStockQuerySchema,
  listTransfersQuerySchema,
  logoutRequestSchema,
  memberSchema,
  membershipSummarySchema,
  meResponseSchema,
  movementPageSchema,
  movementResultSchema,
  orgSchema,
  otpRequestResponseSchema,
  otpRequestSchema,
  otpVerifySchema,
  previewImportSchema,
  problemSchema,
  productDetailSchema,
  productPageSchema,
  receiveTransferSchema,
  recordMovementSchema,
  refreshRequestSchema,
  reverseMovementSchema,
  searchCatalogueQuerySchema,
  setIdentifiersSchema,
  setListingSchema,
  setPublicationSchema,
  setStatusSchema,
  setThresholdSchema,
  setTransferLinesSchema,
  stockLineSchema,
  stockPageSchema,
  stockSummarySchema,
  tokenResponseSchema,
  transferDetailSchema,
  transferPageSchema,
  updateBranchSchema,
  updateMemberSchema,
  updateOrgSchema,
  updateProductSchema,
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

export class RecordMovementDto extends createZodDto(recordMovementSchema) {}
export class ReverseMovementDto extends createZodDto(reverseMovementSchema) {}
export class SetStatusDto extends createZodDto(setStatusSchema) {}
export class SetThresholdDto extends createZodDto(setThresholdSchema) {}
export class ListStockQueryDto extends createZodDto(listStockQuerySchema) {}
export class ListMovementsQueryDto extends createZodDto(listMovementsQuerySchema) {}
export class StockLineDto extends createZodDto(stockLineSchema) {}
export class StockPageDto extends createZodDto(stockPageSchema) {}
export class StockSummaryDto extends createZodDto(stockSummarySchema) {}
export class MovementPageDto extends createZodDto(movementPageSchema) {}
export class MovementResultDto extends createZodDto(movementResultSchema) {}

export class SetPublicationDto extends createZodDto(setPublicationSchema) {}

export class CreateTransferDto extends createZodDto(createTransferSchema) {}
export class SetTransferLinesDto extends createZodDto(setTransferLinesSchema) {}
export class ReceiveTransferDto extends createZodDto(receiveTransferSchema) {}
export class ListTransfersQueryDto extends createZodDto(listTransfersQuerySchema) {}
export class TransferDetailDto extends createZodDto(transferDetailSchema) {}
export class TransferPageDto extends createZodDto(transferPageSchema) {}

export class PreviewImportDto extends createZodDto(previewImportSchema) {}
export class ImportJobDto extends createZodDto(importJobSchema) {}
export class ImportPreviewDto extends createZodDto(importPreviewSchema) {}
export class ImportRowPageDto extends createZodDto(importRowPageSchema) {}
export class ImportPageDto extends createZodDto(importPageSchema) {}
export class ListImportRowsQueryDto extends createZodDto(listImportRowsQuerySchema) {}
export class ListImportsQueryDto extends createZodDto(listImportsQuerySchema) {}

export class ProblemDto extends createZodDto(problemSchema) {}

export class HealthDto extends createZodDto(
  z.object({ status: z.literal("ok"), uptimeSeconds: z.number() }),
) {}
export class MinVersionsDto extends createZodDto(
  z.object({ web: z.string(), android: z.string(), ios: z.string() }),
) {}
