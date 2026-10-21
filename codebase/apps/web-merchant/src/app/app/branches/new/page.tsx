import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BranchForm } from "@/components/branch-form";
import { loadOrg, requireOrg } from "@/lib/server/dal";
import { env } from "@/lib/server/env";

export async function generateMetadata() {
  const t = await getTranslations("branches");
  return { title: t("add") };
}

export default async function NewBranchPage() {
  const { membership } = await requireOrg();
  const org = await loadOrg(membership.orgId);
  if (!org.permissions.includes("branch.manage")) redirect("/app/branches");
  return (
    <BranchForm orgId={membership.orgId} tileUrl={env.NEXT_PUBLIC_MAP_TILE_URL} nextPath="/app/branches" />
  );
}
