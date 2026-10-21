import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BranchForm } from "@/components/branch-form";
import { OnboardingShell } from "@/components/onboarding-shell";
import { loadBranches, requireOrg } from "@/lib/server/dal";
import { env } from "@/lib/server/env";

export async function generateMetadata() {
  const t = await getTranslations("branchForm");
  return { title: t("createTitle") };
}

export default async function LocationStep() {
  const { membership } = await requireOrg(); // no shop yet -> sent to the shop step
  const branches = await loadBranches(membership.orgId);
  if (branches.length) redirect("/app");
  return (
    <OnboardingShell step={2}>
      <BranchForm orgId={membership.orgId} tileUrl={env.NEXT_PUBLIC_MAP_TILE_URL} nextPath="/app" />
    </OnboardingShell>
  );
}
