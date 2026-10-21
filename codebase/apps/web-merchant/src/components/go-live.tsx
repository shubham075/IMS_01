"use client";

import type { Branch } from "@idea01/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setPublicationAction } from "@/app/actions/org";
import { cn } from "@/lib/cn";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { Banner, Button, Pill } from "./ui";

/** Show this branch to shoppers, or hide it again. Going live needs a map pin, verified hours and one product shown. */
export function GoLive({
  orgId,
  branch,
  canPublish,
}: {
  orgId: string;
  branch: Branch;
  canPublish: boolean;
}) {
  const t = useTranslations("goLive");
  const tc = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState(false);

  const steps = [
    { done: !!branch.location, label: t("pin"), href: `/app/branches/${branch.id}` },
    { done: branch.hoursVerified, label: t("hours"), href: `/app/branches/${branch.id}` },
    {
      done: branch.liveProductCount > 0,
      label: t("products", { n: branch.liveProductCount }),
      href: "/app/products",
    },
  ];
  const ready = steps.every((s) => s.done);

  function change(isPublished: boolean) {
    setError(null);
    start(async () => {
      const r = await setPublicationAction(orgId, branch.id, isPublished);
      setConfirmHide(false);
      if (r.ok) return router.refresh();
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setError(errorText(tc, r));
    });
  }

  if (branch.isPublished) {
    return (
      <div className="mt-4 rounded-control border-2 border-ink bg-volt p-3">
        <p className="flex flex-wrap items-center gap-2 font-bold">
          <Pill tone="ink">{t("live")}</Pill>
          {t("liveHelp", { n: branch.liveProductCount })}
        </p>
        {canPublish &&
          (confirmHide ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="font-semibold">{t("hideConfirm")}</span>
              <Button small disabled={pending} onClick={() => change(false)}>
                {t("hideYes")}
              </Button>
              <Button small variant="secondary" onClick={() => setConfirmHide(false)}>
                {t("hideNo")}
              </Button>
            </div>
          ) : (
            <Button small variant="secondary" className="mt-3" onClick={() => setConfirmHide(true)}>
              {t("hide")}
            </Button>
          ))}
        {error && (
          <Banner tone="warn" role="alert" className="mt-3">
            {error}
          </Banner>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-control border-2 border-ink p-3">
      <p className="font-bold">{t("title")}</p>
      <p className="text-sm text-ink/80">{t("help")}</p>
      <ul className="mt-2 space-y-1">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-chip border-2 border-ink text-xs font-black",
                s.done ? "bg-volt" : "bg-grey/50",
              )}
            >
              {s.done ? "✓" : "○"}
            </span>
            <span className="sr-only">{s.done ? t("done") : t("todo")}</span>
            {s.done ? (
              s.label
            ) : (
              <Link href={s.href} className="font-semibold underline">
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {canPublish ? (
        <Button className="mt-3" disabled={pending || !ready} onClick={() => change(true)}>
          {pending ? tc("common.saving") : t("goLive")}
        </Button>
      ) : (
        <p className="mt-3 text-sm">{t("noPermission")}</p>
      )}
      {error && (
        <Banner tone="warn" role="alert" className="mt-3">
          {error}
        </Banner>
      )}
    </div>
  );
}
