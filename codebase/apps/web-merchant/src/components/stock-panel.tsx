"use client";

import { type Movement, type MovementKind, recordMovementSchema, type StockLine } from "@idea01/schemas";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import {
  recordMovementAction,
  reverseMovementAction,
  setStatusAction,
  setThresholdAction,
} from "@/app/actions/stock";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { localizedErrors, localizedFieldErrors, newKey } from "@/lib/form";
import { Banner, Button, Card, Field, Input, Pill, Select } from "./ui";

const IN_KINDS: MovementKind[] = ["receipt", "opening", "customer_return", "found"];
const OUT_KINDS: MovementKind[] = ["sale", "supplier_return", "damage", "expiry", "loss"];

type Note = { tone: "info" | "warn"; text: string };

function useAction() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note | null>(null);
  return { t, router, pending, start, note, setNote };
}

const num = (s: string) => Number(s.trim().replace(",", "."));
export const fmtQty = (n: number, locale: string) =>
  new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", { maximumFractionDigits: 3 }).format(n);

/** Record stock in, a sale, a return, a correction… One form, one event id: sending it twice never counts twice. */
export function MovementForm({
  orgId,
  branchId,
  line,
  canStock,
  canSell,
}: {
  orgId: string;
  branchId: string;
  line: StockLine;
  canStock: boolean;
  canSell: boolean;
}) {
  const { t, router, pending, start, note, setNote } = useAction();
  const locale = useLocale();
  const never = line.lastMovementAt === null;
  const allowed = (k: MovementKind) =>
    (k === "sale" || k === "customer_return" ? canSell : canStock) && (k !== "opening" || never);
  const kinds = [...IN_KINDS, ...OUT_KINDS, "adjustment" as const].filter(allowed);
  const [kind, setKind] = useState<MovementKind>(kinds[0] ?? "receipt");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const eventId = useRef(newKey());
  const form = useRef<HTMLFormElement>(null);

  if (kinds.length === 0) return null;

  function send(confirmLarge: boolean) {
    const fd = new FormData(form.current ?? undefined);
    const raw = {
      productId: line.productId,
      kind,
      quantity: num(String(fd.get("quantity") ?? "")),
      eventId: eventId.current,
      confirmLarge,
      ...(kind === "adjustment" ? { direction: String(fd.get("direction") || "") || undefined } : {}),
      ...(kind === "customer_return" ? { returnToUnsellable: fd.get("unsellable") === "on" } : {}),
      ...(String(fd.get("note") ?? "").trim() ? { note: String(fd.get("note")).trim() } : {}),
    };
    setNote(null);
    const parsed = recordMovementSchema.safeParse(raw);
    if (!parsed.success || Number.isNaN(raw.quantity)) {
      const errs = parsed.success ? {} : localizedErrors(t, parsed.error);
      return setErrors({
        ...errs,
        ...(Number.isNaN(raw.quantity) ? { quantity: t("validation.quantityNumber") } : {}),
      });
    }
    setErrors({});
    start(async () => {
      const r = await recordMovementAction(orgId, branchId, raw);
      if (r.ok) {
        eventId.current = newKey(); // the next entry is a new event
        form.current?.reset();
        setNeedsConfirm(false);
        setNote({
          tone: "info",
          text: t("stock.recorded", {
            qty: fmtQty(r.data.line.onHand, locale),
            unit: t(`units.${line.unit as "pcs"}`),
          }),
        });
        return router.refresh();
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      if (r.code === "CONFIRM_REQUIRED") return setNeedsConfirm(true);
      setErrors(localizedFieldErrors(t, r.fieldErrors));
      setNote({ tone: "warn", text: errorText(t, r) });
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-xl font-bold">{t("stock.recordTitle")}</h2>
      <form
        ref={form}
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setNeedsConfirm(false);
          send(false);
        }}
      >
        <Field label={t("stock.whatHappened")} htmlFor="kind">
          <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as MovementKind)}>
            <optgroup label={t("stock.groupIn")}>
              {IN_KINDS.filter(allowed).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("stock.groupOut")}>
              {OUT_KINDS.filter(allowed).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </optgroup>
            {allowed("adjustment") && <option value="adjustment">{t("kinds.adjustment")}</option>}
          </Select>
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            label={t("stock.quantity", { unit: t(`units.${line.unit as "pcs"}`) })}
            htmlFor="quantity"
            error={errors.quantity}
            hint={line.allowFraction ? undefined : t("stock.wholeOnly")}
          >
            <Input
              id="quantity"
              name="quantity"
              inputMode={line.allowFraction ? "decimal" : "numeric"}
              aria-invalid={!!errors.quantity}
            />
          </Field>
          {kind === "adjustment" && (
            <Field label={t("stock.direction")} htmlFor="direction" error={errors.direction}>
              <Select id="direction" name="direction" defaultValue="" aria-invalid={!!errors.direction}>
                <option value="">{t("stock.chooseDirection")}</option>
                <option value="in">{t("stock.up")}</option>
                <option value="out">{t("stock.down")}</option>
              </Select>
            </Field>
          )}
        </div>
        <Field
          label={kind === "adjustment" ? t("stock.whyRequired") : t("stock.noteOptional")}
          htmlFor="note"
          error={errors.note}
        >
          <Input id="note" name="note" maxLength={200} aria-invalid={!!errors.note} />
        </Field>
        {kind === "customer_return" && (
          <label className="mt-4 flex items-center gap-3">
            <input type="checkbox" name="unsellable" />
            <span>{t("stock.cannotResell")}</span>
          </label>
        )}
        {needsConfirm && (
          <Banner tone="warn" role="alert" className="mt-4">
            <p className="font-bold">{t("errors.codes.CONFIRM_REQUIRED")}</p>
            <div className="mt-2 flex gap-3">
              <Button small type="button" disabled={pending} onClick={() => send(true)}>
                {t("stock.confirmYes")}
              </Button>
              <Button small type="button" variant="secondary" onClick={() => setNeedsConfirm(false)}>
                {t("stock.confirmNo")}
              </Button>
            </div>
          </Banner>
        )}
        {note && (
          <Banner tone={note.tone} role={note.tone === "warn" ? "alert" : "status"} className="mt-4">
            {note.text}
          </Banner>
        )}
        <Button type="submit" disabled={pending} className="mt-4">
          {pending ? t("common.saving") : t("stock.record")}
        </Button>
      </form>
    </Card>
  );
}

/** For products the shop does not count: just "in stock" / "out of stock". */
export function StatusButtons({
  orgId,
  branchId,
  line,
}: {
  orgId: string;
  branchId: string;
  line: StockLine;
}) {
  const { t, router, pending, start, note, setNote } = useAction();
  const set = (status: "in_stock" | "out_of_stock") =>
    start(async () => {
      setNote(null);
      const r = await setStatusAction(orgId, branchId, { productId: line.productId, status });
      if (r.ok) return router.refresh();
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setNote({ tone: "warn", text: errorText(t, r) });
    });
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-xl font-bold">{t("stock.statusTitle")}</h2>
      <p className="mt-1 text-sm text-ink/80">{t("stock.statusHelp")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          disabled={pending}
          variant={line.statusOverride === "in_stock" ? "primary" : "secondary"}
          aria-pressed={line.statusOverride === "in_stock"}
          onClick={() => set("in_stock")}
        >
          {t("stock.inStock")}
        </Button>
        <Button
          disabled={pending}
          variant={line.statusOverride === "out_of_stock" ? "primary" : "secondary"}
          aria-pressed={line.statusOverride === "out_of_stock"}
          onClick={() => set("out_of_stock")}
        >
          {t("stock.outOfStock")}
        </Button>
      </div>
      {note && (
        <Banner tone="warn" role="alert" className="mt-3">
          {note.text}
        </Banner>
      )}
    </Card>
  );
}

/** The level at which this branch should be warned about low stock. */
export function ThresholdForm({
  orgId,
  branchId,
  line,
}: {
  orgId: string;
  branchId: string;
  line: StockLine;
}) {
  const { t, router, pending, start, note, setNote } = useAction();
  const [error, setError] = useState<string | null>(null);
  const save = (threshold: number | null) =>
    start(async () => {
      setNote(null);
      const r = await setThresholdAction(orgId, branchId, { productId: line.productId, threshold });
      if (r.ok) {
        setNote({ tone: "info", text: t("productPage.saved") });
        return router.refresh();
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setNote({ tone: "warn", text: errorText(t, r) });
    });
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-xl font-bold">{t("stock.thresholdTitle")}</h2>
      <p className="mt-1 text-sm text-ink/80">
        {line.thresholdIsCustom ? t("stock.thresholdCustom") : t("stock.thresholdDefault")}
      </p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const n = num(String(new FormData(e.currentTarget).get("threshold") ?? ""));
          if (!(n >= 0)) return setError(t("validation.threshold"));
          setError(null);
          save(n);
        }}
      >
        <Field label={t("stock.thresholdLabel")} htmlFor="threshold" error={error ?? undefined}>
          <Input
            id="threshold"
            name="threshold"
            inputMode="decimal"
            defaultValue={String(line.threshold)}
            aria-invalid={!!error}
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button type="submit" small disabled={pending}>
            {t("common.save")}
          </Button>
          {line.thresholdIsCustom && (
            <Button small type="button" variant="secondary" disabled={pending} onClick={() => save(null)}>
              {t("stock.useProductLevel")}
            </Button>
          )}
        </div>
      </form>
      {note && (
        <Banner tone={note.tone} role={note.tone === "warn" ? "alert" : "status"} className="mt-3">
          {note.text}
        </Banner>
      )}
    </Card>
  );
}

/** The ledger: who did what, when, and why. Entries are never edited; a mistake is undone by a new entry. */
export function History({
  orgId,
  branchId,
  items,
  unit,
  canUndo,
}: {
  orgId: string;
  branchId: string;
  items: Movement[];
  unit: string;
  canUndo: boolean;
}) {
  const { t, router, pending, start, note, setNote } = useAction();
  const locale = useLocale();
  const [confirming, setConfirming] = useState<string | null>(null);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  const undo = (id: string) =>
    start(async () => {
      setNote(null);
      const r = await reverseMovementAction(orgId, branchId, id, { eventId: newKey() });
      setConfirming(null);
      if (r.ok) return router.refresh();
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setNote({ tone: "warn", text: errorText(t, r) });
    });
  if (items.length === 0) return <p className="text-ink/80">{t("stock.noHistory")}</p>;
  return (
    <div>
      {note && (
        <Banner tone="warn" role="alert" className="mb-3">
          {note.text}
        </Banner>
      )}
      <ul className="divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
        {items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-bold">
                {t.has(`kinds.${m.reason}`) ? t(`kinds.${m.reason}`) : m.reason}
                {m.bucket === "unsellable" && <Pill className="ml-2">{t("stock.unsellable")}</Pill>}
                {m.isReversed && <Pill className="ml-2">{t("stock.undone")}</Pill>}
              </p>
              <p className="text-sm text-ink/75">
                {[when(m.occurredAt), m.actorName, m.note].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={m.isReversed ? "font-bold line-through" : "font-bold"}>
                {m.qtyDelta > 0 ? "+" : "−"}
                {fmtQty(Math.abs(m.qtyDelta), locale)} {t(`units.${unit as "pcs"}`)}
              </span>
              {canUndo &&
                !m.isReversal &&
                !m.isReversed &&
                (confirming === m.id ? (
                  <span className="flex gap-2">
                    <Button small disabled={pending} onClick={() => undo(m.id)}>
                      {t("stock.undoYes")}
                    </Button>
                    <Button small variant="secondary" onClick={() => setConfirming(null)}>
                      {t("stock.undoNo")}
                    </Button>
                  </span>
                ) : (
                  <Button small variant="ghost" onClick={() => setConfirming(m.id)}>
                    {t("stock.undo")}
                  </Button>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
