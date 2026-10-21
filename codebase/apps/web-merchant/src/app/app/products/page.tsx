import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, Pill } from "@/components/ui";
import { formatRupees } from "@/lib/money";
import { loadCategories, loadOrg, loadProducts, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("products");
  return { title: t("title") };
}

const PAGE = 20;
type Search = { q?: string; status?: string; category?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { membership } = await requireOrg();
  const status = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const category = sp.category && /^[0-9a-f-]{36}$/i.test(sp.category) ? sp.category : undefined;
  const [org, categories, list, t, tu] = await Promise.all([
    loadOrg(membership.orgId),
    loadCategories(membership.orgId),
    loadProducts(membership.orgId, {
      q,
      status,
      categoryId: category,
      limit: PAGE,
      offset: (page - 1) * PAGE,
    }),
    getTranslations("products"),
    getTranslations("units"),
  ]);
  const canEdit = org.permissions.includes("catalogue.write") && org.status === "active";
  const filtered = !!(q || category || status !== "active");
  const href = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { q, status: status === "active" ? undefined : status, category, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/app/products${s ? `?${s}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(list.total / PAGE));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">{t("title")}</h1>
          <p className="mt-1 text-ink/80">{t("sub")}</p>
        </div>
        {canEdit && (
          <Link
            href="/app/products/add"
            className="inline-flex min-h-12 items-center rounded-control border-[2.5px] border-ink bg-ink px-5 font-bold text-paper shadow-hard-sm hover:bg-volt hover:text-ink"
          >
            + {t("add")}
          </Link>
        )}
      </div>

      <search className="mt-5 block">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_12rem_9rem_auto]">
          <label className="sr-only" htmlFor="q">
            {t("searchLabel")}
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            className="min-h-12 w-full rounded-control border-[2.5px] border-ink bg-paper px-3.5 focus:shadow-volt focus:outline-none"
          />
          <label className="sr-only" htmlFor="category">
            {t("category")}
          </label>
          <select
            id="category"
            name="category"
            defaultValue={category ?? ""}
            className="min-h-12 rounded-control border-[2.5px] border-ink bg-paper px-3"
          >
            <option value="">{t("allCategories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="status">
            {t("statusLabel")}
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="min-h-12 rounded-control border-[2.5px] border-ink bg-paper px-3"
          >
            <option value="active">{t("statusActive")}</option>
            <option value="inactive">{t("statusInactive")}</option>
            <option value="all">{t("statusAll")}</option>
          </select>
          <button
            type="submit"
            className="min-h-12 rounded-control border-[2.5px] border-ink bg-paper px-5 font-bold shadow-hard-sm hover:bg-grey"
          >
            {t("filter")}
          </button>
        </form>
      </search>

      {list.items.length === 0 ? (
        <Card className="mt-6">
          <p className="font-bold">{filtered ? t("noMatch") : t("empty")}</p>
          {!filtered && <p className="mt-1 text-ink/80">{t("emptyHelp")}</p>}
          {filtered ? (
            <Link href="/app/products" className="mt-3 inline-block font-bold underline">
              {t("clear")}
            </Link>
          ) : (
            canEdit && (
              <Link href="/app/products/add" className="mt-3 inline-block font-bold underline">
                {t("addFirst")}
              </Link>
            )
          )}
        </Card>
      ) : (
        <>
          <p className="mt-5 text-sm text-ink/80" role="status">
            {list.total === 1 ? t("countOne") : t("count", { n: list.total })}
          </p>
          <ul className="mt-2 divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
            {list.items.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/app/products/${p.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-volt focus-visible:bg-volt"
                >
                  <span className="min-w-0">
                    <span className="block font-bold">{p.name}</span>
                    <span className="block text-sm text-ink/75">
                      {[p.nameHi, p.brand, p.packSize, tu(p.unit as "pcs")].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {p.pricePaise !== null && <span className="font-bold">{formatRupees(p.pricePaise)}</span>}
                    {p.status !== "active" && <Pill>{t("off")}</Pill>}
                    {p.publishedBranchCount > 0 && (
                      <Pill tone="volt">{t("shownAt", { n: p.publishedBranchCount })}</Pill>
                    )}
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
