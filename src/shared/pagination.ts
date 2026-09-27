export type Pagination = Readonly<{ page: number; pageSize: number; skip: number }>;

export function pagination(page = 1, pageSize = 20): Pagination {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("Page must be a positive integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RangeError("Page size must be between 1 and 100");
  }
  const skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skip)) throw new RangeError("Pagination offset is too large");
  return Object.freeze({ page, pageSize, skip });
}
