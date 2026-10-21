import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { AuthContext, OrgContext } from "../auth/auth.types";
import { CurrentAuth, CurrentOrg, Idempotent, Permissions } from "../auth/decorators";
import { OrgAccessGuard } from "../auth/org-access.guard";
import {
  AddFromCatalogueDto,
  CanonicalProductDto,
  CategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  ProductDetailDto,
  ProductPageDto,
  SearchCatalogueQueryDto,
  SetIdentifiersDto,
  SetListingDto,
  UpdateProductDto,
} from "../dto";
import { ApiAuthed } from "../http";
import { ProductsService } from "./products.service";

@ApiTags("catalogue")
@ApiAuthed()
@UseGuards(OrgAccessGuard)
@Controller("merchant/orgs/:orgId")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get("categories")
  @ApiOperation({ summary: "Product categories" })
  @ZodResponse({ status: 200, type: [CategoryDto] })
  categories(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext) {
    return this.products.categories(org, auth.userId);
  }

  @Get("catalogue/search")
  @ApiOperation({ summary: "Search the shared catalogue" })
  @ZodResponse({ status: 200, type: [CanonicalProductDto] })
  search(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Query() q: SearchCatalogueQueryDto,
  ) {
    return this.products.searchCatalogue(org, auth.userId, q);
  }

  @Get("products")
  @ApiOperation({ summary: "Your products" })
  @ZodResponse({ status: 200, type: ProductPageDto })
  list(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Query() q: ListProductsQueryDto) {
    return this.products.list(org, auth.userId, q);
  }

  @Post("products")
  @Idempotent()
  @Permissions("catalogue.write")
  @ApiOperation({ summary: "Add a custom product" })
  @ZodResponse({ status: 201, type: ProductDetailDto })
  create(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Body() dto: CreateProductDto) {
    return this.products.create(org, auth.userId, dto);
  }

  @Post("products/from-catalogue")
  @Idempotent()
  @Permissions("catalogue.write")
  @ApiOperation({ summary: "Add a product from the shared catalogue" })
  @ZodResponse({ status: 201, type: ProductDetailDto })
  fromCatalogue(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Body() dto: AddFromCatalogueDto,
  ) {
    return this.products.addFromCatalogue(org, auth.userId, dto);
  }

  @Get("products/:productId")
  @ApiOperation({ summary: "One product" })
  @ZodResponse({ status: 200, type: ProductDetailDto })
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("productId", ParseUUIDPipe) productId: string,
  ) {
    return this.products.get(org, auth.userId, productId);
  }

  @Patch("products/:productId")
  @Permissions("catalogue.write")
  @ApiOperation({ summary: "Edit a product, or switch it on/off" })
  @ZodResponse({ status: 200, type: ProductDetailDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(org, auth.userId, productId, dto);
  }

  @Put("products/:productId/identifiers")
  @Permissions("catalogue.write")
  @ApiOperation({ summary: "Replace a product's barcodes, product codes and search names" })
  @ZodResponse({ status: 200, type: ProductDetailDto })
  setIdentifiers(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() dto: SetIdentifiersDto,
  ) {
    return this.products.setIdentifiers(org, auth.userId, productId, dto);
  }

  @Put("products/:productId/listings/:branchId")
  @Permissions("publication.manage")
  @ApiOperation({ summary: "Show or hide a product to shoppers at one branch" })
  @ZodResponse({ status: 200, type: ProductDetailDto })
  setListing(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: SetListingDto,
  ) {
    return this.products.setListing(org, auth.userId, productId, branchId, dto);
  }
}
