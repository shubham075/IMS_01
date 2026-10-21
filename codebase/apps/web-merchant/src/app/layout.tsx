import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Idea01 · Shop", template: "%s · Idea01" },
  description: "Manage your shop's stock and let nearby shoppers find what you have.",
  robots: { index: false, follow: false }, // the merchant console is private
};

export const viewport: Viewport = { themeColor: "#F2F2E8", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, t] = await Promise.all([getLocale(), getMessages(), getTranslations("common")]);
  return (
    <html lang={locale}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:border-[2.5px] focus:border-ink focus:bg-volt focus:px-4 focus:py-2 focus:font-bold"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
