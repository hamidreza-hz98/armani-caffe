# Products and additions

Products own catalog presentation, lifecycle, integer toman prices, ordered optional additions, and category/image references. Inventory owns consumption rules and stock. Orders own the immutable sale history used for sold-count projection. The cross-module composition root is `src/server/catalog/products.ts`: it connects only public server boundaries and avoids circular category/media/product dependencies. Routes import this server-only facade; they never import persistence adapters.

## Rollout

Back up existing data, stop catalog writers, then explicitly run:

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Migration 8 fills missing excerpts from description (first 300 characters), defaults ingredients, compacts addition ordering, and backfills image usage references. It refuses orphan categories, unsafe images, incomplete published products, excessive additions, or invalid published stock mappings. No request-time migration/index synchronization occurs. Product writes/menu/detail fail closed until rollout is recorded. Named indexes include category/status/availability/order, product slug uniqueness, addition/product/availability/order, addition media usage, and order/product/payment/status for sold counts.

## Contracts

- `GET /api/products`: OWNER/CASHIER admin list, newest first, maximum 200 records.
- `GET /api/products/[id]`: admin detail with at most 40 additions, current consumption rules and sold count; malformed legacy over-cap data returns 409 rather than a partial list.
- `POST /api/products`: OWNER creates a draft; `{ name, categoryId, basePriceToman?, description?, excerpt?, ingredients?, mediaIds?, available?, sortOrder?, additions?, consumptionRules? }`.
- `PATCH /api/products/[id]`: OWNER edits the same fields with required `revision`; at least one field must change.
- `POST /api/products/[id]/publish`, `/unpublish`, `/archive`: OWNER explicit transitions; `{ revision }`.
- `GET /api/products/menu`: public category-grouped menu, published categories/products only, maximum 500 products and 5,000 available additions; over-cap data returns 409 rather than a partial list.

Mutations require exact configured Origin, bounded JSON, verified admin capability inside the transaction, and optimistic product revision. CASHIER has catalog reads only. Slugs are generated server-side using Persian-aware normalization and collision suffixes; name edits preserve links. Clients cannot set slug, status, sold count, internal cost fields or database metadata. Prices are nonnegative safe integers in toman; published base price must be positive.

Draft → published, published → draft, and either → archived are explicit. Archived products cannot be edited or silently restored. Publishing needs a name, excerpt, positive price, ready/public primary image, a published category, and valid active stock mappings. Empty mappings deliberately mean a non-stock-tracked product; insufficient stock prevents ordering, not publication. A product with `available: false` remains visible with `orderable: false`. No delete endpoint exists. Archive retains category/media/addition history and releases current consumption rules. Retained archived product references still protect category and media deletion.

## Additions, rules, and references

An addition is `{ id?, name, priceToman, available?, mediaId? }`. Array order defines contiguous zero-based display positions. New entries omit ID; existing entries retain their own product's ID when reordered/edited. Foreign IDs and duplicate IDs/names fail. The complete additions array replaces the current set atomically; unavailable additions stay in admin data but are omitted from the public menu. Images are optional and must be ready/public when provided. At most 40 additions/images per product and 100 unique consumption mappings are accepted.

A consumption rule is `{ inventoryItemId, quantity, unit }`. The Inventory port validates fixed compatible unit families and stores exact integer base-unit quantities. A supplied complete rule array replaces current mappings in the product transaction. Product metadata, addition ordering, media usage references, inventory mappings, audit and outbox all commit together or roll back together. Failure leaves no partial addition reorder or rule changes. Product revisions serialize stale edits; the Category guard serializes product creation/reassignment with category deletion. It also advances category order revision, so clients should reload before reordering categories after catalog edits.

Product and addition media references have separate fields (`mediaIds` and `additionMediaIds`) under the product entity. Asset guards prevent attaching images concurrently with deletion. Media usage fallback queries both actual product images and addition images, including legacy links. Deliberate Media replacement updates both and advances parent product revisions so concurrent edits cannot overwrite it. Generic replacement emits `media.replaced`; future cache consumers must invalidate affected catalog data on that event too. Product edits themselves emit `catalog.products.changed` in the same transaction as their domain event and audit.

## Public projection and historical safety

The menu uses batch, indexed queries in one snapshot transaction: active categories, projected product fields, available additions, stock availability and confirmed-paid order counts. In-memory keyed grouping avoids per-product database queries. Public payloads explicitly allowlist names/slugs, excerpts, ingredients, prices, image IDs, optional additions, orderability and sold counts. They contain no stock quantities/mappings, costs, revisions, deletion timestamps or admin fields. Logical public Media remains in a private bucket and is read through the existing safe Media routes.

Task 21 defines `soldCount` as paid confirmed units (NEW, PREPARING, READY, COMPLETED); cancelled, unpaid, pending or refunded orders do not contribute. It is derived live, never writable catalog input; confirmation/cancellation also maintain an atomic projection. Product edits and archival never update Order/Invoice collections. Snapshots retain copied names, additions, prices and totals even if current additions are removed. Checkout uses its own authoritative price/stock validation and transaction; menu orderability is not a reservation. See [orders](orders.md).

Current menu HTTP responses use `no-store`. Transactional invalidation events are published to the existing outbox, but a cache consumer is not started automatically. Future storefront caching must also react to category changes, media replacement, inventory threshold changes, and order/payment changes that affect sold counts.

## Tests

```sh
npx vitest run --project unit tests/unit/products.test.ts
npx vitest run --project integration tests/integration/products.test.ts
npm run test:e2e -- tests/e2e/products.spec.ts
```

Integration tests use isolated MongoDB replica sets and real OWNER/CASHIER sessions. Coverage includes transitions, Persian slug collisions, publication prerequisites, addition/rule atomicity, concurrent revisions, stock-aware public payloads, historical snapshots, media references, migration safety and category-delete races. The unrelated real-MinIO suite still requires its local service.
