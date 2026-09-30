import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

type JournalState = "received" | "printed" | "acknowledged" | "failed";
export type JournalEntry = {
  jobId: string;
  invoiceId: string;
  attempt: number;
  deliveryId: string;
  state: JournalState;
  updatedAt: string;
  errorCode?: string;
};
const validId = (id: string) => /^[a-f\d]{24}$/u.test(id);

/** One durable JSON file per job, plus an exclusive lock to prevent two local bridge processes. */
export class PrintJournal {
  private lockHandle?: Awaited<ReturnType<typeof open>>;
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  async lock() {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, ".bridge.lock");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        this.lockHandle = await open(path, "wx");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const pid = Number(await readFile(path, "utf8"));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("INVALID_BRIDGE_LOCK");
        try {
          process.kill(pid, 0);
          throw new Error("BRIDGE_ALREADY_RUNNING");
        } catch (probe) {
          if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
        }
        const stale = `${path}.stale-${randomUUID()}`;
        try {
          await rename(path, stale);
          await unlink(stale);
        } catch (claim) {
          if ((claim as NodeJS.ErrnoException).code !== "ENOENT") throw claim;
        }
      }
    }
    if (!this.lockHandle) throw new Error("BRIDGE_LOCK_UNAVAILABLE");
    await this.lockHandle.writeFile(String(process.pid));
    await this.lockHandle.sync();
  }
  async unlock() {
    await this.lockHandle?.close();
    if (this.lockHandle) await unlink(join(this.directory, ".bridge.lock"));
    this.lockHandle = undefined;
  }
  private path(jobId: string) {
    if (!validId(jobId)) throw new Error("INVALID_JOB_ID");
    return join(this.directory, `${jobId}.json`);
  }
  async read(jobId: string): Promise<JournalEntry | null> {
    try {
      const entry = JSON.parse(await readFile(this.path(jobId), "utf8")) as JournalEntry;
      if (entry.jobId !== jobId || !validId(entry.invoiceId)) throw new Error("CORRUPT_JOURNAL");
      return entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async write(entry: JournalEntry): Promise<void> {
    const destination = this.path(entry.jobId);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(entry));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    // Flush the directory entry on POSIX; Windows does not support opening a directory this way.
    if (process.platform !== "win32") {
      const directory = await open(this.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
  async list(): Promise<JournalEntry[]> {
    const { readdir } = await import("node:fs/promises");
    try {
      const names = await readdir(this.directory);
      const entries = await Promise.all(
        names
          .filter((name) => /^[a-f\d]{24}\.json$/u.test(name))
          .map((name) => this.read(name.slice(0, 24))),
      );
      return entries.filter((entry): entry is JournalEntry => entry !== null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
