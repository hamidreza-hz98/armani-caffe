# ADR 0002: Mongoose database lifecycle

- Status: Accepted
- Date: 2026-09-27

## Context

The modular monolith stores transactional business data in MongoDB. Next.js development reloads modules repeatedly, and production workers process many requests. We need consistent schema validation, document versions, and explicit database change management.

## Decision

Use Mongoose 9 as the sole ODM in server-only infrastructure. Cache one connection promise per process on `globalThis`; reconnect after a closed or disconnected connection, and clear failed attempts so a later call can retry. Disable automatic index and collection creation and operation buffering. Do not connect while importing modules or building static pages.

Module adapters own business schemas and indexes. Database migrations and index changes run only through explicit CLI commands; normal requests never synchronize indexes or migrate data. Scripts are forward-only and versioned. Transactions require the local replica set or a compatible deployment.

## Consequences

Mongoose adds a runtime dependency and its MongoDB driver. It supplies schema casting/validation, timestamps, optimistic concurrency for selected documents, and transaction integration that would otherwise require custom driver code. Production must manage database backups, index rollout, credentials, and migration timing. No MongoDB credentials are embedded in source. The repository has no production connection profile yet; the local Compose defaults are development-only.

Potential failure modes include unavailable primary, transaction conflicts, duplicate keys, and expensive index builds. The connection helper fails rather than silently buffering. Index apply never drops existing indexes. Rollback is a new forward migration, not automatic reversal. If Mongoose is later replaced, module infrastructure adapters and this database boundary are the removal points; domain/application code remains unaffected.
