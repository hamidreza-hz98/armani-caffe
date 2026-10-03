# Critical test matrix

This matrix tracks behavior rather than implementation details. Every row has a success case and a fail-closed or rollback case. The referenced suites are the minimum regression set; `npm run test:coverage` produces the combined report in `coverage/`.

| Critical path                        | Positive proof                                                             | Negative / boundary proof                                                                                                         | Real integration boundary                                           |
| ------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Integer Toman and cart pricing       | Current product and ordered addition prices produce the snapshot and total | Fractional/caller-owned totals, duplicates, unavailable choices, overflow, and changed prices are rejected or surfaced            | Mongo replica-set cart and checkout repositories                    |
| Lifecycle state machines             | Product publication and valid order/payment transitions succeed            | Skips, terminal rewrites, forged revisions, callback-only success, and amount/reference mismatch fail                             | Mongo transactions in products, payments, and orders suites         |
| Capabilities and sessions            | OWNER/CASHIER/customer operations exercise their allowed surface           | Missing, forged, cross-role, revoked, CSRF, and final-owner operations fail closed                                                | Auth/admin/customer Mongo suites and HTTP contracts                 |
| Iranian mobile and Jalali dates      | Persian/Latin mobile forms normalize; Gregorian/Jalali values round-trip   | Invalid carrier shape, impossible dates, leap-day and supported-range boundaries fail                                             | Unique Mongo phone index and UTC-midnight schema validation         |
| Product additions and stock mappings | Ordered additions and compatible consumption mappings update atomically    | Duplicate/foreign additions, incompatible units, stale revisions, and incomplete publication fail                                 | Product and inventory Mongo transactions                            |
| Inventory ledger                     | Approval creates one immutable movement and reconciled balance             | Duplicate approval, overdraft, unit mismatch, direct ledger edits, invalid reversal, and transaction failure fail                 | Mongo replica-set contention and rollback tests                     |
| Transaction/order idempotency        | Repeated callbacks and confirmation return one transaction/order/invoice   | Concurrent confirmation, outbox failure, shortage, reference reuse, and stale cart roll back safely                               | Mongo replica-set payment/order suites                              |
| Invoice rendering                    | Stable Persian/mixed-direction HTML and 58/80mm raster output              | Mismatched totals, unsafe HTML/font, bad dimensions, and regenerated snapshots fail                                               | Persisted invoice and printing pipeline suites                      |
| Audit and outbox                     | Domain, audit, and outbox commit together; one worker owns a lease         | Rollback, stale lease, retry, poison/dead event, replay, and secret redaction paths fail safely                                   | Mongo replica-set outbox suite                                      |
| Durable print queue                  | Sorted jobs and presence leases survive Redis adapter restart              | Owner mismatch, duplicate presence, bounded reads, and expired leases fail safely                                                 | Real Redis with isolated random prefix                              |
| Media safety                         | Detected images normalize to exact private immutable variants              | MIME spoofing, traversal, foreign ownership, invalid descriptors, oversize images, partial upload, and interrupted multipart fail | Real MinIO with isolated private bucket plus Mongo media references |

## Determinism and parallelism

- Unit/client tests use fixed clocks, deterministic IDs where identity matters, and no shared external state.
- Mongo integration uses a single-worker project because transaction suites intentionally mutate isolated databases; every suite uses a unique database and drops it after completion.
- Redis keys and MinIO buckets include random run-specific names. Cleanup is restricted to those names.
- Payment fakes are deterministic ledgers. Network timeouts use bounded abort signals rather than wall-clock sleeps.
- Run unit/client tests twice when changing pure domain logic. Run the full integration suite twice after changing transactions, leases, retries, or storage cleanup.

## Review rule

A changed critical branch requires both its successful outcome and its failure/rollback outcome. A low line percentage in route composition or framework glue is acceptable only when the underlying service, contract, authorization boundary, and real adapter are represented above. Missing behavior in any row is a release blocker regardless of aggregate percentage.
