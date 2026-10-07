import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import type { Connection } from "mongoose";

import { ApplicationError } from "../../../shared/errors.ts";
import type { SmsService } from "../application/index.ts";
import type { SmsPurpose } from "../contracts/index.ts";

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 120 * 1000;
type Challenge = {
  _id: string;
  codeHash: string;
  expiresAt: Date;
  resendAt: Date;
  attempts: number;
};

export class OtpService {
  constructor(
    private readonly connection: Connection,
    private readonly sms: SmsService,
    private readonly key: string,
    private readonly templates: Record<SmsPurpose, number>,
    private readonly parameter: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private rows() {
    return this.connection.db!.collection<Challenge>("sms_otp_challenges");
  }
  private hash(value: string) {
    return createHmac("sha256", this.key).update(`sms-otp-v1\0${value}`).digest("hex");
  }
  private id(phone: string, purpose: SmsPurpose) {
    return this.hash(`${purpose}\0${phone}`);
  }

  private async throttleSend(now: Date) {
    const windowMs = 15 * 60 * 1000;
    const bucket = Math.floor(now.getTime() / windowMs);
    const id = this.hash(`send-global\0${bucket}`);
    const collection = this.connection.db!.collection<{
      _id: string;
      count: number;
      expiresAt: Date;
    }>("sms_send_throttles");
    let row;
    try {
      row = await collection.findOneAndUpdate(
        { _id: id },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) } },
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        row = await collection.findOneAndUpdate(
          { _id: id },
          { $inc: { count: 1 } },
          { returnDocument: "after" },
        );
      else throw error;
    }
    if (!row || row.count > 300)
      throw new ApplicationError("RATE_LIMITED", "SMS send limit reached");
  }

  async send(phone: string, purpose: SmsPurpose) {
    const id = this.id(phone, purpose);
    const timestamp = this.now();
    const existing = await this.rows().findOne({ _id: id });
    if (existing && existing.resendAt > timestamp && existing.expiresAt > timestamp)
      throw new ApplicationError("RATE_LIMITED", "Wait before resending verification code");
    await this.throttleSend(timestamp);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const challenge: Challenge = {
      _id: id,
      codeHash: this.hash(`${id}\0${code}`),
      expiresAt: new Date(timestamp.getTime() + OTP_TTL_MS),
      resendAt: new Date(timestamp.getTime() + RESEND_MS),
      attempts: 0,
    };
    const claimed = await this.rows().findOneAndUpdate(
      { _id: id, $or: [{ resendAt: { $lte: timestamp } }, { expiresAt: { $lte: timestamp } }] },
      {
        $set: {
          codeHash: challenge.codeHash,
          expiresAt: challenge.expiresAt,
          resendAt: challenge.resendAt,
          attempts: 0,
        },
      },
      { returnDocument: "after" },
    );
    if (!claimed) {
      try {
        await this.rows().insertOne(challenge);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000)
          throw new ApplicationError("RATE_LIMITED", "Wait before resending verification code");
        throw error;
      }
    }
    try {
      await this.sms.sendTemplate({
        mobile: phone.replace(/^\+98/, "0"),
        templateId: this.templates[purpose],
        parameters: [{ name: this.parameter, value: code }],
      });
    } catch (error) {
      await this.rows().deleteOne({ _id: id, codeHash: challenge.codeHash });
      throw error;
    }
    return { expiresInSeconds: OTP_TTL_MS / 1000, resendInSeconds: RESEND_MS / 1000 };
  }

  async verify(phone: string, purpose: SmsPurpose, code: string) {
    const id = this.id(phone, purpose);
    const now = this.now();
    const row = await this.rows().findOne({
      _id: id,
      expiresAt: { $gt: now },
      attempts: { $lt: 5 },
    });
    if (!row) return false;
    const actual = Buffer.from(row.codeHash, "hex");
    const expected = Buffer.from(this.hash(`${id}\0${code}`), "hex");
    if (!timingSafeEqual(actual, expected)) {
      await this.rows().updateOne({ _id: id, codeHash: row.codeHash }, { $inc: { attempts: 1 } });
      return false;
    }
    return (
      (
        await this.rows().deleteOne({
          _id: id,
          codeHash: row.codeHash,
          expiresAt: { $gt: now },
          attempts: { $lt: 5 },
        })
      ).deletedCount === 1
    );
  }
}
