// Use cases and ports belong here; adapters are injected at composition time.
export type { MediaRepository } from "./repository.ts";
export { MediaService, requireMediaOwner } from "./service.ts";
export type { MediaStorage, StoredImage, UploadInput, UploadTicket } from "./storage.ts";
