# Inventory and stock approvals

Inventory owns integer base-unit balances, product consumption mappings, immutable movements, and stock requests. Items start at zero. No endpoint edits `onHand` directly; negative stock is always forbidden until an explicit owner policy is implemented later.

## Rollout

Back up data, stop stock writers during migration, and run explicitly:

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Migration 7 verifies existing balances against ledger totals. Legacy requests/movements lacking provenance or reconciliation fields require operator review; it never fabricates movements or decisions. Inventory writes fail closed until migration 7 is recorded. No request-time migrations or index sync occur.

Unique named indexes enforce request idempotency, movement idempotency, one movement per approval, and one reversal per original. Existing item/name, item/time, request/status/time, order/time, and product/item indexes remain. `inventory_order_receipts` uses native unique `_id` (order ID) for whole-manifest idempotency. Requests, movements, and receipts have no TTL. The application has no ledger mutation API; Mongoose hooks reject ledger update/delete/save changes. Privileged direct database operations can bypass these protections and must be restricted operationally.

## Units and permissions

Base units are `gram`, `milliliter`, and `piece`. Input additionally accepts `kilogram` and `liter`, with fixed 1000:1 conversions. Plain decimal strings/numbers allow up to three fractional digits; exact integer arithmetic rejects fractional base units, incompatible families, overflow, and arbitrary units. For example, `"0.025" kilogram` stores 25 grams. Item units cannot be changed.

OWNER creates/edits/archives items and approves/rejects requests. CASHIER reads inventory and requests purchases, signed corrections (`adjustment`), or negative waste. Only OWNER requests initial balances and reversals. Owner self-approval is allowed, including bootstrap balances; this is not a two-person approval policy. Decisions use the stored item, unit, delta, and reversal target, never a caller-supplied delta.

Purchase/initial quantities are positive; waste is negative; corrections have either nonzero sign. Initial balance requires an untouched zero-balance item, checked again on approval. A request remains pending if approval fails. Approved/rejected decisions are terminal; repeating the same decision returns the existing result without another movement/event. Changing a completed decision conflicts. Request idempotency keys bind actor and normalized payload; changed payloads or actors conflict.

Reversals specify only the original movement ID and apply its exact opposite once. Initial balances and reversals cannot themselves be reversed. Purchase reversal that would overdraw fails. Order consumption may use this same reversal workflow; future refund code must coordinate it to avoid double restoration. Archiving requires zero stock, no pending requests, and no active product rules; archive is terminal.

## HTTP

- `GET /api/inventory`: OWNER/CASHIER items with computed `stockStatus` (`available`, `low`, `out`).
- `POST /api/inventory`: OWNER `{ name, unit, reorderLevel? }`.
- `PATCH /api/inventory/[id]`: OWNER `{ revision, name?, reorderLevel?, status? }`.
- `GET /api/inventory/[id]/movements`: OWNER/CASHIER ledger.
- `GET /api/inventory/requests`: OWNER/CASHIER requests.
- `POST /api/inventory/requests`: `{ inventoryItemId, kind, quantity, unit, reason, idempotencyKey }`; reversal replaces quantity/unit with `reversalOf`.
- `POST /api/inventory/requests/[id]/decision`: OWNER `{ decision: "approved" | "rejected" }`.

Lists are bounded to 200 records (items by name, history newest first); paginated UI/search is a later task. No query-string filters are accepted yet. Mutations require exact configured Origin, bounded JSON, and verified admin sessions. Permissions are rechecked in write transactions. DTOs contain string IDs and UTC dates, not Mongoose documents or internal fingerprints. Request reason text is not logged/copied into audit or outbox payloads.

## Server ports and transactions

`createInventoryService` exposes a service and trusted repository. `replaceConsumptionRules(session, productId, rules)` requires an active caller transaction, validates unique mappings, active inventory, compatible units, and positive quantities, then replaces mappings atomically. The Product service must validate product identity, authorize, serialize edits, and audit its mutation in the same transaction; this is not a public standalone CRUD endpoint.

`consumeOrder(session, orderId, aggregatedQuantities, requestId)` requires an active caller transaction and has no HTTP endpoint. The Order service must validate the order and derive/snapshot quantities from trusted rules, never browser input. It deducts stock and records sale movements, audit, and outbox events in that transaction. A whole-order manifest makes retries idempotent and rejects changed item sets or quantities. Errors must abort the caller transaction; never catch a failed stock operation and commit partial changes.

Item writes serialize concurrent stock operations. Movement `before + delta = after` reconciles with current stock; the ledger is the audit source of truth. Every committed decision has correlated audit/domain events. Status transitions emit `inventory.threshold_changed` including previous/current status, quantity, and threshold; recovery and threshold edits are included. Failed transactions emit neither movements nor events. Existing outbox delivery is at-least-once; consumers must deduplicate and are not automatically started.

Audit/outbox append helpers use validated `insertMany` batches to avoid Mongoose save-document restoration errors when a later operation aborts the transaction.

## Tests

```sh
npx vitest run --project unit tests/unit/inventory.test.ts
npx vitest run --project integration tests/integration/inventory.test.ts
npm run test:e2e -- tests/e2e/inventory.spec.ts
```

Integration tests use an isolated real single-node MongoDB replica set and real OWNER/CASHIER sessions. They cover conversion, concurrent approval/retries, initial balances, corrections/waste, rejection, threshold events, reversals, insufficient stock, immutable ledger, stock-rule rollback, and transactional order consumption. The unrelated real-MinIO suite requires its local service.
