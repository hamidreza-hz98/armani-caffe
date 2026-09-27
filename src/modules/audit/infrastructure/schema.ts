import "server-only";

import { Schema } from "mongoose";

import { documentSchemaOptions } from "../../../server/database/conventions.ts";
import { requiredText, utcDateField } from "../../../server/database/schema-fields.ts";
import { assertSafeRecord } from "../../../shared/safe-record.ts";

const actorSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["admin", "customer", "system"] },
    id: { type: String, default: null },
  },
  { _id: false, strict: "throw" },
);
const subjectSchema = new Schema(
  { kind: requiredText(80), id: requiredText(120) },
  { _id: false, strict: "throw" },
);

export const auditEventSchema = new Schema(
  {
    occurredAt: utcDateField(),
    actor: { type: actorSchema, required: true },
    action: requiredText(120),
    subject: { type: subjectSchema, required: true },
    requestId: requiredText(80),
    outcome: { type: String, required: true, enum: ["success", "failure"] },
    metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
  },
  { ...documentSchemaOptions(), collection: "audit_events" },
);

auditEventSchema.index(
  { "subject.kind": 1, "subject.id": 1, occurredAt: -1 },
  { name: "audit_subject_time" },
);
auditEventSchema.index(
  { "actor.kind": 1, "actor.id": 1, occurredAt: -1 },
  { name: "audit_actor_time" },
);
auditEventSchema.index({ requestId: 1, occurredAt: -1 }, { name: "audit_request_time" });
auditEventSchema.index({ occurredAt: -1 }, { name: "audit_time" });
auditEventSchema.pre("validate", function () {
  const metadata = this.get("metadata") as Map<string, unknown>;
  try {
    assertSafeRecord(Object.fromEntries(metadata ?? []));
  } catch (error) {
    this.invalidate("metadata", (error as Error).message);
  }
});
