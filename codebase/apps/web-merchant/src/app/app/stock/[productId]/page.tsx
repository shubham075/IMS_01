import { ApiError } from "@idea01/api-client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { History, MovementForm, StatusButtons, ThresholdForm } from "@/components/stock-panel";
import { Card, Pill } from "@/components/ui";
import { loadBranches, loadMovements, loadOrg, loadStock, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("stock");
  return { title: t("productTitle") };
}

export default async function ProductStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ branch?: string; page?: string }>;
}) {
  const [{ productId }, sp] = await Promise.all([params, searchParams]);
  const { membership } = await requireOrg();
  try {
    const branches = await loadBranches(membership.orgId);
    const branch = branches.find((b) => b.id === sp.branch) ?? branches[0];
    if (!branch) notFound();
    const page = Math.min(5000, Math.max(1, Math.floor(Number(sp.page)) || 1));
    const [org, stock, history, t, tu, locale] = await Promise.all([
      loadOrg(membership.orgId),
      loadStock(membership.orgId, branch.id, { productId, limit: 1 }),
      loadMovements(membership.orgId, branch.id, { productId, limit: 20, offset: (page - 1) * 20 }),
      getTranslations("stock"),
      getTranslations("units"),
      getLocale(),
    ]);
    const line = stock.items[0];
    if (!line) notFound(); // unknown, switched off, or another shop's product
    const live = org.status === "active";
    const canStock = live && org.permissions.includes("stock.write");
    const canSell = live && org.permissions.includes("sale.record");
    const counted = line.trackingMode === "quantity";
    const num = new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", { maximumFractionDigits: 3 });
    const pages = Math.max(1, Math.ceil(history.total / 20));
    const q = (n: number) => `/app/stock/${productId}?branch=${branch.id}&page=${n}`;

    return (
      <div className="space-y-6">
        <div>
          <Link href={`/app/stock?branch=${branch.id}`} className="font-bold underline">
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold">{line.name}</h1>
          <p className="text-ink/80">
            {[line.nameHi, branches.length > 1 ? branch.name : null, line.code].filter(Boolean).join(" · ")}
          </p>
        </div>

        <Card className="p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink/75">{t("onHand")}</p>
          <p className="mt-1 text-4xl font-extrabold">
            {counted
              ? line.lastMovementAt === null
                ? t("notCounted")
                : `${num.format(line.onHand)} ${tu(line.unit as "pcs")}`
              : line.statusOverride === "in_stock"
                ? t("inStock")
                : line.statusOverride === "out_of_stock"
                  ? t("outOfStock")
                  : t("notSet")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {line.needsCheck && <Pill tone="ink">{t("badgeCheck")}</Pill>}
            {!line.needsCheck && line.isOut && <Pill tone="ink">{t("badgeOut")}</Pill>}
            {line.isLow && <Pill tone="volt">{t("badgeLow")}</Pill>}
            {counted && line.unsellable !== 0 && (
              <Pill>{t("unsellableCount", { qty: num.format(line.unsellable) })}</Pill>
            )}
          </div>
          {line.needsCheck && <p className="mt-3 font-semibold">{t("checkHelp")}</p>}
        </Card>

        {counted && (canStock || canSell) && (
          <MovementForm
            orgId={membership.orgId}
            branchId={branch.id}
            line={line}
            canStock={canStock}
            canSell={canSell}
          />
        )}
        {!counted && canStock && <StatusButtons orgId={membership.orgId} branchId={branch.id} line={line} />}
        {counted && canStock && <ThresholdForm orgId={membership.orgId} branchId={branch.id} line={line} />}
        {!canStock && !canSell && <p className="text-ink/80">{t("readOnly")}</p>}

        {counted && (
          <section aria-labelledby="history-title">
            <h2 id="history-title" className="mb-3 text-xl font-bold">
              {t("history")}
            </h2>
            <History
              orgId={membership.orgId}
              branchId={branch.id}
              items={history.items}
              unit={line.unit}
              canUndo={canStock}
            />
            {pages > 1 && (
              <nav aria-label={t("pages")} className="mt-4 flex items-center justify-between gap-3">
                {page > 1 ? (
                  <Link href={q(page - 1)} className="font-bold underline">
                    ← {t("prev")}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm">{t("pageOf", { page, pages })}</span>
                {page < pages ? (
                  <Link href={q(page + 1)} className="font-bold underline">
                    {t("next")} →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </section>
        )}
      </div>
    );
  } catch (err) {
    if (err instanceof ApiError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  }
}
