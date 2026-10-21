import { ApiError } from "@idea01/api-client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CountScreen } from "@/components/scan-ui";
import { Pill } from "@/components/ui";
import { loadBranches, loadCount, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("counts");
  return { title: t("detailTitle") };
}

export default async function CountPage({
  params,
  searchParams,
}: {
  params: Promise<{ countId: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const [{ countId }, sp] = await Promise.all([params, searchParams]);
  const { membership } = await requireOrg();
  try {
    const org = await loadOrg(membership.orgId);
    if (!org.permissions.includes("count.run")) redirect("/app");
    const branches = await loadBranches(membership.orgId);
    const branch = branches.find((b) => b.id === sp.branch) ?? branches[0];
    if (!branch) notFound();
    const [count, t] = await Promise.all([
      loadCount(membership.orgId, branch.id, countId),
      getTranslations("counts"),
    ]);
    return (
      <div className="space-y-5">
        <div>
          <Link href={`/app/counts?branch=${branch.id}`} className="font-bold underline">
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold">{t("detailTitle")}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-ink/80">
            <Pill tone={count.status === "draft" ? "volt" : count.status === "finalized" ? "ink" : "grey"}>
              {t(`status.${count.status}`)}
            </Pill>
            {branches.length > 1 ? count.branchName : null}
          </p>
          {count.status === "finalized" && (
            <p className="mt-2 font-semibold">{t("finalizedBody", { n: count.corrections })}</p>
          )}
          {count.status === "abandoned" && <p className="mt-2 font-semibold">{t("abandonedBody")}</p>}
        </div>
        <CountScreen orgId={membership.orgId} count={count} canCount={org.status === "active"} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  }
}
