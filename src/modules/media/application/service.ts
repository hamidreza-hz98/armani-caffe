import { createHash } from "node:crypto";

import { ApplicationError } from "../../../shared/errors.ts";
import {
  idempotencyKey,
  type MediaActor,
  mediaId,
  parseInitiation,
  parseMediaList,
  parseMetadata,
} from "../contracts/media.ts";
import { assertImageVersion } from "../domain/storage-policy.ts";
import type { MediaRepository } from "./repository.ts";
import type { MediaStorage } from "./storage.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function requireMediaOwner(actor: MediaActor | null): MediaActor {
  if (!actor) throw new ApplicationError("UNAUTHORIZED", "Authentication is required");
  mediaId(actor.id);
  if (actor.role !== "OWNER") throw new ApplicationError("FORBIDDEN", "OWNER role is required");
  return actor;
}
export class MediaService {
  private readonly repository: MediaRepository;
  private readonly storage: MediaStorage;
  private readonly now: () => Date;
  constructor(repository: MediaRepository, storage: MediaStorage, now = () => new Date()) {
    this.repository = repository;
    this.storage = storage;
    this.now = now;
  }
  async initiate(actor: MediaActor | null, key: unknown, input: unknown) {
    const owner = requireMediaOwner(actor);
    const requestKey = idempotencyKey(key);
    const value = parseInitiation(input);
    const fingerprint = hash(value);
    let record = await this.repository.findInitiation(owner.id, requestKey);
    if (!record) {
      const ticket = await this.storage.prepareUpload(owner.id, value.byteSize, value.mimeType);
      record = await this.repository.initiate(owner, requestKey, fingerprint, value, ticket);
    }
    if (record.fingerprint !== fingerprint)
      throw new ApplicationError("CONFLICT", "Idempotency key was reused with different input");
    if (record.status !== "pending" && record.status !== "ready")
      throw new ApplicationError("CONFLICT", "Upload is terminal");
    if (record.status === "pending" && record.expiresAt.getTime() <= this.now().getTime())
      throw new ApplicationError("CONFLICT", "Upload expired");
    const ticket =
      record.status === "pending"
        ? await this.storage.prepareUpload(
            record.ownerId,
            value.byteSize,
            value.mimeType,
            record.stagingKey,
          )
        : null;
    if (ticket) await this.repository.refreshTicket(record.id, ticket);
    return {
      id: record.id,
      status: record.status,
      upload: ticket
        ? { url: ticket.url, fields: ticket.fields, expiresIn: ticket.expiresIn }
        : null,
    };
  }
  async initiateBulk(actor: MediaActor | null, key: unknown, inputs: unknown) {
    requireMediaOwner(actor);
    const requestKey = idempotencyKey(key);
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 5)
      throw new ApplicationError("VALIDATION", "Bulk accepts 1–5 entries");
    const results = [];
    for (const [index, input] of inputs.entries()) {
      try {
        results.push({
          ok: true as const,
          index,
          value: await this.initiate(actor, `${hash(requestKey)}_${index}`, input),
        });
      } catch (error) {
        results.push({
          ok: false as const,
          index,
          code: error instanceof ApplicationError ? error.code : "UNAVAILABLE",
        });
      }
    }
    return results;
  }
  async complete(actor: MediaActor | null, id: unknown) {
    requireMediaOwner(actor);
    const assetId = mediaId(id);
    const existing = await this.repository.uploadRecord(assetId);
    if (!existing) throw new ApplicationError("NOT_FOUND", "Media does not exist");
    if (existing.status === "ready") return this.detail(actor, assetId);
    if (existing.status !== "pending") throw new ApplicationError("CONFLICT", "Upload is terminal");
    const claim = await this.repository.claimCompletion(assetId);
    if (!claim) {
      if ((await this.repository.uploadRecord(assetId))?.status === "ready")
        return this.detail(actor, assetId);
      throw new ApplicationError("CONFLICT", "Upload is expired or already processing");
    }
    try {
      let image = await this.storage.findUpload(claim.ownerId, claim.objectVersion);
      if (!image) {
        await this.storage.deleteUpload(claim.ownerId, claim.objectVersion);
        image = await this.storage.finalizeUpload(
          claim.ownerId,
          claim.ticket.token,
          claim.objectVersion,
        );
      }
      assertImageVersion(claim.ownerId, image);
      await this.repository.finishCompletion(claim, image);
    } catch (error) {
      await this.repository.failCompletion(claim, error instanceof RangeError);
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        error instanceof RangeError ? "VALIDATION" : "UNAVAILABLE",
        "Media completion failed",
        { cause: error },
      );
    }
    return this.detail(actor, assetId);
  }
  async completeBulk(actor: MediaActor | null, ids: unknown) {
    requireMediaOwner(actor);
    if (!Array.isArray(ids) || !ids.length || ids.length > 5)
      throw new ApplicationError("VALIDATION", "Bulk accepts 1–5 IDs");
    const results = [];
    for (const [index, id] of ids.entries()) {
      try {
        results.push({ ok: true as const, index, value: await this.complete(actor, id) });
      } catch (error) {
        results.push({
          ok: false as const,
          index,
          code: error instanceof ApplicationError ? error.code : "UNAVAILABLE",
        });
      }
    }
    return results;
  }
  async detail(actor: MediaActor | null, id: unknown) {
    const ownerView = actor?.role === "OWNER";
    const value = await this.repository.detail(mediaId(id), ownerView);
    if (
      !value ||
      (!ownerView &&
        (value.status !== "ready" || value.visibility !== "public" || value.variants.length !== 3))
    )
      throw new ApplicationError("NOT_FOUND", "Media does not exist");
    return value;
  }
  list(actor: MediaActor | null, params: URLSearchParams) {
    return this.repository.list(parseMediaList(params), actor?.role === "OWNER");
  }
  update(actor: MediaActor | null, id: unknown, key: unknown, revision: unknown, input: unknown) {
    const owner = requireMediaOwner(actor);
    const assetId = mediaId(id);
    const requestKey = idempotencyKey(key);
    const metadata = parseMetadata(input);
    if (!Number.isSafeInteger(revision) || (revision as number) < 0)
      throw new ApplicationError("VALIDATION", "Revision is required");
    return this.repository.update(
      owner,
      assetId,
      requestKey,
      hash(["update", assetId, revision, metadata]),
      revision as number,
      metadata,
    );
  }
  delete(actor: MediaActor | null, id: unknown, key: unknown) {
    const owner = requireMediaOwner(actor);
    const assetId = mediaId(id);
    const requestKey = idempotencyKey(key);
    return this.repository.delete(owner, assetId, requestKey, hash(["delete", assetId]));
  }
  replace(actor: MediaActor | null, id: unknown, targetId: unknown, key: unknown) {
    const owner = requireMediaOwner(actor);
    const assetId = mediaId(id);
    const target = mediaId(targetId);
    const requestKey = idempotencyKey(key);
    if (assetId === target)
      throw new ApplicationError("VALIDATION", "Replacement must be different");
    return this.repository.replace(
      owner,
      assetId,
      target,
      requestKey,
      hash(["replace", assetId, target]),
    );
  }
  usages(actor: MediaActor | null, id: unknown) {
    requireMediaOwner(actor);
    return this.repository.usages(mediaId(id));
  }
  async readFile(actor: MediaActor | null, id: unknown, variant: string) {
    if (!["original", "small", "large"].includes(variant))
      throw new ApplicationError("VALIDATION", "Invalid variant");
    const file = await this.repository.file(mediaId(id));
    if (
      !file ||
      file.status !== "ready" ||
      (actor?.role !== "OWNER" && file.visibility !== "public")
    )
      throw new ApplicationError("NOT_FOUND", "Media does not exist");
    const object = file.objects.find((object) => object.variant === variant);
    if (!object) throw new ApplicationError("NOT_FOUND", "Variant does not exist");
    return { bytes: await this.storage.read(file.ownerId, object.key), etag: object.sha256 };
  }
  async cleanup(limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("Invalid cleanup limit");
    const expired = await this.repository.expireUploads();
    let processed = 0;
    let failed = 0;
    while (processed < limit) {
      const claim = await this.repository.claimCleanup();
      if (!claim) break;
      let success = true;
      try {
        if (claim.removeOutputs) await this.storage.deleteUpload(claim.ownerId, claim.outputId);
        if (claim.stagingKey) await this.storage.removeStaging(claim.ownerId, claim.stagingKey);
      } catch {
        success = false;
        failed += 1;
      }
      await this.repository.finishCleanup(claim, success);
      processed += 1;
    }
    return { expired, processed, failed };
  }
}
