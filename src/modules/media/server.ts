import "server-only";

import { registerResource } from "../../server/lifecycle/index.ts";
// Server public boundary. Compose use cases and adapters here.
import { configuredMinioClient } from "../../server/minio/index.ts";
import { getServerConfig } from "../../server/secrets/config.ts";
import { MinioMediaStorage } from "./infrastructure/minio-storage.ts";

export type {
  MediaStorage,
  StoredImage,
  UploadInput,
  UploadTicket,
} from "./application/storage.ts";
export { MinioMediaStorage } from "./infrastructure/minio-storage.ts";
export { mediaAssetSchema } from "./infrastructure/schema.ts";

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
