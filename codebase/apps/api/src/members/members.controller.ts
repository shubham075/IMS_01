import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { AuthContext, OrgContext } from "../auth/auth.types";
import { CurrentAuth, CurrentOrg, Idempotent, Permissions } from "../auth/decorators";
import { OrgAccessGuard } from "../auth/org-access.guard";
import { CreateInvitationDto, InvitationDto, MemberDto, UpdateMemberDto } from "../dto";
import { ApiAuthed } from "../http";
import { MembersService } from "./members.service";

@ApiTags("team")
@ApiAuthed()
@UseGuards(OrgAccessGuard)
@Permissions("staff.manage")
@Controller("merchant/orgs/:orgId")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get("members")
  @ApiOperation({ summary: "Team members of this organisation" })
  @ZodResponse({ status: 200, type: [MemberDto] })
  list(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext) {
    return this.members.listMembers(org, auth.userId);
  }

  @Patch("members/:membershipId")
  @ApiOperation({ summary: "Change a member's role, branches or status (only roles below your own)" })
  @ZodResponse({ status: 200, type: MemberDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("membershipId", ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.updateMember(org, auth.userId, id, dto);
  }

  @Delete("members/:membershipId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a member (takes effect on their next request)" })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("membershipId", ParseUUIDPipe) id: string,
  ) {
    await this.members.removeMember(org, auth.userId, id);
  }

  @Get("invitations")
  @ApiOperation({ summary: "Open invitations" })
  @ZodResponse({ status: 200, type: [InvitationDto] })
  listInvitations(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext) {
    return this.members.listInvitations(org, auth.userId);
  }

  @Post("invitations")
  @Idempotent()
  @ApiOperation({ summary: "Invite a person by mobile number" })
  @ZodResponse({ status: 201, type: InvitationDto })
  invite(@CurrentAuth() auth: AuthContext, @CurrentOrg() org: OrgContext, @Body() dto: CreateInvitationDto) {
    return this.members.invite(org, auth.userId, dto);
  }

  @Delete("invitations/:invitationId")
  @HttpCode(204)
  @ApiOperation({ summary: "Cancel an open invitation" })
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentOrg() org: OrgContext,
    @Param("invitationId", ParseUUIDPipe) id: string,
  ) {
    await this.members.cancelInvitation(org, auth.userId, id);
  }
}
