import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OnboardingShell } from "@/components/onboarding-shell";
import { activeMembership, loadBranches, requireSession } from "@/lib/server/dal";
import { OrgForm } from "./org-form";

export async function generateMetadata() {
  const t = await getTranslations("shopForm");
  return { title: t("title") };
}

export default async function ShopStep() {
  const me = await requireSession();
  const membership = await activeMembership(me);
  if (membership) {
    // The shop already exists: continue where the person left off.
    const branches = await loadBranches(membership.orgId);
    redirect(branches.length ? "/app" : "/onboarding/location");
  }
  return (
    <OnboardingShell step={1}>
      <OrgForm />
    </OnboardingShell>
  );
}
