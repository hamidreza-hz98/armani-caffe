import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { ApplicationError } from "../../../shared/errors.ts";
import type { PasswordHasher } from "../../../shared/security-ports.ts";

const format = /^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
let inFlight = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (inFlight >= 2)
    throw new ApplicationError("RATE_LIMITED", "Password hashing capacity exceeded");
  inFlight++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
        (error, value) =>
          error
            ? reject(new ApplicationError("UNAVAILABLE", "Password hashing unavailable"))
            : resolve(value),
      ),
    );
  } finally {
    inFlight--;
  }
}
export class ScryptPasswords implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16),
      hash = await derive(password, salt);
    return `scrypt$v1$131072$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
  }
  async verify(password: string, encoded: string | null): Promise<boolean> {
    const parsed = encoded ? format.exec(encoded) : null;
    const actual = await derive(
      password,
      parsed ? Buffer.from(parsed[1], "hex") : Buffer.alloc(16),
    );
    const expected = parsed ? Buffer.from(parsed[2], "hex") : Buffer.alloc(64);
    return timingSafeEqual(actual, expected) && parsed !== null;
  }
}
export const isSupportedAdminPasswordHash = (input: unknown) =>
  typeof input === "string" && format.test(input);
