import "server-only";

import { type ClientSession, type Connection, Types } from "mongoose";

import { asUtcTimestamp } from "../../../../shared/domain.ts";
import { ApplicationError } from "../../../../shared/errors.ts";
import type {
  AdminAuthorizer,
  SecurityCommit,
  TransactionContext,
} from "../../../../shared/security-ports.ts";
import type { CategoryRepository } from "../application/types.ts";
import type { CategoryCreate, CategoryReorder, CategoryUpdate } from "../contracts/category.ts";
import type { Category } from "../domain/model.ts";
import { categorySlugBase } from "../domain/slug.ts";

type Row = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  mediaId: Types.ObjectId | null;
  sortOrder: number;
  status: "draft" | "published";
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
const mongoSession = (tx?: TransactionContext) => tx as ClientSession | undefined;
const dto = (row: Row): Category => ({
  id: row._id.toString(),
  name: row.name,
  slug: row.slug,
  mediaId: row.mediaId?.toString() ?? null,
  sortOrder: row.sortOrder,
  status: row.status,
  revision: row.__v,
  createdAt: asUtcTimestamp(row.createdAt.toISOString()),
  updatedAt: asUtcTimestamp(row.updatedAt.toISOString()),
  deletedAt: row.deletedAt ? asUtcTimestamp(row.deletedAt.toISOString()) : null,
});
export type CategoryMediaSync = (
  tx: TransactionContext,
  categoryId: string,
  oldId: string | null,
  nextId: string | null,
) => Promise<void>;
export type CategoryProductDependencies = (
  tx: TransactionContext,
  categoryId: string,
) => Promise<number>;
export class MongoCategoryRepository implements CategoryRepository {
  private readonly connection: Connection;
  private readonly authorize: AdminAuthorizer;
  private readonly commit: SecurityCommit;
  private readonly mediaSync: CategoryMediaSync;
  private readonly productDependencies: CategoryProductDependencies;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    authorize: AdminAuthorizer,
    commit: SecurityCommit,
    mediaSync: CategoryMediaSync,
    productDependencies: CategoryProductDependencies,
    now: () => Date = () => new Date(),
  ) {
    this.connection = connection;
    this.authorize = authorize;
    this.commit = commit;
    this.mediaSync = mediaSync;
    this.productDependencies = productDependencies;
    this.now = now;
  }
  private rows() {
    return this.connection.db!.collection<Row>("categories");
  }
  private guards() {
    return this.connection.db!.collection<{ _id: string; revision: number }>(
      "category_order_guard",
    );
  }
  private async lockGuard(tx: TransactionContext, expected?: number) {
    const row = await this.guards().findOneAndUpdate(
      { _id: "catalog", ...(expected === undefined ? {} : { revision: expected }) },
      { $inc: { revision: 1 } },
      { session: mongoSession(tx), returnDocument: "after" },
    );
    if (!row)
      throw new ApplicationError("CONFLICT", "Category order changed or migration is missing");
    return row.revision;
  }
  private async mutation<T>(
    token: string | null,
    action: string,
    id: string,
    requestId: string,
    operation: (tx: TransactionContext, orderRevision: number) => Promise<T>,
    expected?: number,
  ): Promise<T> {
    const actor = await this.authorize(token, "catalog.manage");
    return this.commit(
      { actor: { kind: "admin", id: actor.id }, action, subjectId: id, requestId },
      async (tx) => {
        const orderRevision = await this.lockGuard(tx, expected);
        await this.authorize(token, "catalog.manage", tx);
        return operation(tx, orderRevision);
      },
    );
  }
  async publicList() {
    const rows = await this.rows()
      .find(
        { status: "published", deletedAt: null },
        {
          projection: {
            name: 1,
            slug: 1,
            mediaId: 1,
            sortOrder: 1,
            status: 1,
            deletedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            __v: 1,
          },
        },
      )
      .sort({ sortOrder: 1, _id: 1 })
      .limit(500)
      .toArray();
    return rows.map(dto);
  }
  async adminList(token: string | null) {
    await this.authorize(token, "catalog.read");
    return this.connection.transaction(async (tx) => {
      const guard = await this.guards().findOne({ _id: "catalog" }, { session: tx });
      if (!guard) throw new ApplicationError("UNAVAILABLE", "Apply category migration before use");
      const rows = await this.rows()
        .find(
          { deletedAt: null },
          {
            session: tx,
            projection: {
              name: 1,
              slug: 1,
              mediaId: 1,
              sortOrder: 1,
              status: 1,
              deletedAt: 1,
              createdAt: 1,
              updatedAt: 1,
              __v: 1,
            },
          },
        )
        .sort({ sortOrder: 1, _id: 1 })
        .limit(500)
        .toArray();
      return { items: rows.map(dto), orderRevision: guard.revision };
    });
  }
  async detail(token: string | null, id: string) {
    await this.authorize(token, "catalog.read");
    const row = await this.rows().findOne({ _id: new Types.ObjectId(id), deletedAt: null });
    if (!row) throw new ApplicationError("NOT_FOUND", "Category not found");
    return dto(row);
  }
  private async slug(name: string, tx: TransactionContext) {
    const base = categorySlugBase(name);
    if (!base) throw new ApplicationError("VALIDATION", "Category name cannot form a slug");
    for (let suffix = 1; suffix <= 500; suffix++) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      if (
        !(await this.rows().findOne(
          { slug: candidate, deletedAt: null },
          { session: mongoSession(tx), projection: { _id: 1 } },
        ))
      )
        return candidate;
    }
    throw new ApplicationError("CONFLICT", "Category slug space exhausted");
  }
  async create(token: string | null, input: CategoryCreate, requestId: string) {
    const id = new Types.ObjectId();
    return this.mutation(token, "category.created", id.toString(), requestId, async (tx) => {
      const count = await this.rows().countDocuments(
        { deletedAt: null },
        { session: mongoSession(tx) },
      );
      if (count >= 500) throw new ApplicationError("CONFLICT", "Category limit reached");
      const timestamp = this.now();
      const row: Row = {
        _id: id,
        name: input.name,
        slug: await this.slug(input.name, tx),
        mediaId: input.mediaId ? new Types.ObjectId(input.mediaId) : null,
        sortOrder: count,
        status: input.status,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        __v: 0,
      };
      await this.mediaSync(tx, id.toString(), null, input.mediaId);
      await this.rows().insertOne(row, { session: mongoSession(tx) });
      return dto(row);
    });
  }
  async update(token: string | null, id: string, input: CategoryUpdate, requestId: string) {
    return this.mutation(token, "category.updated", id, requestId, async (tx) => {
      const prior = await this.rows().findOne(
        { _id: new Types.ObjectId(id), deletedAt: null },
        { session: mongoSession(tx) },
      );
      if (!prior) throw new ApplicationError("NOT_FOUND", "Category not found");
      if (prior.__v !== input.revision)
        throw new ApplicationError("CONFLICT", "Category revision conflict");
      const oldMedia = prior.mediaId?.toString() ?? null;
      const nextMedia = input.mediaId === undefined ? oldMedia : input.mediaId;
      await this.mediaSync(tx, id, oldMedia, nextMedia);
      const row = await this.rows().findOneAndUpdate(
        { _id: prior._id, __v: input.revision, deletedAt: null },
        {
          $set: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.mediaId === undefined
              ? {}
              : { mediaId: nextMedia ? new Types.ObjectId(nextMedia) : null }),
            updatedAt: this.now(),
          },
          $inc: { __v: 1 },
        },
        { session: mongoSession(tx), returnDocument: "after" },
      );
      if (!row) throw new ApplicationError("CONFLICT", "Category revision conflict");
      return dto(row);
    });
  }
  async delete(token: string | null, id: string, revision: number, requestId: string) {
    return this.mutation(token, "category.deleted", id, requestId, async (tx) => {
      const prior = await this.rows().findOne(
        { _id: new Types.ObjectId(id), deletedAt: null },
        { session: mongoSession(tx) },
      );
      if (!prior) throw new ApplicationError("NOT_FOUND", "Category not found");
      if (prior.__v !== revision)
        throw new ApplicationError("CONFLICT", "Category revision conflict");
      const dependencies = await this.productDependencies(tx, id);
      if (dependencies) throw new ApplicationError("CONFLICT", "Category has dependent products");
      await this.mediaSync(tx, id, prior.mediaId?.toString() ?? null, null);
      await this.rows().updateOne(
        { _id: prior._id, __v: revision, deletedAt: null },
        {
          $set: { deletedAt: this.now(), status: "draft", updatedAt: this.now() },
          $inc: { __v: 1 },
        },
        { session: mongoSession(tx) },
      );
      const remaining = await this.rows()
        .find({ deletedAt: null }, { session: mongoSession(tx) })
        .sort({ sortOrder: 1, _id: 1 })
        .toArray();
      for (const [index, row] of remaining.entries())
        if (row.sortOrder !== index)
          await this.rows().updateOne(
            { _id: row._id },
            { $set: { sortOrder: index, updatedAt: this.now() }, $inc: { __v: 1 } },
            { session: mongoSession(tx) },
          );
    });
  }
  async reorder(token: string | null, input: CategoryReorder, requestId: string) {
    return this.mutation(
      token,
      "category.reordered",
      "catalog",
      requestId,
      async (tx, orderRevision) => {
        const rows = await this.rows()
          .find({ deletedAt: null }, { session: mongoSession(tx) })
          .sort({ sortOrder: 1, _id: 1 })
          .toArray();
        if (
          rows.length !== input.ids.length ||
          new Set(rows.map((row) => row._id.toString())).size !== input.ids.length ||
          rows.some((row) => !input.ids.includes(row._id.toString()))
        )
          throw new ApplicationError("CONFLICT", "Category set changed; reload before reordering");
        const byId = new Map(rows.map((row) => [row._id.toString(), row]));
        const result: Category[] = [];
        for (const [index, id] of input.ids.entries()) {
          const prior = byId.get(id)!;
          if (prior.sortOrder === index) {
            result.push(dto(prior));
            continue;
          }
          const row = await this.rows().findOneAndUpdate(
            { _id: prior._id, __v: prior.__v },
            { $set: { sortOrder: index, updatedAt: this.now() }, $inc: { __v: 1 } },
            { session: mongoSession(tx), returnDocument: "after" },
          );
          if (!row) throw new ApplicationError("CONFLICT", "Concurrent category reorder");
          result.push(dto(row));
        }
        return { items: result, orderRevision };
      },
      input.revision,
    );
  }
}
