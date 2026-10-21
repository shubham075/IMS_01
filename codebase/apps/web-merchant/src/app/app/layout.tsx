import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NavLink } from "@/components/nav-link";
import { OrgSwitcher } from "@/components/org-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { Banner, Logo, Pill } from "@/components/ui";
import { loadBranches, loadOrg, requireOrg } from "@/lib/server/dal";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { me, membership } = await requireOrg();
  const [org, branches, t] = await Promise.all([
    loadOrg(membership.orgId),
    loadBranches(membership.orgId),
    getTranslations(),
  ]);
  const canManageTeam = org.permissions.includes("staff.manage");

  return (
    <div className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-5">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold leading-tight">{org.name}</p>
            <Pill tone="volt">{t(`roles.${org.myRole}`)}</Pill>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <OrgSwitcher orgs={me.memberships} current={membership.orgId} />
          <LocaleSwitcher />
          <SignOutButton />
        </div>
      </header>

      <nav aria-label="Main" className="mb-6 flex flex-wrap gap-2">
        <NavLink href="/app" exact>
          {t("console.nav.home")}
        </NavLink>
        <NavLink href="/app/products">{t("console.nav.products")}</NavLink>
        <NavLink href="/app/stock">{t("console.nav.stock")}</NavLink>
        {branches.length >= 2 && <NavLink href="/app/transfers">{t("console.nav.transfers")}</NavLink>}
        <NavLink href="/app/branches">{t("console.nav.branches")}</NavLink>
        {canManageTeam && <NavLink href="/app/team">{t("console.nav.team")}</NavLink>}
      </nav>

      {org.status === "read_only" && (
        <Banner tone="warn" role="status" className="mb-5">
          {t("console.readOnly")}
        </Banner>
      )}
      <main id="main">{children}</main>
    </div>
  );
}
