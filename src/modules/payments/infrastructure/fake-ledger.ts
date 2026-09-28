import "server-only";

import type { Connection } from "mongoose";

import type { VerificationResult } from "../application/provider.ts";
import type { FakeLedger, FakeRecord } from "./fake.ts";
export class MongoFakeLedger implements FakeLedger {
  private readonly connection: Connection;
  constructor(connection: Connection) {
    this.connection = connection;
  }
  private rows() {
    return this.connection.db!.collection<FakeRecord & { _id: string }>("fake_payment_ledger");
  }
  async put(record: FakeRecord) {
    await this.rows().updateOne(
      { _id: record.authority },
      { $setOnInsert: { ...record } },
      { upsert: true },
    );
    const row = await this.get(record.authority);
    if (!row || row.paymentId !== record.paymentId || row.amountToman !== record.amountToman)
      throw new Error("Fake payment idempotency conflict");
  }
  async get(authority: string) {
    const row = await this.rows().findOne({ _id: authority });
    return row
      ? {
          authority: row.authority,
          paymentId: row.paymentId,
          amountToman: row.amountToman,
          outcome: row.outcome,
        }
      : null;
  }
  async outcome(authority: string, result: VerificationResult) {
    const updated = await this.rows().updateOne({ _id: authority }, { $set: { outcome: result } });
    if (!updated.matchedCount) throw new Error("Unknown fake authority");
  }
}
