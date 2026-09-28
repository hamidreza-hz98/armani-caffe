import {
  checkoutCommand,
  orderId,
  refundCommand,
  transitionCommand,
} from "../contracts/commands.ts";
import type { CheckoutView, OrderView } from "../domain/confirmation.ts";
export interface OrderOperations {
  checkout(
    token: string | null,
    command: ReturnType<typeof checkoutCommand>,
    requestId: string,
  ): Promise<CheckoutView>;
  checkoutView(token: string | null, id: string): Promise<CheckoutView>;
  confirm(transactionId: string, requestId: string): Promise<CheckoutView>;
  list(token: string | null, customer: boolean): Promise<OrderView[]>;
  detail(token: string | null, id: string, customer: boolean): Promise<OrderView>;
  transition(
    token: string | null,
    id: string,
    command: ReturnType<typeof transitionCommand>,
    requestId: string,
  ): Promise<OrderView>;
  refund(
    token: string | null,
    id: string,
    command: ReturnType<typeof refundCommand>,
    requestId: string,
    recovery: boolean,
  ): Promise<CheckoutView | OrderView>;
}
export class OrderService {
  private readonly repository: OrderOperations;
  constructor(repository: OrderOperations) {
    this.repository = repository;
  }
  checkout(token: string | null, input: unknown, requestId: string) {
    return this.repository.checkout(token, checkoutCommand(input), requestId);
  }
  checkoutView(token: string | null, id: unknown) {
    return this.repository.checkoutView(token, orderId(id));
  }
  confirm(transactionId: unknown, requestId: string) {
    return this.repository.confirm(orderId(transactionId), requestId);
  }
  list(token: string | null, customer = false) {
    return this.repository.list(token, customer);
  }
  detail(token: string | null, id: unknown, customer = false) {
    return this.repository.detail(token, orderId(id), customer);
  }
  transition(token: string | null, id: unknown, input: unknown, requestId: string) {
    return this.repository.transition(token, orderId(id), transitionCommand(input), requestId);
  }
  requestRefund(
    token: string | null,
    id: unknown,
    input: unknown,
    requestId: string,
    recovery = false,
  ) {
    return this.repository.refund(token, orderId(id), refundCommand(input), requestId, recovery);
  }
}
