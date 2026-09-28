# Orders and atomic confirmation (Task 21)

Run explicit `npm run db:migrate:up -- --apply` and `npm run db:indexes:apply -- --apply` before rollout. Migration **11** normalizes existing status spellings, initializes the counter above existing codes and rebuilds the confirmed-sales projection. Invalid legacy codes stop migration for operator reconciliation. Requests never migrate data. No dependency was added.

## Checkout and financial truth

An authenticated customer submits only `{cartId,revision,idempotencyKey}` to `POST /api/checkout`. Inside a snapshot/majority MongoDB transaction the service re-reads current products/additions, aggregates compatible stock demands, rejects stale pricing/unavailable items and freezes customer/item/addition/category/pricing/notes/consumption snapshots in `checkout_intents`. The cart becomes `payment_pending`. The checkout ID reserves the future order ID; payment `orderId` references that durable intent until fulfillment. No unpaid order is created. Discount/delivery are zero; clients cannot submit prices or totals.

Pending carts have no TTL timestamp: delayed payments must not lose their quote. Another active cart may be created; frozen carts cannot be edited. Unique customer/key and cart indexes prevent duplicate checkout. Repeating the original command resumes provider creation without replacing the snapshot. Network ambiguity retains intent/payment for inquiry, never silent gateway fallback. Definitively failed payments retain their frozen intent for financial history; customers can start a fresh active cart. Never auto-delete pending intents or treat ambiguity as definitive failure.

```text
customer cart → frozen checkout → provider creation → authoritative verification
                                                    ↓ MongoDB transaction
payment succeeded + unique NEW order + AC counter + stock ledger + sold projection
                  + cart checked_out/cleared + required audit/outbox → commit
```

The payment settlement hook runs in the same transaction that persists success. Confirmation locks authoritative financial evidence and matches checkout/amount/reference. All stock lines are checked before any deduction; write conflicts retry the whole transaction. Counter, order, inventory receipt/movements, sold counts, cart and required events commit together or roll back. Unique checkout/cart/transaction IDs and inventory receipts protect retries. No network calls occur inside fulfillment transactions. A crashed verifier's claim remains leased for 30 seconds; trusted `payment:inquire` after expiry re-verifies and retries. Browser fields cannot confirm orders.

If stock becomes insufficient, inactive or incompatible, commit **payment succeeded + RECOVERY_REQUIRED** plus audit/outbox, but no order, counter, partial deduction or cart clearing. Frozen quote/manifest never change. OWNER replenishes via approvals then retries, or requests a refund. Missing frozen carts yield `CART_UNAVAILABLE` and require reconciliation/refund, never substitution with another cart.

## Lifecycle, cancellation and refunds

```text
NEW → PREPARING → READY → COMPLETED
 │        │
 └────────┴→ CANCELLED (OWNER + reason)
```

CASHIER can read/progress the normal sequence. Customers read only their own orders. Skips, terminal transitions, stale versions and forged actors fail. NEW cancellation reverses sale movements exactly once; PREPARING cancellation does **not** restock consumed materials. READY/COMPLETED cannot be cancelled; recoverable materials require a separate approved inventory correction. Cancellation decrements sold counts but never changes snapshots, totals or financial reference.

OWNER alone can request refund of a cancelled paid order or paid recovery intent with reason/revision. This emits `payment.refund_requested`, not a financial success flag. A trusted adapter/reconciliation worker must obtain authoritative provider evidence and persist transaction `refunded` before calling server-only `reconcileRefund`. Reconciliation checks identity/amount/requested branch, is idempotent and emits `order.refunded`. Iranian adapters remain disabled. There is no browser/admin “mark refunded” endpoint and no automatic gateway refund worker; executing refunds remains the documented provider-adapter extension point.

## HTTP, indexes and retention

Customer: `GET /api/checkout/[id]`, `GET /api/customer/orders`, `GET /api/customer/orders/[id]`. Admin: `GET /api/admin/orders`, `GET /api/admin/orders/[id]`, `POST .../[id]/status`, `POST .../[id]/refund`. Owner recovery: `GET /api/admin/orders/recovery`, `POST .../recovery/[id]/retry` with `{}`, `POST .../recovery/[id]/refund` with `{revision,reason}`. Mutation origins are allowlisted, bodies bounded, responses no-store with correlated Persian errors. Lists return at most 50 in indexed stable order; pagination is a future contract extension.

Snapshot/notes/customer-ID schema fields are immutable; application writes whitelist status/refund metadata and version. DTOs never expose persistence documents, stock rules, costs, password/session fields or idempotency keys. Customer snapshots are private to authenticated customer/admin reads; logs/events carry IDs only, never names/phones/notes/secrets. Confirmed paid orders contribute sold counts immediately (NEW through COMPLETED), cancelled orders do not. `order_sales_projection` updates transactionally; catalog's bounded indexed order aggregation is the reconciliation-safe read projection.

Unique indexes: code, checkout/cart/transaction, order idempotency, intent customer/key/cart and transaction. Recovery uses state/updatedAt; order lists use customer/status/paymentStatus and placedAt; sales uses items.productId/paymentStatus/status. Counter/projection use unique `_id`. Retain orders/intents/payment links and ledger for financial history; closed carts have 24-hour TTL. Migration never invents missing customer/pricing/payment evidence; incomplete historical records require explicit reconciliation before the new workflow.

## Tests

`npx vitest run --project integration tests/integration/orders.test.ts` uses an isolated real MongoDB replica set, real authentication/inventory approvals and deterministic fake-provider evidence. Covers duplicate callbacks/24 retries, competing claims, rollback at late outbox append, recovery, immutable catalog/customer/stock snapshots, authorization, versions/statuses, cancellation reversals and authoritative refund reconciliation. Unit tests cover codes/pricing/commands; Playwright checks guarded production routes. The separate MinIO integration suite still requires real local MinIO/Docker.
