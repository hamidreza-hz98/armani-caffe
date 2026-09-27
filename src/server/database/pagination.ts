import "server-only";

import { pagination } from "../../shared/pagination.ts";

export function applyPagination<T extends { skip(value: number): T; limit(value: number): T }>(
  query: T,
  page = 1,
  pageSize = 20,
): { query: T; pagination: ReturnType<typeof pagination> } {
  const request = pagination(page, pageSize);
  return { query: query.skip(request.skip).limit(request.pageSize), pagination: request };
}
