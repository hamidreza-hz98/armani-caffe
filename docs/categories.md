# Categories

Task 16 implements category CRUD and atomic ordering in the Catalog/Categories module. `draft` means inactive; only `published` and non-deleted categories appear in the public storefront list. Slugs are generated on the server from normalized Persian/Arabic text and ASCII digits. Collisions receive `-2`, `-3`, etc. A name edit keeps the existing slug so links remain stable; callers cannot supply a slug or display order.

## Rollout

Back up existing MongoDB data. Apply migration 6 and indexes explicitly during a change window:

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Migration 6 creates `category_order_guard`, normalizes existing non-deleted orders to `0…n-1`, and backfills safe category media references. It refuses more than 500 existing categories, invalid sort values, or media that is not ready/public. A category write fails closed if the guard has not been initialized. No migration or index sync runs on request startup.

## HTTP and authorization

- `GET /api/categories/public`: public, published-only list sorted by `sortOrder`, then ID.
- `GET /api/categories` and `GET /api/categories/[id]`: authenticated OWNER or CASHIER reads. The list includes `orderRevision`.
- `POST /api/categories`: OWNER only; `{ name, status?, mediaId? }`. New categories append at the end and default to `draft`.
- `PATCH /api/categories/[id]`: OWNER only; `{ revision, name?, status?, mediaId? }`. At least one field must change.
- `DELETE /api/categories/[id]`: OWNER only; `{ revision }`. Soft-deletes only when no non-deleted product references the category. Product reassignment is **not** implemented; an owner must resolve product dependencies explicitly before retrying.
- `POST /api/categories/reorder`: OWNER only; `{ revision: orderRevision, ids: [all active category IDs in desired order] }`. The full set is required.

Mutations require exact configured `Origin`, bounded JSON, and a verified admin session. The capability map gives CASHIER `catalog.read` but not `catalog.manage`; both the route and service enforce the policy. Public DTOs omit persistence internals and show only non-deleted published categories. Admin DTOs include draft categories and document revisions.

Future product-create and category-reassignment services must verify the target category and coordinate with the category order guard in their transaction. Until those services exist, category deletion checks every non-deleted product reference and refuses to proceed when one is present; direct database writes are outside the supported application workflow.

Every mutation locks and advances one order-guard document inside the same MongoDB transaction as category changes, audit, and outbox messages. Reorder compares its supplied guard revision before updating positions; competing reorders cannot both commit. Creation appends; deletion compacts positions. The invariant is a stable contiguous sequence across all non-deleted categories, including drafts. A transaction emits a category domain event plus `catalog.categories.changed`, which future storefront cache consumers can use for invalidation. No event is emitted on rollback. The current public HTTP response uses `no-store`; this task does not claim a cache consumer is already running.

An optional `mediaId` must reference a ready, public Media asset. The media asset guard and category usage reference are updated in the category transaction; Media deletion detects the reference. Generic Media replacement refuses category usages, so an owner changes the category image through `PATCH` first. This prevents a replacement from deleting an asset while leaving a category pointed at it.

Focused checks: `npx vitest run --project unit tests/unit/categories.test.ts`, `npx vitest run --project integration tests/integration/categories.test.ts`, and `npm run test:e2e`. The aggregate integration suite additionally requires a real MinIO service.
