import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ImportUploader } from "@/components/import-ui";
import { Card, Pill } from "@/components/ui";
import { loadBranches, loadCategories, loadImports, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("imports");
  return { title: t("title") };
}

export default async function ImportPage() {
  const { membership } = await requireOrg();
  const org = await loadOrg(membership.orgId);
  if (!org.permissions.includes("import.run")) redirect("/app");
  const [branches, categories, past, t, locale] = await Promise.all([
    loadBranches(membership.orgId),
    loadCategories(membership.orgId),
    loadImports(membership.orgId, { limit: 20 }),
    getTranslations("imports"),
    getLocale(),
  ]);
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

      {org.status !== "active" ? (
        <Card>
          <p className="font-bold">{t("readOnly")}</p>
        </Card>
      ) : branches.length === 0 ? (
        <Card>
          <p className="font-bold">{t("needBranch")}</p>
          <Link href="/app/branches/new" className="mt-2 inline-block font-bold underline">
            {t("addBranch")}
          </Link>
        </Card>
      ) : (
        <ImportUploader orgId={membership.orgId} branches={branches} categories={categories} />
      )}

      <section aria-labelledby="past-title">
        <h2 id="past-title" className="mb-3 text-xl font-bold">
          {t("past")}
        </h2>
        {past.items.length === 0 ? (
          <p className="text-ink/80">{t("noPast")}</p>
        ) : (
          <ul className="divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
            {past.items.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/app/import/${j.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-volt focus-visible:bg-volt"
                >
                  <span className="min-w-0">
                    <span className="block font-bold">{j.fileName ?? t("untitled")}</span>
                    <span className="block text-sm text-ink/75">
                      {[j.branchName, when(j.createdAt), j.createdByName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Pill tone={j.status === "applied" ? "volt" : j.status === "undone" ? "grey" : "ink"}>
                    {t(`jobStatus.${j.status}`)}
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
