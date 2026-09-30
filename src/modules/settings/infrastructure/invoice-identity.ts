import "server-only";

import type { ClientSession, Connection } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import { parseSettingsValues } from "../contracts/settings.ts";
import { settingsDefaults, type SettingsKind, type SettingsValues } from "../domain/model.ts";

/** Transactional read projection; never loads credentials or ciphertext. */
export async function invoiceIdentitySettings(connection: Connection, session: ClientSession) {
  if (!session.inTransaction())
    throw new ApplicationError("VALIDATION", "Invoice identity requires transaction");
  const rows = await connection
    .db!.collection<{ kind: SettingsKind; formatVersion: number; values: unknown }>("settings")
    .find(
      { kind: { $in: ["business", "contact", "printing"] } },
      { session, projection: { kind: 1, formatVersion: 1, values: 1 } },
    )
    .limit(3)
    .toArray();
  const read = <K extends "business" | "contact" | "printing">(kind: K): SettingsValues[K] => {
    const row = rows.find((r) => r.kind === kind);
    if (!row) return settingsDefaults(kind);
    if (row.formatVersion !== 1)
      throw new ApplicationError("UNAVAILABLE", "Settings require migration");
    try {
      return parseSettingsValues(kind, row.values) as SettingsValues[K];
    } catch {
      throw new ApplicationError("UNAVAILABLE", "Invalid stored invoice settings");
    }
  };
  const business = read("business"),
    contact = read("contact"),
    printing = read("printing");
  return {
    identity: {
      title: business.title,
      legalName: business.legalName,
      address: contact.address,
      phone: contact.phone,
      email: contact.email,
      footer: printing.footer,
    },
    paperWidthMm: printing.paperWidthMm,
    printing: {
      automatic: printing.enabled && printing.automaticPrint,
      printerId: printing.bridgeId,
    },
  };
}
