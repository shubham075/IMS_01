import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { loadBranches, loadOrg, loadTransfers, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("transfers");
  return { title: t("title") };
}

const PAGE = 20;
const STATUSES = ["draft", "dispatched", "received", "cancelled"] as const;

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const { membership } = await requireOrg();
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const page = Math.min(5000, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const [org, branches, list, t, locale] = await Promise.all([
    loadOrg(membership.orgId),
    loadBranches(membership.orgId),
    loadTransfers(membership.orgId, { status, limit: PAGE, offset: (page - 1) * PAGE }),
    getTranslations("transfers"),
    getLocale(),
  ]);
  const canCreate =
    org.permissions.includes("transfer.manage") && org.status === "active" && branches.length >= 2;
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium" }).format(
      new Date(iso),
    );
  const href = (over: { status?: string; page?: number }) => {
    const p = new URLSearchParams();
    const s = "status" in over ? over.status : status;
    if (s) p.set("status", s);
    if (over.page && over.page > 1) p.set("page", String(over.page));
    const q = p.toString();
    return `/app/transfers${q ? `?${q}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(list.total / PAGE));
  const chip = (key: string | undefined, label: string) => (
    <Link
      key={label}
      href={href({ status: key })}
      aria-current={status === key ? "true" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center rounded-control border-2 border-ink px-3 font-semibold",
        status === key ? "bg-volt shadow-hard-sm" : "bg-paper hover:bg-grey/50",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">{t("title")}</h1>
          <p className="mt-1 text-ink/80">{t("sub")}</p>
        </div>
        {canCreate && (
          <Link
            href="/app/transfers/new"
            className="inline-flex min-h-12 items-center rounded-control border-[2.5px] border-ink bg-ink px-5 font-bold text-paper shadow-hard-sm hover:bg-volt hover:text-ink"
          >
            + {t("new")}
          </Link>
        )}
      </div>
      {branches.length < 2 && <p className="mt-5 font-semibold">{t("needTwo")}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {chip(undefined, t("filterAll"))}
        {STATUSES.map((s) => chip(s, t(`status.${s}`)))}
      </div>

      {list.items.length === 0 ? (
        <Card className="mt-6">
          <p className="font-bold">{t("empty")}</p>
        </Card>
      ) : (
        <>
          <ul className="mt-5 divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
            {list.items.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/app/transfers/${x.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-volt focus-visible:bg-volt"
                >
                  <span className="min-w-0">
                    <span className="block font-bold">
                      {x.fromBranchName} → {x.toBranchName}
                    </span>
                    <span className="block text-sm text-ink/75">
                      {x.lineCount === 1 ? t("lineCountOne") : t("lineCount", { n: x.lineCount })} ·{" "}
                      {when(x.createdAt)}
                    </span>
                  </span>
                  <Pill tone={x.status === "dispatched" ? "volt" : x.status === "received" ? "ink" : "grey"}>
                    {t(`status.${x.status}`)}
                  </Pill>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label={t("pages")} className="mt-5 flex items-center justify-between gap-3">
              {page > 1 ? (
                <Link href={href({ page: page - 1 })} className="font-bold underline">
                  ← {t("prev")}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm">{t("pageOf", { page, pages })}</span>
              {page < pages ? (
                <Link href={href({ page: page + 1 })} className="font-bold underline">
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
