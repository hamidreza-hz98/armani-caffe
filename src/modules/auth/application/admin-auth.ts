import { ApplicationError } from "../../../shared/errors.ts";
import type { PasswordHasher } from "../../../shared/security-ports.ts";
import { parseAdminLogin } from "../contracts/admin-auth.ts";
import type { AdminPrincipal } from "../domain/admin-session.ts";

export type AdminCredentialIdentity = {
  id: string;
  username: string;
  displayName: string;
  role: "OWNER" | "CASHIER";
  status: "active" | "disabled";
  deletedAt: Date | null;
  authVersion: number;
  passwordHash: string;
};
export type IssuedAdminSession = { token: string; expiresAt: Date; principal: AdminPrincipal };
export interface AdminAuthStore {
  throttle(username: string, network: string): Promise<void>;
  credentials(username: string): Promise<AdminCredentialIdentity | null>;
  rejectLogin(requestId: string): Promise<void>;
  login(
    identity: AdminCredentialIdentity,
    previousToken: string | null,
    requestId: string,
  ): Promise<IssuedAdminSession>;
  resolve(token: string | null): Promise<AdminPrincipal | null>;
  rotate(token: string | null, requestId: string): Promise<IssuedAdminSession>;
  logout(token: string | null, requestId: string): Promise<void>;
}
export class AdminAuthService {
  private readonly store: AdminAuthStore;
  private readonly passwords: PasswordHasher;
  constructor(store: AdminAuthStore, passwords: PasswordHasher) {
    this.store = store;
    this.passwords = passwords;
  }
  async login(
    input: unknown,
    previousToken: string | null,
    network: string,
    requestId: string,
  ): Promise<IssuedAdminSession> {
    const { username, password } = parseAdminLogin(input);
    await this.store.throttle(username, network);
    const identity = await this.store.credentials(username);
    const valid = await this.passwords.verify(password, identity?.passwordHash ?? null);
    if (!valid || !identity || identity.status !== "active" || identity.deletedAt) {
      await this.store.rejectLogin(requestId);
      throw new ApplicationError("INVALID_CREDENTIALS", "Invalid credentials");
    }
    return this.store.login(identity, previousToken, requestId);
  }
  resolve(token: string | null) {
    return this.store.resolve(token);
  }
  rotate(token: string | null, requestId: string) {
    return this.store.rotate(token, requestId);
  }
  logout(token: string | null, requestId: string) {
    return this.store.logout(token, requestId);
  }
}
