# Database lifecycle and conventions

Mongoose is used only inside server-only infrastructure. Importing a model or helper does not open MongoDB. `getDatabaseConnection()` opens lazily, caches concurrent requests across Next.js development reloads in the same process, reuses a healthy connection, and retries after an initial failure or a closed/disconnected connection. Mongoose handles transient driver reconnection while connected. Commands must explicitly call the connection helper.

## Document conventions

- Use `documentSchemaOptions()` for timestamps (`createdAt`, `updatedAt` as BSON UTC `Date`), `__v` version keys, strict schemas, no operation buffering, and no automatic index/collection creation.
- Enable `optimisticConcurrency` for mutable aggregates where lost updates matter (for example carts, stock balances, or order state). Do not assume it protects raw `updateOne()` operations; use conditional updates and transactions there.
- Store monetary amounts as **non-negative safe integers in تومان**, with field names ending in `Toman`. The shared `Money` primitive uses `amountToman`. No floating-point currency amounts or silent rial conversion.
- Normalize Iranian mobile numbers to `+989XXXXXXXXX` at input boundaries using `normalizeIranianMobile()`; the schema field setter is a second defense. Never log raw contact details.
- Soft deletion is **opt-in** through `addSoftDelete()`, only for entities whose business history requires tombstones. Audits, invoices, payments, and orders should preserve immutable history instead of being casually deleted. Callers must explicitly include or exclude `deletedAt` in queries; no hidden global query filter exists.
- Declare indexes in owning module schemas or the operational index registry, with stable names and query justification. Do not rely on implicit `unique` schema flags as a deployment migration.
- Use `withDatabaseTransaction()` for multi-document business changes. Operations inside one transaction must use its session and should not run in parallel.
- Use `applyPagination()` with a stable indexed sort and a bounded page size (1–100). Offset pagination is for bounded lists; future large feeds should use cursor pagination.
- Map MongoDB duplicate-key code 11000 to a `CONFLICT` application error without returning the duplicate value.

## Current explicit indexes

| Collection           | Index                                           | Purpose                  |
| -------------------- | ----------------------------------------------- | ------------------------ |
| `_schema_migrations` | `_id` (MongoDB default)                         | Unique migration version |
| `_schema_migrations` | `migration_applied_at` on `appliedAt` ascending | Operational history      |
| `_seed_runs`         | `_id` (MongoDB default)                         | Idempotent seed identity |
| `_seed_runs`         | `seed_created_at` on `createdAt` ascending      | Operational history      |

Business collections and their indexes will be added with their owning modules. `db:indexes:plan` lists desired indexes without connecting. `db:indexes:apply -- --apply` creates/ensures declared indexes but **never drops** unexpected indexes. Review index changes and arrange a backup before production application; removal needs its own reviewed migration.

## Local commands

Start the local MongoDB replica set as described in [local infrastructure](local-infrastructure.md), then use:

```bash
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
npm run db:seed -- --apply
npm run db:smoke -- --apply
```

`migrate:status` is read-only. Migrations under `src/server/database/migrations/` are numbered, forward-only, and applied once with a transaction and ledger entry. `seed` is development/test-only, requires a loopback MongoDB host, and idempotently records `baseline-v1`; it creates no admin account, sample customer, or real credential. `smoke` has the same host/mode guard, writes a temporary document in a transaction, verifies commit, and removes it. Every mutating command requires `--apply`; none runs on application startup or during ordinary requests. The CLI reads ignored `.env.local` and honors already-set process environment values. Use a real backup/change window before production migration or index application.
