import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { AuthContext, OrgContext } from "../auth/auth.types";
import { CurrentAuth, CurrentOrg, Idempotent, Permissions } from "../auth/decorators";
import { OrgAccessGuard } from "../auth/org-access.guard";
import { BranchDto, CreateBranchDto, SetPublicationDto, UpdateBranchDto } from "../dto";
import { ApiAuthed } from "../http";
import { BranchesService } from "./branches.service";

@ApiTags("branches")
@ApiAuthed()
@UseGuards(OrgAccessGuard)
@Controller("merchant/orgs/:orgId/branches")
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiOperation({ summary: "Branches you can access" })
  @ZodResponse({ status: 200, type: [BranchDto] })
  list(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext) {
    return this.branches.list(org, auth.userId);
  }

  @Post()
  @Idempotent()
  @Permissions("branch.manage")
  @ApiOperation({ summary: "Add a branch (shop location)" })
  @ZodResponse({ status: 201, type: BranchDto })
  create(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Body() dto: CreateBranchDto) {
    return this.branches.create(org, auth.userId, dto);
  }

  @Get(":branchId")
  @ApiOperation({ summary: "One branch" })
  @ZodResponse({ status: 200, type: BranchDto })
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
  ) {
    return this.branches.get(org, auth.userId, branchId);
  }

  @Patch(":branchId")
  @Permissions("branch.manage")
  @ApiOperation({ summary: "Update a branch" })
  @ZodResponse({ status: 200, type: BranchDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branches.update(org, auth.userId, branchId, dto);
  }

  @Put(":branchId/publication")
  @Permissions("publication.manage")
  @ApiOperation({ summary: "Go live (show this branch to shoppers) or hide it" })
  @ZodResponse({ status: 200, type: BranchDto })
  setPublication(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Body() dto: SetPublicationDto,
  ) {
    return this.branches.setPublication(org, auth.userId, branchId, dto.isPublished);
  }
}
