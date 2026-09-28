import "server-only";

import type { ClientSession, Connection } from "mongoose";

import { getDatabaseConnection } from "../../server/database/connection.ts";
import { registerResource } from "../../server/lifecycle/index.ts";
// Server public boundary. Compose use cases and adapters here.
import { configuredMinioClient } from "../../server/minio/index.ts";
import { getServerConfig } from "../../server/secrets/config.ts";
import { authenticateAdminRequest } from "../auth/server.ts";
import {
  productMediaIds,
  productMediaUsages,
  replaceProductMedia,
} from "../catalog/products/server.ts";
import { MediaService, requireMediaOwner } from "./application/service.ts";
import { type MediaActor, mediaId } from "./contracts/media.ts";
import { createMediaHttpHandler } from "./infrastructure/http.ts";
import { MinioMediaStorage } from "./infrastructure/minio-storage.ts";
import { MongoMediaRepository } from "./infrastructure/repository.ts";

export { MediaService } from "./application/service.ts";
export type {
  MediaStorage,
  StoredImage,
  UploadInput,
  UploadTicket,
} from "./application/storage.ts";
export { createMediaActions } from "./infrastructure/actions.ts";
export { createMediaHttpHandler } from "./infrastructure/http.ts";
export { MinioMediaStorage } from "./infrastructure/minio-storage.ts";
export {
  mediaAssetSchema,
  mediaCleanupSchema,
  mediaReceiptSchema,
  mediaReferenceSchema,
} from "./infrastructure/schema.ts";

// Only verified live admin sessions supply actor IDs and roles.
export const handleMediaHttp = createMediaHttpHandler({
  service: createMediaService,
  authenticate: authenticateAdminRequest,
  origins: () => {
    const config = getServerConfig();
    return [new URL(config.appUrl).origin, new URL(config.adminUrl).origin];
  },
});

function createMediaRepository(
  connection: Connection,
  bucket: string,
  encryptionKey: string,
  now = () => new Date(),
  previousKey?: string,
) {
  return new MongoMediaRepository(
    connection,
    bucket,
    encryptionKey,
    {
      usages: (session, id) => productMediaUsages(connection, session, id),
      replace: (session, from, to) => replaceProductMedia(connection, session, from, to),
      productMediaIds: (session, id) => productMediaIds(connection, session, id),
    },
    now,
    previousKey,
  );
}
export async function createMediaService() {
  const config = getServerConfig();
  const connection = await getDatabaseConnection();
  return new MediaService(
    createMediaRepository(
      connection,
      config.minio.bucket,
      config.encryption.key,
      undefined,
      config.encryption.previousKey,
    ),
    createMediaStorage(),
  );
}
/** Trusted product services must use this unit of work when writing mediaIds. Never expose the callback to HTTP clients. */
export async function withProductMediaReferences(
  connection: Connection,
  actor: MediaActor | null,
  productId: string,
  ids: readonly string[],
  change: (session: ClientSession) => Promise<void>,
) {
  requireMediaOwner(actor);
  mediaId(productId);
  if (ids.length > 40) throw new RangeError("Too many product images");
  ids.forEach(mediaId);
  const config = getServerConfig();
  await createMediaRepository(
    connection,
    config.minio.bucket,
    config.encryption.key,
  ).syncProductReferences(productId, ids, change);
}

const mediaState = globalThis as typeof globalThis & { __armaniMediaStorage?: MinioMediaStorage };
export function createMediaStorage() {
  if (mediaState.__armaniMediaStorage) return mediaState.__armaniMediaStorage;
  const config = getServerConfig();
  const client = configuredMinioClient();
  const storage = new MinioMediaStorage(client, config.minio.bucket, config.encryption.key);
  registerResource("media-storage", async () => {
    client.destroy();
    delete mediaState.__armaniMediaStorage;
  });
  mediaState.__armaniMediaStorage = storage;
  return storage;
}
