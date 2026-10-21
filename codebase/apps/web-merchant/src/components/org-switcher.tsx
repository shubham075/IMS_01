"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { switchOrgAction } from "@/app/actions/auth";
import { Select } from "./ui";

export function OrgSwitcher({
  orgs,
  current,
}: {
  orgs: Array<{ orgId: string; orgName: string }>;
  current: string;
}) {
  const t = useTranslations("console");
  const router = useRouter();
  const [pending, start] = useTransition();
  if (orgs.length < 2) return null;
  return (
    <Select
      aria-label={t("switchShop")}
      value={current}
      disabled={pending}
      className="min-h-10 max-w-52 py-1 text-sm font-semibold"
      onChange={(e) =>
        start(async () => {
          await switchOrgAction(e.target.value);
          router.push("/app");
          router.refresh();
        })
      }
    >
      {orgs.map((o) => (
        <option key={o.orgId} value={o.orgId}>
          {o.orgName}
        </option>
      ))}
    </Select>
  );
}
