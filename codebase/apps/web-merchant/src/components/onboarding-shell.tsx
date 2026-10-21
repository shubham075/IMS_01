import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import { LocaleSwitcher } from "./locale-switcher";
import { SignOutButton } from "./sign-out-button";
import { Logo } from "./ui";

const STEPS = ["shop", "location"] as const;

export async function OnboardingShell({ step, children }: { step: 1 | 2; children: React.ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-6">
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
      <nav aria-label={t("onboarding.title")} className="mb-5">
        <p className="mb-2 text-sm font-semibold">{t("onboarding.step", { n: step, total: STEPS.length })}</p>
        <ol className="flex gap-3">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i + 1 === step ? "step" : undefined}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-control border-[2.5px] border-ink px-3 py-2 text-sm font-bold",
                i + 1 === step ? "bg-paper shadow-hard-sm" : i + 1 < step ? "bg-volt" : "bg-grey",
              )}
            >
              <span className="grid size-6 place-items-center rounded-chip border-2 border-ink bg-paper text-xs">
                {i + 1 < step ? "✓" : i + 1}
              </span>
              {t(`onboarding.steps.${s}`)}
            </li>
          ))}
        </ol>
      </nav>
      <main id="main">{children}</main>
      <p className="mt-6 text-sm text-ink/75">{t("onboarding.later")}</p>
    </div>
  );
}
