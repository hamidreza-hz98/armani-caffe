import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { ApplicationError } from "../../../../shared/errors.ts";
import type { AdminAuthorizer } from "../../../../shared/security-ports.ts";
import { persianSlug } from "../../../../shared/slug.ts";
import type { ProductRepository } from "../application/service.ts";
import type { AdditionInput, ProductFields, RuleInput } from "../contracts/product.ts";
import { assertProductTransition, validatePublished } from "../domain/lifecycle.ts";

type Stamp = { _id: Types.ObjectId; createdAt: Date; updatedAt: Date; __v: number };
type Row = Stamp &
  Omit<ProductFields, "categoryId" | "mediaIds" | "additions" | "consumptionRules"> & {
    categoryId: Types.ObjectId;
    mediaIds: Types.ObjectId[];
    slug: string;
    status: "draft" | "published" | "archived";
    deletedAt: Date | null;
  };
type Addition = Stamp &
  Omit<AdditionInput, "id" | "mediaId"> & {
    productId: Types.ObjectId;
    mediaId: Types.ObjectId | null;
    sortOrder: number;
  };
export type ProductPorts = {
  category: (session: ClientSession, id: string | null, published: boolean) => Promise<void>;
  categories: (
    session: ClientSession,
  ) => Promise<{ id: string; name: string; sortOrder: number }[]>;
  media: (
    session: ClientSession,
    id: string,
    oldImages: string[],
    images: string[],
    oldAdditionImages: string[],
    additionImages: string[],
  ) => Promise<void>;
  rules: (session: ClientSession, id: string, rules: readonly RuleInput[]) => Promise<unknown>;
  stock: (
    session: ClientSession,
    ids: string[],
  ) => Promise<Map<string, { rules: RuleInput[]; orderable: boolean; valid: boolean }>>;
  sold: (session: ClientSession, ids: string[]) => Promise<Map<string, number>>;
  record: (
    session: ClientSession,
    actorId: string,
    action: string,
    id: string,
    requestId: string,
  ) => Promise<void>;
};
const id = (value: string) => new Types.ObjectId(value);
const productDto = (r: Row) => ({
  id: String(r._id),
  name: r.name,
  slug: r.slug,
  categoryId: String(r.categoryId),
  description: r.description,
  excerpt: r.excerpt,
  ingredients: r.ingredients,
  basePriceToman: r.basePriceToman,
  mediaIds: r.mediaIds.map(String),
  available: r.available,
  sortOrder: r.sortOrder,
  status: r.status,
  revision: r.__v,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  deletedAt: r.deletedAt?.toISOString() ?? null,
});
const additionDto = (r: Addition) => ({
  id: String(r._id),
  name: r.name,
  priceToman: r.priceToman,
  available: r.available,
  mediaId: r.mediaId ? String(r.mediaId) : null,
  sortOrder: r.sortOrder,
});
export class MongoProductRepository implements ProductRepository {
  private readonly connection: Connection;
  private readonly authorize: AdminAuthorizer;
  private readonly ports: ProductPorts;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    authorize: AdminAuthorizer,
    ports: ProductPorts,
    now: () => Date = () => new Date(),
  ) {
    this.connection = connection;
    this.authorize = authorize;
    this.ports = ports;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("products");
  }
  private additions() {
    return this.connection.db!.collection<Addition>("product_additions");
  }
  private async transaction<T>(run: (session: ClientSession) => Promise<T>) {
    try {
      return await this.connection.transaction(
        async (session) => {
          if (
            !(await this.connection
              .db!.collection<{ _id: number }>("_schema_migrations")
              .findOne({ _id: 8 }, { session }))
          )
            throw new ApplicationError("UNAVAILABLE", "Apply product migration 8 before use");
          return run(session);
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        throw new ApplicationError("CONFLICT", "Product uniqueness conflict");
      throw new ApplicationError("UNAVAILABLE", "Product transaction failed");
    }
  }
  async list(token: string | null) {
    await this.authorize(token, "catalog.read");
    return (
      await this.rows()
        .find({ deletedAt: null })
        .sort({ updatedAt: -1, _id: -1 })
        .limit(200)
        .toArray()
    ).map(productDto);
  }
  async detail(token: string | null, productId: string) {
    await this.authorize(token, "catalog.read");
    return this.transaction(async (session) => {
      const row = await this.rows().findOne({ _id: id(productId), deletedAt: null }, { session });
      if (!row) throw new ApplicationError("NOT_FOUND", "Product not found");
      return this.details(session, row);
    });
  }
  private async details(session: ClientSession, row: Row) {
    const additions = await this.additions()
      .find({ productId: row._id }, { session })
      .sort({ sortOrder: 1, _id: 1 })
      .limit(41)
      .maxTimeMS(2500)
      .toArray();
    if (additions.length > 40)
      throw new ApplicationError("CONFLICT", "Product has too many additions for a bounded detail");
    const stock = await this.ports.stock(session, [String(row._id)]),
      sold = await this.ports.sold(session, [String(row._id)]);
    return {
      ...productDto(row),
      additions: additions.map(additionDto),
      consumptionRules: stock.get(String(row._id))?.rules ?? [],
      soldCount: sold.get(String(row._id)) ?? 0,
    };
  }
  async menu() {
    return this.transaction(async (session) => {
      const categories = await this.ports.categories(session);
      const rows = await this.rows()
        .find(
          {
            categoryId: { $in: categories.map((c) => id(c.id)) },
            status: "published",
            deletedAt: null,
          },
          {
            session,
            projection: {
              _id: 1,
              categoryId: 1,
              name: 1,
              slug: 1,
              excerpt: 1,
              ingredients: 1,
              basePriceToman: 1,
              mediaIds: 1,
              available: 1,
              sortOrder: 1,
            },
          },
        )
        .sort({ categoryId: 1, sortOrder: 1, _id: 1 })
        .limit(500)
        .maxTimeMS(2500)
        .toArray();
      const ids = rows.map((r) => String(r._id));
      const additions = await this.additions()
        .find(
          { productId: { $in: rows.map((r) => r._id) }, available: true },
          {
            session,
            projection: {
              productId: 1,
              name: 1,
              priceToman: 1,
              mediaId: 1,
              available: 1,
              sortOrder: 1,
            },
          },
        )
        .sort({ productId: 1, sortOrder: 1, _id: 1 })
        .limit(5001)
        .maxTimeMS(2500)
        .toArray();
      if (additions.length > 5000)
        throw new ApplicationError(
          "CONFLICT",
          "Menu has too many additions for a bounded response",
        );
      const stock = await this.ports.stock(session, ids),
        sold = await this.ports.sold(session, ids);
      const byCategory = new Map<string, Row[]>(),
        byProduct = new Map<string, Addition[]>();
      for (const row of rows) {
        const key = String(row.categoryId);
        byCategory.set(key, [...(byCategory.get(key) ?? []), row]);
      }
      for (const addition of additions) {
        const key = String(addition.productId);
        byProduct.set(key, [...(byProduct.get(key) ?? []), addition]);
      }
      return categories.map((category) => ({
        ...category,
        products: (byCategory.get(category.id) ?? []).map((r) => ({
          id: String(r._id),
          name: r.name,
          slug: r.slug,
          excerpt: r.excerpt,
          ingredients: r.ingredients,
          basePriceToman: r.basePriceToman,
          mediaIds: r.mediaIds.map(String),
          orderable: r.available && (stock.get(String(r._id))?.orderable ?? true),
          soldCount: sold.get(String(r._id)) ?? 0,
          additions: (byProduct.get(String(r._id)) ?? []).map(additionDto),
        })),
      }));
    });
  }
  private async slug(session: ClientSession, name: string) {
    const base = persianSlug(name);
    if (!base) throw new ApplicationError("VALIDATION", "Name cannot form product slug");
    for (let n = 1; n <= 1000; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      if (
        !(await this.rows().findOne({ slug, deletedAt: null }, { session, projection: { _id: 1 } }))
      )
        return slug;
    }
    throw new ApplicationError("CONFLICT", "Product slug space exhausted");
  }
  private async replaceAdditions(
    session: ClientSession,
    productId: Types.ObjectId,
    inputs: AdditionInput[],
    old: Addition[],
  ) {
    const rows = inputs.map((a, sortOrder): Addition => {
      const prior = a.id ? old.find((r) => String(r._id) === a.id) : undefined;
      if (a.id && !prior)
        throw new ApplicationError(
          "VALIDATION",
          "Addition belongs to another product or was removed",
        );
      return {
        _id: prior?._id ?? new Types.ObjectId(),
        productId,
        name: a.name,
        priceToman: a.priceToman,
        mediaId: a.mediaId ? id(a.mediaId) : null,
        available: a.available,
        sortOrder,
        createdAt: prior?.createdAt ?? this.now(),
        updatedAt: this.now(),
        __v: (prior?.__v ?? -1) + 1,
      };
    });
    await this.additions().deleteMany({ productId }, { session });
    if (rows.length) await this.additions().insertMany(rows, { session, ordered: true });
    return rows;
  }
  async write(
    token: string | null,
    productId: string | null,
    fields: Partial<ProductFields>,
    revision: number | undefined,
    requestId: string,
  ) {
    return this.transaction(async (session) => {
      const actor = await this.authorize(token, "catalog.manage", session);
      const prior = productId
        ? await this.rows().findOne({ _id: id(productId), deletedAt: null }, { session })
        : null;
      if (productId && !prior) throw new ApplicationError("NOT_FOUND", "Product not found");
      if (prior && (prior.__v !== revision || prior.status === "archived"))
        throw new ApplicationError("CONFLICT", "Product revision or lifecycle conflict");
      const { additions: additionInput, consumptionRules, mediaIds, categoryId, ...plain } = fields;
      const next: Row = {
        ...(prior ?? {}),
        ...plain,
        _id: prior?._id ?? new Types.ObjectId(),
        categoryId: categoryId ? id(categoryId) : prior!.categoryId,
        mediaIds: mediaIds ? mediaIds.map(id) : prior!.mediaIds,
        slug: prior?.slug ?? "",
        status: prior?.status ?? "draft",
        deletedAt: null,
        createdAt: prior?.createdAt ?? this.now(),
        updatedAt: this.now(),
        __v: (prior?.__v ?? -1) + 1,
      } as Row;
      await this.ports.category(session, String(next.categoryId), next.status === "published");
      if (!prior) {
        if ((await this.rows().countDocuments({ deletedAt: null }, { session })) >= 500)
          throw new ApplicationError("CONFLICT", "Catalog product limit reached");
        next.slug = await this.slug(session, next.name);
      }
      if (next.status === "published") validatePublished(next);
      const oldAdditions = prior
        ? await this.additions().find({ productId: prior._id }, { session }).toArray()
        : [];
      const nextAdditions =
        additionInput === undefined
          ? oldAdditions
          : await this.replaceAdditions(session, next._id, additionInput, oldAdditions);
      await this.ports.media(
        session,
        String(next._id),
        prior?.mediaIds.map(String) ?? [],
        next.mediaIds.map(String),
        oldAdditions.flatMap((a) => (a.mediaId ? [String(a.mediaId)] : [])),
        nextAdditions.flatMap((a) => (a.mediaId ? [String(a.mediaId)] : [])),
      );
      if (consumptionRules !== undefined)
        await this.ports.rules(session, String(next._id), consumptionRules);
      // Revalidate existing rules too; catalog edits cannot preserve an invalid published mapping.
      const stock = await this.ports.stock(session, [String(next._id)]);
      if (next.status === "published" && stock.get(String(next._id))?.valid === false)
        throw new ApplicationError("CONFLICT", "Invalid published stock mapping");
      if (prior) {
        const result = await this.rows().replaceOne({ _id: prior._id, __v: revision }, next, {
          session,
        });
        if (result.matchedCount !== 1)
          throw new ApplicationError("CONFLICT", "Concurrent product edit");
      } else await this.rows().insertOne(next, { session });
      await this.ports.record(
        session,
        actor.id,
        prior ? "product.updated" : "product.created",
        String(next._id),
        requestId,
      );
      return this.details(session, next);
    });
  }
  async transition(
    token: string | null,
    productId: string,
    revision: number,
    status: "draft" | "published" | "archived",
    requestId: string,
  ) {
    return this.transaction(async (session) => {
      const actor = await this.authorize(token, "catalog.manage", session);
      const prior = await this.rows().findOne({ _id: id(productId), deletedAt: null }, { session });
      if (!prior) throw new ApplicationError("NOT_FOUND", "Product not found");
      if (prior.__v !== revision)
        throw new ApplicationError("CONFLICT", "Product revision conflict");
      assertProductTransition(prior.status, status);
      await this.ports.category(
        session,
        status === "archived" ? null : String(prior.categoryId),
        status === "published",
      );
      const additions = await this.additions()
        .find({ productId: prior._id }, { session })
        .toArray();
      if (status === "published") {
        validatePublished(prior);
        await this.ports.media(
          session,
          productId,
          prior.mediaIds.map(String),
          prior.mediaIds.map(String),
          additions.flatMap((a) => (a.mediaId ? [String(a.mediaId)] : [])),
          additions.flatMap((a) => (a.mediaId ? [String(a.mediaId)] : [])),
        );
        const stock = await this.ports.stock(session, [productId]);
        if (stock.get(productId)?.valid === false)
          throw new ApplicationError("CONFLICT", "Invalid published stock mapping");
      }
      if (status === "archived") await this.ports.rules(session, productId, []);
      const row = await this.rows().findOneAndUpdate(
        { _id: prior._id, __v: revision },
        {
          $set: {
            status,
            ...(status === "archived" ? { available: false } : {}),
            updatedAt: this.now(),
          },
          $inc: { __v: 1 },
        },
        { session, returnDocument: "after" },
      );
      if (!row) throw new ApplicationError("CONFLICT", "Concurrent product transition");
      await this.ports.record(
        session,
        actor.id,
        `product.${status === "draft" ? "unpublished" : status}`,
        productId,
        requestId,
      );
      return this.details(session, row);
    });
  }
}
