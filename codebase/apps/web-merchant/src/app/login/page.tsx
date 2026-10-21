import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Card, Logo } from "@/components/ui";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: t("title") };
}

export default async function LoginPage() {
  const t = await getTranslations("common");
  const devCode =
    process.env.NEXT_PUBLIC_SHOW_DEV_OTP_HINT === "true" ? (process.env.NEXT_PUBLIC_DEV_OTP_CODE ?? "") : "";
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3 text-lg font-extrabold">
          <Logo />
          {t("appName")}
        </div>
        <LocaleSwitcher />
      </div>
      <Card>
        <LoginForm devCode={devCode} />
      </Card>
    </main>
  );
}
