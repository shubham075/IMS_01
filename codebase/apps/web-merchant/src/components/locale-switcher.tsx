"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/actions/auth";
import { Button } from "./ui";

const OPTIONS = [
  { value: "en", label: "EN", name: "English" },
  { value: "hi", label: "हिं", name: "हिन्दी" },
] as const;

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <fieldset className="m-0 flex gap-2 border-0 p-0">
      <legend className="sr-only">{t("language")}</legend>
      {OPTIONS.map((o) => (
        <Button
          key={o.value}
          small
          variant={o.value === locale ? "primary" : "secondary"}
          aria-pressed={o.value === locale}
          aria-label={o.name}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setLocaleAction(o.value);
              router.refresh();
            })
          }
        >
          {o.label}
        </Button>
      ))}
    </fieldset>
  );
}
