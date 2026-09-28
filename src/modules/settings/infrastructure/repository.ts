import "server-only";

import { createHash } from "node:crypto";

import type { ClientSession, Connection } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import { requireSettingsOwner, type SettingsRepository } from "../application/service.ts";
import {
  parseSettingsValues,
  parseSettingsWrite,
  type SettingsWrite,
} from "../contracts/settings.ts";
import {
  type OwnerSettings,
  type SettingsActor,
  settingsDefaults,
  type SettingsKind,
  type SettingsSecrets,
  type SettingsValues,
} from "../domain/model.ts";
import { SettingsVault } from "./vault.ts";

type Row = {
  kind: SettingsKind;
  revision: number;
  formatVersion: number;
  values: SettingsValues[SettingsKind];
  encryptedPayload: string | null;
  credentialConfigured: boolean;
  encryptionKeyId: string | null;
  encryptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
};
type Receipt = {
  actorId: string;
  mutationKey: string;
  fingerprint: string;
  fingerprintKeyId: string;
  result: OwnerSettings;
  createdAt: Date;
};
export type SettingsChange = {
  actor: SettingsActor;
  kind: SettingsKind;
  revision: number;
  requestId: string;
  idempotencyKey: string;
  rotate: boolean;
};
export type SettingsCommit = <T>(
  change: SettingsChange,
  operation: (session: ClientSession) => Promise<T>,
) => Promise<T>;
function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value))
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function dto(row: Omit<Row, "encryptedPayload">): OwnerSettings {
  if (row.formatVersion !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1)
    throw new ApplicationError("UNAVAILABLE", "Settings require an explicit migration");
  let values: SettingsValues[SettingsKind];
  try {
    values = parseSettingsValues(row.kind, row.values);
  } catch {
    throw new ApplicationError(
      "UNAVAILABLE",
      "Stored settings are invalid; operator review required",
    );
  }
  return {
    kind: row.kind,
    revision: row.revision,
    values,
    credentials: {
      configured: row.credentialConfigured === true,
      keyId: row.encryptionKeyId ?? null,
      rotatedAt: row.encryptedAt?.toISOString() ?? null,
    },
  };
}
export class MongoSettingsRepository implements SettingsRepository {
  private readonly connection: Connection;
  private readonly vault: SettingsVault;
  private readonly commit: SettingsCommit;
  private readonly now: () => Date;
  constructor(
    connection: Connection,
    vault: SettingsVault,
    commit: SettingsCommit,
    now: () => Date = () => new Date(),
  ) {
    this.connection = connection;
    this.vault = vault;
    this.commit = commit;
    this.now = now;
  }
  private rows() {
    if (!this.connection.db) throw new ApplicationError("UNAVAILABLE", "Database unavailable");
    return this.connection.db.collection<Row>("settings");
  }
  private receipts() {
    return this.connection.db!.collection<Receipt>("settings_receipts");
  }
  async stamp(kind: SettingsKind): Promise<number> {
    const row = await this.rows().findOne(
      { kind },
      { projection: { revision: 1, formatVersion: 1 } },
    );
    if (row && (row.formatVersion !== 1 || !Number.isSafeInteger(row.revision) || row.revision < 1))
      throw new ApplicationError("UNAVAILABLE", "Settings require an explicit migration");
    return row?.revision ?? 0;
  }
  async read(kind: SettingsKind): Promise<OwnerSettings | null> {
    const row = await this.rows().findOne({ kind }, { projection: { encryptedPayload: 0 } });
    return row ? dto(row) : null;
  }
  private async replay(
    actor: SettingsActor,
    key: string,
    fingerprintInput: string,
    session?: ClientSession,
  ): Promise<OwnerSettings | null> {
    const receipt = await this.receipts().findOne(
      { actorId: actor.id, mutationKey: key },
      { session },
    );
    if (!receipt) return null;
    if (receipt.fingerprint !== this.vault.fingerprint(fingerprintInput, receipt.fingerprintKeyId))
      throw new ApplicationError("CONFLICT", "Mutation key reused with different input");
    // Reconstruct the whitelist; never return arbitrary stored receipt fields.
    return {
      kind: receipt.result.kind,
      revision: receipt.result.revision,
      values: parseSettingsValues(receipt.result.kind, receipt.result.values),
      credentials: {
        configured: receipt.result.credentials.configured,
        keyId: receipt.result.credentials.keyId,
        rotatedAt: receipt.result.credentials.rotatedAt,
      },
    };
  }
  async write(
    kind: SettingsKind,
    input: SettingsWrite,
    actor: SettingsActor,
    key: string,
    requestId: string,
  ): Promise<OwnerSettings> {
    requireSettingsOwner(actor);
    const command = parseSettingsWrite(kind, input),
      fingerprintInput = canonical({ kind, ...command });
    const replay = await this.replay(actor, key, fingerprintInput);
    if (replay) return replay;
    // Fixed-size audit/outbox idempotency IDs, no config or credential hashes in logs.
    const idempotencyKey = `settings:${createHash("sha256").update(`${actor.id}:${key}`).digest("hex")}`;
    try {
      return await this.commit(
        {
          actor,
          kind,
          revision: command.revision,
          requestId,
          idempotencyKey,
          rotate: command.rotate,
        },
        async (session) => {
          const prior = await this.rows().findOne({ kind }, { session });
          if (prior) dto(prior);
          if ((prior?.revision ?? 0) !== command.revision)
            throw new ApplicationError(
              "CONFLICT",
              "Settings changed; reload and retry with the current revision",
            );
          let encryptedPayload = prior?.encryptedPayload ?? null,
            encryptionKeyId = prior?.encryptionKeyId ?? null,
            encryptedAt = prior?.encryptedAt ?? null;
          let secrets: SettingsSecrets | undefined;
          if (command.rotate || Object.keys(command.secrets ?? {}).length) {
            secrets = encryptedPayload ? this.vault.open(kind, encryptedPayload) : {};
            for (const [field, value] of Object.entries(command.secrets ?? {})) {
              if (value === null) delete secrets[field as keyof SettingsSecrets];
              else secrets[field as keyof SettingsSecrets] = value;
            }
            if (Object.keys(secrets).length) {
              encryptedPayload = this.vault.seal(kind, secrets);
              encryptionKeyId = this.vault.keyId;
              encryptedAt = this.now();
            } else {
              encryptedPayload = null;
              encryptionKeyId = null;
              encryptedAt = null;
            }
          }
          if (
            kind === "printing" &&
            (command.values as SettingsValues["printing"]).enabled &&
            !encryptedPayload
          )
            throw new ApplicationError(
              "VALIDATION",
              "Enabled printing requires bridge credentials",
            );
          const timestamp = this.now();
          const row: Row = {
            kind,
            revision: command.revision + 1,
            values: command.values,
            formatVersion: 1,
            encryptedPayload,
            encryptionKeyId,
            encryptedAt,
            credentialConfigured: encryptedPayload !== null,
            createdAt: prior?.createdAt ?? timestamp,
            updatedAt: timestamp,
            __v: (prior?.__v ?? 0) + 1,
          };
          if (prior) {
            const result = await this.rows().replaceOne({ kind, revision: command.revision }, row, {
              session,
            });
            if (result.modifiedCount !== 1)
              throw new ApplicationError("CONFLICT", "Settings revision conflict");
          } else await this.rows().insertOne(row, { session });
          const result = dto(row);
          await this.receipts().insertOne(
            {
              actorId: actor.id,
              mutationKey: key,
              fingerprint: this.vault.fingerprint(fingerprintInput),
              fingerprintKeyId: this.vault.keyId,
              result,
              createdAt: timestamp,
            },
            { session },
          );
          return result;
        },
      );
    } catch (error) {
      if (
        (error instanceof ApplicationError && error.code === "CONFLICT") ||
        (error && typeof error === "object" && "code" in error && error.code === 11000)
      ) {
        const result = await this.replay(actor, key, fingerprintInput);
        if (result) return result;
        throw new ApplicationError("CONFLICT", "Concurrent settings update; reload and retry");
      }
      // Avoid driver errors containing documents/secrets in diagnostic logs.
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("UNAVAILABLE", "Settings transaction failed");
    }
  }
  /** Trusted server adapter only. Not exposed by SettingsService, actions or HTTP. */
  async withCredentials<T>(
    kind: "payment" | "printing",
    consume: (
      values: SettingsValues[typeof kind],
      secrets: Readonly<SettingsSecrets>,
    ) => Promise<T>,
  ): Promise<T> {
    const row = await this.rows().findOne({ kind });
    const values = row ? (dto(row).values as SettingsValues[typeof kind]) : settingsDefaults(kind);
    const secrets = row?.encryptedPayload ? this.vault.open(kind, row.encryptedPayload) : {};
    try {
      return await consume(values, secrets);
    } catch {
      throw new ApplicationError("UNAVAILABLE", "Settings credential consumer failed");
    }
  }
}
