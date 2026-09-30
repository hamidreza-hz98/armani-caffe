import type { MenuCategory } from "../contracts/menu.ts";
import type { ProductFields } from "../contracts/product.ts";
import { parseProduct, parseRevision, productId } from "../contracts/product.ts";
export interface ProductRepository {
  list(token: string | null): Promise<unknown>;
  detail(token: string | null, id: string): Promise<unknown>;
  menu(): Promise<MenuCategory[]>;
  write(
    token: string | null,
    id: string | null,
    fields: Partial<ProductFields>,
    revision: number | undefined,
    requestId: string,
  ): Promise<unknown>;
  transition(
    token: string | null,
    id: string,
    revision: number,
    status: "draft" | "published" | "archived",
    requestId: string,
  ): Promise<unknown>;
}
export class ProductService {
  private readonly repository: ProductRepository;
  constructor(repository: ProductRepository) {
    this.repository = repository;
  }
  list(token: string | null) {
    return this.repository.list(token);
  }
  detail(token: string | null, id: unknown) {
    return this.repository.detail(token, productId(id));
  }
  menu() {
    return this.repository.menu();
  }
  create(token: string | null, raw: unknown, requestId: string) {
    return this.repository.write(token, null, parseProduct(raw), undefined, requestId);
  }
  update(token: string | null, id: unknown, raw: unknown, requestId: string) {
    const { revision, ...fields } = parseProduct(raw, true);
    return this.repository.write(token, productId(id), fields, revision, requestId);
  }
  transition(
    token: string | null,
    id: unknown,
    raw: unknown,
    status: "draft" | "published" | "archived",
    requestId: string,
  ) {
    return this.repository.transition(token, productId(id), parseRevision(raw), status, requestId);
  }
}
