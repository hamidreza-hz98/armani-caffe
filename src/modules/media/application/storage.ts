export type StoredImage = Readonly<{
  id: string;
  objects: readonly Readonly<{
    key: string;
    variant: "original" | "small" | "large";
    byteSize: number;
    sha256: string;
    mimeType: "image/webp";
    width: number;
    height: number;
  }>[];
}>;
export type UploadInput = Readonly<{ bytes: Uint8Array; mimeType: string }>;
export type UploadTicket = Readonly<{
  token: string;
  url: string;
  fields: Readonly<Record<string, string>>;
  expiresIn: number;
}>;
export interface MediaStorage {
  upload(ownerId: string, input: UploadInput): Promise<StoredImage>;
  uploadBulk(
    ownerId: string,
    inputs: readonly UploadInput[],
  ): Promise<readonly ({ ok: true; image: StoredImage } | { ok: false; code: "UPLOAD_FAILED" })[]>;
  prepareUpload(
    ownerId: string,
    byteSize: number,
    mimeType: string,
    existingKey?: string,
  ): Promise<UploadTicket>;
  finalizeUpload(ownerId: string, token: string, outputId?: string): Promise<StoredImage>;
  findUpload(ownerId: string, outputId: string): Promise<StoredImage | null>;
  deleteUpload(ownerId: string, outputId: string): Promise<void>;
  removeStaging(ownerId: string, key: string): Promise<void>;
  cancelUpload(ownerId: string, token: string): Promise<void>;
  read(ownerId: string, key: string): Promise<Uint8Array>;
  metadata(
    ownerId: string,
    key: string,
  ): Promise<{ byteSize: number; mimeType: string; etag: string; lastModified: Date }>;
  downloadUrl(ownerId: string, key: string): Promise<string>;
  delete(ownerId: string, keys: readonly string[]): Promise<void>;
  health(): Promise<void>;
}
