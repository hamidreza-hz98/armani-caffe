import type {
  InitiateMedia,
  MediaActor,
  MediaDetail,
  MediaListQuery,
  MediaMetadata,
  MediaSummary,
  MediaUsage,
} from "../contracts/media.ts";
import type { StoredImage, UploadTicket } from "./storage.ts";

export type UploadRecord = Readonly<{
  id: string;
  ownerId: string;
  objectVersion: string;
  status: string;
  fingerprint: string;
  ticket: UploadTicket;
  expiresAt: Date;
  stagingKey: string;
}>;
export type CompletionClaim = UploadRecord & Readonly<{ leaseToken: string }>;
export type CleanupClaim = Readonly<{
  id: string;
  ownerId: string;
  outputId: string;
  stagingKey: string | null;
  removeOutputs: boolean;
  leaseToken: string;
  attempts: number;
}>;
export interface MediaRepository {
  findInitiation(uploaderId: string, key: string): Promise<UploadRecord | null>;
  initiate(
    actor: MediaActor,
    key: string,
    fingerprint: string,
    input: InitiateMedia,
    ticket: UploadTicket,
  ): Promise<UploadRecord>;
  refreshTicket(id: string, ticket: UploadTicket): Promise<void>;
  claimCompletion(id: string): Promise<CompletionClaim | null>;
  uploadRecord(id: string): Promise<UploadRecord | null>;
  finishCompletion(claim: CompletionClaim, image: StoredImage): Promise<void>;
  failCompletion(claim: CompletionClaim, terminal: boolean): Promise<void>;
  detail(id: string, ownerView: boolean): Promise<MediaDetail | null>;
  file(id: string): Promise<{
    ownerId: string;
    status: string;
    visibility: string;
    objects: StoredImage["objects"];
  } | null>;
  list(
    query: MediaListQuery,
    ownerView: boolean,
  ): Promise<{ items: MediaSummary[]; total: number; page: number; pageSize: number }>;
  update(
    actor: MediaActor,
    id: string,
    key: string,
    fingerprint: string,
    revision: number,
    metadata: MediaMetadata,
  ): Promise<MediaDetail>;
  delete(actor: MediaActor, id: string, key: string, fingerprint: string): Promise<MediaDetail>;
  replace(
    actor: MediaActor,
    id: string,
    targetId: string,
    key: string,
    fingerprint: string,
  ): Promise<MediaDetail>;
  usages(id: string): Promise<MediaUsage[]>;
  expireUploads(): Promise<number>;
  claimCleanup(): Promise<CleanupClaim | null>;
  finishCleanup(claim: CleanupClaim, success: boolean): Promise<void>;
}
