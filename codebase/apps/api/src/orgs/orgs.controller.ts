import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { AuthContext, OrgContext } from "../auth/auth.types";
import { CurrentAuth, CurrentOrg, Idempotent, Permissions } from "../auth/decorators";
import { OrgAccessGuard } from "../auth/org-access.guard";
import { CreateOrgDto, OrgDto, UpdateOrgDto } from "../dto";
import { ApiAuthed } from "../http";
import { OrgsService } from "./orgs.service";

@ApiTags("organisations")
@ApiAuthed()
@Controller("merchant/orgs")
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  @Idempotent()
  @ApiOperation({ summary: "Create a shop (organisation); the caller becomes its owner on the Free plan" })
  @ZodResponse({ status: 201, type: OrgDto })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateOrgDto) {
    return this.orgs.create(auth, dto);
  }

  @Get()
  @ApiOperation({ summary: "Organisations the caller belongs to" })
  @ZodResponse({ status: 200, type: [OrgDto] })
  list(@CurrentAuth() auth: AuthContext) {
    return this.orgs.listMine(auth.userId);
  }

  @Get(":orgId")
  @UseGuards(OrgAccessGuard)
  @ApiOperation({ summary: "One organisation, with the caller's role and permissions in it" })
  @ZodResponse({ status: 200, type: OrgDto })
  get(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext) {
    return this.orgs.get(org, auth.userId);
  }

  @Patch(":orgId")
  @UseGuards(OrgAccessGuard)
  @Permissions("org.manage")
  @ApiOperation({ summary: "Update organisation details" })
  @ZodResponse({ status: 200, type: OrgDto })
  update(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Body() dto: UpdateOrgDto) {
    return this.orgs.update(org, auth.userId, dto);
  }
}
