import { ApiError } from "@idea01/api-client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { RowTable, UndoImport } from "@/components/import-ui";
import { Card, Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { loadImport, loadImportRows, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("imports");
  return { title: t("reportTitle") };
}

const PAGE = 50;
const FILTERS = ["error", "skipped", "applied", "ok"] as const;

export default async function ImportReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ importId: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const [{ importId }, sp] = await Promise.all([params, searchParams]);
  const { membership } = await requireOrg();
  const status = (FILTERS as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const page = Math.min(5000, Math.max(1, Math.floor(Number(sp.page)) || 1));
  try {
    const org = await loadOrg(membership.orgId);
    if (!org.permissions.includes("import.run")) redirect("/app");
    const [job, rows, t, locale] = await Promise.all([
      loadImport(membership.orgId, importId),
      loadImportRows(membership.orgId, importId, { status, limit: PAGE, offset: (page - 1) * PAGE }),
      getTranslations("imports"),
      getLocale(),
    ]);
    const when = (iso: string | null) =>
      iso
        ? new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(iso))
        : null;
    const href = (s?: string, p?: number) => {
      const q = new URLSearchParams();
      if (s) q.set("status", s);
      if (p && p > 1) q.set("page", String(p));
      const str = q.toString();
      return `/app/import/${importId}${str ? `?${str}` : ""}`;
    };
    const pages = Math.max(1, Math.ceil(rows.total / PAGE));
    const chip = (key: string | undefined, label: string) => (
      <Link
        key={label}
        href={href(key)}
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
      <div className="space-y-6">
        <div>
          <Link href="/app/import" className="font-bold underline">
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold">{job.fileName ?? t("untitled")}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-ink/80">
            <Pill tone={job.status === "applied" ? "volt" : job.status === "undone" ? "grey" : "ink"}>
              {t(`jobStatus.${job.status}`)}
            </Pill>
            {[job.branchName, when(job.createdAt), job.createdByName].filter(Boolean).join(" · ")}
          </p>
        </div>

        <Card className="p-4 sm:p-5">
          <p className="flex flex-wrap gap-2" role="status">
            <Pill tone="volt">{t("okCount", { n: job.okRows })}</Pill>
            {job.skippedRows > 0 && <Pill>{t("skippedCount", { n: job.skippedRows })}</Pill>}
            {job.errorRows > 0 && <Pill tone="ink">{t("errorCount", { n: job.errorRows })}</Pill>}
          </p>
          {job.status === "applied" && (
            <p className="mt-3 font-semibold">{t("doneBody", { n: job.appliedRows })}</p>
          )}
          {job.status === "undone" && (
            <p className="mt-3 font-semibold">{t("undoneBody", { when: when(job.undoneAt) ?? "" })}</p>
          )}
          {org.status === "active" && <UndoImport orgId={membership.orgId} job={job} />}
        </Card>

        <div className="flex flex-wrap gap-2">
          {chip(undefined, t("filterAll"))}
          {FILTERS.map((f) => chip(f, t(`rowStatus.${f}`)))}
        </div>
        <RowTable rows={rows.items} />
        {pages > 1 && (
          <nav aria-label={t("pages")} className="flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link href={href(status, page - 1)} className="font-bold underline">
                ← {t("prev")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm">{t("pageOf", { page, pages })}</span>
            {page < pages ? (
              <Link href={href(status, page + 1)} className="font-bold underline">
                {t("next")} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    );
  } catch (err) {
    if (err instanceof ApiError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  }
}
