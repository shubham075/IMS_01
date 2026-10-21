import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { ZodResponse } from "nestjs-zod";
import {
  OtpRequestDto,
  OtpRequestResponseDto,
  OtpVerifyDto,
  RefreshRequestDto,
  TokenResponseDto,
} from "../dto";
import { ApiAuthed, ApiPublicRoute } from "../http";
import { AuthService } from "./auth.service";
import type { AuthContext } from "./auth.types";
import { CurrentAuth, Public, RateLimit } from "./decorators";
import { OtpService } from "./otp.service";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @ApiPublicRoute()
  @RateLimit(10, 60)
  @Post("otp/request")
  @ApiOperation({ summary: "Send a one-time login code to a mobile number" })
  @ZodResponse({
    status: 200,
    description: "Code sent (same response whether or not the number has an account)",
    type: OtpRequestResponseDto,
  })
  requestOtp(@Body() dto: OtpRequestDto, @Req() req: FastifyRequest) {
    return this.otp.request(dto.phone, dto.channel, req.ip);
  }

  @Public()
  @ApiPublicRoute()
  @RateLimit(20, 60)
  @Post("otp/verify")
  @ApiOperation({ summary: "Verify the code and sign in (creates the account the first time)" })
  @ZodResponse({ status: 200, description: "Signed in", type: TokenResponseDto })
  verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: FastifyRequest) {
    return this.auth.loginWithOtp(dto, req.ip);
  }

  @Public()
  @ApiPublicRoute()
  @RateLimit(30, 60)
  @Post("refresh")
  @ApiOperation({ summary: "Exchange a refresh token for a new access + refresh token (rotation)" })
  @ZodResponse({ status: 200, description: "New tokens", type: TokenResponseDto })
  refresh(@Body() dto: RefreshRequestDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiAuthed()
  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Sign out this device (revokes the whole refresh-token family)" })
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth);
  }
}
