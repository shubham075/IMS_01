import {
  allowsFraction,
  createProductSchema,
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  type ImportField,
  type ImportJob,
  type ImportPage,
  type ImportPreview,
  type ImportRow,
  type ImportRowPage,
  type ListImportRowsQuery,
  type ListImportsQuery,
  type PreviewImport,
  UNITS,
  type Unit,
} from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { AppError, Errors, pgHint } from "../common/errors";
import { iso, isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";
import { CsvError, parseCsv } from "./csv";

type Code =
  | "MISSING_NAME"
  | "UNKNOWN_CATEGORY"
  | "BAD_UNIT"
  | "BAD_PRICE"
  | "BAD_STOCK"
  | "BAD_BARCODE"
  | "BAD_SKU"
  | "TOO_LONG"
  | "FORMULA"
  | "DUPLICATE_IN_FILE"
  | "ALREADY_EXISTS"
  | "INVALID";

/** Column titles people actually use, in English and Hindi. Matching ignores case, spaces, hyphens and underscores. */
const HEADERS: Record<ImportField, string[]> = {
  name: ["name", "product", "productname", "item", "itemname", "नाम", "प्रोडक्ट", "सामान"],
  name_hi: ["namehi", "hindiname", "nameinhindi", "हिंदीनाम", "हिन्दीनाम"],
  category: ["category", "categoryname", "कैटेगरी", "श्रेणी"],
  unit: ["unit", "uom", "soldby", "इकाई"],
  price: ["price", "sellingprice", "rate", "saleprice", "कीमत", "भाव"],
  cost: ["cost", "costprice", "purchaseprice", "buyprice", "लागत"],
  barcode: ["barcode", "ean", "upc", "बारकोड"],
  sku: ["sku", "code", "productcode", "itemcode", "कोड"],
  brand: ["brand", "company", "ब्रांड"],
  pack_size: ["packsize", "pack", "size", "पैकसाइज"],
  stock: ["stock", "quantity", "qty", "openingstock", "openingqty", "onhand", "स्टॉक", "मात्रा"],
};
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, "");

const UNIT_WORDS: Record<string, Unit> = {
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  nos: "pcs",
  no: "pcs",
  unit: "pcs",
  units: "pcs",
  each: "pcs",
  पीस: "pcs",
  box: "box",
  boxes: "box",
  डिब्बा: "box",
  pack: "pack",
  packs: "pack",
  packet: "pack",
  packets: "pack",
  पैक: "pack",
  dozen: "dozen",
  doz: "dozen",
  दर्जन: "dozen",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilogram: "kg",
  किलो: "kg",
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  ग्राम: "g",
  l: "litre",
  ltr: "litre",
  litre: "litre",
  liter: "litre",
  litres: "litre",
  liters: "litre",
  लीटर: "litre",
  ml: "ml",
  मिली: "ml",
  m: "m",
  mtr: "m",
  meter: "m",
  metre: "m",
  meters: "m",
  metres: "m",
  मीटर: "m",
};

/** "249", "249.5", "₹1,299.00" -> paise. null = blank, undefined = not a price. */
export function rupeesToPaise(input: string): number | null | undefined {
  const s = input.replace(/[₹,]/g, "").trim();
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [r = "0", f = ""] = s.split(".");
  const paise = Number(r) * 100 + Number(f.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : undefined;
}

interface Parsed {
  rowNo: number;
  cells: Partial<Record<ImportField, string>>;
  status: "ok" | "error" | "skipped";
  code: Code | null;
  field: string | null;
  detail: string | null;
  existingProductId: string | null;
  product?: {
    name: string;
    nameHi?: string;
    brand?: string;
    categoryId: string;
    unit: Unit;
    packSize?: string;
    pricePaise?: number | null;
    costPaise?: number | null;
    barcode?: string;
    sku?: string;
  };
  stock: number | null;
}

interface JobRow {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  file_name: string | null;
  kind: string;
  status: string;
  total_rows: number;
  applied_rows: number;
  error_rows: number;
  ok_rows: string;
  skipped_rows: string;
  created_at: Date;
  applied_at: Date | null;
  undone_at: Date | null;
  created_by_name: string | null;
}

const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

@Injectable()
export class ImportsService {
  constructor(private readonly db: Db) {}

  async list(org: OrgContext, userId: string, q: ListImportsQuery): Promise<ImportPage> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const scope = this.scopeSql(org);
      const total = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM import_job j WHERE j.org_id = ${org.orgId} ${scope}`.execute(trx);
      const rows = await sql<JobRow>`${this.jobSelect()} WHERE j.org_id = ${org.orgId} ${scope}
        ORDER BY j.created_at DESC, j.id LIMIT ${q.limit} OFFSET ${q.offset}`.execute(trx);
      return {
        items: rows.rows.map(mapJob),
        total: Number(total.rows[0]?.n ?? 0),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  async get(org: OrgContext, userId: string, id: string): Promise<ImportJob> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => mapJob(await this.load(trx, org, id)));
  }

  async rows(org: OrgContext, userId: string, id: string, q: ListImportRowsQuery): Promise<ImportRowPage> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      await this.load(trx, org, id);
      const filter = q.status ? sql`AND r.status = ${q.status}` : sql``;
      const total = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM import_row r WHERE r.job_id = ${id} ${filter}`.execute(trx);
      const rs =
        await sql<RawRow>`SELECT r.row_no, r.status, r.error_code, r.product_id, r.raw FROM import_row r
        WHERE r.job_id = ${id} ${filter} ORDER BY r.row_no LIMIT ${q.limit} OFFSET ${q.offset}`.execute(trx);
      return {
        items: rs.rows.map(mapRow),
        total: Number(total.rows[0]?.n ?? 0),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  /** Reads the file and checks every row. Nothing in the shop changes; the result is kept so "Apply" does exactly this. */
  async preview(org: OrgContext, userId: string, dto: PreviewImport): Promise<ImportPreview> {
    if (org.branchIds.length && !org.branchIds.includes(dto.branchId)) throw Errors.branchOutOfScope();
    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(dto.csv, IMPORT_MAX_ROWS);
    } catch (err) {
      if (err instanceof CsvError)
        throw Errors.validation([{ path: "csv", message: err.message, code: err.code }], err.message);
      throw err;
    }
    const { map, recognised, ignored } = mapHeaders(parsed.header);
    if (!map.has("name"))
      throw Errors.validation([
        { path: "csv", message: "The file needs a column called name.", code: "NO_NAME_COLUMN" },
      ]);
    if (!map.has("category") && !dto.defaultCategoryId)
      throw Errors.validation([
        {
          path: "csv",
          message: "The file needs a category column, or choose a category for all rows.",
          code: "NO_CATEGORY",
        },
      ]);
    if (parsed.rows.length === 0)
      throw Errors.validation([{ path: "csv", message: "The file has no products.", code: "NO_ROWS" }]);

    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const branch = await trx
        .selectFrom("branch")
        .select("id")
        .where("org_id", "=", org.orgId)
        .where("id", "=", dto.branchId)
        .executeTakeFirst();
      if (!branch) throw Errors.notFound("Branch");

      const categories = new Map<string, string>();
      for (const c of await trx.selectFrom("category").selectAll().execute()) {
        for (const key of [c.slug, c.name_en, c.name_hi]) if (key) categories.set(norm(key), c.id);
      }
      if (dto.defaultCategoryId && ![...categories.values()].includes(dto.defaultCategoryId))
        throw Errors.validation([{ path: "defaultCategoryId", message: "Choose a category from the list." }]);

      const rows = parsed.rows.map((cells, i) => toCells(cells, map, i + 2));
      const existing = await this.existingKeys(trx, org.orgId, rows);
      const results = rows.map((cells) =>
        validate(cells, { categories, defaultCategoryId: dto.defaultCategoryId, existing }),
      );
      markDuplicatesInFile(results);

      const hasStock = map.has("stock");
      const job = await trx
        .insertInto("import_job")
        .values({
          org_id: org.orgId,
          branch_id: dto.branchId,
          kind: hasStock ? "opening_stock" : "products",
          status: "validated",
          file_key: "inline",
          file_name: dto.fileName ?? null,
          total_rows: results.length,
          error_rows: results.filter((r) => r.status === "error").length,
          created_by: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("import_job")
        .set({ file_key: `inline:${job.id}` })
        .where("id", "=", job.id)
        .execute();
      for (let i = 0; i < results.length; i += 500) {
        await trx
          .insertInto("import_row")
          .values(
            results.slice(i, i + 500).map((r) => ({
              org_id: org.orgId,
              job_id: job.id,
              row_no: r.rowNo,
              raw: JSON.stringify({
                cells: r.cells,
                product: r.product ?? null,
                stock: r.stock,
                field: r.field,
                detail: r.detail,
              }),
              status: r.status,
              error_code: r.code,
              product_id: r.existingProductId,
            })),
          )
          .execute();
      }
      const first =
        await sql<RawRow>`SELECT r.row_no, r.status, r.error_code, r.product_id, r.raw FROM import_row r
        WHERE r.job_id = ${job.id}
        ORDER BY (r.status = 'error') DESC, (r.status = 'skipped') DESC, r.row_no LIMIT 50`.execute(trx);
      return {
        job: mapJob(await this.load(trx, org, job.id)),
        recognised,
        ignored,
        rows: first.rows.map(mapRow),
      };
    });
  }

  /** Creates the products and their opening stock. Safe to repeat: a second call returns the finished job. */
  async apply(org: OrgContext, userId: string, id: string): Promise<ImportJob> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const job = await this.lock(trx, org, id);
      if (job.status === "applied") return mapJob(await this.load(trx, org, id));
      if (job.status !== "validated")
        throw Errors.conflict("This import cannot be applied (it was undone or failed).");
      if (job.branch_id && org.branchIds.length && !org.branchIds.includes(job.branch_id))
        throw Errors.branchOutOfScope();

      const rs =
        await sql<RawRow>`SELECT r.row_no, r.status, r.error_code, r.product_id, r.raw FROM import_row r
        WHERE r.job_id = ${id} AND r.status = 'ok' ORDER BY r.row_no`.execute(trx);
      if (rs.rows.length === 0)
        throw Errors.validation([
          { path: "job", message: "Nothing to import: every row has a problem or already exists." },
        ]);

      // The shop may have changed since the preview: re-check codes and skip rows that now clash.
      const cells = rs.rows.map((r) => toStored(r));
      const existing = await this.existingKeys(
        trx,
        org.orgId,
        cells.map((c) => ({ rowNo: c.rowNo, cells: c.cells })),
      );
      const used = new Set(
        (
          await trx
            .selectFrom("product_identifier")
            .select("value")
            .where("org_id", "=", org.orgId)
            .where("kind", "=", "short_code")
            .execute()
        ).map((x) => x.value),
      );
      let applied = 0;
      for (const row of cells) {
        const p = row.product;
        if (!p) continue;
        const clash = [p.barcode && existing.barcode.get(p.barcode), p.sku && existing.sku.get(p.sku)].find(
          Boolean,
        );
        if (clash) {
          await trx
            .updateTable("import_row")
            .set({ status: "skipped", error_code: "ALREADY_EXISTS", product_id: clash })
            .where("job_id", "=", id)
            .where("row_no", "=", row.rowNo)
            .execute();
          continue;
        }
        const created = await trx
          .insertInto("product")
          .values({
            org_id: org.orgId,
            category_id: p.categoryId,
            name: p.name,
            name_hi: p.nameHi ?? null,
            brand: p.brand ?? null,
            unit: p.unit,
            allow_fraction: allowsFraction(p.unit),
            pack_size: p.packSize ?? null,
            price_paise: p.pricePaise ?? null,
            price_updated_at: p.pricePaise != null ? new Date() : null,
            cost_paise: p.costPaise ?? null,
            created_by: userId,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const idents: Array<{ kind: string; value: string }> = [];
        if (p.barcode) idents.push({ kind: "barcode", value: p.barcode });
        if (p.sku) idents.push({ kind: "sku", value: p.sku });
        if (!p.barcode) idents.push({ kind: "short_code", value: newShortCode(used) });
        await trx
          .insertInto("product_identifier")
          .values(idents.map((i) => ({ ...i, org_id: org.orgId, product_id: created.id })))
          .execute();
        if (row.stock && row.stock > 0) {
          await guarded(() =>
            sql`SELECT * FROM apply_stock_movement(${org.orgId}::uuid, ${job.branch_id}::uuid, ${created.id}::uuid, ${row.stock}::numeric,
                'on_hand', 'opening', 'csv', ${`import:${id}:${row.rowNo}`}, now(), ${userId}::uuid, NULL, NULL, 'import', 'import_job', ${id})`.execute(
              trx,
            ),
          );
        }
        await trx
          .updateTable("import_row")
          .set({ status: "applied", product_id: created.id })
          .where("job_id", "=", id)
          .where("row_no", "=", row.rowNo)
          .execute();
        if (p.barcode) existing.barcode.set(p.barcode, created.id);
        if (p.sku) existing.sku.set(p.sku, created.id);
        applied++;
      }
      await trx
        .updateTable("import_job")
        .set({ status: "applied", applied_rows: applied, applied_at: new Date() })
        .where("id", "=", id)
        .execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "import.applied",
        targetType: "import_job",
        targetId: id,
        meta: { products: applied, rows: cells.length },
      });
      return mapJob(await this.load(trx, org, id));
    });
  }

  /**
   * Takes an import back: its opening stock is reversed and its products are switched off. Refused if anyone has
   * recorded anything else on those products since (a sale, a count, a transfer): that needs a person to sort out.
   */
  async undo(org: OrgContext, userId: string, id: string): Promise<ImportJob> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const job = await this.lock(trx, org, id);
      if (job.status === "undone") return mapJob(await this.load(trx, org, id));
      if (job.status !== "applied") throw Errors.conflict("Only an applied import can be undone.");
      if (job.branch_id && org.branchIds.length && !org.branchIds.includes(job.branch_id))
        throw Errors.branchOutOfScope();

      const made = await sql<{ product_id: string; row_no: number }>`SELECT product_id, row_no FROM import_row
        WHERE job_id = ${id} AND status = 'applied' ORDER BY row_no`.execute(trx);
      const productIds = made.rows.map((r) => r.product_id);
      if (productIds.length) {
        const later = await sql<{ n: string }>`SELECT count(*) AS n FROM stock_movement
          WHERE org_id = ${org.orgId} AND product_id IN (${sql.join(productIds)})
            AND NOT (source = 'csv' AND source_event_id LIKE ${`import:${id}:%`})`.execute(trx);
        if (Number(later.rows[0]?.n) > 0)
          throw Errors.conflict(
            "Stock has been recorded on these products since the import, so it cannot be undone automatically.",
          );
        const opening = await sql<{ id: string }>`SELECT id FROM stock_movement WHERE org_id = ${org.orgId}
          AND source = 'csv' AND source_event_id LIKE ${`import:${id}:%`}`.execute(trx);
        for (const m of opening.rows) {
          await guarded(() =>
            sql`SELECT * FROM reverse_stock_movement(${org.orgId}::uuid, ${m.id}::uuid, ${userId}::uuid, ${`undo:${id}:${m.id}`}, 'import undone')`.execute(
              trx,
            ),
          );
        }
        await trx
          .updateTable("product")
          .set({ status: "inactive" })
          .where("org_id", "=", org.orgId)
          .where("id", "in", productIds)
          .execute();
        for (const b of await trx
          .selectFrom("merchant_listing")
          .select(["branch_id", "product_id"])
          .where("product_id", "in", productIds)
          .execute())
          await sql`SELECT refresh_public_listing(${b.branch_id}::uuid, ${b.product_id}::uuid)`.execute(trx);
      }
      await trx
        .updateTable("import_job")
        .set({ status: "undone", undone_at: new Date() })
        .where("id", "=", id)
        .execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "import.undone",
        targetType: "import_job",
        targetId: id,
        meta: { products: productIds.length },
      });
      return mapJob(await this.load(trx, org, id));
    });
  }

  // ---------- helpers ----------

  private scopeSql(org: OrgContext) {
    return org.branchIds.length
      ? sql`AND (j.branch_id IS NULL OR j.branch_id IN (${sql.join(org.branchIds)}))`
      : sql``;
  }

  private jobSelect() {
    return sql`
      SELECT j.id, j.branch_id, b.name AS branch_name, j.file_name, j.kind, j.status, j.total_rows, j.applied_rows, j.error_rows,
             (SELECT count(*) FROM import_row r WHERE r.job_id = j.id AND r.status IN ('ok','applied')) AS ok_rows,
             (SELECT count(*) FROM import_row r WHERE r.job_id = j.id AND r.status = 'skipped') AS skipped_rows,
             j.created_at, j.applied_at, j.undone_at, u.display_name AS created_by_name
        FROM import_job j
        LEFT JOIN branch b ON b.org_id = j.org_id AND b.id = j.branch_id
        LEFT JOIN app_user u ON u.id = j.created_by`;
  }

  private async load(trx: Trx, org: OrgContext, id: string): Promise<JobRow> {
    const r = await sql<JobRow>`${this.jobSelect()} WHERE j.org_id = ${org.orgId} AND j.id = ${id}`.execute(
      trx,
    );
    const row = r.rows[0];
    if (!row) throw Errors.notFound("Import");
    if (org.branchIds.length && row.branch_id && !org.branchIds.includes(row.branch_id))
      throw Errors.notFound("Import");
    return row;
  }

  private async lock(trx: Trx, org: OrgContext, id: string): Promise<JobRow> {
    const job = await this.load(trx, org, id);
    await sql`SELECT 1 FROM import_job WHERE id = ${id} FOR UPDATE`.execute(trx);
    return (await this.load(trx, org, id)) ?? job;
  }

  /** Barcodes and codes (and names of products without any code) that the shop already has. */
  private async existingKeys(
    trx: Trx,
    orgId: string,
    rows: Array<{ rowNo: number; cells: Partial<Record<ImportField, string>> }>,
  ) {
    const barcodes = [...new Set(rows.map((r) => r.cells.barcode).filter((v): v is string => !!v))];
    const skus = [...new Set(rows.map((r) => r.cells.sku).filter((v): v is string => !!v))];
    const names = [
      ...new Set(
        rows
          .filter((r) => !r.cells.barcode && !r.cells.sku && r.cells.name)
          .map((r) => (r.cells.name as string).toLowerCase()),
      ),
    ];
    const out = {
      barcode: new Map<string, string>(),
      sku: new Map<string, string>(),
      name: new Map<string, string>(),
    };
    const chunk = <T>(a: T[]) =>
      Array.from({ length: Math.ceil(a.length / 500) }, (_, i) => a.slice(i * 500, i * 500 + 500));
    for (const [kind, values, target] of [
      ["barcode", barcodes, out.barcode],
      ["sku", skus, out.sku],
    ] as const) {
      for (const part of chunk([...values])) {
        const r = await trx
          .selectFrom("product_identifier")
          .select(["value", "product_id"])
          .where("org_id", "=", orgId)
          .where("kind", "=", kind)
          .where("value", "in", part)
          .execute();
        for (const x of r) target.set(x.value, x.product_id);
      }
    }
    for (const part of chunk(names)) {
      const r = await sql<{ lname: string; id: string }>`SELECT lower(name) AS lname, id FROM product
        WHERE org_id = ${orgId} AND status <> 'merged' AND lower(name) IN (${sql.join(part)})`.execute(trx);
      for (const x of r.rows) out.name.set(x.lname, x.id);
    }
    return out;
  }
}

// ---------- pure helpers ----------

type Existing = { barcode: Map<string, string>; sku: Map<string, string>; name: Map<string, string> };

export function mapHeaders(header: string[]) {
  const map = new Map<ImportField, number>();
  const recognised: Array<{ column: string; field: ImportField }> = [];
  const ignored: string[] = [];
  header.forEach((col, i) => {
    const key = norm(col);
    const field = IMPORT_FIELDS.find((f) => HEADERS[f].some((a) => norm(a) === key));
    if (field && !map.has(field)) {
      map.set(field, i);
      recognised.push({ column: col, field });
    } else if (col !== "") ignored.push(col);
  });
  return { map, recognised, ignored };
}

function toCells(cells: string[], map: Map<ImportField, number>, rowNo: number) {
  const out: Partial<Record<ImportField, string>> = {};
  for (const [field, idx] of map) {
    const v = (cells[idx] ?? "").trim();
    if (v !== "") out[field] = v;
  }
  return { rowNo, cells: out };
}

const FORMULA = /^[=+@]/;
const TEXT_FIELDS: ImportField[] = [
  "name",
  "name_hi",
  "category",
  "brand",
  "pack_size",
  "sku",
  "barcode",
  "unit",
];

function validate(
  row: { rowNo: number; cells: Partial<Record<ImportField, string>> },
  ctx: { categories: Map<string, string>; defaultCategoryId?: string; existing: Existing },
): Parsed {
  const { rowNo, cells } = row;
  const fail = (code: Code, field: string, detail: string | null = null): Parsed => ({
    rowNo,
    cells,
    status: "error",
    code,
    field,
    detail,
    existingProductId: null,
    stock: null,
  });
  for (const f of TEXT_FIELDS) {
    const v = cells[f];
    if (v && FORMULA.test(v)) return fail("FORMULA", f, v.slice(0, 40));
  }
  if (!cells.name) return fail("MISSING_NAME", "name");

  let categoryId = ctx.defaultCategoryId;
  if (cells.category) {
    categoryId = ctx.categories.get(norm(cells.category));
    if (!categoryId) return fail("UNKNOWN_CATEGORY", "category", cells.category.slice(0, 60));
  }
  if (!categoryId) return fail("UNKNOWN_CATEGORY", "category");

  let unit: Unit = "pcs";
  if (cells.unit) {
    const u = UNIT_WORDS[cells.unit.toLowerCase().replace(/[.\s]/g, "")] ?? UNIT_WORDS[cells.unit.trim()];
    if (!u || !UNITS.includes(u)) return fail("BAD_UNIT", "unit", cells.unit.slice(0, 30));
    unit = u;
  }
  const price = cells.price ? rupeesToPaise(cells.price) : null;
  if (price === undefined) return fail("BAD_PRICE", "price", cells.price?.slice(0, 30) ?? null);
  const cost = cells.cost ? rupeesToPaise(cells.cost) : null;
  if (cost === undefined) return fail("BAD_PRICE", "cost", cells.cost?.slice(0, 30) ?? null);

  let stock: number | null = null;
  if (cells.stock) {
    const s = cells.stock.replace(/,/g, "");
    const n = /^\d+(\.\d{1,3})?$/.test(s) ? Number(s) : Number.NaN;
    if (!Number.isFinite(n) || n > 10_000_000) return fail("BAD_STOCK", "stock", cells.stock.slice(0, 30));
    if (!allowsFraction(unit) && n !== Math.trunc(n))
      return fail("BAD_STOCK", "stock", cells.stock.slice(0, 30));
    stock = n;
  }

  const candidate = {
    name: cells.name,
    categoryId,
    unit,
    ...(cells.name_hi ? { nameHi: cells.name_hi } : {}),
    ...(cells.brand ? { brand: cells.brand } : {}),
    ...(cells.pack_size ? { packSize: cells.pack_size } : {}),
    ...(price !== null ? { pricePaise: price } : {}),
    ...(cost !== null ? { costPaise: cost } : {}),
    ...(cells.barcode ? { barcode: cells.barcode } : {}),
    ...(cells.sku ? { sku: cells.sku } : {}),
  };
  const checked = createProductSchema.safeParse(candidate);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const path = String(issue?.path[0] ?? "name");
    const code: Code =
      path === "barcode"
        ? "BAD_BARCODE"
        : path === "sku"
          ? "BAD_SKU"
          : path === "pricePaise" || path === "costPaise"
            ? "BAD_PRICE"
            : issue?.code === "too_big"
              ? "TOO_LONG"
              : path === "name"
                ? "MISSING_NAME"
                : "INVALID";
    return fail(code, path, String((candidate as Record<string, unknown>)[path] ?? "").slice(0, 60));
  }
  const p = checked.data;

  const hit =
    (p.barcode &&
      ctx.existing.barcode.get(p.barcode) &&
      (["barcode", ctx.existing.barcode.get(p.barcode)] as const)) ||
    (p.sku && ctx.existing.sku.get(p.sku) && (["sku", ctx.existing.sku.get(p.sku)] as const)) ||
    (!p.barcode &&
      !p.sku &&
      ctx.existing.name.get(p.name.toLowerCase()) &&
      (["name", ctx.existing.name.get(p.name.toLowerCase())] as const)) ||
    null;
  const product = {
    name: p.name,
    nameHi: p.nameHi,
    brand: p.brand,
    categoryId: p.categoryId,
    unit: p.unit as Unit,
    packSize: p.packSize,
    pricePaise: p.pricePaise,
    costPaise: p.costPaise,
    barcode: p.barcode,
    sku: p.sku,
  };
  if (hit)
    return {
      rowNo,
      cells,
      status: "skipped",
      code: "ALREADY_EXISTS",
      field: hit[0],
      detail: null,
      existingProductId: hit[1] as string,
      product,
      stock,
    };
  return {
    rowNo,
    cells,
    status: "ok",
    code: null,
    field: null,
    detail: null,
    existingProductId: null,
    product,
    stock,
  };
}

/** The same barcode or code twice in one file: keep the first row, flag the later ones (docs/01 M4). */
function markDuplicatesInFile(rows: Parsed[]) {
  const seen = { barcode: new Map<string, number>(), sku: new Map<string, number>() };
  for (const r of rows) {
    if (r.status !== "ok" || !r.product) continue;
    for (const f of ["barcode", "sku"] as const) {
      const v = r.product[f];
      if (!v) continue;
      const first = seen[f].get(v);
      if (first !== undefined) {
        r.status = "error";
        r.code = "DUPLICATE_IN_FILE";
        r.field = f;
        r.detail = String(first);
        break;
      }
    }
    if (r.status === "ok") {
      if (r.product.barcode) seen.barcode.set(r.product.barcode, r.rowNo);
      if (r.product.sku) seen.sku.set(r.product.sku, r.rowNo);
    }
  }
  // names without any code: the same product listed twice is almost certainly a mistake
  const names = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "ok" || !r.product || r.product.barcode || r.product.sku) continue;
    const key = `${r.product.name.toLowerCase()}|${r.product.unit}`;
    const first = names.get(key);
    if (first !== undefined) {
      r.status = "error";
      r.code = "DUPLICATE_IN_FILE";
      r.field = "name";
      r.detail = String(first);
    } else names.set(key, r.rowNo);
  }
}

interface RawRow {
  row_no: number;
  status: string;
  error_code: string | null;
  product_id: string | null;
  raw: {
    cells?: Partial<Record<ImportField, string>>;
    product?: Parsed["product"] | null;
    stock?: number | null;
    field?: string | null;
    detail?: string | null;
  };
}

function toStored(r: RawRow) {
  return {
    rowNo: r.row_no,
    cells: r.raw.cells ?? {},
    product: r.raw.product ?? undefined,
    stock: r.raw.stock ?? null,
  };
}

function mapRow(r: RawRow): ImportRow {
  return {
    rowNo: r.row_no,
    status: r.status as ImportRow["status"],
    name: r.raw.cells?.name ?? null,
    stock: r.raw.stock ?? null,
    errorCode: r.error_code as ImportRow["errorCode"],
    field: r.raw.field ?? null,
    detail: r.raw.detail ?? null,
    existingProductId: r.error_code === "ALREADY_EXISTS" ? r.product_id : null,
  };
}

function mapJob(r: JobRow): ImportJob {
  return {
    id: r.id,
    branchId: r.branch_id,
    branchName: r.branch_name,
    fileName: r.file_name,
    kind: r.kind as ImportJob["kind"],
    status: r.status as ImportJob["status"],
    totalRows: r.total_rows,
    okRows: Number(r.ok_rows),
    skippedRows: Number(r.skipped_rows),
    errorRows: r.error_rows,
    appliedRows: r.applied_rows,
    createdAt: isoReq(r.created_at),
    appliedAt: iso(r.applied_at),
    undoneAt: iso(r.undone_at),
    createdByName: r.created_by_name,
  };
}

function newShortCode(used: Set<string>): string {
  for (;;) {
    let code = "";
    for (let n = 0; n < 6; n++)
      code += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    const mapped = Errors.fromHint(pgHint(err), err instanceof Error ? err.message : "");
    throw mapped ?? err;
  }
}
