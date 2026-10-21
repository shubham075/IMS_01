import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadBranches, loadOrg, loadTeam, requireOrg } from "@/lib/server/dal";
import { TeamManager } from "./team-manager";

export async function generateMetadata() {
  const t = await getTranslations("team");
  return { title: t("title") };
}

export default async function TeamPage() {
  const { me, membership } = await requireOrg();
  const org = await loadOrg(membership.orgId);
  if (!org.permissions.includes("staff.manage")) redirect("/app");
  const [team, branches] = await Promise.all([loadTeam(membership.orgId), loadBranches(membership.orgId)]);
  return (
    <TeamManager
      orgId={membership.orgId}
      myUserId={me.user.id}
      myRole={org.myRole}
      scoped={membership.branchIds.length > 0}
      branches={branches}
      members={team.members}
      invitations={team.invitations}
    />
  );
}
