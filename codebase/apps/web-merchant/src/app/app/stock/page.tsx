import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { cleanQuery } from "@/lib/form";
import { loadBranches, loadStock, loadStockSummary, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("stock");
  return { title: t("title") };
}

const PAGE = 20;
type Search = { branch?: string; filter?: string; q?: string; page?: string };
const FILTERS = ["all", "low", "out", "check"] as const;

export default async function StockPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { membership } = await requireOrg();
  const [branches, t, tu, locale] = await Promise.all([
    loadBranches(membership.orgId),
    getTranslations("stock"),
    getTranslations("units"),
    getLocale(),
  ]);
  const branch = branches.find((b) => b.id === sp.branch) ?? branches[0];
  if (!branch) {
    return (
      <Card>
        <p className="font-bold">{t("noBranch")}</p>
        <Link href="/app/branches/new" className="mt-2 inline-block font-bold underline">
          {t("addBranch")}
        </Link>
      </Card>
    );
  }
  const filter = (FILTERS as readonly string[]).includes(sp.filter ?? "")
    ? (sp.filter as (typeof FILTERS)[number])
    : "all";
  const page = Math.min(5000, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const q = cleanQuery(sp.q);
  const [summary, list] = await Promise.all([
    loadStockSummary(membership.orgId, branch.id),
    loadStock(membership.orgId, branch.id, { q, filter, limit: PAGE, offset: (page - 1) * PAGE }),
  ]);
  const href = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged: Search = {
      branch: branches.length > 1 ? branch.id : undefined,
      q,
      filter: filter === "all" ? undefined : filter,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/app/stock${s ? `?${s}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(list.total / PAGE));
  const num = new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", { maximumFractionDigits: 3 });
  const chip = (key: (typeof FILTERS)[number], label: string, n: number | null) => (
    <Link
      key={key}
      href={href({ filter: key === "all" ? undefined : key, page: undefined })}
      aria-current={filter === key ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-control border-[2.5px] border-ink px-4 font-bold",
        filter === key ? "bg-volt shadow-hard-sm" : "bg-paper hover:bg-grey/50",
      )}
    >
      {label}
      {n !== null && <Pill tone={key !== "all" && n > 0 ? "ink" : "grey"}>{n}</Pill>}
    </Link>
  );

  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("title")}</h1>
      <p className="mt-1 text-ink/80">{t("sub")}</p>

      {branches.length > 1 && (
        <nav aria-label={t("branch")} className="mt-4 flex flex-wrap gap-2">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/app/stock?branch=${b.id}`}
              aria-current={b.id === branch.id ? "true" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center rounded-control border-2 border-ink px-3 font-semibold",
                b.id === branch.id ? "bg-ink text-paper" : "bg-paper hover:bg-grey/50",
              )}
            >
              {b.name}
            </Link>
          ))}
        </nav>
      )}

      <fieldset className="m-0 mt-5 flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">{t("filters")}</legend>
        {chip("all", t("filterAll"), summary.products)}
        {chip("low", t("filterLow"), summary.low)}
        {chip("out", t("filterOut"), summary.out)}
        {chip("check", t("filterCheck"), summary.needsCheck)}
      </fieldset>

      <search className="mt-4 block">
        <form method="get" className="flex flex-wrap gap-3">
          {branches.length > 1 && <input type="hidden" name="branch" value={branch.id} />}
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <label className="sr-only" htmlFor="q">
            {t("search")}
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            className="min-h-12 min-w-0 flex-1 rounded-control border-[2.5px] border-ink bg-paper px-3.5 focus:shadow-volt focus:outline-none"
          />
          <button
            type="submit"
            className="min-h-12 rounded-control border-[2.5px] border-ink bg-paper px-5 font-bold shadow-hard-sm hover:bg-grey"
          >
            {t("searchButton")}
          </button>
        </form>
      </search>

      {list.items.length === 0 ? (
        <Card className="mt-6">
          <p className="font-bold">{summary.products === 0 ? t("noProducts") : t("noMatch")}</p>
          <Link
            href={summary.products === 0 ? "/app/products/add" : "/app/stock"}
            className="mt-2 inline-block font-bold underline"
          >
            {summary.products === 0 ? t("addProducts") : t("clear")}
          </Link>
        </Card>
      ) : (
        <>
          <ul className="mt-5 divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
            {list.items.map((l) => (
              <li key={l.productId}>
                <Link
                  href={`/app/stock/${l.productId}?branch=${branch.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-volt focus-visible:bg-volt"
                >
                  <span className="min-w-0">
                    <span className="block font-bold">{l.name}</span>
                    <span className="block text-sm text-ink/75">
                      {[l.nameHi, l.code].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {l.needsCheck && <Pill tone="ink">{t("badgeCheck")}</Pill>}
                    {!l.needsCheck && l.isOut && <Pill tone="ink">{t("badgeOut")}</Pill>}
                    {l.isLow && <Pill tone="volt">{t("badgeLow")}</Pill>}
                    <span className="min-w-20 text-right font-extrabold">
                      {l.trackingMode === "status_only"
                        ? l.statusOverride === "in_stock"
                          ? t("inStock")
                          : l.statusOverride === "out_of_stock"
                            ? t("outOfStock")
                            : t("notSet")
                        : l.lastMovementAt === null
                          ? t("notCounted")
                          : `${num.format(l.onHand)} ${tu(l.unit as "pcs")}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label={t("pages")} className="mt-5 flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link href={href({ page: String(page - 1) })} className="font-bold underline">
                  ← {t("prev")}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm">{t("pageOf", { page, pages })}</span>
              {page < pages ? (
                <Link href={href({ page: String(page + 1) })} className="font-bold underline">
                  {t("next")} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
