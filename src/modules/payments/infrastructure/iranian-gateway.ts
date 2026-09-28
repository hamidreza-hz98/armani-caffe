import "server-only";

import { ApplicationError } from "../../../shared/errors.ts";
import type { PaymentProvider } from "../application/provider.ts";
/** Deliberately disabled. Bind a named gateway only after official docs are approved. */
export class IranianGatewayPlaceholder implements PaymentProvider {
  readonly id = "iranian-gateway";
  readonly idempotentCreate = false;
  readonly callbackMethods: string[] = [];
  readonly callbackFields: string[] = [];
  readonly redirectOrigins: string[] = [];
  private unavailable(): never {
    throw new ApplicationError("UNAVAILABLE", "Iranian gateway adapter is not configured");
  }
  async create(): Promise<never> {
    return this.unavailable();
  }
  parseCallback(): never {
    return this.unavailable();
  }
  async verify(): Promise<never> {
    return this.unavailable();
  }
  async inquire(): Promise<never> {
    return this.unavailable();
  }
}
