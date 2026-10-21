import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { StartCount } from "@/components/scan-ui";
import { Card, Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { loadBranches, loadCounts, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("counts");
  return { title: t("title") };
}

export default async function CountsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const { membership } = await requireOrg();
  const org = await loadOrg(membership.orgId);
  if (!org.permissions.includes("count.run")) redirect("/app");
  const [branches, t, locale] = await Promise.all([
    loadBranches(membership.orgId),
    getTranslations("counts"),
    getLocale(),
  ]);
  const branch = branches.find((b) => b.id === sp.branch) ?? branches[0];
  if (!branch)
    return (
      <Card>
        <p className="font-bold">{t("needBranch")}</p>
      </Card>
    );
  const list = await loadCounts(membership.orgId, branch.id, { limit: 20 });
  const open = list.items.find((c) => c.status === "draft");
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">{t("title")}</h1>
        <p className="mt-1 text-ink/80">{t("sub")}</p>
      </div>
      {branches.length > 1 && (
        <nav aria-label={t("branch")} className="flex flex-wrap gap-2">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/app/counts?branch=${b.id}`}
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
      {org.status === "active" && (
        <Card>
          <p className="mb-3">{open ? t("openHelp", { n: open.lineCount }) : t("startHelp")}</p>
          <StartCount orgId={membership.orgId} branchId={branch.id} hasOpen={!!open} />
        </Card>
      )}
      <section aria-labelledby="past-counts">
        <h2 id="past-counts" className="mb-3 text-xl font-bold">
          {t("past")}
        </h2>
        {list.items.length === 0 ? (
          <p className="text-ink/80">{t("none")}</p>
        ) : (
          <ul className="divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
            {list.items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/counts/${c.id}?branch=${branch.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-volt focus-visible:bg-volt"
                >
                  <span>
                    <span className="block font-bold">{when(c.startedAt)}</span>
                    <span className="block text-sm text-ink/75">
                      {[c.startedByName, t("products", { n: c.lineCount })].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Pill tone={c.status === "draft" ? "volt" : c.status === "finalized" ? "ink" : "grey"}>
                    {t(`status.${c.status}`)}
                  </Pill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
