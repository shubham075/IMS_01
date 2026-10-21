import {
  type AddFromCatalogue,
  allowsFraction,
  type CanonicalProduct,
  type Category,
  type CreateProduct,
  type ListProductsQuery,
  type Listing,
  type Product,
  type ProductDetail,
  type ProductPage,
  type SearchCatalogueQuery,
  type SetIdentifiers,
  type SetListing,
  type Unit,
  type UpdateProduct,
} from "@idea01/schemas";
import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import type { OrgContext } from "../auth/auth.types";
import { writeAudit } from "../common/audit";
import { Errors } from "../common/errors";
import { isoReq } from "../common/util";
import { Db, type Trx } from "../db/db.service";

const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type Ident = { kind: string; value: string };
type ProductRow = {
  id: string;
  name: string;
  name_hi: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  category_id: string | null;
  unit: string;
  allow_fraction: boolean;
  pack_size: string | null;
  attrs: unknown;
  tracking_mode: string;
  low_stock_threshold: string | number;
  price_paise: string | number | null;
  cost_paise: string | number | null;
  status: string;
  canonical_id: string | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class ProductsService {
  constructor(private readonly db: Db) {}

  async categories(org: OrgContext, userId: string): Promise<Category[]> {
    const rows = await this.db.tx({ userId, orgId: org.orgId }, (trx) =>
      trx.selectFrom("category").selectAll().orderBy("name_en").execute(),
    );
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      nameEn: c.name_en,
      nameHi: c.name_hi,
      restricted: c.restricted,
    }));
  }

  async searchCatalogue(org: OrgContext, userId: string, q: SearchCatalogueQuery): Promise<CanonicalProduct[]> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const term = `%${likeEscape(q.q.toLowerCase())}%`;
      let query = trx
        .selectFrom("canonical_product as c")
        .leftJoin("product as p", (j) => j.onRef("p.canonical_id", "=", "c.id").on("p.org_id", "=", org.orgId))
        .select(["c.id", "c.name", "c.brand", "c.barcode", "c.category_id", "p.id as added_id"])
        .where((eb) =>
          eb.or([
            eb(sql`f_unaccent(lower(c.name))`, "like", term),
            eb(sql`f_unaccent(lower(coalesce(c.brand, '')))`, "like", term),
            eb("c.barcode", "=", q.q),
          ]),
        )
        .orderBy("c.name")
        .limit(q.limit);
      if (q.categoryId) query = query.where("c.category_id", "=", q.categoryId);
      return (await query.execute()).map((r) => ({
        id: r.id,
        name: r.name,
        brand: r.brand,
        barcode: r.barcode,
        categoryId: r.category_id,
        alreadyAddedProductId: r.added_id,
      }));
    });
  }

  async list(org: OrgContext, userId: string, q: ListProductsQuery): Promise<ProductPage> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const base = () => {
        let b = trx.selectFrom("product as p").where("p.org_id", "=", org.orgId);
        b = q.status === "all" ? b.where("p.status", "<>", "merged") : b.where("p.status", "=", q.status);
        if (q.categoryId) b = b.where("p.category_id", "=", q.categoryId);
        if (q.q) {
          const term = `%${likeEscape(q.q.toLowerCase())}%`;
          b = b.where((eb) =>
            eb.or([
              eb(sql`f_unaccent(lower(p.name))`, "like", term),
              eb(sql`lower(coalesce(p.name_hi, ''))`, "like", term),
              eb(sql`lower(coalesce(p.brand, ''))`, "like", term),
              eb.exists(
                eb
                  .selectFrom("product_identifier as i")
                  .select(sql`1`.as("x"))
                  .whereRef("i.product_id", "=", "p.id")
                  .where(sql`lower(i.value)`, "like", term),
              ),
            ]),
          );
        }
        return b;
      };
      const total = await base().select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
      const rows = await base()
        .selectAll("p")
        .orderBy(sql`lower(p.name)`)
        .orderBy("p.id")
        .limit(q.limit)
        .offset(q.offset)
        .execute();
      const ids = await this.identifiersFor(
        trx,
        rows.map((r) => r.id),
      );
      const counts = await this.publishedCounts(trx, org, rows.map((r) => r.id));
      return {
        items: rows.map((r) => this.map(org, r as ProductRow, ids.get(r.id) ?? [], counts.get(r.id) ?? 0)),
        total: Number(total.n),
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  async get(org: OrgContext, userId: string, id: string): Promise<ProductDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, (trx) => this.detail(trx, org, id));
  }

  async create(org: OrgContext, userId: string, dto: CreateProduct): Promise<ProductDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      await this.assertCategory(trx, dto.categoryId);
      await this.assertFree(trx, org.orgId, "barcode", dto.barcode);
      await this.assertFree(trx, org.orgId, "sku", dto.sku);
      const row = await trx
        .insertInto("product")
        .values({
          org_id: org.orgId,
          category_id: dto.categoryId,
          name: dto.name,
          name_hi: dto.nameHi || null,
          brand: dto.brand || null,
          model: dto.model || null,
          description: dto.description || null,
          unit: dto.unit,
          allow_fraction: allowsFraction(dto.unit),
          pack_size: dto.packSize || null,
          attrs: JSON.stringify(dto.attrs ?? {}),
          tracking_mode: dto.trackingMode,
          low_stock_threshold: dto.lowStockThreshold,
          price_paise: dto.pricePaise ?? null,
          price_updated_at: dto.pricePaise != null ? new Date() : null,
          cost_paise: dto.costPaise ?? null,
          created_by: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const idents: Ident[] = [];
      if (dto.barcode) idents.push({ kind: "barcode", value: dto.barcode });
      if (dto.sku) idents.push({ kind: "sku", value: dto.sku });
      if (!dto.barcode) idents.push({ kind: "short_code", value: await this.newShortCode(trx, org.orgId) });
      await trx
        .insertInto("product_identifier")
        .values(idents.map((i) => ({ ...i, org_id: org.orgId, product_id: row.id })))
        .execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "product.created",
        targetType: "product",
        targetId: row.id,
      });
      return this.detail(trx, org, row.id);
    });
  }

  async addFromCatalogue(org: OrgContext, userId: string, dto: AddFromCatalogue): Promise<ProductDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const c = await trx.selectFrom("canonical_product").selectAll().where("id", "=", dto.canonicalId).executeTakeFirst();
      if (!c) throw Errors.notFound("Catalogue product");
      const existing = await trx
        .selectFrom("product")
        .select("id")
        .where("org_id", "=", org.orgId)
        .where("canonical_id", "=", c.id)
        .executeTakeFirst();
      if (existing) throw Errors.duplicateIdentifier("catalogue product", existing.id);
      if (c.barcode) await this.assertFree(trx, org.orgId, "barcode", c.barcode);
      const row = await trx
        .insertInto("product")
        .values({
          org_id: org.orgId,
          category_id: c.category_id,
          canonical_id: c.id,
          name: c.name,
          brand: c.brand,
          unit: dto.unit,
          allow_fraction: allowsFraction(dto.unit),
          price_paise: dto.pricePaise ?? null,
          price_updated_at: dto.pricePaise != null ? new Date() : null,
          created_by: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("product_identifier")
        .values({
          org_id: org.orgId,
          product_id: row.id,
          kind: c.barcode ? "barcode" : "short_code",
          value: c.barcode ?? (await this.newShortCode(trx, org.orgId)),
        })
        .execute();
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "product.created",
        targetType: "product",
        targetId: row.id,
        meta: { canonicalId: c.id },
      });
      return this.detail(trx, org, row.id);
    });
  }

  async update(org: OrgContext, userId: string, id: string, dto: UpdateProduct): Promise<ProductDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const cur = await trx
        .selectFrom("product")
        .select(["id", "status", "price_paise"])
        .where("org_id", "=", org.orgId)
        .where("id", "=", id)
        .executeTakeFirst();
      if (!cur || cur.status === "merged") throw Errors.notFound("Product");
      if (dto.categoryId) await this.assertCategory(trx, dto.categoryId);
      const patch: Record<string, unknown> = {};
      const columns: Record<string, string> = {
        name: "name",
        nameHi: "name_hi",
        brand: "brand",
        model: "model",
        description: "description",
        categoryId: "category_id",
        unit: "unit",
        packSize: "pack_size",
        trackingMode: "tracking_mode",
        lowStockThreshold: "low_stock_threshold",
        costPaise: "cost_paise",
        status: "status",
      };
      for (const [key, col] of Object.entries(columns)) {
        const v = (dto as Record<string, unknown>)[key];
        if (v !== undefined) patch[col] = v === "" ? null : v;
      }
      if (dto.unit) patch.allow_fraction = allowsFraction(dto.unit as Unit);
      if (dto.attrs !== undefined) patch.attrs = JSON.stringify(dto.attrs);
      if (dto.pricePaise !== undefined) {
        patch.price_paise = dto.pricePaise;
        if (num(cur.price_paise) !== dto.pricePaise) patch.price_updated_at = new Date();
      }
      await trx.updateTable("product").set(patch).where("id", "=", id).execute();
      await this.refreshPublic(trx, id);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: dto.status ? `product.${dto.status === "active" ? "activated" : "deactivated"}` : "product.updated",
        targetType: "product",
        targetId: id,
        meta: { fields: Object.keys(dto) },
      });
      return this.detail(trx, org, id);
    });
  }

  async setIdentifiers(org: OrgContext, userId: string, id: string, dto: SetIdentifiers): Promise<ProductDetail> {
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      await this.requireProduct(trx, org.orgId, id);
      const wanted: Ident[] = [
        ...dto.barcodes.map((value) => ({ kind: "barcode", value })),
        ...dto.skus.map((value) => ({ kind: "sku", value })),
        ...dto.aliases.map((value) => ({ kind: "alias", value })),
      ];
      for (const w of wanted) {
        if (w.kind !== "alias") await this.assertFree(trx, org.orgId, w.kind, w.value, id);
      }
      await trx
        .deleteFrom("product_identifier")
        .where("org_id", "=", org.orgId)
        .where("product_id", "=", id)
        .where("kind", "<>", "short_code")
        .execute();
      const unique = [...new Map(wanted.map((w) => [`${w.kind}:${w.value}`, w])).values()];
      if (unique.length)
        await trx
          .insertInto("product_identifier")
          .values(unique.map((w) => ({ ...w, org_id: org.orgId, product_id: id })))
          .execute();
      await this.refreshPublic(trx, id);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: "product.identifiers_changed",
        targetType: "product",
        targetId: id,
      });
      return this.detail(trx, org, id);
    });
  }

  async setListing(
    org: OrgContext,
    userId: string,
    productId: string,
    branchId: string,
    dto: SetListing,
  ): Promise<ProductDetail> {
    if (org.branchIds.length && !org.branchIds.includes(branchId)) throw Errors.branchOutOfScope();
    return this.db.tx({ userId, orgId: org.orgId }, async (trx) => {
      const product = await trx
        .selectFrom("product as p")
        .leftJoin("category as c", "c.id", "p.category_id")
        .select(["p.id", "p.status", "c.restricted"])
        .where("p.org_id", "=", org.orgId)
        .where("p.id", "=", productId)
        .executeTakeFirst();
      if (!product || product.status === "merged") throw Errors.notFound("Product");
      const branch = await trx
        .selectFrom("branch")
        .select(["id", sql<boolean>`geo is not null`.as("has_pin")])
        .where("org_id", "=", org.orgId)
        .where("id", "=", branchId)
        .executeTakeFirst();
      if (!branch) throw Errors.notFound("Branch");
      if (dto.isPublished) {
        if (product.restricted) throw Errors.restrictedCategory();
        if (product.status !== "active")
          throw Errors.validation([
            { path: "isPublished", message: "Turn the product on before showing it to shoppers." },
          ]);
        if (!branch.has_pin)
          throw Errors.branchNotReady("Pin this branch on the map before showing products to shoppers.");
      }
      const prev = await trx
        .selectFrom("merchant_listing")
        .select(["price_paise", "is_published"])
        .where("branch_id", "=", branchId)
        .where("product_id", "=", productId)
        .executeTakeFirst();
      const priceChanged = (dto.pricePaise ?? null) !== num(prev?.price_paise ?? null);
      const values = {
        is_published: dto.isPublished,
        show_price: dto.showPrice,
        price_paise: dto.pricePaise ?? null,
        temporarily_unavailable: dto.temporarilyUnavailable,
        published_by: userId,
        ...(priceChanged ? { price_updated_at: new Date() } : {}),
        ...(dto.isPublished && !prev?.is_published ? { published_at: new Date() } : {}),
      };
      await trx
        .insertInto("merchant_listing")
        .values({ org_id: org.orgId, branch_id: branchId, product_id: productId, ...values })
        .onConflict((oc) => oc.columns(["branch_id", "product_id"]).doUpdateSet(values))
        .execute();
      await sql`select refresh_public_listing(${branchId}::uuid, ${productId}::uuid)`.execute(trx);
      await writeAudit(trx, {
        orgId: org.orgId,
        actorUserId: userId,
        action: dto.isPublished ? "listing.published" : "listing.unpublished",
        targetType: "product",
        targetId: productId,
        meta: { branchId, showPrice: dto.showPrice },
      });
      return this.detail(trx, org, productId);
    });
  }

  // ---------- helpers ----------

  private async detail(trx: Trx, org: OrgContext, id: string): Promise<ProductDetail> {
    const row = await trx
      .selectFrom("product")
      .selectAll()
      .where("org_id", "=", org.orgId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row || row.status === "merged") throw Errors.notFound("Product");
    const ids = await this.identifiersFor(trx, [id]);
    let bq = trx
      .selectFrom("branch as b")
      .leftJoin("merchant_listing as l", (j) => j.onRef("l.branch_id", "=", "b.id").on("l.product_id", "=", id))
      .select([
        "b.id as branch_id",
        "b.name as branch_name",
        "l.is_published",
        "l.show_price",
        "l.price_paise",
        "l.temporarily_unavailable",
      ])
      .where("b.org_id", "=", org.orgId)
      .orderBy("b.created_at");
    if (org.branchIds.length) bq = bq.where("b.id", "in", org.branchIds);
    const listings: Listing[] = (await bq.execute()).map((r) => ({
      branchId: r.branch_id,
      branchName: r.branch_name,
      isPublished: r.is_published ?? false,
      showPrice: r.show_price ?? false,
      pricePaise: num(r.price_paise),
      temporarilyUnavailable: r.temporarily_unavailable ?? false,
    }));
    const published = (await this.publishedCounts(trx, org, [id])).get(id) ?? 0;
    return { ...this.map(org, row as ProductRow, ids.get(id) ?? [], published), listings };
  }

  private map(org: OrgContext, r: ProductRow, identifiers: Ident[], publishedBranchCount: number): Product {
    const canSeeCost = org.permissions.includes("catalogue.write");
    return {
      id: r.id,
      name: r.name,
      nameHi: r.name_hi,
      brand: r.brand,
      model: r.model,
      description: r.description,
      categoryId: r.category_id,
      unit: r.unit,
      allowFraction: r.allow_fraction,
      packSize: r.pack_size,
      attrs: (r.attrs ?? {}) as Record<string, unknown>,
      trackingMode: r.tracking_mode as Product["trackingMode"],
      lowStockThreshold: Number(r.low_stock_threshold),
      pricePaise: num(r.price_paise),
      costPaise: canSeeCost ? num(r.cost_paise) : null,
      status: r.status as Product["status"],
      canonicalId: r.canonical_id,
      identifiers: identifiers.filter((i) => i.kind !== "short_code") as Product["identifiers"],
      shortCode: identifiers.find((i) => i.kind === "short_code")?.value ?? null,
      publishedBranchCount,
      createdAt: isoReq(r.created_at),
      updatedAt: isoReq(r.updated_at),
    };
  }

  private async publishedCounts(trx: Trx, org: OrgContext, ids: string[]) {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    let q = trx
      .selectFrom("merchant_listing")
      .select(["product_id", sql<string>`count(*)`.as("n")])
      .where("org_id", "=", org.orgId)
      .where("is_published", "=", true)
      .where("product_id", "in", ids)
      .groupBy("product_id");
    if (org.branchIds.length) q = q.where("branch_id", "in", org.branchIds);
    for (const r of await q.execute()) out.set(r.product_id, Number(r.n));
    return out;
  }

  private async identifiersFor(trx: Trx, ids: string[]) {
    const out = new Map<string, Ident[]>();
    if (!ids.length) return out;
    const rows = await trx
      .selectFrom("product_identifier")
      .select(["product_id", "kind", "value"])
      .where("product_id", "in", ids)
      .orderBy("kind")
      .orderBy("value")
      .execute();
    for (const r of rows) out.set(r.product_id, [...(out.get(r.product_id) ?? []), { kind: r.kind, value: r.value }]);
    return out;
  }

  private async assertCategory(trx: Trx, categoryId: string) {
    const c = await trx.selectFrom("category").select("id").where("id", "=", categoryId).executeTakeFirst();
    if (!c) throw Errors.validation([{ path: "categoryId", message: "Choose a category from the list." }]);
  }

  /** Barcode, SKU and short code are unique per shop; the error points at the product that already has it. */
  private async assertFree(trx: Trx, orgId: string, kind: string, value: string | undefined, selfId?: string) {
    if (!value) return;
    const hit = await trx
      .selectFrom("product_identifier")
      .select("product_id")
      .where("org_id", "=", orgId)
      .where("kind", "=", kind)
      .where("value", "=", value)
      .executeTakeFirst();
    if (hit && hit.product_id !== selfId)
      throw Errors.duplicateIdentifier(kind === "sku" ? "product code" : kind, hit.product_id);
  }

  private async newShortCode(trx: Trx, orgId: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      let code = "";
      for (let n = 0; n < 6; n++) code += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
      const hit = await trx
        .selectFrom("product_identifier")
        .select("product_id")
        .where("org_id", "=", orgId)
        .where("kind", "=", "short_code")
        .where("value", "=", code)
        .executeTakeFirst();
      if (!hit) return code;
    }
    throw Errors.unavailable("Could not create a product code. Please try again.");
  }

  private async requireProduct(trx: Trx, orgId: string, id: string) {
    const p = await trx
      .selectFrom("product")
      .select(["id", "status"])
      .where("org_id", "=", orgId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!p || p.status === "merged") throw Errors.notFound("Product");
  }

  /** Re-derives the public rows of this product everywhere it is listed (name, category, status changes). */
  private async refreshPublic(trx: Trx, productId: string) {
    const rows = await trx
      .selectFrom("merchant_listing")
      .select("branch_id")
      .where("product_id", "=", productId)
      .execute();
    for (const r of rows)
      await sql`select refresh_public_listing(${r.branch_id}::uuid, ${productId}::uuid)`.execute(trx);
  }
}
