import "server-only";

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
