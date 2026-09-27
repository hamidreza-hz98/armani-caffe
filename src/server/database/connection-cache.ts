import "server-only";

type ReusableConnection = { readyState: number; close(): Promise<unknown> };

export class ConnectionCache<T extends ReusableConnection> {
  private connection: T | null = null;
  private pending: Promise<T> | null = null;
  private readonly open: () => Promise<T>;

  constructor(open: () => Promise<T>) {
    this.open = open;
  }

  get(): Promise<T> {
    if (this.connection?.readyState === 1) return Promise.resolve(this.connection);
    if (this.pending) return this.pending;
    this.pending = (async () => {
      if (this.connection) {
        const stale = this.connection;
        this.connection = null;
        await stale.close();
      }
      const connection = await this.open();
      this.connection = connection;
      return connection;
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async close(): Promise<void> {
    if (this.pending) await this.pending.catch(() => undefined);
    const connection = this.connection;
    this.connection = null;
    if (connection) await connection.close();
  }
}
