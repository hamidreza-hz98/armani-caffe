export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_PIXELS = 16_000_000;
export const MEDIA_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type MediaMime = (typeof MEDIA_MIMES)[number];

export function validateMediaInput(size: number, mime: string): asserts mime is MediaMime {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_MEDIA_BYTES)
    throw new RangeError("Media must contain between 1 byte and 10 MiB");
  if (!(MEDIA_MIMES as readonly string[]).includes(mime))
    throw new RangeError("Only JPEG, PNG and WebP images are accepted");
}

export function assertOwnerId(ownerId: string): void {
  if (!/^[a-f0-9]{24}$/.test(ownerId)) throw new RangeError("Invalid media owner ID");
}

export function stagingKey(ownerId: string, id: string): string {
  assertOwnerId(ownerId);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new RangeError("Invalid upload ID");
  return `staging/v1/${ownerId}/${id}`;
}

export function mediaKey(ownerId: string, id: string, hash: string, variant: string): string {
  stagingKey(ownerId, id);
  if (!/^[a-f0-9]{64}$/.test(hash) || !/^(original|small|large)$/.test(variant))
    throw new RangeError("Invalid media version or variant");
  return `media/v1/${ownerId}/${id}/${hash}-${variant}.webp`;
}

export function assertOwnedKey(key: string, ownerId: string, staging = false): void {
  assertOwnerId(ownerId);
  const pattern = staging
    ? /^staging\/v1\/[a-f0-9]{24}\/[a-f0-9-]{36}$/
    : /^media\/v1\/[a-f0-9]{24}\/[a-f0-9-]{36}\/[a-f0-9]{64}-(original|small|large)\.webp$/;
  if (!pattern.test(key) || !key.startsWith(`${staging ? "staging" : "media"}/v1/${ownerId}/`))
    throw new RangeError("Invalid or unauthorized media key");
}

export function assertImageVersion(
  ownerId: string,
  image: {
    id: string;
    objects: readonly {
      key: string;
      variant: string;
      sha256: string;
      mimeType: string;
      byteSize: number;
      width: number;
      height: number;
    }[];
  },
): void {
  if (
    image.objects.length !== 3 ||
    new Set(image.objects.map((object) => object.variant)).size !== 3
  )
    throw new RangeError("Three distinct image variants are required");
  for (const object of image.objects) {
    validateMediaInput(object.byteSize, object.mimeType);
    const limit = { original: 4096, small: 320, large: 1280 }[
      object.variant as "original" | "small" | "large"
    ];
    if (
      object.mimeType !== "image/webp" ||
      object.key !== mediaKey(ownerId, image.id, object.sha256, object.variant) ||
      !Number.isSafeInteger(object.width) ||
      !Number.isSafeInteger(object.height) ||
      object.width < 1 ||
      object.height < 1 ||
      object.width > limit ||
      object.height > limit
    )
      throw new RangeError("Invalid normalized image descriptor");
  }
}
