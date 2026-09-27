# ADR 0001: Local MongoDB, Redis, and MinIO

- Status: Accepted for local development
- Date: 2026-09-27
- Owners: Armani Caffe project

## Context

Upcoming application work needs MongoDB transactions, durable queue storage, and S3-compatible private media storage. These services must be reproducible on developer machines without adding them to the Next.js process.

## Decision

Use Docker Compose for three local services: a single-node MongoDB replica set named `rs0`, Redis with an append-only file and one-second fsync, and MinIO with a named data volume. Keep MongoDB and MinIO initialization as one-shot services. The MinIO step creates a private bucket and configures server-wide allowed origins because community MinIO does not support bucket-specific CORS. Bind exposed ports to `127.0.0.1`. The Next.js app continues to run on the host.

Image tags are pinned to MongoDB 8.0.30, Redis 8.2.9, MinIO 2025-09-07, and MinIO Client 2025-08-13. The MinIO community image is archived, so this choice is limited to local development and must be reviewed before any production design.

## Alternatives considered

- Host-installed services: harder to reproduce across developer machines.
- MongoDB standalone: cannot exercise transactions.
- Redis without persistence: unsuitable for queue restart tests.
- Browser or filesystem storage: does not exercise the intended S3-compatible workflow.

## Consequences

Developers need Docker Desktop or Docker Engine with Compose. Redis AOF with `appendfsync everysec` may lose up to about one second of writes on a host crash; it is not a backup or high-availability design. The single-node MongoDB replica set is not highly available. Local MongoDB and Redis have no authentication, and MinIO uses explicitly unsafe development defaults unless overridden. All ports bind to the local loopback interface. Volumes retain data until an explicit `down --volumes`.

## Dependencies

| Service or image | Why it exists                                               | Platform alternative                       |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Docker Compose   | Repeatable local service lifecycle and named volumes        | Manual host installations                  |
| MongoDB          | Transaction-capable document database                       | No built-in equivalent                     |
| Redis            | Queue persistence and restart behavior                      | In-process queue loses work on restart     |
| MinIO and mc     | Local S3-compatible private media bucket and initialization | Local filesystem does not test S3 behavior |

No npm infrastructure client package is added by this decision. Add clients only when application code first needs them.
