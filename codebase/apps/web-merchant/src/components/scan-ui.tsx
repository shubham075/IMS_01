"use client";

import type { Branch, CountDetail, LookupResult } from "@idea01/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { addFromCatalogueAction } from "@/app/actions/catalogue";
import {
  abandonCountAction,
  addCountLineAction,
  finalizeCountAction,
  lookupCodeAction,
  startCountAction,
} from "@/app/actions/scan";
import { recordMovementAction } from "@/app/actions/stock";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { localizedFieldErrors, newKey } from "@/lib/form";
import { BarcodeScanner } from "./barcode-scanner";
import { Banner, Button, Card, Field, Input, Pill, Select } from "./ui";

const num = (s: string) => Number(s.trim().replace(",", "."));
const fmt = (n: number, locale: string) =>
  new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", { maximumFractionDigits: 3 }).format(n);

interface Result {
  code: string;
  data: LookupResult;
}

/** Scan or type a code: open the product, add it from the shared catalogue, start a new one, or update its stock fast. */
export function ScanFinder({
  orgId,
  branches,
  canSell,
  canStock,
  canCreate,
}: {
  orgId: string;
  branches: Branch[];
  canSell: boolean;
  canStock: boolean;
  canCreate: boolean;
}) {
  const t = useTranslations("scan");
  const tc = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const eventId = useRef(newKey());
  const canQuick = canSell || canStock;

  function found(code: string) {
    setError(null);
    setSaved(null);
    setQtyError(null);
    setQty("1");
    start(async () => {
      const r = await lookupCodeAction(orgId, code, branchId || undefined);
      if (r.ok) {
        eventId.current = newKey();
        setResult({ code, data: r.data });
        setRecent((list) => [code, ...list.filter((c) => c !== code)].slice(0, 5));
        return;
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setResult(null);
      const field = Object.values(localizedFieldErrors(tc, r.fieldErrors))[0];
      setError(r.code === "VALIDATION_FAILED" && field ? field : errorText(tc, r));
    });
  }

  function record(kind: "sale" | "receipt") {
    const p = result?.data.product;
    if (!p) return;
    const n = num(qty);
    if (!(n > 0) || Number.isNaN(n)) return setQtyError(tc("validation.quantityPositive"));
    if (!p.allowFraction && n !== Math.trunc(n)) return setQtyError(tc("errors.codes.QTY_NOT_INTEGRAL"));
    setQtyError(null);
    start(async () => {
      const r = await recordMovementAction(orgId, branchId, {
        productId: p.id,
        kind,
        quantity: n,
        eventId: eventId.current,
        confirmLarge: false,
      });
      if (r.ok) {
        eventId.current = newKey();
        setSaved(
          tc("stock.recorded", {
            qty: fmt(r.data.line.onHand, locale),
            unit: tc(`units.${p.unit as "pcs"}`),
          }),
        );
        setResult((cur) => (cur ? { ...cur, data: { ...cur.data, stock: r.data.line } } : cur));
        return;
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setQtyError(errorText(tc, r));
    });
  }

  function addCatalogue(id: string) {
    start(async () => {
      const r = await addFromCatalogueAction(orgId, { canonicalId: id }, newKey());
      if (r.ok) return router.push(`/app/products/${r.data.id}`);
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      if (r.code === "DUPLICATE_IDENTIFIER" && r.existingId)
        return router.push(`/app/products/${r.existingId}`);
      setError(errorText(tc, r));
    });
  }

  const p = result?.data.product;
  const stock = result?.data.stock;
  return (
    <div className="space-y-5">
      <Card>
        {branches.length > 1 && (
          <Field label={t("branch")} htmlFor="scan-branch">
            <Select id="scan-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="mt-2">
          <BarcodeScanner onCode={found} busy={pending} />
        </div>
        {recent.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {t("recent")}
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                className="rounded-chip border-2 border-ink px-2 font-semibold hover:bg-volt"
                onClick={() => found(c)}
              >
                {c}
              </button>
            ))}
          </p>
        )}
      </Card>

      {error && (
        <Banner tone="warn" role="alert">
          {error}
        </Banner>
      )}

      {result && (
        <Card aria-live="polite">
          {p ? (
            <>
              <h2 className="text-2xl font-extrabold">{p.name}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-ink/80">
                {p.nameHi}
                {p.status !== "active" && <Pill>{tc("productPage.off")}</Pill>}
                <Pill tone="ink">{result.code}</Pill>
              </p>
              {stock && (
                <p className="mt-3 text-3xl font-extrabold">
                  {p.trackingMode === "status_only"
                    ? stock.statusOverride === "in_stock"
                      ? tc("stock.inStock")
                      : stock.statusOverride === "out_of_stock"
                        ? tc("stock.outOfStock")
                        : tc("stock.notSet")
                    : stock.lastMovementAt === null
                      ? tc("stock.notCounted")
                      : `${fmt(stock.onHand, locale)} ${tc(`units.${p.unit as "pcs"}`)}`}
                </p>
              )}
              {stock?.needsCheck && <p className="mt-1 font-semibold">{tc("stock.badgeCheck")}</p>}
              <div className="mt-4 flex flex-wrap gap-4">
                <Link href={`/app/products/${p.id}`} className="font-bold underline">
                  {t("openProduct")}
                </Link>
                <Link href={`/app/stock/${p.id}?branch=${branchId}`} className="font-bold underline">
                  {t("openStock")}
                </Link>
              </div>
              {canQuick && p.status === "active" && p.trackingMode === "quantity" && (
                <div className="mt-5 border-t-2 border-ink pt-4">
                  <h3 className="font-bold">{t("quickTitle")}</h3>
                  <Field
                    label={tc("stock.quantity", { unit: tc(`units.${p.unit as "pcs"}`) })}
                    htmlFor="quick-qty"
                    error={qtyError ?? undefined}
                  >
                    <Input
                      id="quick-qty"
                      value={qty}
                      inputMode={p.allowFraction ? "decimal" : "numeric"}
                      onChange={(e) => setQty(e.target.value)}
                      aria-invalid={!!qtyError}
                    />
                  </Field>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {canSell && (
                      <Button disabled={pending} onClick={() => record("sale")}>
                        {tc("kinds.sale")}
                      </Button>
                    )}
                    {canStock && (
                      <Button variant="secondary" disabled={pending} onClick={() => record("receipt")}>
                        {tc("kinds.receipt")}
                      </Button>
                    )}
                  </div>
                  {saved && (
                    <Banner role="status" className="mt-3">
                      {saved}
                    </Banner>
                  )}
                </div>
              )}
            </>
          ) : result.data.canonical ? (
            <>
              <h2 className="text-xl font-bold">{t("inCatalogue")}</h2>
              <p className="mt-1 font-semibold">
                {result.data.canonical.name}
                {result.data.canonical.brand ? ` · ${result.data.canonical.brand}` : ""}
              </p>
              <p className="mt-1 text-sm text-ink/80">{t("notInShop", { code: result.code })}</p>
              {canCreate && (
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button disabled={pending} onClick={() => addCatalogue(result.data.canonical?.id ?? "")}>
                    + {t("addToShop")}
                  </Button>
                  <Link
                    href={`/app/products/add?tab=custom&barcode=${encodeURIComponent(result.code)}`}
                    className="inline-flex min-h-12 items-center font-bold underline"
                  >
                    {t("createOwn")}
                  </Link>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold">{t("unknownTitle")}</h2>
              <p className="mt-1">{t("unknownBody", { code: result.code })}</p>
              {canCreate && (
                <Link
                  href={`/app/products/add?tab=custom&barcode=${encodeURIComponent(result.code)}`}
                  className="mt-4 inline-flex min-h-12 items-center rounded-control border-[2.5px] border-ink bg-ink px-5 font-bold text-paper shadow-hard-sm hover:bg-volt hover:text-ink"
                >
                  + {t("createWithCode")}
                </Link>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

/** Walk the shelves: each scan adds one to that product's tally; numbers can be typed over. Finishing corrects the stock. */
export function CountScreen({
  orgId,
  count,
  canCount,
}: {
  orgId: string;
  count: CountDetail;
  canCount: boolean;
}) {
  const t = useTranslations("counts");
  const tc = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"finish" | "cancel" | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const open = count.status === "draft" && canCount;

  const fail = (r: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    retryAfter?: number;
  }) => {
    if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
    setError(errorText(tc, r));
  };

  // Scans are handled one at a time, in order, and the tally is kept here too: people scan faster than the page refreshes,
  // and the latest number sent for a product wins, so each request must start from the one before it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const tally = useRef(new Map<string, number>());

  function scanned(code: string) {
    setError(null);
    setNote(null);
    queue.current = queue.current.then(() => handleScan(code)).catch(() => undefined);
  }

  async function handleScan(code: string) {
    await new Promise<void>((resolve) => {
      start(async () => {
        await run(code);
        resolve();
      });
    });
  }

  async function run(code: string) {
    {
      const l = await lookupCodeAction(orgId, code, count.branchId);
      if (!l.ok) return fail(l);
      const p = l.data.product;
      if (!p) return setError(t("unknownCode", { code }));
      if (p.status !== "active" || p.trackingMode !== "quantity")
        return setError(t("notCountable", { name: p.name }));
      const current = Math.max(
        tally.current.get(p.id) ?? 0,
        count.lines.find((x) => x.productId === p.id)?.counted ?? 0,
      );
      const r = await addCountLineAction(orgId, count.branchId, count.id, {
        productId: p.id,
        quantity: current + 1,
      });
      if (!r.ok) return fail(r);
      tally.current.set(p.id, current + 1);
      setNote(t("counted", { name: p.name, n: fmt(current + 1, locale) }));
      router.refresh();
    }
  }

  function setLine(productId: string, name: string) {
    const n = num(edits[productId] ?? "");
    if (Number.isNaN(n) || n < 0) return setError(tc("validation.quantityNumber"));
    setError(null);
    start(async () => {
      const r = await addCountLineAction(orgId, count.branchId, count.id, { productId, quantity: n });
      if (!r.ok) return fail(r);
      tally.current.set(productId, n);
      setEdits((e) => {
        const { [productId]: _gone, ...rest } = e;
        return rest;
      });
      setNote(t("counted", { name, n: fmt(n, locale) }));
      router.refresh();
    });
  }

  const finish = () =>
    start(async () => {
      const r = await finalizeCountAction(orgId, count.branchId, count.id);
      setConfirm(null);
      if (r.ok) return router.refresh();
      fail(r);
    });
  const cancel = () =>
    start(async () => {
      const r = await abandonCountAction(orgId, count.branchId, count.id);
      setConfirm(null);
      if (r.ok) return router.refresh();
      fail(r);
    });

  return (
    <div className="space-y-5">
      {open && (
        <Card>
          <h2 className="text-xl font-bold">{t("scanTitle")}</h2>
          <p className="mt-1 text-sm text-ink/80">{t("scanHelp")}</p>
          <div className="mt-3">
            <BarcodeScanner onCode={scanned} busy={pending} />
          </div>
        </Card>
      )}
      {error && (
        <Banner tone="warn" role="alert">
          {error}
        </Banner>
      )}
      {note && <Banner role="status">{note}</Banner>}

      <section aria-labelledby="counted-title">
        <h2 id="counted-title" className="mb-3 text-xl font-bold">
          {t("countedTitle", { n: count.lines.length })}
        </h2>
        {count.lines.length === 0 ? (
          <p className="text-ink/80">{t("nothingYet")}</p>
        ) : (
          <ul className="divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
            {count.lines.map((l) => (
              <li key={l.productId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-bold">{l.name}</span>
                  <span className="block text-sm text-ink/75">
                    {t("expectedLine", { expected: fmt(l.expected, locale) })}
                    {l.difference !== 0 && (
                      <Pill tone={l.difference < 0 ? "ink" : "volt"} className="ml-2">
                        {l.difference > 0 ? "+" : "−"}
                        {fmt(Math.abs(l.difference), locale)}
                      </Pill>
                    )}
                  </span>
                </span>
                {open ? (
                  <span className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`cl-${l.productId}`}>
                      {t("countedFor", { name: l.name })}
                    </label>
                    <Input
                      id={`cl-${l.productId}`}
                      className="w-24"
                      inputMode={l.allowFraction ? "decimal" : "numeric"}
                      value={edits[l.productId] ?? String(l.counted)}
                      onChange={(e) => setEdits({ ...edits, [l.productId]: e.target.value })}
                    />
                    {edits[l.productId] !== undefined && edits[l.productId] !== String(l.counted) && (
                      <Button
                        small
                        disabled={pending}
                        onClick={() => setLine(l.productId, l.name)}
                        aria-label={t("saveFor", { name: l.name })}
                      >
                        {tc("common.save")}
                      </Button>
                    )}
                  </span>
                ) : (
                  <span className="font-extrabold">
                    {fmt(l.counted, locale)} {tc(`units.${l.unit as "pcs"}`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && count.lines.length > 0 && (
        <Card className="p-4 sm:p-5">
          <p className="font-semibold">
            {count.corrections > 0 ? t("willCorrect", { n: count.corrections }) : t("noDifferences")}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {confirm === "finish" ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t("finishConfirm")}</span>
                <Button small disabled={pending} onClick={finish}>
                  {t("finishYes")}
                </Button>
                <Button small variant="secondary" onClick={() => setConfirm(null)}>
                  {t("no")}
                </Button>
              </span>
            ) : (
              <Button disabled={pending} onClick={() => setConfirm("finish")}>
                {t("finish")}
              </Button>
            )}
            {confirm === "cancel" ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t("cancelConfirm")}</span>
                <Button small disabled={pending} onClick={cancel}>
                  {t("cancelYes")}
                </Button>
                <Button small variant="secondary" onClick={() => setConfirm(null)}>
                  {t("no")}
                </Button>
              </span>
            ) : (
              <Button variant="ghost" disabled={pending} onClick={() => setConfirm("cancel")}>
                {t("cancel")}
              </Button>
            )}
          </div>
        </Card>
      )}
      {open && count.lines.length === 0 && (
        <Button variant="ghost" disabled={pending} onClick={cancel}>
          {t("cancel")}
        </Button>
      )}
    </div>
  );
}

/** Start a count at a branch, or carry on with the one already open. */
export function StartCount({
  orgId,
  branchId,
  hasOpen,
}: {
  orgId: string;
  branchId: string;
  hasOpen: boolean;
}) {
  const t = useTranslations("counts");
  const tc = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {error && (
        <Banner tone="warn" role="alert" className="mb-3">
          {error}
        </Banner>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startCountAction(orgId, branchId, {});
            if (r.ok) return router.push(`/app/counts/${r.data.id}?branch=${branchId}`);
            if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
            setError(errorText(tc, r));
          })
        }
      >
        {pending ? tc("common.saving") : hasOpen ? t("continue") : t("start")}
      </Button>
    </div>
  );
}
