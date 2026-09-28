import { adminPassword } from "../../../shared/admin-input.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { AdminAuthorizer, PasswordHasher } from "../../../shared/security-ports.ts";
import {
  type AdminCreate,
  adminId,
  adminRecord,
  type AdminUpdate,
  parseAdminCreate,
  parseAdminUpdate,
} from "../contracts/admin.ts";
import type { AdminDetails } from "../domain/model.ts";

export interface AdminRepository {
  list(
    token: string | null,
    page: number,
    limit: number,
  ): Promise<{ items: AdminDetails[]; total: number }>;
  create(
    token: string | null,
    input: Omit<AdminCreate, "password">,
    hash: string,
    requestId: string,
  ): Promise<AdminDetails>;
  update(
    token: string | null,
    id: string,
    input: AdminUpdate,
    requestId: string,
  ): Promise<AdminDetails>;
  delete(token: string | null, id: string, revision: number, requestId: string): Promise<void>;
  resetPassword(token: string | null, id: string, hash: string, requestId: string): Promise<void>;
}
export class AdminService {
  private readonly repository: AdminRepository;
  private readonly passwords: PasswordHasher;
  private readonly authorize: AdminAuthorizer;
  constructor(repository: AdminRepository, passwords: PasswordHasher, authorize: AdminAuthorizer) {
    this.repository = repository;
    this.passwords = passwords;
    this.authorize = authorize;
  }
  async list(token: string | null, page = 1, limit = 20) {
    await this.authorize(token, "admins.read");
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new ApplicationError("VALIDATION", "Invalid admin pagination");
    return this.repository.list(token, page, limit);
  }
  async create(token: string | null, input: unknown, requestId: string) {
    await this.authorize(token, "admins.manage");
    const { password, ...values } = parseAdminCreate(input);
    return this.repository.create(token, values, await this.passwords.hash(password), requestId);
  }
  async update(token: string | null, id: unknown, input: unknown, requestId: string) {
    await this.authorize(token, "admins.manage");
    return this.repository.update(token, adminId(id), parseAdminUpdate(input), requestId);
  }
  async delete(token: string | null, id: unknown, input: unknown, requestId: string) {
    await this.authorize(token, "admins.manage");
    const { revision } = adminRecord(input, ["revision"]);
    if (!Number.isSafeInteger(revision) || (revision as number) < 0)
      throw new ApplicationError("VALIDATION", "Revision required");
    return this.repository.delete(token, adminId(id), revision as number, requestId);
  }
  async resetPassword(token: string | null, id: unknown, input: unknown, requestId: string) {
    await this.authorize(token, "admins.manage");
    const row = adminRecord(input, ["password"]),
      password = adminPassword(row.password);
    return this.repository.resetPassword(
      token,
      adminId(id),
      await this.passwords.hash(password),
      requestId,
    );
  }
}
