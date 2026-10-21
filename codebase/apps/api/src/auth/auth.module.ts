import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";
import { MockOtpProvider, OTP_PROVIDER } from "./otp-provider";
import { TokenService } from "./token.service";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    MockOtpProvider,
    // Swap this for a real SMS / WhatsApp / voice provider through configuration (env validation forbids the mock in production).
    { provide: OTP_PROVIDER, useExisting: MockOtpProvider },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
