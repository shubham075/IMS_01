import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { AuthContext } from "../auth/auth.types";
import { CurrentAuth } from "../auth/decorators";
import { MembershipSummaryDto, MeResponseDto, UpdateProfileDto, UserProfileDto } from "../dto";
import { ApiAuthed } from "../http";
import { MeService } from "./me.service";

@ApiTags("me")
@ApiAuthed()
@Controller("me")
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({ summary: "The signed-in user, their organisations and any open invitations" })
  @ZodResponse({ status: 200, type: MeResponseDto })
  get(@CurrentAuth() auth: AuthContext) {
    return this.me.me(auth);
  }

  @Patch()
  @ApiOperation({ summary: "Update display name or language" })
  @ZodResponse({ status: 200, type: UserProfileDto })
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.me.updateProfile(auth, dto);
  }

  @Post("invitations/:invitationId/accept")
  @HttpCode(200)
  @ApiOperation({ summary: "Accept an invitation to join an organisation" })
  @ZodResponse({ status: 200, type: MembershipSummaryDto })
  accept(@CurrentAuth() auth: AuthContext, @Param("invitationId", ParseUUIDPipe) id: string) {
    return this.me.acceptInvitation(auth, id);
  }

  @Post("invitations/:invitationId/decline")
  @HttpCode(204)
  @ApiOperation({ summary: "Decline an invitation" })
  async decline(@CurrentAuth() auth: AuthContext, @Param("invitationId", ParseUUIDPipe) id: string) {
    await this.me.declineInvitation(auth, id);
  }
}
