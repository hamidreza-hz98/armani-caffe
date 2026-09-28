export interface InventoryOperations {
  list(token: string | null): Promise<unknown>;
  movements(token: string | null, id: unknown): Promise<unknown>;
  requests(token: string | null): Promise<unknown>;
  create(token: string | null, input: unknown, requestId: string): Promise<unknown>;
  update(token: string | null, id: unknown, input: unknown, requestId: string): Promise<unknown>;
  request(token: string | null, input: unknown, requestId: string): Promise<unknown>;
  decide(token: string | null, id: unknown, input: unknown, requestId: string): Promise<unknown>;
}
/** All inventory mutations pass through an authorization-enforcing transactional port. */
export class InventoryService {
  private readonly repository: InventoryOperations;
  constructor(repository: InventoryOperations) {
    this.repository = repository;
  }
  list(token: string | null) {
    return this.repository.list(token);
  }
  movements(token: string | null, id: unknown) {
    return this.repository.movements(token, id);
  }
  requests(token: string | null) {
    return this.repository.requests(token);
  }
  create(token: string | null, input: unknown, requestId: string) {
    return this.repository.create(token, input, requestId);
  }
  update(token: string | null, id: unknown, input: unknown, requestId: string) {
    return this.repository.update(token, id, input, requestId);
  }
  request(token: string | null, input: unknown, requestId: string) {
    return this.repository.request(token, input, requestId);
  }
  decide(token: string | null, id: unknown, input: unknown, requestId: string) {
    return this.repository.decide(token, id, input, requestId);
  }
}
