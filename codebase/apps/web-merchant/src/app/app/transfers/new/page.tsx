import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TransferBuilder } from "@/components/transfer-ui";
import { Card } from "@/components/ui";
import { loadBranches, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("transfers");
  return { title: t("new") };
}

export default async function NewTransferPage() {
  const { membership } = await requireOrg();
  const [org, branches, t] = await Promise.all([
    loadOrg(membership.orgId),
    loadBranches(membership.orgId),
    getTranslations("transfers"),
  ]);
  if (!org.permissions.includes("transfer.manage") || org.status !== "active") redirect("/app/transfers");
  return (
    <div className="space-y-4">
      <Link href="/app/transfers" className="font-bold underline">
        ← {t("title")}
      </Link>
      {branches.length < 2 ? (
        <Card>
          <p className="font-bold">{t("needTwo")}</p>
        </Card>
      ) : (
        <TransferBuilder orgId={membership.orgId} branches={branches} />
      )}
    </div>
  );
}
