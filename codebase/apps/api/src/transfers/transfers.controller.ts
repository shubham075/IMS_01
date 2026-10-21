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
import { CurrentAuth, CurrentOrg, Idempotent, Permissions } from "../auth/decorators";
import { OrgAccessGuard } from "../auth/org-access.guard";
import {
  CreateTransferDto,
  ListTransfersQueryDto,
  ReceiveTransferDto,
  SetTransferLinesDto,
  TransferDetailDto,
  TransferPageDto,
} from "../dto";
import { ApiAuthed } from "../http";
import { TransfersService } from "./transfers.service";

@ApiTags("transfers")
@ApiAuthed()
@UseGuards(OrgAccessGuard)
@Controller("merchant/orgs/:orgId/transfers")
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @ApiOperation({ summary: "Transfers between your branches" })
  @ZodResponse({ status: 200, type: TransferPageDto })
  list(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Query() q: ListTransfersQueryDto) {
    return this.transfers.list(org, auth.userId, q);
  }

  @Post()
  @Idempotent()
  @Permissions("transfer.manage")
  @ApiOperation({ summary: "Start a transfer (draft)" })
  @ZodResponse({ status: 201, type: TransferDetailDto })
  create(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Body() dto: CreateTransferDto) {
    return this.transfers.create(org, auth.userId, dto);
  }

  @Get(":transferId")
  @ApiOperation({ summary: "One transfer with its products" })
  @ZodResponse({ status: 200, type: TransferDetailDto })
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("transferId", ParseUUIDPipe) id: string,
  ) {
    return this.transfers.get(org, auth.userId, id);
  }

  @Put(":transferId/lines")
  @Permissions("transfer.manage")
  @ApiOperation({ summary: "Replace the products of a draft transfer" })
  @ZodResponse({ status: 200, type: TransferDetailDto })
  setLines(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("transferId", ParseUUIDPipe) id: string,
    @Body() dto: SetTransferLinesDto,
  ) {
    return this.transfers.setLines(org, auth.userId, id, dto);
  }

  @Post(":transferId/dispatch")
  @HttpCode(200)
  @Permissions("transfer.manage")
  @ApiOperation({ summary: "Send the transfer: stock leaves the sending branch" })
  @ZodResponse({ status: 200, type: TransferDetailDto })
  dispatch(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("transferId", ParseUUIDPipe) id: string,
  ) {
    return this.transfers.dispatch(org, auth.userId, id);
  }

  @Post(":transferId/receive")
  @HttpCode(200)
  @Permissions("transfer.manage")
  @ApiOperation({ summary: "Confirm what arrived at the receiving branch" })
  @ZodResponse({ status: 200, type: TransferDetailDto })
  receive(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("transferId", ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferDto,
  ) {
    return this.transfers.receive(org, auth.userId, id, dto);
  }

  @Post(":transferId/cancel")
  @HttpCode(200)
  @Permissions("transfer.manage")
  @ApiOperation({ summary: "Cancel a draft transfer" })
  @ZodResponse({ status: 200, type: TransferDetailDto })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("transferId", ParseUUIDPipe) id: string,
  ) {
    return this.transfers.cancel(org, auth.userId, id);
  }
}
