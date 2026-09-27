export type AuditActor = Readonly<{ kind: "admin" | "customer" | "system"; id: string | null }>;
