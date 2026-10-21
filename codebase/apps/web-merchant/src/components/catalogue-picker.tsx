"use client";

import type { CanonicalProduct, Category } from "@idea01/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { addFromCatalogueAction, searchCatalogueAction } from "@/app/actions/catalogue";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { newKey } from "@/lib/form";
import { Banner, Button, Card, Field, Input, Pill } from "./ui";

/** Search the shared catalogue and add products with one tap. Added rows stay on screen so several can be added in a row. */
export function CataloguePicker({ orgId, categories }: { orgId: string; categories: Category[] }) {
  const t = useTranslations();
  const router = useRouter();
  const lang = useLocale();
  const [pending, start] = useTransition();
  const [results, setResults] = useState<CanonicalProduct[] | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({}); // canonicalId -> product id
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const categoryName = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    return c ? (lang === "hi" && c.nameHi ? c.nameHi : c.nameEn) : null;
  };

  function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (term.trim() === "") return setError(t("validation.searchEmpty"));
    start(async () => {
      const r = await searchCatalogueAction(orgId, term);
      if (r.ok) return setResults(r.data);
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setError(errorText(t, r));
    });
  }

  async function add(c: CanonicalProduct) {
    setBusy(c.id);
    setError(null);
    const r = await addFromCatalogueAction(orgId, { canonicalId: c.id }, newKey());
    setBusy(null);
    if (r.ok) {
      setAdded((a) => ({ ...a, [c.id]: r.data.id }));
      return router.refresh();
    }
    if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
    if (r.code === "DUPLICATE_IDENTIFIER" && r.existingId) {
      const id = r.existingId;
      return setAdded((a) => ({ ...a, [c.id]: id }));
    }
    setError(errorText(t, r));
  }

  return (
    <Card>
      <h2 className="text-xl font-bold">{t("picker.title")}</h2>
      <p className="mt-1 text-ink/80">{t("picker.sub")}</p>
      <search>
        <form noValidate onSubmit={search} className="mt-2 flex flex-wrap items-end gap-3">
          <Field label={t("picker.searchLabel")} htmlFor="catalogue-q" className="min-w-0 flex-1">
            <Input
              id="catalogue-q"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t("picker.placeholder")}
              autoFocus
              enterKeyHint="search"
            />
          </Field>
          <Button type="submit" disabled={pending} className="mb-0">
            {pending ? t("picker.searching") : t("picker.search")}
          </Button>
        </form>
      </search>
      {error && (
        <Banner tone="warn" role="alert" className="mt-4">
          {error}
        </Banner>
      )}
      {results && results.length === 0 && (
        <p className="mt-5 text-ink/80" role="status">
          {t("picker.none")}{" "}
          <Link href="/app/products/add?tab=custom" className="font-bold underline">
            {t("picker.addOwn")}
          </Link>
        </p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-5 divide-y-2 divide-ink border-t-2 border-ink" aria-label={t("picker.results")}>
          {results.map((c) => {
            const productId = added[c.id] ?? c.alreadyAddedProductId;
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-bold">{c.name}</p>
                  <p className="text-sm text-ink/75">
                    {[c.brand, categoryName(c.categoryId), c.barcode].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {productId ? (
                  <div className="flex items-center gap-3">
                    <Pill tone="volt">✓ {t("picker.added")}</Pill>
                    <Link href={`/app/products/${productId}`} className="font-bold underline">
                      {t("picker.open")}
                    </Link>
                  </div>
                ) : (
                  <Button
                    small
                    disabled={busy === c.id}
                    onClick={() => add(c)}
                    aria-label={t("picker.addNamed", { name: c.name })}
                  >
                    {busy === c.id ? t("common.saving") : `+ ${t("picker.add")}`}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
