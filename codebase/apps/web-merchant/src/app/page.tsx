import { redirect } from "next/navigation";
import { activeMembership, getSession } from "@/lib/server/dal";

/** Entry point: send each person to the place where they can continue. */
export default async function Home() {
  const me = await getSession();
  if (!me) redirect("/login");
  if (await activeMembership(me)) redirect("/app");
  redirect(me.pendingInvitations.length ? "/join" : "/onboarding/shop");
}
