import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ScanFinder } from "@/components/scan-ui";
import { Card } from "@/components/ui";
import { loadBranches, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("scan");
  return { title: t("title") };
}

export default async function ScanPage() {
  const { membership } = await requireOrg();
  const [org, branches, t] = await Promise.all([
    loadOrg(membership.orgId),
    loadBranches(membership.orgId),
    getTranslations("scan"),
  ]);
  const live = org.status === "active";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold">{t("title")}</h1>
        <p className="mt-1 text-ink/80">{t("sub")}</p>
      </div>
      {branches.length === 0 ? (
        <Card>
          <p className="font-bold">{t("needBranch")}</p>
          <Link href="/app/branches/new" className="mt-2 inline-block font-bold underline">
            {t("addBranch")}
          </Link>
        </Card>
      ) : (
        <ScanFinder
          orgId={membership.orgId}
          branches={branches}
          canSell={live && org.permissions.includes("sale.record")}
          canStock={live && org.permissions.includes("stock.write")}
          canCreate={live && org.permissions.includes("catalogue.write")}
        />
      )}
    </div>
  );
}
