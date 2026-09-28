import { randomUUID } from "node:crypto";

import type {
  MediaStorage,
  StoredImage,
  UploadInput,
} from "../../src/modules/media/application/storage.ts";
import { mediaKey, stagingKey } from "../../src/modules/media/domain/storage-policy.ts";

/** Application tests only; this is not evidence of S3/MinIO compatibility. */
export class FakeMediaStorage implements MediaStorage {
  readonly outputs = new Map<string, StoredImage>();
  readonly stages = new Set<string>();
  readonly invalidStages = new Set<string>();
  finalizations = 0;
  failDeletion = false;
  failStagingDeletion = false;
  async prepareUpload(ownerId: string, byteSize: number, mimeType: string, existingKey?: string) {
    const key = existingKey ?? stagingKey(ownerId, randomUUID());
    return {
      token: JSON.stringify({ key, mimeType, byteSize }),
      url: "http://storage.test.invalid",
      fields: { key, "Content-Type": mimeType },
      expiresIn: 120,
    };
  }
  async upload(ownerId: string, _input: UploadInput): Promise<StoredImage> {
    void _input;
    return this.finalizeUpload(ownerId, JSON.stringify({ key: "test" }), randomUUID());
  }
  async uploadBulk(ownerId: string, inputs: readonly UploadInput[]) {
    const values = [];
    for (const input of inputs)
      values.push({ ok: true as const, image: await this.upload(ownerId, input) });
    return values;
  }
  async finalizeUpload(
    ownerId: string,
    token: string,
    outputId: string = randomUUID(),
  ): Promise<StoredImage> {
    this.finalizations += 1;
    const { key } = JSON.parse(token);
    if (this.invalidStages.has(key)) throw new RangeError("Detected type is not allowed");
    const image: StoredImage = {
      id: outputId,
      objects: (["original", "small", "large"] as const).map((variant) => ({
        key: mediaKey(ownerId, outputId, "a".repeat(64), variant),
        variant,
        mimeType: "image/webp",
        byteSize: 100,
        sha256: "a".repeat(64),
        width: variant === "small" ? 320 : 640,
        height: variant === "small" ? 240 : 480,
      })),
    };
    this.outputs.set(outputId, image);
    this.stages.add(key);
    return image;
  }
  async findUpload(_ownerId: string, outputId: string) {
    return this.outputs.get(outputId) ?? null;
  }
  async deleteUpload(_ownerId: string, outputId: string) {
    if (this.failDeletion) throw new Error("Storage unavailable");
    this.outputs.delete(outputId);
  }
  async removeStaging(_ownerId: string, key: string) {
    if (this.failStagingDeletion) throw new Error("Storage unavailable");
    this.stages.delete(key);
  }
  async cancelUpload(_ownerId: string, token: string) {
    this.stages.delete(JSON.parse(token).key);
  }
  async read() {
    return new Uint8Array([1, 2, 3]);
  }
  async metadata() {
    return {
      byteSize: 100,
      mimeType: "image/webp",
      etag: "test",
      lastModified: new Date("2025-01-01"),
    };
  }
  async downloadUrl() {
    return "http://storage.test.invalid/signed";
  }
  async health() {}
  async delete(_ownerId: string, keys: readonly string[]) {
    void _ownerId;
    for (const [id, image] of this.outputs)
      if (image.objects.some((object) => keys.includes(object.key))) this.outputs.delete(id);
  }
}
