import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CataloguePicker } from "@/components/catalogue-picker";
import { ProductForm } from "@/components/product-form";
import { cn } from "@/lib/cn";
import { cleanQuery } from "@/lib/form";
import { loadCategories, loadOrg, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("products");
  return { title: t("add") };
}

export default async function AddProductPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; barcode?: string }>;
}) {
  const { tab, barcode } = await searchParams;
  const { membership } = await requireOrg();
  const org = await loadOrg(membership.orgId);
  if (!org.permissions.includes("catalogue.write") || org.status !== "active") redirect("/app/products");
  const [categories, t] = await Promise.all([loadCategories(membership.orgId), getTranslations("products")]);
  const custom = tab === "custom";
  const tabClass = (on: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-control border-[2.5px] border-ink px-4 font-bold",
      on ? "bg-volt shadow-hard-sm" : "bg-paper hover:bg-grey/50",
    );
  return (
    <div>
      <h1 className="text-3xl font-extrabold">{t("add")}</h1>
      <div role="tablist" aria-label={t("add")} className="mt-4 flex flex-wrap gap-2">
        <Link href="/app/products/add" role="tab" aria-selected={!custom} className={tabClass(!custom)}>
          {t("tabCatalogue")}
        </Link>
        <Link
          href="/app/products/add?tab=custom"
          role="tab"
          aria-selected={custom}
          className={tabClass(custom)}
        >
          {t("tabCustom")}
        </Link>
      </div>
      <div className="mt-5">
        {custom ? (
          <ProductForm
            orgId={membership.orgId}
            categories={categories}
            initialBarcode={cleanQuery(barcode)}
          />
        ) : (
          <CataloguePicker orgId={membership.orgId} categories={categories} />
        )}
      </div>
    </div>
  );
}
