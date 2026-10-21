import { ApiError } from "@idea01/api-client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DraftActions, ReceiveForm } from "@/components/transfer-ui";
import { Card, Pill } from "@/components/ui";
import { loadOrg, loadTransfer, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("transfers");
  return { title: t("detailTitle") };
}

export default async function TransferPage({ params }: { params: Promise<{ transferId: string }> }) {
  const { transferId } = await params;
  const { membership } = await requireOrg();
  try {
    const [org, tr, t, tu, locale] = await Promise.all([
      loadOrg(membership.orgId),
      loadTransfer(membership.orgId, transferId),
      getTranslations("transfers"),
      getTranslations("units"),
      getLocale(),
    ]);
    const can = org.permissions.includes("transfer.manage") && org.status === "active";
    const scoped = membership.branchIds.length > 0;
    const mine = (id: string) => !scoped || membership.branchIds.includes(id);
    const when = (iso: string | null) =>
      iso
        ? new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(iso))
        : null;
    const num = new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", { maximumFractionDigits: 3 });

    return (
      <div className="space-y-6">
        <div>
          <Link href="/app/transfers" className="font-bold underline">
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold">
            {tr.fromBranchName} → {tr.toBranchName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-ink/80">
            <Pill tone={tr.status === "dispatched" ? "volt" : tr.status === "received" ? "ink" : "grey"}>
              {t(`status.${tr.status}`)}
            </Pill>
            {[tr.createdByName, when(tr.createdAt)].filter(Boolean).join(" · ")}
          </p>
          {tr.note && <p className="mt-2 font-semibold">{tr.note}</p>}
          {tr.status === "dispatched" && <p className="mt-2 font-semibold">{t("inTransit")}</p>}
        </div>

        {tr.status === "draft" && (
          <DraftActions orgId={membership.orgId} transfer={tr} canAct={can && mine(tr.fromBranchId)} />
        )}
        {tr.status === "dispatched" && (
          <ReceiveForm orgId={membership.orgId} transfer={tr} canAct={can && mine(tr.toBranchId)} />
        )}

        {(tr.status === "received" || tr.status === "cancelled") && (
          <Card className="p-4 sm:p-5">
            <ul className="divide-y-2 divide-ink">
              {tr.lines.map((l) => (
                <li key={l.productId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="font-bold">{l.name}</span>
                  <span>
                    {tr.status === "received" && l.qtyReceived !== null
                      ? t("receivedOf", {
                          got: num.format(l.qtyReceived),
                          sent: num.format(l.qtySent),
                          unit: tu(l.unit as "pcs"),
                        })
                      : `${num.format(l.qtySent)} ${tu(l.unit as "pcs")}`}
                    {tr.status === "received" && l.qtyReceived !== null && l.qtyReceived < l.qtySent && (
                      <Pill tone="ink" className="ml-2">
                        {t("short", { n: num.format(l.qtySent - l.qtyReceived) })}
                      </Pill>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {tr.status === "received" && <p className="mt-3 text-sm">{when(tr.receivedAt)}</p>}
          </Card>
        )}
      </div>
    );
  } catch (err) {
    if (err instanceof ApiError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  }
}
