import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import type { ClientSession, Connection, Model } from "mongoose";
import { Types } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type {
  CleanupClaim,
  CompletionClaim,
  MediaRepository,
  UploadRecord,
} from "../application/repository.ts";
import type { StoredImage, UploadTicket } from "../application/storage.ts";
import type {
  InitiateMedia,
  MediaActor,
  MediaDetail,
  MediaListQuery,
  MediaMetadata,
  MediaSummary,
  MediaUsage,
} from "../contracts/media.ts";
import {
  mediaAssetSchema,
  mediaCleanupSchema,
  mediaReceiptSchema,
  mediaReferenceSchema,
} from "./schema.ts";

type Asset = {
  _id: Types.ObjectId;
  __v: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  ownerId: Types.ObjectId;
  uploaderId: Types.ObjectId;
  objectVersion: string;
  objectKey: string | null;
  filename: string;
  bucket: string;
  mimeType: string;
  byteSize: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  variants: StoredImage["objects"];
  status: string;
  title: string;
  altText: string;
  caption: string;
  seo: MediaMetadata["seo"];
  visibility: "public" | "private";
  initiationKey: string;
  fingerprint: string;
  ticketCiphertext: string;
  stagingKey: string;
  expiresAt: Date;
  leaseToken: string | null;
  lockedUntil: Date | null;
  referenceGuard: number;
  legacyReviewRequired: boolean;
};
type Cleanup = {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  assetId: Types.ObjectId;
  outputId: string;
  stagingKey: string | null;
  removeOutputs: boolean;
  status: string;
  availableAt: Date;
  lockedUntil: Date | null;
  leaseToken: string | null;
  attempts: number;
  completedAt: Date | null;
};
type Receipt = { scope: string; key: string; fingerprint: string; result: MediaDetail };
type Reference = {
  mediaId: Types.ObjectId;
  entityKind: "product" | "category";
  entityId: Types.ObjectId;
  field: "mediaIds" | "mediaId" | "additionMediaIds";
};
export type MediaReferenceBridge = Readonly<{
  usages: (session: ClientSession | null, id: string) => Promise<MediaUsage[]>;
  replace: (session: ClientSession, from: string, to: string) => Promise<void>;
  productMediaIds: (session: ClientSession, productId: string) => Promise<string[]>;
}>;

function summary(row: Asset): MediaSummary {
  return {
    id: String(row._id),
    title: row.title,
    altText: row.altText,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: row.status,
    visibility: row.visibility,
  };
}
function detail(row: Asset, ownerView: boolean): MediaDetail {
  return {
    ...summary(row),
    caption: row.caption,
    seo: row.seo,
    revision: row.__v,
    variants: row.variants.map(({ variant, width, height, byteSize }) => ({
      variant,
      width,
      height,
      byteSize,
    })),
    ...(ownerView
      ? {
          filename: row.filename,
          uploaderId: String(row.uploaderId),
          objectVersion: row.objectVersion,
          sha256: row.sha256,
        }
      : {}),
  };
}
const summaryFields =
  "title altText mimeType byteSize width height createdAt updatedAt status visibility";
const detailFields = `${summaryFields} caption seo __v variants filename uploaderId objectVersion sha256`;

export class MongoMediaRepository implements MediaRepository {
  private readonly assets: Model<Asset>;
  private readonly cleanupJobs: Model<Cleanup>;
  private readonly receipts: Model<Receipt>;
  private readonly references: Model<Reference>;
  private readonly connection: Connection;
  private readonly bucket: string;
  private readonly encryptionKeys: readonly string[];
  private readonly bridge: MediaReferenceBridge;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    bucket: string,
    encryptionKey: string,
    bridge: MediaReferenceBridge,
    now = () => new Date(),
    previousKey?: string,
  ) {
    this.connection = connection;
    this.bucket = bucket;
    this.encryptionKeys = previousKey ? [encryptionKey, previousKey] : [encryptionKey];
    this.bridge = bridge;
    this.now = now;
    if (this.encryptionKeys.some((key) => !/^[a-f0-9]{64}$/i.test(key)))
      throw new RangeError("Invalid media encryption key");
    this.assets =
      (connection.models.MediaAsset as Model<Asset>) ??
      connection.model<Asset>("MediaAsset", mediaAssetSchema);
    this.cleanupJobs =
      (connection.models.MediaCleanup as Model<Cleanup>) ??
      connection.model<Cleanup>("MediaCleanup", mediaCleanupSchema);
    this.receipts =
      (connection.models.MediaReceipt as Model<Receipt>) ??
      connection.model<Receipt>("MediaReceipt", mediaReceiptSchema);
    this.references =
      (connection.models.MediaReference as Model<Reference>) ??
      connection.model<Reference>("MediaReference", mediaReferenceSchema);
  }
  private encrypt(ticket: UploadTicket) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(this.encryptionKeys[0], "hex"), iv);
    cipher.setAAD(Buffer.from("armani-media-ticket-v1"));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(ticket), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
  }
  private decrypt(value: string): UploadTicket {
    const bytes = Buffer.from(value, "base64");
    for (const key of this.encryptionKeys) {
      try {
        const cipher = createDecipheriv(
          "aes-256-gcm",
          Buffer.from(key, "hex"),
          bytes.subarray(0, 12),
        );
        cipher.setAAD(Buffer.from("armani-media-ticket-v1"));
        cipher.setAuthTag(bytes.subarray(12, 28));
        return JSON.parse(
          Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(),
        ) as UploadTicket;
      } catch {
        /* Try the explicitly configured previous rotation key. */
      }
    }
    throw new ApplicationError("UNAVAILABLE", "Upload ticket cannot be decrypted");
  }
  private record(row: Asset): UploadRecord {
    return {
      id: String(row._id),
      ownerId: String(row.ownerId),
      objectVersion: row.objectVersion,
      status: row.status,
      fingerprint: row.fingerprint,
      ticket:
        row.status === "pending"
          ? this.decrypt(row.ticketCiphertext)
          : { token: "", url: "", fields: {}, expiresIn: 0 },
      expiresAt: row.expiresAt,
      stagingKey: row.stagingKey,
    };
  }
  async findInitiation(uploaderId: string, key: string) {
    const row = await this.assets
      .findOne({ uploaderId, initiationKey: key })
      .select("+ticketCiphertext +stagingKey")
      .lean();
    return row ? this.record(row) : null;
  }
  async initiate(
    actor: MediaActor,
    key: string,
    fingerprint: string,
    input: InitiateMedia,
    ticket: UploadTicket,
  ) {
    try {
      const row = await this.assets.create({
        ownerId: actor.id,
        uploaderId: actor.id,
        bucket: this.bucket,
        objectVersion: randomUUID(),
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        ...input.metadata,
        initiationKey: key,
        fingerprint,
        ticketCiphertext: this.encrypt(ticket),
        objectKey: ticket.fields.key,
        stagingKey: ticket.fields.key,
        expiresAt: new Date(this.now().getTime() + 15 * 60_000),
        status: "pending",
      });
      return this.record(row.toObject());
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.findInitiation(actor.id, key);
      if (!existing) throw error;
      return existing;
    }
  }
  async refreshTicket(id: string, ticket: UploadTicket) {
    await this.assets.updateOne(
      { _id: id, status: "pending", stagingKey: ticket.fields.key, expiresAt: { $gt: this.now() } },
      { $set: { ticketCiphertext: this.encrypt(ticket) } },
    );
  }
  async uploadRecord(id: string) {
    const row = await this.assets.findById(id).select("+ticketCiphertext +stagingKey").lean();
    return row ? this.record(row) : null;
  }
  async claimCompletion(id: string): Promise<CompletionClaim | null> {
    const leaseToken = randomUUID();
    const now = this.now();
    const row = await this.assets
      .findOneAndUpdate(
        {
          _id: id,
          status: "pending",
          expiresAt: { $gt: now },
          $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
        },
        { $set: { leaseToken, lockedUntil: new Date(now.getTime() + 5 * 60_000) } },
        { returnDocument: "after" },
      )
      .select("+ticketCiphertext +stagingKey +leaseToken")
      .lean();
    return row ? { ...this.record(row), leaseToken } : null;
  }
  private async cleanup(row: Asset, session: ClientSession, removeOutputs: boolean) {
    await this.cleanupJobs.create(
      [
        {
          assetId: row._id,
          ownerId: row.ownerId,
          outputId: row.objectVersion,
          stagingKey: row.stagingKey,
          removeOutputs,
          availableAt: this.now(),
        },
      ],
      { session },
    );
  }
  async finishCompletion(claim: CompletionClaim, image: StoredImage) {
    const original = image.objects.find((object) => object.variant === "original");
    if (!original || image.id !== claim.objectVersion || image.objects.length !== 3)
      throw new ApplicationError("CONFLICT", "Invalid finalized image");
    await this.connection.transaction(async (session) => {
      const row = await this.assets
        .findOneAndUpdate(
          { _id: claim.id, status: "pending", leaseToken: claim.leaseToken },
          {
            $set: {
              objectKey: original.key,
              mimeType: original.mimeType,
              byteSize: original.byteSize,
              sha256: original.sha256,
              width: original.width,
              height: original.height,
              variants: image.objects,
              status: "ready",
              lockedUntil: null,
              leaseToken: null,
            },
            $inc: { __v: 1 },
          },
          { session, returnDocument: "after", runValidators: true },
        )
        .select("+stagingKey")
        .lean();
      if (!row) throw new ApplicationError("CONFLICT", "Completion lease was lost");
      await this.cleanup(row, session, false);
    });
  }
  async failCompletion(claim: CompletionClaim, terminal: boolean) {
    await this.connection.transaction(async (session) => {
      const row = await this.assets
        .findOneAndUpdate(
          { _id: claim.id, status: "pending", leaseToken: claim.leaseToken },
          {
            $set: {
              status: terminal ? "rejected" : "pending",
              leaseToken: null,
              lockedUntil: null,
            },
          },
          { session, returnDocument: "after" },
        )
        .select("+stagingKey")
        .lean();
      if (row && terminal) await this.cleanup(row, session, true);
    });
  }
  async detail(id: string, ownerView: boolean) {
    const row = await this.assets.findById(id).select(detailFields).lean();
    return row ? detail(row, ownerView) : null;
  }
  async file(id: string) {
    const row = await this.assets.findById(id).select("ownerId status visibility variants").lean();
    return row
      ? {
          ownerId: String(row.ownerId),
          status: row.status,
          visibility: row.visibility,
          objects: row.variants,
        }
      : null;
  }
  async list(query: MediaListQuery, ownerView: boolean) {
    const f = query.filters;
    const filter: Record<string, unknown> = {};
    if (ownerView) {
      filter.status = f.status ?? "ready";
      if (f.visibility) filter.visibility = f.visibility;
    } else {
      filter.status = "ready";
      filter.visibility = "public";
    }
    if (f.mimeType) filter.mimeType = f.mimeType;
    if (f.uploaderId && ownerView) filter.uploaderId = new Types.ObjectId(f.uploaderId);
    if (f.q) filter.$text = { $search: f.q, $language: "none" };
    const direction = query.direction === "asc" ? 1 : -1;
    const rows = await this.assets
      .find(filter)
      .select(summaryFields)
      .sort({ [query.sort]: direction, _id: direction })
      .skip(query.pagination.skip)
      .limit(query.pagination.pageSize)
      .maxTimeMS(2500)
      .lean();
    const total = await this.assets.countDocuments(filter).maxTimeMS(2500);
    return {
      items: rows.map(summary),
      total,
      page: query.pagination.page,
      pageSize: query.pagination.pageSize,
    };
  }
  private async mutate(
    actor: MediaActor,
    key: string,
    fingerprint: string,
    run: (session: ClientSession) => Promise<MediaDetail>,
  ): Promise<MediaDetail> {
    const operation = () =>
      this.connection.transaction(async (session) => {
        const prior = await this.receipts.findOne({ scope: actor.id, key }).session(session).lean();
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new ApplicationError("CONFLICT", "Idempotency key mismatch");
          return prior.result;
        }
        const result = await run(session);
        await this.receipts.create([{ scope: actor.id, key, fingerprint, result }], { session });
        return result;
      });
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return operation();
      throw error;
    }
  }
  update(
    actor: MediaActor,
    id: string,
    key: string,
    fingerprint: string,
    revision: number,
    metadata: MediaMetadata,
  ) {
    return this.mutate(actor, key, fingerprint, async (session) => {
      const previous = await this.assets.findById(id).session(session).lean();
      if (
        metadata.visibility === "private" &&
        previous?.visibility === "public" &&
        (await this.allUsages(id, session)).length
      )
        throw new ApplicationError("CONFLICT", "Referenced public media must remain public");
      const row = await this.assets
        .findOneAndUpdate(
          { _id: id, __v: revision, status: "ready" },
          { $set: metadata, $inc: { __v: 1 } },
          { session, runValidators: true, returnDocument: "after" },
        )
        .lean();
      if (!row) throw new ApplicationError("CONFLICT", "Media version is stale or not ready");
      return detail(row, true);
    });
  }
  private async touch(id: string, session: ClientSession) {
    const row = await this.assets
      .findOneAndUpdate(
        { _id: id },
        { $inc: { referenceGuard: 1 } },
        { session, returnDocument: "after" },
      )
      .select("+stagingKey")
      .lean();
    if (!row) throw new ApplicationError("NOT_FOUND", "Media does not exist");
    return row;
  }
  private async allUsages(id: string, session: ClientSession | null): Promise<MediaUsage[]> {
    const references = await this.references
      .find({ mediaId: id })
      .session(session)
      .select("entityKind entityId field")
      .limit(101)
      .lean();
    if (references.length > 100)
      throw new ApplicationError(
        "CONFLICT",
        "Media has too many references for a bounded usage view",
      );
    const external = await this.bridge.usages(session, id);
    if (external.length > 100)
      throw new ApplicationError(
        "CONFLICT",
        "Media has too many references for a bounded usage view",
      );
    const unique = new Map<string, MediaUsage>();
    for (const usage of [
      ...external,
      ...references.map((ref) => ({
        entityKind: ref.entityKind,
        entityId: String(ref.entityId),
        field: ref.field,
      })),
    ])
      unique.set(`${usage.entityKind}:${usage.entityId}:${usage.field}`, usage);
    if (unique.size > 100)
      throw new ApplicationError(
        "CONFLICT",
        "Media has too many references for a bounded usage view",
      );
    return [...unique.values()];
  }
  usages(id: string) {
    return this.allUsages(id, null);
  }
  delete(actor: MediaActor, id: string, key: string, fingerprint: string) {
    return this.mutate(actor, key, fingerprint, async (session) => {
      const row = await this.touch(id, session);
      if (row.legacyReviewRequired)
        throw new ApplicationError("CONFLICT", "Legacy media needs operator review");
      if (row.status === "deleted") return detail(row, true);
      if (row.lockedUntil && row.lockedUntil > this.now())
        throw new ApplicationError("CONFLICT", "Upload is processing");
      if ((await this.allUsages(id, session)).length)
        throw new ApplicationError("CONFLICT", "Media is in use");
      await this.assets.updateOne(
        { _id: id },
        {
          $set: { status: "deleted", visibility: "private", deletedAt: this.now() },
          $inc: { __v: 1 },
        },
        { session },
      );
      await this.cleanup(row, session, true);
      return detail((await this.assets.findById(id).session(session).lean())!, true);
    });
  }
  replace(actor: MediaActor, id: string, targetId: string, key: string, fingerprint: string) {
    return this.mutate(actor, key, fingerprint, async (session) => {
      // Deterministic lock ordering avoids reciprocal replacement races.
      const rows = new Map<string, Asset>();
      for (const mediaId of [id, targetId].sort())
        rows.set(mediaId, await this.touch(mediaId, session));
      const from = rows.get(id)!;
      const to = rows.get(targetId)!;
      if (from.legacyReviewRequired || to.legacyReviewRequired)
        throw new ApplicationError("CONFLICT", "Legacy media needs operator review");
      if (
        from.status !== "ready" ||
        to.status !== "ready" ||
        (from.visibility === "public" && to.visibility !== "public")
      )
        throw new ApplicationError("CONFLICT", "Replacement must preserve ready/public access");
      if (
        await this.references
          .countDocuments({ mediaId: id, entityKind: "category" })
          .session(session)
      )
        throw new ApplicationError(
          "CONFLICT",
          "Category media must be changed through category update",
        );
      await this.bridge.replace(session, id, targetId);
      const refs = await this.references.find({ mediaId: id }).session(session).lean();
      for (const ref of refs)
        await this.references.updateOne(
          {
            mediaId: targetId,
            entityKind: ref.entityKind,
            entityId: ref.entityId,
            field: ref.field,
          },
          {
            $setOnInsert: {
              mediaId: targetId,
              entityKind: ref.entityKind,
              entityId: ref.entityId,
              field: ref.field,
            },
          },
          { upsert: true, session },
        );
      await this.references.deleteMany({ mediaId: id }, { session });
      if ((await this.allUsages(id, session)).length)
        throw new ApplicationError("CONFLICT", "Unresolved media references");
      await this.assets.updateOne(
        { _id: id },
        {
          $set: { status: "deleted", visibility: "private", deletedAt: this.now() },
          $inc: { __v: 1 },
        },
        { session },
      );
      await this.cleanup(from, session, true);
      return detail((await this.assets.findById(id).session(session).lean())!, true);
    });
  }
  async syncProductReferences(
    productId: string,
    mediaIds: readonly string[],
    change: (session: ClientSession) => Promise<void>,
  ) {
    await this.connection.transaction(async (session) => {
      const old = await this.bridge.productMediaIds(session, productId);
      for (const id of [...new Set([...old, ...mediaIds])].sort()) {
        const row = await this.touch(id, session);
        if (mediaIds.includes(id) && row.status !== "ready")
          throw new ApplicationError("CONFLICT", "Referenced media must be ready");
      }
      await change(session);
      const actual = await this.bridge.productMediaIds(session, productId);
      if (
        JSON.stringify([...new Set(actual)].sort()) !==
        JSON.stringify([...new Set(mediaIds)].sort())
      )
        throw new ApplicationError("CONFLICT", "Product write did not match declared references");
      await this.references.deleteMany(
        { entityKind: "product", entityId: productId, field: "mediaIds" },
        { session },
      );
      for (const mediaId of new Set(mediaIds))
        await this.references.create(
          [{ mediaId, entityKind: "product", entityId: productId, field: "mediaIds" }],
          { session },
        );
    });
  }
  async expireUploads() {
    const rows = await this.assets
      .find({
        status: "pending",
        expiresAt: { $lte: this.now() },
        $or: [{ lockedUntil: null }, { lockedUntil: { $lte: this.now() } }],
      })
      .select("_id")
      .limit(100)
      .lean();
    let expired = 0;
    for (const row of rows)
      await this.connection.transaction(async (session) => {
        const asset = await this.assets
          .findOneAndUpdate(
            {
              _id: row._id,
              status: "pending",
              $or: [{ lockedUntil: null }, { lockedUntil: { $lte: this.now() } }],
            },
            { $set: { status: "rejected", leaseToken: null, lockedUntil: null } },
            { session, returnDocument: "after" },
          )
          .select("+stagingKey")
          .lean();
        if (asset) {
          await this.cleanup(asset, session, true);
          expired += 1;
        }
      });
    return expired;
  }
  async claimCleanup(): Promise<CleanupClaim | null> {
    const leaseToken = randomUUID();
    const now = this.now();
    const row = await this.cleanupJobs
      .findOneAndUpdate(
        {
          $or: [
            { status: "pending", availableAt: { $lte: now } },
            { status: "processing", lockedUntil: { $lte: now } },
          ],
        },
        {
          $set: {
            status: "processing",
            leaseToken,
            lockedUntil: new Date(now.getTime() + 120_000),
          },
          $inc: { attempts: 1 },
        },
        { sort: { availableAt: 1, _id: 1 }, returnDocument: "after" },
      )
      .lean();
    return row
      ? {
          id: String(row._id),
          ownerId: String(row.ownerId),
          outputId: row.outputId,
          stagingKey: row.stagingKey,
          removeOutputs: row.removeOutputs,
          leaseToken,
          attempts: row.attempts,
        }
      : null;
  }
  async finishCleanup(claim: CleanupClaim, success: boolean) {
    await this.cleanupJobs.updateOne(
      { _id: claim.id, status: "processing", leaseToken: claim.leaseToken },
      {
        $set: {
          status: success ? "done" : "pending",
          completedAt: success ? this.now() : null,
          leaseToken: null,
          lockedUntil: null,
          availableAt: new Date(
            this.now().getTime() + Math.min(3600_000, 1000 * 2 ** Math.min(claim.attempts, 12)),
          ),
        },
      },
    );
  }
}
