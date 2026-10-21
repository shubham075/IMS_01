"use client";

import { type Branch, type TransferDetail } from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import {
  cancelTransferAction,
  createTransferAction,
  dispatchTransferAction,
  receiveTransferAction,
  searchProductsAction,
  setTransferLinesAction,
} from "@/app/actions/transfers";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { localizedFieldErrors, newKey } from "@/lib/form";
import { Banner, Button, Card, Field, Input, Pill, Select } from "./ui";

interface Line {
  productId: string;
  name: string;
  unit: string;
  allowFraction: boolean;
  quantity: string;
  sourceOnHand?: number;
}

const num = (s: string) => Number(s.trim().replace(",", "."));

function useFlow(orgId: string) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return { t, router, pending, start, error, setError, orgId };
}

/** Search products and add them to the transfer; quantities are typed per line. */
function LinesEditor({
  orgId,
  lines,
  setLines,
  errors,
}: {
  orgId: string;
  lines: Line[];
  setLines: (l: Line[]) => void;
  errors: Record<string, string>;
}) {
  const t = useTranslations();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; name: string; unit: string; allowFraction: boolean; trackingMode: string }>
  >([]);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();
  const search = () =>
    start(async () => {
      const r = await searchProductsAction(orgId, q);
      setSearched(true);
      if (r.ok) setResults(r.data.items.filter((p) => p.trackingMode === "quantity"));
    });
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("transfers.findProduct")} htmlFor="tp-q" className="min-w-0 flex-1">
          <Input
            id="tp-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            placeholder={t("transfers.findPlaceholder")}
          />
        </Field>
        <Button type="button" variant="secondary" disabled={pending} onClick={search}>
          {t("picker.search")}
        </Button>
      </div>
      {searched && results.length === 0 && <p className="mt-3 text-ink/80">{t("transfers.noResults")}</p>}
      {results.length > 0 && (
        <ul
          className="mt-3 divide-y-2 divide-ink rounded-control border-2 border-ink"
          aria-label={t("picker.results")}
        >
          {results.map((p) => {
            const already = lines.some((l) => l.productId === p.id);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-semibold">{p.name}</span>
                {already ? (
                  <Pill tone="volt">✓ {t("picker.added")}</Pill>
                ) : (
                  <Button
                    small
                    type="button"
                    aria-label={t("picker.addNamed", { name: p.name })}
                    onClick={() =>
                      setLines([
                        ...lines,
                        {
                          productId: p.id,
                          name: p.name,
                          unit: p.unit,
                          allowFraction: p.allowFraction,
                          quantity: "",
                        },
                      ])
                    }
                  >
                    + {t("picker.add")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="mt-6 font-bold">{t("transfers.productsTitle")}</h3>
      {errors.lines && (
        <p role="alert" className="mt-2 font-semibold">
          ! {errors.lines}
        </p>
      )}
      {lines.length === 0 ? (
        <p className="mt-2 text-ink/80">{t("transfers.noLines")}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {lines.map((l, i) => {
            const n = num(l.quantity);
            const short = l.sourceOnHand !== undefined && n > l.sourceOnHand;
            return (
              <li key={l.productId} className="rounded-control border-2 border-ink p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{l.name}</span>
                  <Button
                    small
                    type="button"
                    variant="ghost"
                    onClick={() => setLines(lines.filter((x) => x.productId !== l.productId))}
                    aria-label={t("transfers.removeNamed", { name: l.name })}
                  >
                    {t("common.remove")}
                  </Button>
                </div>
                <Field
                  label={t("transfers.qty", { unit: t(`units.${l.unit as "pcs"}`) })}
                  htmlFor={`qty-${l.productId}`}
                  error={errors[`lines.${i}.quantity`]}
                  hint={short ? t("transfers.onlyHave", { n: l.sourceOnHand ?? 0 }) : undefined}
                >
                  <Input
                    id={`qty-${l.productId}`}
                    inputMode={l.allowFraction ? "decimal" : "numeric"}
                    value={l.quantity}
                    onChange={(e) =>
                      setLines(
                        lines.map((x) =>
                          x.productId === l.productId ? { ...x, quantity: e.target.value } : x,
                        ),
                      )
                    }
                    aria-invalid={!!errors[`lines.${i}.quantity`]}
                  />
                </Field>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function toApiLines(lines: Line[]) {
  return lines.map((l) => ({ productId: l.productId, quantity: num(l.quantity) }));
}
function checkLines(t: ReturnType<typeof useTranslations>, lines: Line[]): Record<string, string> {
  const errs: Record<string, string> = {};
  if (lines.length === 0) errs.lines = t("validation.addProducts");
  lines.forEach((l, i) => {
    const n = num(l.quantity);
    if (l.quantity.trim() === "" || Number.isNaN(n))
      errs[`lines.${i}.quantity`] = t("validation.quantityNumber");
    else if (n <= 0) errs[`lines.${i}.quantity`] = t("validation.quantityPositive");
    else if (!l.allowFraction && n !== Math.trunc(n))
      errs[`lines.${i}.quantity`] = t("errors.codes.QTY_NOT_INTEGRAL");
  });
  return errs;
}

/** Start a transfer: from, to, products, quantities. Saved as a draft; nothing moves until it is sent. */
export function TransferBuilder({ orgId, branches }: { orgId: string; branches: Branch[] }) {
  const { t, router, pending, start, error, setError } = useFlow(orgId);
  const [from, setFrom] = useState(branches[0]?.id ?? "");
  const [to, setTo] = useState(branches[1]?.id ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useRef(newKey());

  function save() {
    setError(null);
    const errs = checkLines(t, lines);
    if (from === to) errs.toBranchId = t("validation.differentBranches");
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    start(async () => {
      const r = await createTransferAction(
        orgId,
        {
          fromBranchId: from,
          toBranchId: to,
          lines: toApiLines(lines),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        key.current,
      );
      if (r.ok) return router.push(`/app/transfers/${r.data.id}`);
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setErrors(localizedFieldErrors(t, r.fieldErrors));
      setError(errorText(t, r));
      if (r.code !== "IDEMPOTENCY_IN_PROGRESS") key.current = newKey();
    });
  }

  return (
    <Card>
      <h2 className="text-xl font-bold">{t("transfers.newTitle")}</h2>
      <p className="mt-1 text-ink/80">{t("transfers.newSub")}</p>
      {error && (
        <Banner tone="warn" role="alert" className="mt-4">
          {error}
        </Banner>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={t("transfers.from")} htmlFor="from">
          <Select id="from" value={from} onChange={(e) => setFrom(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("transfers.to")} htmlFor="to" error={errors.toBranchId}>
          <Select
            id="to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-invalid={!!errors.toBranchId}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("transfers.note")} htmlFor="note">
        <Input id="note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-4">
        <LinesEditor orgId={orgId} lines={lines} setLines={setLines} errors={errors} />
      </div>
      <Button className="mt-6" disabled={pending} onClick={save}>
        {pending ? t("common.saving") : t("transfers.saveDraft")}
      </Button>
    </Card>
  );
}

/** A draft: change the products, send it, or cancel it. */
export function DraftActions({
  orgId,
  transfer,
  canAct,
}: {
  orgId: string;
  transfer: TransferDetail;
  canAct: boolean;
}) {
  const { t, router, pending, start, error, setError } = useFlow(orgId);
  const [lines, setLines] = useState<Line[]>(
    transfer.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      unit: l.unit,
      allowFraction: l.allowFraction,
      quantity: String(l.qtySent),
      sourceOnHand: l.sourceOnHand,
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<"send" | "cancel" | null>(null);
  const [saved, setSaved] = useState(false);

  const fail = (r: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    retryAfter?: number;
  }) => {
    if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
    setErrors(localizedFieldErrors(t, r.fieldErrors));
    setError(errorText(t, r));
  };
  function saveLines(then?: () => void) {
    setError(null);
    setSaved(false);
    const errs = checkLines(t, lines);
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    start(async () => {
      const r = await setTransferLinesAction(orgId, transfer.id, { lines: toApiLines(lines) });
      if (!r.ok) return fail(r);
      setSaved(true);
      router.refresh();
      then?.();
    });
  }
  const send = () =>
    start(async () => {
      setError(null);
      const r = await dispatchTransferAction(orgId, transfer.id);
      setConfirm(null);
      if (r.ok) return router.refresh();
      fail(r);
    });
  const cancel = () =>
    start(async () => {
      setError(null);
      const r = await cancelTransferAction(orgId, transfer.id);
      setConfirm(null);
      if (r.ok) return router.refresh();
      fail(r);
    });

  if (!canAct) return <p className="text-ink/80">{t("transfers.readOnly")}</p>;
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-xl font-bold">{t("transfers.editDraft")}</h2>
      {error && (
        <Banner tone="warn" role="alert" className="mt-3">
          {error}
        </Banner>
      )}
      {saved && (
        <Banner role="status" className="mt-3">
          {t("productPage.saved")}
        </Banner>
      )}
      <div className="mt-3">
        <LinesEditor orgId={orgId} lines={lines} setLines={setLines} errors={errors} />
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button variant="secondary" disabled={pending} onClick={() => saveLines()}>
          {t("transfers.saveChanges")}
        </Button>
        {confirm === "send" ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {t("transfers.sendConfirm", { from: transfer.fromBranchName })}
            </span>
            <Button small disabled={pending} onClick={() => saveLines(send)}>
              {t("transfers.sendYes")}
            </Button>
            <Button small variant="secondary" onClick={() => setConfirm(null)}>
              {t("transfers.no")}
            </Button>
          </span>
        ) : (
          <Button disabled={pending} onClick={() => setConfirm("send")}>
            {t("transfers.send")}
          </Button>
        )}
        {confirm === "cancel" ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t("transfers.cancelConfirm")}</span>
            <Button small disabled={pending} onClick={cancel}>
              {t("transfers.cancelYes")}
            </Button>
            <Button small variant="secondary" onClick={() => setConfirm(null)}>
              {t("transfers.no")}
            </Button>
          </span>
        ) : (
          <Button variant="ghost" disabled={pending} onClick={() => setConfirm("cancel")}>
            {t("transfers.cancel")}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** The receiving branch confirms what arrived. Anything short is written off at the sender. */
export function ReceiveForm({
  orgId,
  transfer,
  canAct,
}: {
  orgId: string;
  transfer: TransferDetail;
  canAct: boolean;
}) {
  const { t, router, pending, start, error, setError } = useFlow(orgId);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(transfer.lines.map((l) => [l.productId, String(l.qtySent)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!canAct)
    return <p className="text-ink/80">{t("transfers.waitingToArrive", { to: transfer.toBranchName })}</p>;

  function submit() {
    setError(null);
    const errs: Record<string, string> = {};
    const received = transfer.lines.map((l) => {
      const n = num(qty[l.productId] ?? "");
      if (Number.isNaN(n) || n < 0) errs[l.productId] = t("validation.quantityNumber");
      else if (n > l.qtySent) errs[l.productId] = t("transfers.moreThanSent", { n: l.qtySent });
      else if (!l.allowFraction && n !== Math.trunc(n))
        errs[l.productId] = t("errors.codes.QTY_NOT_INTEGRAL");
      return { productId: l.productId, quantity: n };
    });
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    start(async () => {
      const r = await receiveTransferAction(orgId, transfer.id, { received });
      if (r.ok) return router.refresh();
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setError(errorText(t, r));
    });
  }
  const shortLines = transfer.lines.filter((l) => num(qty[l.productId] ?? "") < l.qtySent);
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-xl font-bold">{t("transfers.receiveTitle")}</h2>
      <p className="mt-1 text-sm text-ink/80">{t("transfers.receiveHelp")}</p>
      {error && (
        <Banner tone="warn" role="alert" className="mt-3">
          {error}
        </Banner>
      )}
      <ul className="mt-3 space-y-3">
        {transfer.lines.map((l) => (
          <li key={l.productId} className="rounded-control border-2 border-ink p-3">
            <p className="font-bold">
              {l.name}{" "}
              <span className="font-normal text-ink/75">
                · {t("transfers.sentQty", { n: l.qtySent, unit: t(`units.${l.unit as "pcs"}`) })}
              </span>
            </p>
            <Field
              label={t("transfers.arrived", { name: l.name })}
              htmlFor={`arr-${l.productId}`}
              error={errors[l.productId]}
            >
              <Input
                id={`arr-${l.productId}`}
                inputMode={l.allowFraction ? "decimal" : "numeric"}
                value={qty[l.productId] ?? ""}
                onChange={(e) => setQty({ ...qty, [l.productId]: e.target.value })}
                aria-invalid={!!errors[l.productId]}
              />
            </Field>
          </li>
        ))}
      </ul>
      {shortLines.length > 0 && (
        <Banner tone="warn" role="status" className="mt-3">
          {t("transfers.shortWarning", { n: shortLines.length, from: transfer.fromBranchName })}
        </Banner>
      )}
      <Button className="mt-4" disabled={pending} onClick={submit}>
        {pending ? t("common.saving") : t("transfers.confirmReceived")}
      </Button>
    </Card>
  );
}
