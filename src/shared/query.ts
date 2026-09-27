import { ApplicationError } from "./errors.ts";
import { type Pagination, pagination } from "./pagination.ts";

export type ListQuery<Sort extends string, Filter extends string> = Readonly<{
  pagination: Pagination;
  sort: Sort;
  direction: "asc" | "desc";
  filters: Readonly<Partial<Record<Filter, string>>>;
}>;

export function parseListQuery<Sort extends string, Filter extends string>(
  params: URLSearchParams,
  options: { sorts: readonly Sort[]; defaultSort: Sort; filters: readonly Filter[] },
): ListQuery<Sort, Filter> {
  const allowed = new Set(["page", "pageSize", "sort", "direction", ...options.filters]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length > 1) {
      throw new ApplicationError("VALIDATION", `Invalid or repeated query field: ${key}`);
    }
  }
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  let parsedPagination: Pagination;
  try {
    parsedPagination = pagination(page, pageSize);
  } catch (cause) {
    throw new ApplicationError("VALIDATION", "Invalid pagination", { cause });
  }
  const sort = params.get("sort") ?? options.defaultSort;
  if (!options.sorts.includes(sort as Sort))
    throw new ApplicationError("VALIDATION", "Invalid sort");
  const direction = params.get("direction") ?? "desc";
  if (direction !== "asc" && direction !== "desc") {
    throw new ApplicationError("VALIDATION", "Invalid sort direction");
  }
  const filters: Partial<Record<Filter, string>> = {};
  for (const key of options.filters) {
    const value = params.get(key);
    if (value !== null) {
      if (value.length > 100) throw new ApplicationError("VALIDATION", `Filter too long: ${key}`);
      filters[key] = value;
    }
  }
  return { pagination: parsedPagination, sort: sort as Sort, direction, filters };
}
