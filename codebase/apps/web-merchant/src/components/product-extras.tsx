"use client";

import type { Branch, ProductDetail } from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setIdentifiersAction, setListingAction, updateProductAction } from "@/app/actions/catalogue";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { localizedFieldErrors } from "@/lib/form";
import { paiseToInput, parseRupees, splitList } from "@/lib/money";
import { Banner, Button, Card, Field, Input, Pill } from "./ui";

/** Shows the outcome of a save, or the localized reason it failed. */
function useSaver() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  function save(
    call: () => Promise<
      | { ok: true }
      | {
          ok: false;
          code: string;
          message: string;
          fieldErrors?: Record<string, string>;
          retryAfter?: number;
        }
    >,
  ) {
    setMessage(null);
    start(async () => {
      const r = await call();
      if (r.ok) {
        setMessage({ tone: "info", text: t("productPage.saved") });
        return router.refresh();
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      const fields = Object.values(localizedFieldErrors(t, r.fieldErrors))[0];
      setMessage({ tone: "warn", text: r.code === "VALIDATION_FAILED" && fields ? fields : errorText(t, r) });
    });
  }
  return { pending, message, save };
}

function Message({ message }: { message: { tone: "info" | "warn"; text: string } | null }) {
  if (!message) return null;
  return (
    <Banner tone={message.tone} role={message.tone === "warn" ? "alert" : "status"} className="mt-3">
      {message.text}
    </Banner>
  );
}

/** Switch a product off (hidden from shoppers, cannot be sold) or back on. */
export function StatusToggle({ orgId, product }: { orgId: string; product: ProductDetail }) {
  const t = useTranslations("productPage");
  const { pending, message, save } = useSaver();
  const active = product.status === "active";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone={active ? "volt" : "grey"}>{active ? t("on") : t("off")}</Pill>
        <Button
          small
          variant="secondary"
          disabled={pending}
          onClick={() =>
            save(() => updateProductAction(orgId, product.id, { status: active ? "inactive" : "active" }))
          }
        >
          {active ? t("switchOff") : t("switchOn")}
        </Button>
      </div>
      <Message message={message} />
    </div>
  );
}

/** Barcodes, product codes and extra names people might search by. */
export function IdentifiersEditor({ orgId, product }: { orgId: string; product: ProductDetail }) {
  const t = useTranslations("productPage");
  const { pending, message, save } = useSaver();
  const of = (kind: string) =>
    product.identifiers
      .filter((i) => i.kind === kind)
      .map((i) => i.value)
      .join(", ");
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-xl font-bold">{t("codesTitle")}</h2>
      <p className="mt-1 text-sm text-ink/80">{t("codesHelp")}</p>
      {product.shortCode && (
        <p className="mt-3 text-sm">
          {t("shortCode")} <Pill tone="ink">{product.shortCode}</Pill>
        </p>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          save(() =>
            setIdentifiersAction(orgId, product.id, {
              barcodes: splitList(String(fd.get("barcodes"))),
              skus: splitList(String(fd.get("skus"))),
              aliases: splitList(String(fd.get("aliases"))),
            }),
          );
        }}
      >
        <Field label={t("barcodes")} htmlFor="barcodes" hint={t("listHint")}>
          <Input id="barcodes" name="barcodes" defaultValue={of("barcode")} />
        </Field>
        <Field label={t("skus")} htmlFor="skus" hint={t("listHint")}>
          <Input id="skus" name="skus" defaultValue={of("sku")} />
        </Field>
        <Field label={t("aliases")} htmlFor="aliases" hint={t("aliasesHint")}>
          <Input id="aliases" name="aliases" defaultValue={of("alias")} />
        </Field>
        <Message message={message} />
        <Button type="submit" disabled={pending} className="mt-4">
          {pending ? t("saving") : t("saveCodes")}
        </Button>
      </form>
    </Card>
  );
}

/** One row per branch: show this product to shoppers there, with or without the price. */
export function ListingsEditor({
  orgId,
  product,
  branches,
  canPublish,
}: {
  orgId: string;
  product: ProductDetail;
  branches: Branch[];
  canPublish: boolean;
}) {
  const t = useTranslations("productPage");
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-xl font-bold">{t("visibleTitle")}</h2>
      <p className="mt-1 text-sm text-ink/80">{canPublish ? t("visibleHelp") : t("visibleReadOnly")}</p>
      {product.status !== "active" && (
        <Banner tone="warn" className="mt-3">
          {t("visibleOff")}
        </Banner>
      )}
      <ul className="mt-4 space-y-4">
        {product.listings.map((l) => {
          const branch = branches.find((b) => b.id === l.branchId);
          return (
            <li key={l.branchId}>
              <ListingRow
                orgId={orgId}
                product={product}
                listing={l}
                branch={branch}
                canPublish={canPublish}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ListingRow({
  orgId,
  product,
  listing,
  branch,
  canPublish,
}: {
  orgId: string;
  product: ProductDetail;
  listing: ProductDetail["listings"][number];
  branch: Branch | undefined;
  canPublish: boolean;
}) {
  const t = useTranslations("productPage");
  const { pending, message, save } = useSaver();
  const [priceError, setPriceError] = useState<string | null>(null);
  const noPin = branch ? !branch.location : false;
  const id = `listing-${listing.branchId}`;
  return (
    <form
      noValidate
      aria-labelledby={`${id}-name`}
      className="rounded-control border-2 border-ink p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const price = parseRupees(String(fd.get("price") ?? ""));
        if (!price.ok) return setPriceError(t("priceInvalid"));
        setPriceError(null);
        save(() =>
          setListingAction(orgId, product.id, listing.branchId, {
            isPublished: fd.get("published") === "on",
            showPrice: fd.get("showPrice") === "on",
            pricePaise: price.paise,
            temporarilyUnavailable: fd.get("unavailable") === "on",
          }),
        );
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-name`} className="font-bold">
          {listing.branchName}
        </h3>
        <div className="flex flex-wrap gap-2">
          {noPin && <Pill>{t("noPin")}</Pill>}
          {branch && !branch.isPublished && <Pill>{t("branchHidden")}</Pill>}
          <Pill tone={listing.isPublished ? "volt" : "grey"}>
            {listing.isPublished ? t("shown") : t("hidden")}
          </Pill>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="published"
            defaultChecked={listing.isPublished}
            disabled={!canPublish}
          />
          <span className="font-semibold">{t("showToShoppers")}</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="checkbox" name="showPrice" defaultChecked={listing.showPrice} disabled={!canPublish} />
          <span>{t("showPrice")}</span>
        </label>
        <label className="flex items-center gap-3 sm:col-span-2">
          <input
            type="checkbox"
            name="unavailable"
            defaultChecked={listing.temporarilyUnavailable}
            disabled={!canPublish}
          />
          <span>{t("unavailable")}</span>
        </label>
      </div>
      <Field
        label={t("branchPrice")}
        htmlFor={`${id}-price`}
        hint={t("branchPriceHelp")}
        error={priceError ?? undefined}
      >
        <Input
          id={`${id}-price`}
          name="price"
          inputMode="decimal"
          defaultValue={paiseToInput(listing.pricePaise)}
          disabled={!canPublish}
          aria-invalid={!!priceError}
        />
      </Field>
      <Message message={message} />
      {canPublish && (
        <Button type="submit" small disabled={pending} className="mt-3">
          {pending ? t("saving") : t("saveVisibility")}
        </Button>
      )}
    </form>
  );
}
