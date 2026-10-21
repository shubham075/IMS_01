"use client";

import {
  type Category,
  createProductSchema,
  type ProductDetail,
  UNITS,
  updateProductSchema,
} from "@idea01/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { createProductAction, updateProductAction } from "@/app/actions/catalogue";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { clean, localizedErrors, localizedFieldErrors, newKey } from "@/lib/form";
import { paiseToInput, parseRupees } from "@/lib/money";
import { Banner, Button, Card, Field, Input, Select } from "./ui";

interface Props {
  orgId: string;
  categories: Category[];
  /** Present when editing. */
  product?: ProductDetail;
}

export function ProductForm({ orgId, categories, product }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const lang = useLocale();
  const editing = !!product;
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ text: string; existingId?: string; ref?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const idempotencyKey = useRef(newKey());

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const price = parseRupees(String(fd.get("price") ?? ""));
    const cost = parseRupees(String(fd.get("cost") ?? ""));
    const threshold = String(fd.get("threshold") ?? "").trim();
    const localErrors: Record<string, string> = {};
    if (!editing && !fd.get("categoryId")) localErrors.categoryId = t("validation.chooseCategory");
    if (!price.ok) localErrors.price = t("validation.priceFormat");
    if (!cost.ok) localErrors.cost = t("validation.priceFormat");
    if (threshold !== "" && !(Number(threshold) >= 0)) localErrors.threshold = t("validation.threshold");
    const raw = {
      ...clean({
        name: fd.get("name"),
        categoryId: fd.get("categoryId"),
        unit: fd.get("unit"),
        brand: fd.get("brand"),
        model: fd.get("model"),
        nameHi: fd.get("nameHi"),
        packSize: fd.get("packSize"),
        ...(editing ? {} : { barcode: fd.get("barcode"), sku: fd.get("sku") }),
      }),
      trackingMode: fd.get("statusOnly") ? "status_only" : "quantity",
      ...(threshold !== "" ? { lowStockThreshold: Number(threshold) } : {}),
      ...(price.ok ? (editing || price.paise !== null ? { pricePaise: price.paise } : {}) : {}),
      ...(cost.ok ? (editing || cost.paise !== null ? { costPaise: cost.paise } : {}) : {}),
    };
    setBanner(null);
    setSaved(false);
    const parsed = (editing ? updateProductSchema : createProductSchema).safeParse(raw);
    const errs = { ...(parsed.success ? {} : localizedErrors(t, parsed.error)), ...localErrors };
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    start(async () => {
      const r = editing
        ? await updateProductAction(orgId, product.id, raw)
        : await createProductAction(orgId, raw, idempotencyKey.current);
      if (r.ok) {
        if (editing) {
          setSaved(true);
          return router.refresh();
        }
        return router.push(`/app/products/${r.data.id}`);
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setErrors(localizedFieldErrors(t, r.fieldErrors));
      setBanner({
        text: errorText(t, r),
        existingId: r.code === "DUPLICATE_IDENTIFIER" ? r.existingId : undefined,
        ref: r.code === "INTERNAL_ERROR" ? r.traceId : undefined,
      });
      if (!editing && r.code !== "IDEMPOTENCY_IN_PROGRESS") idempotencyKey.current = newKey();
    });
  }

  return (
    <Card>
      <form noValidate onSubmit={submit} aria-labelledby="product-form-title">
        <h2 id="product-form-title" className="text-xl font-bold">
          {editing ? t("productForm.editTitle") : t("productForm.createTitle")}
        </h2>
        {banner && (
          <Banner tone="warn" role="alert" className="mt-4">
            {banner.text}
            {banner.existingId && (
              <Link href={`/app/products/${banner.existingId}`} className="ml-2 font-bold underline">
                {t("productForm.openExisting")}
              </Link>
            )}
            {banner.ref && (
              <span className="mt-1 block text-xs">{t("common.reference", { id: banner.ref })}</span>
            )}
          </Banner>
        )}
        {saved && (
          <Banner role="status" className="mt-4">
            {t("productForm.saved")}
          </Banner>
        )}

        <Field label={t("productForm.name")} htmlFor="name" error={errors.name}>
          <Input
            id="name"
            name="name"
            defaultValue={product?.name}
            aria-invalid={!!errors.name}
            autoFocus={!editing}
            placeholder={t("productForm.namePlaceholder")}
          />
        </Field>
        <Field
          label={t("productForm.nameHi")}
          htmlFor="nameHi"
          hint={t("productForm.nameHiHelp")}
          error={errors.nameHi}
        >
          <Input id="nameHi" name="nameHi" lang="hi" defaultValue={product?.nameHi ?? ""} />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label={t("productForm.category")} htmlFor="categoryId" error={errors.categoryId}>
            <Select
              id="categoryId"
              name="categoryId"
              defaultValue={product?.categoryId ?? ""}
              aria-invalid={!!errors.categoryId}
            >
              <option value="">{t("productForm.chooseCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {lang === "hi" && c.nameHi ? c.nameHi : c.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("productForm.unit")} htmlFor="unit" error={errors.unit}>
            <Select id="unit" name="unit" defaultValue={product?.unit ?? "pcs"}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("productForm.brand")} htmlFor="brand" error={errors.brand}>
            <Input id="brand" name="brand" defaultValue={product?.brand ?? ""} />
          </Field>
          <Field label={t("productForm.model")} htmlFor="model" error={errors.model}>
            <Input id="model" name="model" defaultValue={product?.model ?? ""} />
          </Field>
          <Field
            label={t("productForm.packSize")}
            htmlFor="packSize"
            hint={t("productForm.packSizeHelp")}
            error={errors.packSize}
          >
            <Input id="packSize" name="packSize" defaultValue={product?.packSize ?? ""} />
          </Field>
          <Field
            label={t("productForm.price")}
            htmlFor="price"
            hint={t("productForm.priceHelp")}
            error={errors.pricePaise ?? errors.price}
          >
            <Input
              id="price"
              name="price"
              inputMode="decimal"
              defaultValue={paiseToInput(product?.pricePaise)}
              aria-invalid={!!(errors.pricePaise ?? errors.price)}
            />
          </Field>
          <Field
            label={t("productForm.cost")}
            htmlFor="cost"
            hint={t("productForm.costHelp")}
            error={errors.costPaise ?? errors.cost}
          >
            <Input
              id="cost"
              name="cost"
              inputMode="decimal"
              defaultValue={paiseToInput(product?.costPaise)}
              aria-invalid={!!(errors.costPaise ?? errors.cost)}
            />
          </Field>
          <Field
            label={t("productForm.threshold")}
            htmlFor="threshold"
            hint={t("productForm.thresholdHelp")}
            error={errors.lowStockThreshold ?? errors.threshold}
          >
            <Input
              id="threshold"
              name="threshold"
              inputMode="decimal"
              defaultValue={product ? String(product.lowStockThreshold) : ""}
              aria-invalid={!!(errors.lowStockThreshold ?? errors.threshold)}
            />
          </Field>
        </div>

        {!editing && (
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field
              label={t("productForm.barcode")}
              htmlFor="barcode"
              hint={t("productForm.barcodeHelp")}
              error={errors.barcode}
            >
              <Input id="barcode" name="barcode" inputMode="numeric" aria-invalid={!!errors.barcode} />
            </Field>
            <Field
              label={t("productForm.sku")}
              htmlFor="sku"
              hint={t("productForm.skuHelp")}
              error={errors.sku}
            >
              <Input id="sku" name="sku" aria-invalid={!!errors.sku} />
            </Field>
          </div>
        )}

        <label className="mt-5 flex items-start gap-3">
          <input type="checkbox" name="statusOnly" defaultChecked={product?.trackingMode === "status_only"} />
          <span>
            <span className="font-semibold">{t("productForm.statusOnly")}</span>
            <span className="block text-sm text-ink/75">{t("productForm.statusOnlyHelp")}</span>
          </span>
        </label>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? t("common.saving") : editing ? t("common.save") : t("productForm.create")}
          </Button>
          {!editing && (
            <Link
              href="/app/products"
              className="inline-flex min-h-12 items-center rounded-control px-5 font-bold underline"
            >
              {t("common.cancel")}
            </Link>
          )}
        </div>
      </form>
    </Card>
  );
}
