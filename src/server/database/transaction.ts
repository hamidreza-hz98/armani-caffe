import "server-only";

import type { ClientSession } from "mongoose";

import { getDatabaseConnection } from "./connection.ts";

// Database-driver-independent port; MongoDB adapters can provide sessions later.
export interface TransactionRunner<Session> {
  run<T>(work: (session: Session) => Promise<T>): Promise<T>;
}

export function inTransaction<Session, T>(
  runner: TransactionRunner<Session>,
  work: (session: Session) => Promise<T>,
): Promise<T> {
  return runner.run(work);
}

export async function withDatabaseTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const connection = await getDatabaseConnection();
  return connection.transaction(work, {
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
  });
}
