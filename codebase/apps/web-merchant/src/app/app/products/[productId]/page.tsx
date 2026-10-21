import { ApiError } from "@idea01/api-client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { IdentifiersEditor, ListingsEditor, StatusToggle } from "@/components/product-extras";
import { ProductForm } from "@/components/product-form";
import { Card, Pill } from "@/components/ui";
import { formatRupees } from "@/lib/money";
import { loadBranches, loadCategories, loadOrg, loadProduct, requireOrg } from "@/lib/server/dal";

export async function generateMetadata() {
  const t = await getTranslations("productPage");
  return { title: t("title") };
}

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const { membership } = await requireOrg();
  try {
    const [org, product, branches, categories, t, tu] = await Promise.all([
      loadOrg(membership.orgId),
      loadProduct(membership.orgId, productId),
      loadBranches(membership.orgId),
      loadCategories(membership.orgId),
      getTranslations("productPage"),
      getTranslations("units"),
    ]);
    const live = org.status === "active";
    const canEdit = org.permissions.includes("catalogue.write") && live;
    const canPublish = org.permissions.includes("publication.manage") && live;
    const category = categories.find((c) => c.id === product.categoryId);

    return (
      <div className="space-y-6">
        <div>
          <Link href="/app/products" className="font-bold underline">
            ← {t("back")}
          </Link>
          <h1 className="mt-2 text-3xl font-extrabold">{product.name}</h1>
          {product.nameHi && (
            <p lang="hi" className="text-lg">
              {product.nameHi}
            </p>
          )}
        </div>

        {category?.restricted && (
          <Card className="bg-volt p-4">
            <p className="font-bold">{t("restricted")}</p>
          </Card>
        )}

        {canEdit ? (
          <>
            <StatusToggle orgId={membership.orgId} product={product} />
            <ProductForm orgId={membership.orgId} categories={categories} product={product} />
          </>
        ) : (
          <Card className="p-4 sm:p-5">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Row label={t("category")} value={category?.nameEn} />
              <Row label={t("unit")} value={tu(product.unit as "pcs")} />
              <Row label={t("brand")} value={product.brand} />
              <Row label={t("model")} value={product.model} />
              <Row label={t("price")} value={formatRupees(product.pricePaise)} />
              <Row label={t("status")} value={product.status === "active" ? t("on") : t("off")} />
            </dl>
            {product.shortCode && (
              <p className="mt-3 text-sm">
                {t("shortCode")} <Pill tone="ink">{product.shortCode}</Pill>
              </p>
            )}
          </Card>
        )}

        {canEdit && <IdentifiersEditor orgId={membership.orgId} product={product} />}
        <ListingsEditor
          orgId={membership.orgId}
          product={product}
          branches={branches}
          canPublish={canPublish}
        />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiError && [400, 403, 404].includes(err.status)) notFound();
    throw err;
  }
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-ink/75">{label}</dt>
      <dd className="font-bold">{value || "—"}</dd>
    </div>
  );
}
