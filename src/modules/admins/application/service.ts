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

export type AdminListFilters = Readonly<{
  q?: string;
  role?: "OWNER" | "CASHIER";
  status?: "active" | "disabled";
}>;
export type AdminListStats = Readonly<{
  total: number;
  activeOwners: number;
  activeCashiers: number;
  disabled: number;
}>;

export interface AdminRepository {
  list(
    token: string | null,
    page: number,
    limit: number,
    filters: AdminListFilters,
  ): Promise<{ items: AdminDetails[]; total: number; stats: AdminListStats }>;
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
  async list(token: string | null, page = 1, limit = 20, filters: AdminListFilters = {}) {
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
    if (
      filters.q !== undefined &&
      (typeof filters.q !== "string" || !filters.q.trim() || filters.q.length > 80)
    )
      throw new ApplicationError("VALIDATION", "Invalid admin search");
    if (filters.role !== undefined && !["OWNER", "CASHIER"].includes(filters.role))
      throw new ApplicationError("VALIDATION", "Invalid admin role filter");
    if (filters.status !== undefined && !["active", "disabled"].includes(filters.status))
      throw new ApplicationError("VALIDATION", "Invalid admin status filter");
    return this.repository.list(token, page, limit, {
      ...filters,
      ...(filters.q ? { q: filters.q.trim() } : {}),
    });
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
