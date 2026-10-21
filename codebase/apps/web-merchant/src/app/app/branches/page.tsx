import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GoLive } from "@/components/go-live";
import { Card, Pill } from "@/components/ui";
import { loadBranches, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("branches");
  return { title: t("title") };
}

export default async function BranchesPage() {
  const { membership } = await requireOrg();
  const [org, branches, t] = await Promise.all([
    loadOrg(membership.orgId),
    loadBranches(membership.orgId),
    getTranslations("branches"),
  ]);
  const canManage = org.permissions.includes("branch.manage");
  const canPublish = org.permissions.includes("publication.manage") && org.status === "active";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">{t("title")}</h1>
          <p className="mt-1 text-ink/80">{t("sub")}</p>
        </div>
        {canManage && org.status === "active" && (
          <Link
            href="/app/branches/new"
            className="inline-flex min-h-12 items-center rounded-control border-[2.5px] border-ink bg-ink px-5 font-bold text-paper shadow-hard-sm hover:bg-volt hover:text-ink"
          >
            + {t("add")}
          </Link>
        )}
      </div>

      {branches.length === 0 ? (
        <p className="mt-8 text-ink/75">{t("empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {branches.map((b) => (
            <li key={b.id}>
              <Card className="h-full p-4 sm:p-5">
                <h2 className="text-lg font-bold">{b.name}</h2>
                <p className="mt-1 text-sm text-ink/80">
                  {[b.addressLine, b.area, b.city, b.pincode].filter(Boolean).join(", ")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill tone={b.location ? "volt" : "grey"}>
                    {b.location ? `✓ ${t("pinSet")}` : t("pinMissing")}
                  </Pill>
                  <Pill tone={b.hoursVerified ? "volt" : "grey"}>
                    {b.hoursVerified ? `✓ ${t("hoursSet")}` : t("hoursMissing")}
                  </Pill>
                  <Pill>{b.isPublished ? t("public") : t("notPublic")}</Pill>
                </div>
                <GoLive orgId={membership.orgId} branch={b} canPublish={canPublish} />
                {canManage && org.status === "active" && (
                  <Link href={`/app/branches/${b.id}`} className="mt-4 inline-block font-bold underline">
                    {t("edit")}
                  </Link>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
