"use client";

import { useTranslations } from "next-intl";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "./ui";

export function SignOutButton() {
  const t = useTranslations("common");
  return (
    <form action={logoutAction}>
      <Button type="submit" variant="secondary" small>
        {t("signOut")}
      </Button>
    </form>
  );
}
