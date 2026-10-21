"use client";

import {
  type Branch,
  type Category,
  IMPORT_MAX_BYTES,
  type ImportJob,
  type ImportPreview,
  type ImportRow,
} from "@idea01/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { applyImportAction, previewImportAction, undoImportAction } from "@/app/actions/imports";
import { decodeCsv } from "@/lib/csv-decode";
import { errorText, SESSION_ERRORS } from "@/lib/error-text";
import { Banner, Button, Card, Field, Input, Pill, Select } from "./ui";

/** One sentence per problem, in the person's language: what is wrong, in which row, with which value. */
export function useRowText() {
  const t = useTranslations("imports");
  return (r: ImportRow) => {
    if (!r.errorCode) return "";
    const key = `row.${r.errorCode}`;
    return t.has(key)
      ? t(key, { field: r.field ? t(`fields.${r.field}`) : "", detail: r.detail ?? "" })
      : t("row.INVALID", { field: r.field ?? "", detail: r.detail ?? "" });
  };
}

export function RowTable({ rows }: { rows: ImportRow[] }) {
  const t = useTranslations("imports");
  const text = useRowText();
  if (rows.length === 0) return <p className="text-ink/80">{t("noRows")}</p>;
  return (
    <ul className="divide-y-2 divide-ink rounded-card border-[2.5px] border-ink bg-paper">
      {rows.map((r) => (
        <li key={r.rowNo} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
          <span className="min-w-0">
            <span className="font-bold">
              {t("rowLabel", { n: r.rowNo })} · {r.name ?? "—"}
            </span>
            {r.errorCode && <span className="block text-sm">{text(r)}</span>}
            {r.existingProductId && (
              <Link href={`/app/products/${r.existingProductId}`} className="text-sm font-bold underline">
                {t("openExisting")}
              </Link>
            )}
          </span>
          <Pill tone={r.status === "error" ? "ink" : r.status === "skipped" ? "grey" : "volt"}>
            {t(`rowStatus.${r.status}`)}
          </Pill>
        </li>
      ))}
    </ul>
  );
}

/** Choose a file, check it, see every problem, then apply. Nothing is created before "Import". */
export function ImportUploader({
  orgId,
  branches,
  categories,
}: {
  orgId: string;
  branches: Branch[];
  categories: Category[];
}) {
  const t = useTranslations("imports");
  const tc = useTranslations();
  const router = useRouter();
  const lang = useLocale();
  const [pending, start] = useTransition();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  function check() {
    setError(null);
    setDone(null);
    const f = file.current?.files?.[0];
    if (!f) return setError(t("chooseFile"));
    if (f.size > IMPORT_MAX_BYTES) return setError(t("tooBig"));
    start(async () => {
      const csv = decodeCsv(await f.arrayBuffer());
      const r = await previewImportAction(orgId, {
        branchId,
        csv,
        fileName: f.name,
        ...(categoryId ? { defaultCategoryId: categoryId } : {}),
      });
      if (r.ok) return setPreview(r.data);
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setPreview(null);
      const csvMessage = r.fieldErrors?.csv;
      setError(csvMessage ? csvProblem(t, csvMessage) : errorText(tc, r));
    });
  }

  function apply() {
    if (!preview) return;
    setError(null);
    start(async () => {
      const r = await applyImportAction(orgId, preview.job.id);
      if (r.ok) {
        setDone(r.data);
        setPreview(null);
        if (file.current) file.current.value = "";
        return router.refresh();
      }
      if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
      setError(errorText(tc, r));
    });
  }

  if (done) {
    return (
      <Card>
        <h2 className="text-xl font-bold">{t("doneTitle")}</h2>
        <p className="mt-2 font-semibold" role="status">
          {t("doneBody", { n: done.appliedRows })}
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link href="/app/products" className="font-bold underline">
            {t("seeProducts")}
          </Link>
          <Link href={`/app/import/${done.id}`} className="font-bold underline">
            {t("seeReport")}
          </Link>
          <Button small variant="secondary" onClick={() => setDone(null)}>
            {t("importAnother")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-xl font-bold">{t("uploadTitle")}</h2>
      <p className="mt-1 text-ink/80">{t("uploadHelp")}</p>
      <p className="mt-2">
        <a
          href={`/app/import/template?lang=${lang === "hi" ? "hi" : "en"}`}
          className="font-bold underline"
          download
        >
          {t("downloadTemplate")}
        </a>
      </p>
      {error && (
        <Banner tone="warn" role="alert" className="mt-4">
          {error}
        </Banner>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={t("branch")} htmlFor="imp-branch" hint={t("branchHelp")}>
          <Select id="imp-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("defaultCategory")} htmlFor="imp-cat" hint={t("defaultCategoryHelp")}>
          <Select id="imp-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("noDefaultCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {lang === "hi" && c.nameHi ? c.nameHi : c.nameEn}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("file")} htmlFor="imp-file">
        <Input
          id="imp-file"
          ref={file}
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={() => {
            setPreview(null);
            setError(null);
          }}
        />
      </Field>
      <Button className="mt-4" disabled={pending} onClick={check}>
        {pending && !preview ? t("checking") : t("check")}
      </Button>

      {preview && (
        <section className="mt-8" aria-labelledby="preview-title">
          <h3 id="preview-title" className="text-lg font-bold">
            {t("previewTitle", { name: preview.job.fileName ?? "" })}
          </h3>
          <p className="mt-2 flex flex-wrap gap-2" role="status">
            <Pill tone="volt">{t("okCount", { n: preview.job.okRows })}</Pill>
            {preview.job.skippedRows > 0 && <Pill>{t("skippedCount", { n: preview.job.skippedRows })}</Pill>}
            {preview.job.errorRows > 0 && (
              <Pill tone="ink">{t("errorCount", { n: preview.job.errorRows })}</Pill>
            )}
          </p>
          <p className="mt-2 text-sm text-ink/80">
            {t("recognised", {
              list: preview.recognised.map((r) => `${r.column} → ${t(`fields.${r.field}`)}`).join(", "),
            })}
          </p>
          {preview.ignored.length > 0 && (
            <p className="mt-1 text-sm text-ink/80">{t("ignored", { list: preview.ignored.join(", ") })}</p>
          )}
          {preview.job.errorRows + preview.job.skippedRows >
            preview.rows.filter((r) => r.status !== "ok").length && (
            <p className="mt-1 text-sm">{t("firstRows")}</p>
          )}
          <div className="mt-3">
            <RowTable rows={preview.rows} />
          </div>
          {preview.job.okRows > 0 ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button disabled={pending} onClick={apply}>
                {pending ? tc("common.saving") : t("apply", { n: preview.job.okRows })}
              </Button>
              <span className="text-sm">
                {preview.job.errorRows > 0 ? t("applyOnlyGood") : t("nothingYet")}
              </span>
            </div>
          ) : (
            <p className="mt-4 font-bold">{t("nothingToImport")}</p>
          )}
        </section>
      )}
    </Card>
  );
}

function csvProblem(t: ReturnType<typeof useTranslations>, message: string): string {
  // The server's file errors carry a stable code in `fieldErrors.csv`'s message; show our own wording for the common ones.
  const known: Record<string, string> = {
    "The file is empty.": "problem.EMPTY",
    "This does not look like a CSV text file.": "problem.BINARY",
    "A quoted cell is not closed.": "problem.UNCLOSED_QUOTE",
    "Too many rows.": "problem.TOO_MANY_ROWS",
    "Too many columns.": "problem.TOO_MANY_COLUMNS",
    "A cell is too long.": "problem.CELL_TOO_LONG",
    "The file needs a column called name.": "problem.NO_NAME_COLUMN",
    "The file needs a category column, or choose a category for all rows.": "problem.NO_CATEGORY",
    "The file has no products.": "problem.NO_ROWS",
    "The file is too large.": "tooBig",
  };
  const key = known[message];
  return key && t.has(key) ? t(key) : t("problem.OTHER");
}

/** Undo an applied import (only possible while nothing else has been recorded on its products). */
export function UndoImport({ orgId, job }: { orgId: string; job: ImportJob }) {
  const t = useTranslations("imports");
  const tc = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (job.status !== "applied") return null;
  return (
    <div className="mt-4">
      {error && (
        <Banner tone="warn" role="alert" className="mb-3">
          {error}
        </Banner>
      )}
      {confirm ? (
        <span className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">{t("undoConfirm", { n: job.appliedRows })}</span>
          <Button
            small
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await undoImportAction(orgId, job.id);
                setConfirm(false);
                if (r.ok) return router.refresh();
                if (SESSION_ERRORS.has(r.code)) return router.replace("/login");
                setError(r.code === "VERSION_CONFLICT" ? t("undoBlocked") : errorText(tc, r));
              })
            }
          >
            {t("undoYes")}
          </Button>
          <Button small variant="secondary" onClick={() => setConfirm(false)}>
            {t("undoNo")}
          </Button>
        </span>
      ) : (
        <Button small variant="secondary" onClick={() => setConfirm(true)}>
          {t("undo")}
        </Button>
      )}
    </div>
  );
}
