import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Banner, Card, Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { loadBranches, loadOrg, loadProducts, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("console.nav");
  return { title: t("home") };
}

export default async function Dashboard() {
  const { me, membership } = await requireOrg();
  const [org, branches, products, t] = await Promise.all([
    loadOrg(membership.orgId),
    loadBranches(membership.orgId),
    loadProducts(membership.orgId, { status: "all", limit: 100 }),
    getTranslations("dashboard"),
  ]);
  const published = products.items.some((p) => p.publishedBranchCount > 0);
  const located = branches.some((b) => b.location && b.hoursVerified);
  const items: Array<{ done: boolean; label: string; href?: string }> = [
    { done: true, label: t("shopDone") },
    {
      done: located,
      label: located ? t("locationDone") : t("locationTodo"),
      href: branches[0] ? `/app/branches/${branches[0].id}` : "/app/branches/new",
    },
    {
      done: products.total > 0,
      label:
        products.total === 1
          ? t("productsDoneOne")
          : products.total > 1
            ? t("productsDone", { n: products.total })
            : t("productsTodo"),
      href: "/app/products/add",
    },
    {
      done: published,
      label: published ? t("publishDone") : t("publishTodo"),
      href: products.total > 0 ? "/app/products" : undefined,
    },
  ];
  const firstName = me.user.displayName?.split(" ")[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section>
        <h1 className="text-3xl font-extrabold">
          {firstName ? t("welcome", { name: firstName }) : t("welcomeNoName")}
        </h1>
        <p className="mt-1 text-ink/80">{t("sub")}</p>

        {me.pendingInvitations.length > 0 && (
          <Banner
            tone="warn"
            role="status"
            className="mt-5 flex flex-wrap items-center justify-between gap-3"
          >
            <span>{t("invitations")}</span>
            <Link href="/join" className="font-bold underline">
              {t("viewInvitations")}
            </Link>
          </Banner>
        )}

        <Card className="mt-6">
          <h2 className="text-xl font-bold">{t("checklist")}</h2>
          <ol className="mt-4 space-y-3">
            {items.map((i) => (
              <li key={i.label} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 grid size-7 shrink-0 place-items-center rounded-chip border-2 border-ink text-sm font-black",
                    i.done ? "bg-volt" : "bg-grey/50",
                  )}
                >
                  {i.done ? "✓" : "○"}
                </span>
                <span className={cn("pt-0.5", !i.done && !i.href && "text-ink/70")}>
                  {i.href && !i.done ? (
                    <Link href={i.href} className="font-bold underline">
                      {i.label}
                    </Link>
                  ) : (
                    i.label
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <aside className="space-y-4">
        <Card className="p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink/75">{t("plan")}</p>
          <p className="mt-1 text-2xl font-extrabold">{t("planFree")}</p>
        </Card>
        <Card className="p-4 sm:p-5">
          <p className="text-sm font-semibold text-ink/75">{t("role")}</p>
          <Pill tone="volt" className="mt-2">
            {(await getTranslations("roles"))(org.myRole)}
          </Pill>
        </Card>
      </aside>
    </div>
  );
}
