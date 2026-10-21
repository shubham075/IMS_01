import { ApiError } from "@idea01/api-client";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BranchForm } from "@/components/branch-form";
import { loadBranch, loadOrg, requireOrg } from "@/lib/server/dal";
import { env } from "@/lib/server/env";

export async function generateMetadata() {
  const t = await getTranslations("branchForm");
  return { title: t("editTitle") };
}

export default async function EditBranchPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const { membership } = await requireOrg();
  const org = await loadOrg(membership.orgId);
  if (!org.permissions.includes("branch.manage")) redirect("/app/branches");
  try {
    const branch = await loadBranch(membership.orgId, branchId);
    return (
      <BranchForm
        orgId={membership.orgId}
        tileUrl={env.NEXT_PUBLIC_MAP_TILE_URL}
        branch={branch}
        nextPath="/app/branches"
      />
    );
  } catch (err) {
    if (err instanceof ApiError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  }
}
