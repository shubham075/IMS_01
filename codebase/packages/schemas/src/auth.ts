import { z } from "zod";
import { phoneSchema, uuidSchema } from "./common";

export const OTP_CHANNELS = ["sms", "whatsapp", "voice"] as const;
export const otpChannelSchema = z.enum(OTP_CHANNELS);
export type OtpChannel = (typeof OTP_CHANNELS)[number];
export const CLIENT_PLATFORMS = ["web", "android", "ios"] as const;
export const LOCALES = ["en", "hi"] as const;
export const localeSchema = z.enum(LOCALES);

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  channel: otpChannelSchema.default("sms"),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpRequestResponseSchema = z.object({
  channel: otpChannelSchema.describe(
    "Channel the code was actually sent on (may differ if the provider failed over)",
  ),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

export const deviceInfoSchema = z.object({
  platform: z.enum(CLIENT_PLATFORMS),
  label: z.string().trim().max(80).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  acceptTerms: z.boolean().optional().describe("Required the first time a number signs up"),
  device: deviceInfoSchema.optional(),
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const userProfileSchema = z.object({
  id: uuidSchema,
  phone: z.string().nullable(),
  displayName: z.string().nullable(),
  locale: localeSchema,
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().describe("Access token lifetime in seconds"),
  isNewUser: z.boolean(),
  user: userProfileSchema,
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const refreshRequestSchema = z.object({ refreshToken: z.string().min(20) });
export const logoutRequestSchema = z.object({ refreshToken: z.string().min(20).optional() });
export const updateProfileSchema = z
  .object({ displayName: z.string().trim().min(2).max(80).optional(), locale: localeSchema.optional() })
  .refine((v) => v.displayName !== undefined || v.locale !== undefined, "Nothing to update");
