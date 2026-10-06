import { ApplicationError } from "../../../shared/errors.ts";
import type { TransactionContext } from "../../../shared/security-ports.ts";
import {
  type Customer,
  parseCustomerLogin,
  parseCustomerProfileUpdate,
  parseCustomerSignup,
} from "../../customers/index.ts";
import type { CustomerPrincipal } from "../domain/customer-session.ts";

export type CustomerSignup = {
  phone: string;
  proof?: string;
  displayName: string | null;
  birthDate: string | null;
};
export type CustomerLogin = { phone: string; proof: string };
export type CustomerProfileUpdate = {
  revision: number;
  displayName?: string | null;
  birthDate?: string | null;
};
export type CustomerCredentialIdentity = {
  id: string;
  phone: string;
  status: "active" | "blocked" | "anonymized";
  authVersion: number;
};
export interface CustomerIdentityRepository {
  byPhone(phone: string): Promise<CustomerCredentialIdentity | null>;
  byId(id: string, tx?: TransactionContext): Promise<CustomerCredentialIdentity | null>;
  create(
    id: string,
    input: Omit<CustomerSignup, "proof">,
    tx: TransactionContext,
  ): Promise<Customer>;
  profile(id: string): Promise<Customer>;
  update(id: string, input: CustomerProfileUpdate, tx: TransactionContext): Promise<Customer>;
}
export type IssuedCustomerSession = {
  token: string;
  expiresAt: Date;
  principal: CustomerPrincipal;
};
export interface CustomerAuthStore {
  throttle(phone: string, operation: "signup" | "login"): Promise<void>;
  credentials(phone: string): Promise<CustomerCredentialIdentity | null>;
  rejectLogin(requestId: string): Promise<void>;
  signup(
    input: Omit<CustomerSignup, "proof">,
    requestId: string,
  ): Promise<Customer>;
  login(
    identity: CustomerCredentialIdentity,
    previousToken: string | null,
    requestId: string,
  ): Promise<IssuedCustomerSession>;
  resolve(token: string | null): Promise<CustomerPrincipal | null>;
  rotate(token: string | null, requestId: string): Promise<IssuedCustomerSession>;
  logout(token: string | null, requestId: string): Promise<void>;
  profile(token: string | null): Promise<Customer>;
  update(token: string | null, input: CustomerProfileUpdate, requestId: string): Promise<Customer>;
}
/** Verifies phone possession before issuing customer sessions. */
export interface CustomerProofVerifier {
  verify(phone: string, proof: string): Promise<boolean>;
}
export class CustomerAuthService {
  private readonly store: CustomerAuthStore;
  private readonly proofs: CustomerProofVerifier;
  constructor(store: CustomerAuthStore, proofs: CustomerProofVerifier) {
    this.store = store;
    this.proofs = proofs;
  }
  async signup(raw: unknown, requestId: string) {
    const input = parseCustomerSignup(raw);
    await this.store.throttle(input.phone, "signup");
    if (!input.proof || !(await this.proofs.verify(input.phone, input.proof)))
      throw new ApplicationError("INVALID_CREDENTIALS", "Invalid verification code");
    return this.store.signup(
      {
        phone: input.phone,
        displayName: input.displayName,
        birthDate: input.birthDate,
      },
      requestId,
    );
  }
  async login(raw: unknown, previousToken: string | null, requestId: string) {
    const input = parseCustomerLogin(raw);
    await this.store.throttle(input.phone, "login");
    const valid = await this.proofs.verify(input.phone, input.proof);
    const identity = await this.store.credentials(input.phone);
    if (!valid || !identity || identity.status !== "active") {
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
  profile(token: string | null) {
    return this.store.profile(token);
  }
  update(token: string | null, raw: unknown, requestId: string) {
    return this.store.update(token, parseCustomerProfileUpdate(raw), requestId);
  }
}
