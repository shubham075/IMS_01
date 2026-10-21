import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { AuthContext, OrgContext } from "../auth/auth.types";
import { CurrentAuth, CurrentOrg, Permissions } from "../auth/decorators";
import { OrgAccessGuard } from "../auth/org-access.guard";
import {
  ListMovementsQueryDto,
  ListStockQueryDto,
  MovementPageDto,
  MovementResultDto,
  RecordMovementDto,
  ReverseMovementDto,
  SetStatusDto,
  SetThresholdDto,
  StockLineDto,
  StockPageDto,
  StockSummaryDto,
} from "../dto";
import { ApiAuthed } from "../http";
import { StockService } from "./stock.service";

/** Stock at one branch. Reads are open to every member; writes check the role (sales/returns need `sale.record`, the rest `stock.write`). */
@ApiTags("stock")
@ApiAuthed()
@UseGuards(OrgAccessGuard)
@Controller("merchant/orgs/:orgId/branches/:branchId/stock")
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @ApiOperation({ summary: "Stock of every product at this branch" })
  @ZodResponse({ status: 200, type: StockPageDto })
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Query() q: ListStockQueryDto,
  ) {
    return this.stock.list(org, auth.userId, branchId, q);
  }

  @Get("summary")
  @ApiOperation({ summary: "How many products are low, out, or need a check" })
  @ZodResponse({ status: 200, type: StockSummaryDto })
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
  ) {
    return this.stock.summary(org, auth.userId, branchId);
  }

  @Post("movements")
  @HttpCode(200)
  @ApiOperation({ summary: "Record stock in, a sale, a return, an adjustment…" })
  @ZodResponse({ status: 200, type: MovementResultDto })
  record(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: RecordMovementDto,
  ) {
    return this.stock.record(org, auth.userId, branchId, dto);
  }

  @Get("movements")
  @ApiOperation({ summary: "Stock history" })
  @ZodResponse({ status: 200, type: MovementPageDto })
  movements(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Query() q: ListMovementsQueryDto,
  ) {
    return this.stock.movements(org, auth.userId, branchId, q);
  }

  @Post("movements/:movementId/reverse")
  @HttpCode(200)
  @Permissions("stock.write")
  @ApiOperation({ summary: "Undo an entry (once) by adding the opposite entry" })
  @ZodResponse({ status: 200, type: MovementResultDto })
  reverse(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("movementId", ParseUUIDPipe) movementId: string,
    @Body() dto: ReverseMovementDto,
  ) {
    return this.stock.reverse(org, auth.userId, branchId, movementId, dto);
  }

  @Put("status")
  @Permissions("stock.write")
  @ApiOperation({ summary: "Mark an uncounted product in stock or out of stock" })
  @ZodResponse({ status: 200, type: StockLineDto })
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: SetStatusDto,
  ) {
    return this.stock.setStatus(org, auth.userId, branchId, dto);
  }

  @Put("threshold")
  @Permissions("stock.write")
  @ApiOperation({ summary: "Set the low-stock level for one product at this branch" })
  @ZodResponse({ status: 200, type: StockLineDto })
  setThreshold(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: SetThresholdDto,
  ) {
    return this.stock.setThreshold(org, auth.userId, branchId, dto);
  }
}
