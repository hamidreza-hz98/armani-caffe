import type { CategoryCreate, CategoryReorder, CategoryUpdate } from "../contracts/category.ts";
import type { Category } from "../domain/model.ts";

export interface CategoryRepository {
  publicList(): Promise<Category[]>;
  adminList(token: string | null): Promise<{ items: Category[]; orderRevision: number }>;
  detail(token: string | null, id: string): Promise<Category>;
  create(token: string | null, input: CategoryCreate, requestId: string): Promise<Category>;
  update(
    token: string | null,
    id: string,
    input: CategoryUpdate,
    requestId: string,
  ): Promise<Category>;
  delete(token: string | null, id: string, revision: number, requestId: string): Promise<void>;
  reorder(
    token: string | null,
    input: CategoryReorder,
    requestId: string,
  ): Promise<{ items: Category[]; orderRevision: number }>;
}
