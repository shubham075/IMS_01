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
  CountDetailDto,
  CountLineInputDto,
  CountPageDto,
  ListCountsQueryDto,
  LookupQueryDto,
  LookupResultDto,
  StartCountDto,
} from "../dto";
import { ApiAuthed } from "../http";
import { ScanService } from "./scan.service";

@ApiTags("scan")
@ApiAuthed()
@UseGuards(OrgAccessGuard)
@Controller("merchant/orgs/:orgId")
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  @Get("catalogue/lookup")
  @ApiOperation({ summary: "Find a product by barcode, product code or quick code" })
  @ZodResponse({ status: 200, type: LookupResultDto })
  lookup(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Query() q: LookupQueryDto) {
    return this.scan.lookup(org, auth.userId, q);
  }

  @Get("branches/:branchId/counts")
  @Permissions("count.run")
  @ApiOperation({ summary: "Stock counts at a branch" })
  @ZodResponse({ status: 200, type: CountPageDto })
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Query() q: ListCountsQueryDto,
  ) {
    return this.scan.list(org, auth.userId, branchId, q);
  }

  @Post("branches/:branchId/counts")
  @HttpCode(200)
  @Permissions("count.run")
  @ApiOperation({ summary: "Start a stock count, or continue the one in progress" })
  @ZodResponse({ status: 200, type: CountDetailDto })
  start(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: StartCountDto,
  ) {
    return this.scan.start(org, auth.userId, branchId, dto);
  }

  @Get("branches/:branchId/counts/:countId")
  @Permissions("count.run")
  @ApiOperation({ summary: "One stock count with what was counted and what will change" })
  @ZodResponse({ status: 200, type: CountDetailDto })
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("countId", ParseUUIDPipe) countId: string,
  ) {
    return this.scan.get(org, auth.userId, branchId, countId);
  }

  @Post("branches/:branchId/counts/:countId/lines")
  @HttpCode(200)
  @Permissions("count.run")
  @ApiOperation({ summary: "Record the number counted for a product" })
  @ZodResponse({ status: 200, type: CountDetailDto })
  addLine(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("countId", ParseUUIDPipe) countId: string,
    @Body() dto: CountLineInputDto,
  ) {
    return this.scan.addLine(org, auth.userId, branchId, countId, dto);
  }

  @Post("branches/:branchId/counts/:countId/finalize")
  @HttpCode(200)
  @Permissions("count.run")
  @ApiOperation({ summary: "Finish the count: stock is corrected to what was counted" })
  @ZodResponse({ status: 200, type: CountDetailDto })
  finalize(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("countId", ParseUUIDPipe) countId: string,
  ) {
    return this.scan.finalize(org, auth.userId, branchId, countId);
  }

  @Post("branches/:branchId/counts/:countId/abandon")
  @HttpCode(200)
  @Permissions("count.run")
  @ApiOperation({ summary: "Cancel a count without changing any stock" })
  @ZodResponse({ status: 200, type: CountDetailDto })
  abandon(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("countId", ParseUUIDPipe) countId: string,
  ) {
    return this.scan.abandon(org, auth.userId, branchId, countId);
  }
}
