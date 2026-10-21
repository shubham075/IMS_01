import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE } from "@/lib/cookies";

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

/** The saved choice wins; otherwise the browser's first language; otherwise English. No language in the URL. */
async function resolveLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (saved === "hi" || saved === "en") return saved;
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("hi") ? "hi" : "en";
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
