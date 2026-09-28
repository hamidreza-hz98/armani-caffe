import {
  categoryId,
  parseCategoryCreate,
  parseCategoryDelete,
  parseCategoryReorder,
  parseCategoryUpdate,
} from "../contracts/category.ts";
import type { CategoryRepository } from "./types.ts";

export class CategoryService {
  private readonly repository: CategoryRepository;
  constructor(repository: CategoryRepository) {
    this.repository = repository;
  }
  publicList() {
    return this.repository.publicList();
  }
  adminList(token: string | null) {
    return this.repository.adminList(token);
  }
  detail(token: string | null, id: unknown) {
    return this.repository.detail(token, categoryId(id));
  }
  create(token: string | null, input: unknown, requestId: string) {
    return this.repository.create(token, parseCategoryCreate(input), requestId);
  }
  update(token: string | null, id: unknown, input: unknown, requestId: string) {
    return this.repository.update(token, categoryId(id), parseCategoryUpdate(input), requestId);
  }
  delete(token: string | null, id: unknown, input: unknown, requestId: string) {
    return this.repository.delete(
      token,
      categoryId(id),
      parseCategoryDelete(input).revision,
      requestId,
    );
  }
  reorder(token: string | null, input: unknown, requestId: string) {
    return this.repository.reorder(token, parseCategoryReorder(input), requestId);
  }
}
