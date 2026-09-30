import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";

import type { PrintDelivery } from "./protocol.ts";

export interface PrinterAdapter {
  /** Resolves only after the local output target reports acceptance, never at WebSocket emit. */
  print(bytes: Uint8Array, job: PrintDelivery): Promise<void>;
}

/** Bytes may have reached a printer; an automatic retry could make a second physical copy. */
export class OutputUncertainError extends Error {
  constructor() {
    super("OUTPUT_UNCERTAIN");
  }
}

/** Durable simulator output: one ESC/POS file per job, with no overwrite. */
export class FilePrinter implements PrinterAdapter {
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  async print(bytes: Uint8Array, job: PrintDelivery) {
    const { mkdir, unlink } = await import("node:fs/promises");
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${job.jobId}.escpos`);
    const file = await open(target, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } catch (error) {
      await file.close();
      await unlink(target).catch(() => undefined);
      throw error;
    } finally {
      if (file.fd !== -1) await file.close();
    }
  }
}

/** Raw TCP 9100 output; a successful write means transport acceptance, not paper confirmation. */
export class NetworkPrinter implements PrinterAdapter {
  private readonly host: string;
  private readonly port: number;
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
  async print(bytes: Uint8Array) {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let sending = false;
      socket.setTimeout(15_000);
      socket.once("timeout", () => socket.destroy(new Error("PRINTER_TIMEOUT")));
      socket.once("error", () =>
        reject(sending ? new OutputUncertainError() : new Error("PRINTER_CONNECT_FAILED")),
      );
      socket.once("connect", () => {
        sending = true;
        socket.end(bytes, () => resolve());
      });
    });
  }
}

/** Windows RAW spooler adapter; the spooler accepts bytes, but cannot prove paper emerged. */
export class WindowsSpoolPrinter implements PrinterAdapter {
  private readonly printerName: string;
  private readonly scratchDirectory: string;
  constructor(printerName: string, scratchDirectory: string) {
    this.printerName = printerName;
    this.scratchDirectory = scratchDirectory;
  }
  async print(bytes: Uint8Array, job: PrintDelivery) {
    if (process.platform !== "win32") throw new Error("WINDOWS_ONLY");
    const { mkdir, unlink } = await import("node:fs/promises");
    await mkdir(this.scratchDirectory, { recursive: true });
    const path = join(this.scratchDirectory, `${job.jobId}-${job.deliveryId}.bin`);
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(import.meta.dirname, "winspool.ps1"),
          "-PrinterName",
          this.printerName,
          "-DataPath",
          path,
        ],
        { timeout: 30_000, windowsHide: true },
      );
    } catch (error) {
      if (/PRINTER_OPEN_FAILED|PRINTER_START_FAILED/u.test(String(error)))
        throw new Error("PRINTER_UNAVAILABLE");
      throw new OutputUncertainError();
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }
}
