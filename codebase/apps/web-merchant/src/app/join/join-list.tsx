"use client";

import type { MeResponse } from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptInvitationAction, declineInvitationAction } from "@/app/actions/team";
import { Banner, Button, Card } from "@/components/ui";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";

export function JoinList({ invitations }: { invitations: MeResponse["pendingInvitations"] }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(id: string, accept: boolean) {
    setError(null);
    start(async () => {
      const r = accept ? await acceptInvitationAction(id) : await declineInvitationAction(id);
      if (r.ok) {
        router.push(accept ? "/app" : "/");
        return router.refresh();
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setError(errorText(t, r));
    });
  }

  return (
    <div className="mt-6 space-y-4">
      {error && (
        <Banner tone="warn" role="alert">
          {error}
        </Banner>
      )}
      {invitations.map((i) => (
        <Card key={i.id} className="p-4 sm:p-5">
          <p className="text-xl font-extrabold">{i.orgName}</p>
          <p className="mt-1">
            {t("join.asRole", { role: t(`roles.${i.role}`) })} ·{" "}
            {t("join.expires", { date: new Date(i.expiresAt).toLocaleDateString() })}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={pending} onClick={() => respond(i.id, true)}>
              {t("join.accept")}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => respond(i.id, false)}>
              {t("join.decline")}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
