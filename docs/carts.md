# Customer carts and authoritative pricing

Carts own ephemeral selections, notes, and price snapshots, not catalog prices or stock reservations. Only verified customer sessions can access them. Admin cookies, identity headers, and caller-supplied customer IDs cannot select an owner. Session writes inside the cart transaction serialize operations with logout and rotation. Customers keep the same cart across sessions; guests are not supported in this phase.

## Rollout

Stop cart writers, back up existing data, then run these explicit commands:

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Migration 9 defaults notes and rejects ambiguous duplicate active carts, duplicate selections/additions, and oversized legacy carts for operator review. Resolve duplicates deliberately before applying the partial unique `cart_one_active_customer` index. Existing customer/status/update and TTL indexes remain. No requests create indexes or migrate data. The service fails closed until migration 9 is recorded.

## API

- `GET /api/customer/cart`: get or create the customer's active cart; refresh current prices/availability.
- `POST /api/customer/cart`: mutate using `{ cartId, revision, operation, ...fields }`.
- `POST /api/customer/cart/preview`: refresh all prices and availability using `{ cartId, revision }`.

Mutations use `operation: "add"` with `productId`, `additionIds`, and `quantity`; `"update"` with `itemKey`, `additionIds`, and absolute `quantity`; `"remove"` with `itemKey`; or `"notes"` with `notes`. Add/update may also carry a per-product `note` (maximum 300 characters), which is preserved in cart, order, invoice, and printable receipt snapshots. All fields are strict, so totals, discounts, ownership, and unknown fields are rejected. IDs are canonical lowercase ObjectId strings, not arbitrary values. JSON is limited to 16 KiB and mutations require the exact configured storefront Origin. Responses are safe-action envelopes with no-store caching and correlation IDs. Order-wide notes remain plain text, maximum 1,000 characters; render all notes as escaped text, never HTML.

## Storefront interaction

The menu opens a native mobile dialog for options, quantity, and per-product note. `GET /api/products/[id]/options` returns current public options and `POST` on the same URL quotes a validated selection from a fresh server catalog read. This quote is informational: the cart mutation reprices again and the browser never sends a price. The shared cart client queues writes serially, replays pending actions over the last confirmed response, retries a stale revision after one fresh read, and rolls back a failed operation. The fixed menu summary reserves safe-area space below content; `/cart` uses the same line controls for any selection, including additions, notes, and removal. There is no payment action on that page yet.

The response contains `id`, `revision`, `expiresAt`, `notes`, item snapshots, `pricing`, `issues`, `checkoutReady`, and `accepted`. Each item's key is the product ID followed by colon-separated, sorted addition IDs; derive it from the returned snapshot. At most 50 lines, 20 distinct additions per line, and 1–100 units per line are allowed. Adding an existing identical selection increments its quantity. Updating a line changes its absolute quantity; if the new selection matches another line, quantities merge subject to the same limit. Repeated writes with an old revision fail with CONFLICT; they do not apply twice. Missing item keys fail with NOT_FOUND.

## Pricing and issues

Every material change (including notes/removal), ordinary read, and checkout preview uses one bounded batch of product IDs, inside a MongoDB snapshot transaction. The public Product server projection supplies only current prices, names, lifecycle/category availability, and additions; the Inventory server projection supplies internal stock rules. There are no per-cart-item database calls. Products/additions/categories and stock rules/items use projected, bounded batch queries with time limits. Shared stock consumption is summed across all cart lines and products, including distinct addition selections. Nothing reserves or deducts stock at cart time.

All prices/totals are nonnegative safe integer تومان. The server derives base + selected additions, quantity × unit price, subtotal, and total. `discountToman` and `deliveryToman` remain exactly zero; promotions are not implemented. Arithmetic outside safe integer limits fails closed. Catalog and persisted cart prices are never accepted from browser input.

Structured issues are `PRODUCT_UNAVAILABLE`, `ADDITION_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `PRICE_CHANGED`, and `CART_EXPIRED`, with selection/addition identifiers where relevant. PRICE_CHANGED includes previous/current unit prices. Incoming unavailable products or additions reject the selection (`accepted: false`) while returning the refreshed existing cart. An excessive stock demand may remain in the cart with a blocking issue so the customer can reduce quantities. Existing unavailable selections are retained visibly, not silently removed. Missing products/additions retain their last snapshot prices, so totals are provisional whenever issues exist, not a payable quote.

A price refresh saves the updated snapshot and advances the revision. A changed-price response has `checkoutReady: false`; another preview of that returned revision acknowledges the current quote if no further changes occurred. Empty carts and any issue are not checkout-ready. A read can also acknowledge updated prices on a later request. Future order/payment creation must revalidate catalog, prices, stock, ownership, expiry and revision in its own transaction; `checkoutReady` is informational, never authorization or a reservation.

The 24-hour lifetime is fixed at creation, not extended by reads or edits. Logical expiry is checked even before MongoDB TTL cleanup. An expired mutation/preview returns CART_EXPIRED without creating a replacement; GET creates the next empty cart. Both cart ID and revision are required, preventing an old revision from targeting a new cart after expiry. All mutations use owner/status/expiry/revision conditional writes; the partial unique index handles concurrent first reads across different sessions, with bounded duplicate-create retries. Carts and their snapshots are ephemeral and do not modify historical Order/Invoice snapshots.

## Tests

```sh
npx vitest run --project unit tests/unit/cart.test.ts
npx vitest run --project integration tests/integration/carts.test.ts
npm run test:e2e -- tests/e2e/carts.spec.ts
```

The integration suite uses an isolated real MongoDB replica set and real customer authentication. It covers pricing/discounts, mutation flows, selection merging, availability, price refresh, conflicts, owner isolation, revoked sessions, logical/TTL expiry, bounded catalog calls and HTTP origins. E2E verifies production route guards; no development cart data is touched.
