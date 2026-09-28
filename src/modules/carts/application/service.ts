import { ApplicationError } from "../../../shared/errors.ts";
import type { TransactionContext } from "../../../shared/security-ports.ts";
import { cartId, type CartMutation, cartRevision, parseCartMutation } from "../contracts/cart.ts";
import type { CartView } from "../contracts/view.ts";
import type { CatalogPrice } from "../domain/pricing.ts";
export type { CartView } from "../contracts/view.ts";

export type CartPorts = {
  authorize: (token: string | null, tx: TransactionContext) => Promise<{ id: string }>;
  catalog: (ids: string[], tx: TransactionContext) => Promise<Map<string, CatalogPrice>>;
};
export interface CartRepository {
  execute(
    token: string | null,
    operation: "read" | "preview" | CartMutation,
    version?: { revision: number; cartId: string },
  ): Promise<CartView>;
}
export class CartService {
  private readonly repository: CartRepository;
  constructor(repository: CartRepository) {
    this.repository = repository;
  }
  read(token: string | null) {
    return this.repository.execute(token, "read");
  }
  mutate(token: string | null, input: unknown) {
    return this.repository.execute(token, parseCartMutation(input));
  }
  preview(token: string | null, input: unknown) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 2 ||
      !("revision" in input) ||
      !("cartId" in input)
    )
      throw new ApplicationError("VALIDATION", "Invalid preview input");
    return this.repository.execute(token, "preview", {
      revision: cartRevision(input.revision),
      cartId: cartId(input.cartId),
    });
  }
}
