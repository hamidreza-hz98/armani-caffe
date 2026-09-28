import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import { ApplicationError } from "../../../shared/errors.ts";
import { parseProviderCredentials, settingsRecord } from "../contracts/settings.ts";
import type { SettingsKind, SettingsSecrets } from "../domain/model.ts";

type Envelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
  encryptedAt: string;
};
export class SettingsVault {
  readonly keyId: string;
  private readonly keys = new Map<string, Buffer>();
  private readonly now: () => Date;
  constructor(primary: string, previous?: string, now: () => Date = () => new Date()) {
    this.now = now;
    for (const hex of [primary, previous].filter((key): key is string => key !== undefined)) {
      if (!/^[a-fA-F0-9]{64}$/.test(hex))
        throw new Error("Settings encryption needs a 256-bit hex key");
      const key = Buffer.from(hex, "hex"),
        id = createHash("sha256").update(key).digest("hex").slice(0, 24);
      this.keys.set(id, key);
    }
    this.keyId = createHash("sha256")
      .update(Buffer.from(primary, "hex"))
      .digest("hex")
      .slice(0, 24);
  }
  fingerprint(value: string, keyId = this.keyId): string {
    const key = this.keys.get(keyId);
    if (!key)
      throw new ApplicationError(
        "CONFLICT",
        "Receipt key retired; use a new mutation key and current revision",
      );
    return createHmac("sha256", key)
      .update("armani-settings-receipt-v1\0")
      .update(value)
      .digest("hex");
  }
  seal(kind: SettingsKind, secrets: SettingsSecrets): string {
    const iv = randomBytes(12),
      encryptedAt = this.now().toISOString();
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.keyId)!, iv, {
      authTagLength: 16,
    });
    cipher.setAAD(Buffer.from(`armani-settings:${kind}:1:${this.keyId}:${encryptedAt}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secrets), "utf8"),
      cipher.final(),
    ]);
    const envelope: Envelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      keyId: this.keyId,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      encryptedAt,
    };
    return JSON.stringify(envelope);
  }
  open(kind: SettingsKind, payload: string): SettingsSecrets {
    try {
      if (payload.length > 12000 || (kind !== "payment" && kind !== "printing")) throw new Error();
      const e = settingsRecord(JSON.parse(payload), [
        "version",
        "algorithm",
        "keyId",
        "iv",
        "tag",
        "ciphertext",
        "encryptedAt",
      ]) as Envelope;
      if (
        e.version !== 1 ||
        e.algorithm !== "aes-256-gcm" ||
        !this.keys.has(e.keyId) ||
        typeof e.encryptedAt !== "string" ||
        !Number.isFinite(Date.parse(e.encryptedAt))
      )
        throw new Error();
      for (const field of [e.iv, e.tag, e.ciphertext])
        if (typeof field !== "string" || !/^[A-Za-z0-9_-]+$/.test(field)) throw new Error();
      const iv = Buffer.from(e.iv, "base64url"),
        tag = Buffer.from(e.tag, "base64url");
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.keys.get(e.keyId)!, iv, {
        authTagLength: 16,
      });
      decipher.setAAD(Buffer.from(`armani-settings:${kind}:1:${e.keyId}:${e.encryptedAt}`));
      decipher.setAuthTag(tag);
      const data = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(e.ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      );
      const parsed = settingsRecord(
        data,
        kind === "payment" ? ["gatewayCredential", "providerCredentials"] : ["bridgeToken"],
      );
      if (!Object.keys(parsed).length) throw new Error();
      for (const [field, value] of Object.entries(parsed)) {
        if (field === "providerCredentials") parseProviderCredentials(value);
        else if (typeof value !== "string" || value.length < 16 || value.length > 4096)
          throw new Error();
      }
      return parsed as SettingsSecrets;
    } catch {
      throw new ApplicationError("UNAVAILABLE", "Stored settings credentials cannot be decrypted");
    }
  }
}
