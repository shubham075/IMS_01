import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { AuthContext, OrgContext } from "../auth/auth.types";
import { CurrentAuth, CurrentOrg, Permissions } from "../auth/decorators";
import { OrgAccessGuard } from "../auth/org-access.guard";
import {
  ImportJobDto,
  ImportPageDto,
  ImportPreviewDto,
  ImportRowPageDto,
  ListImportRowsQueryDto,
  ListImportsQueryDto,
  PreviewImportDto,
} from "../dto";
import { ApiAuthed } from "../http";
import { ImportsService } from "./imports.service";

/** Bulk-add products from a CSV file: preview (checks everything, changes nothing), apply, and undo. */
@ApiTags("imports")
@ApiAuthed()
@UseGuards(OrgAccessGuard)
@Permissions("import.run")
@Controller("merchant/orgs/:orgId/imports")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  @ApiOperation({ summary: "Past imports" })
  @ZodResponse({ status: 200, type: ImportPageDto })
  list(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Query() q: ListImportsQueryDto) {
    return this.imports.list(org, auth.userId, q);
  }

  @Post("preview")
  @HttpCode(200)
  @ApiOperation({ summary: "Check a CSV file. Nothing changes until it is applied." })
  @ZodResponse({ status: 200, type: ImportPreviewDto })
  preview(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Body() dto: PreviewImportDto) {
    return this.imports.preview(org, auth.userId, dto);
  }

  @Get(":importId")
  @ApiOperation({ summary: "One import" })
  @ZodResponse({ status: 200, type: ImportJobDto })
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("importId", ParseUUIDPipe) id: string,
  ) {
    return this.imports.get(org, auth.userId, id);
  }

  @Get(":importId/rows")
  @ApiOperation({ summary: "The rows of an import and what happened to each" })
  @ZodResponse({ status: 200, type: ImportRowPageDto })
  rows(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("importId", ParseUUIDPipe) id: string,
    @Query() q: ListImportRowsQueryDto,
  ) {
    return this.imports.rows(org, auth.userId, id, q);
  }

  @Post(":importId/apply")
  @HttpCode(200)
  @ApiOperation({ summary: "Create the products and opening stock" })
  @ZodResponse({ status: 200, type: ImportJobDto })
  apply(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("importId", ParseUUIDPipe) id: string,
  ) {
    return this.imports.apply(org, auth.userId, id);
  }

  @Post(":importId/undo")
  @HttpCode(200)
  @ApiOperation({ summary: "Take the import back (only if nothing else was recorded on its products)" })
  @ZodResponse({ status: 200, type: ImportJobDto })
  undo(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("importId", ParseUUIDPipe) id: string,
  ) {
    return this.imports.undo(org, auth.userId, id);
  }
}
