import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { Logo } from "@/components/ui";
import { activeMembership, requireSession } from "@/lib/server/dal";
import { JoinList } from "./join-list";

export async function generateMetadata() {
  const t = await getTranslations("join");
  return { title: t("title") };
}

export default async function JoinPage() {
  const me = await requireSession();
  const [t, membership] = await Promise.all([getTranslations(), activeMembership(me)]);
  if (me.pendingInvitations.length === 0) redirect(membership ? "/app" : "/onboarding/shop");
  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-lg font-extrabold">
          <Logo />
          {t("common.appName")}
        </div>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <SignOutButton />
        </div>
      </header>
      <main id="main">
        <h1 className="text-3xl font-extrabold">{t("join.title")}</h1>
        <p className="mt-1 text-ink/80">{t("join.sub")}</p>
        <JoinList invitations={me.pendingInvitations} />
        {!membership && (
          <p className="mt-8">
            <Link href="/onboarding/shop" className="font-bold underline">
              {t("join.startOwn")}
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
