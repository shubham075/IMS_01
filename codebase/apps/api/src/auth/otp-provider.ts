import type { OtpChannel } from "@idea01/schemas";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { maskPhone } from "../common/util";
import { ENV, type Env } from "../config/env";

export interface OtpMessage {
  target: string; // E.164 phone
  channel: OtpChannel;
  code: string;
}

/** A delivery provider. Real providers (SMS / WhatsApp / voice vendors) implement this and are swapped in by config. */
export interface OtpProvider {
  readonly name: string;
  /** Resolve when the provider accepted the message; reject if it could not be sent on this channel. */
  send(message: OtpMessage): Promise<void>;
}
export const OTP_PROVIDER = Symbol("OTP_PROVIDER");

/**
 * Development provider: writes the code to the log instead of sending it. Refused in production by env validation.
 * `OTP_MOCK_FAIL_CHANNELS=sms` simulates a provider outage so the fail-over path can be exercised.
 */
@Injectable()
export class MockOtpProvider implements OtpProvider {
  readonly name = "mock";
  private readonly log = new Logger("MockOtp");
  private readonly failing: Set<string>;

  constructor(@Inject(ENV) env: Env) {
    this.failing = new Set(env.OTP_MOCK_FAIL_CHANNELS);
  }

  async send({ target, channel, code }: OtpMessage): Promise<void> {
    if (this.failing.has(channel)) throw new Error(`mock provider: ${channel} is down`);
    this.log.warn(`[mock-otp] code for ${maskPhone(target)} via ${channel}: ${code}`);
  }
}
