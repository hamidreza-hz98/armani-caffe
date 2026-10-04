# Reliability and recovery runbook

This runbook is for the single-node local stack and a planned maintenance window. It is not a high-availability or point-in-time-recovery design. Keep backups **outside the repository and Docker volumes**, encrypted, access-controlled, and periodically restore-tested. Do not put `.env.local`, bridge credentials, receipts, archives, or journal contents in Git. Record the code commit, migration status, backup timestamp, MongoDB replica-set name, MinIO bucket, and bridge printer ID with each backup.

## Failure behavior and operator signals

| Failure                               | Expected behavior                                                                                                                                                                                                                                           | Recovery check                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB unavailable                   | New sessions, cart mutations, payments, order confirmation, and admin writes fail closed. A cached public menu may remain visible for at most its 30-second TTL; it is not a checkout authority. Mongoose reconnects, and workers retry with capped jitter. | `/api/health/ready` reports `mongodb: up`; `npm run db:smoke -- --apply` commits a test transaction; inspect pending outbox and print jobs. |
| Redis or queue unavailable            | Print scheduling and presence fail fast without an unbounded offline command queue. MongoDB remains the source of truth for PrintJobs; the dispatcher retries and reconciles its schedule when Redis returns. Do not infer printing from a WebSocket send.  | Readiness reports Redis, queue, and realtime up; check `print.dispatcher_recovered`, queued jobs, and bridge ACKs.                          |
| MinIO unavailable                     | Uploads/media reads fail or show the UI fallback; payments and order confirmation do not require MinIO. Do not make the private bucket public to repair an outage.                                                                                          | MinIO health and signed `HeadBucket` checks pass; a private object is readable only with a signed URL; anonymous access is denied.          |
| Gateway timeout or ambiguous response | A transaction remains pending/ambiguous, never successful from callback parameters alone. Do not retry a non-idempotent create blindly; use authoritative inquiry/reconciliation.                                                                           | Provider reference and amount match, then the confirmed order and invoice exist exactly once.                                               |
| Realtime/bridge disconnect            | The server PrintJob remains queued/printing until a matching ACK. Lost ACKs are handled by redelivery and the bridge journal; an ambiguous `received` entry needs paper/spool inspection.                                                                   | Reconnect, reconcile server status with bridge journal, and follow [printing resilience](printing-resilience.md) before any reprint.        |
| Worker crash or restart               | MongoDB outbox claims and print leases expire; idempotent consumers and schedule reconciliation resume work. Shutdown waits for loops before closing dependencies.                                                                                          | Check `outbox.worker_recovered`, `print.dispatcher_recovered`, `outbox.dead_letter`, `print.dead_letter`, queue depth and oldest age.       |

`/api/health/live` only proves that the Next.js process responds. `/api/health/ready` checks MongoDB, Redis, the private MinIO bucket, print queue, and realtime process with bounded probes; a 503 means **do not route new operational traffic**. The realtime process has separate `/live` and `/ready`. Alert on repeated `*.worker_unavailable`/`print.dispatcher_unavailable`, dead-letter events, `media.cleanup_required`, sustained readiness failures, and old queued/processing work. Log events are structured and redact configured secrets; keep request IDs for correlation. A recovered dependency does not prove that backlog is drained.

The retry loop backs off from roughly 375 ms to at most 37.5 s with jitter and resets after a successful operation. Redis commands fail while disconnected (`disableOfflineQueue`) and an already-connected client reconnects with capped jitter. **At startup**, Redis connection attempts are bounded to five seconds; if Redis is still down, the realtime process exits and needs an operator-managed service/supervisor restart policy. Outbox delivery and PrintJob attempts have their own finite retry/dead-letter limits. Replay an outbox event only after checking the downstream idempotency key and effect: `npm run outbox:replay -- EVENT_ID --apply`. A dead print job is **not** replayed in place; inspect whether paper emerged, then use the audited invoice reprint workflow if another copy is needed. Never clear Redis or the bridge journal to force a retry.

Redis AOF is useful for restart durability but is not the canonical print backup: MongoDB PrintJobs and outbox events are. After a coordinated restore, start with an empty dedicated Redis namespace and let the dispatcher rebuild due jobs from the **matching** MongoDB snapshot. Do not restore a stale Redis schedule from a different MongoDB point in time or delete a live namespace while workers are running.

No generic payment circuit breaker is enabled: a timed-out non-idempotent create or verification is an **unknown** outcome that requires authoritative inquiry, not a synthetic failure or blind retry. The provider adapter has a five-second default deadline, and its implementation must honor cancellation where possible. Redis uses fail-fast offline commands plus bounded reconnect; MinIO uses bounded requests and a small SDK retry count. Add a provider-specific circuit only after its official idempotency/inquiry semantics and alert thresholds are known.

## Controlled restart

1. Stop sending new checkouts/admin mutations at the proxy or put the café into maintenance. Wait for active requests to finish; do not kill the Next.js process immediately after accepting a payment. Record pending/ambiguous transactions and queue counts.
2. Send `SIGTERM` to the realtime/outbox processes. They stop claiming work and give an active operation up to 30 seconds to drain before closing realtime, Redis, and MongoDB in dependency order. Configure the service manager's force-kill deadline longer than this drain window plus the later closes. The bridge should be stopped with `Ctrl+C`/service stop, not by deleting its journal. A forced kill or timed-out drain can leave leased work, which is recovered after lease expiry; it cannot guarantee zero duplicate physical output.
3. Restart MongoDB, Redis, and MinIO first. Confirm replica-set primary and transaction smoke, Redis persistence and queue ping, and private bucket access. Start the app, realtime worker, then bridge. Check both readiness endpoints and compare outbox/PrintJob backlog before accepting traffic.
4. Refresh an order/print status from the server after reconnect. Treat browser WebSocket notices as hints, not durable state. Reconcile every ambiguous payment through its provider before declaring success or refunding.

## Backup: MongoDB

Install the matching MongoDB Database Tools (`mongodump`, `mongorestore`) on the operator machine. In PowerShell, choose a new restricted directory outside the repo and set the **actual** project replica-set URI (the local project may be on 27018; never assume the unrelated default-port service is Armani Caffe):

```powershell
$backupDir = 'D:\Backups\ArmaniCaffe\2026-10-04T1830'
New-Item -ItemType Directory -Path $backupDir -ErrorAction Stop
$projectMongoUri = 'mongodb://127.0.0.1:27018/armani_caffe?directConnection=true&replicaSet=rsowner'
mongodump --uri=$projectMongoUri --db=armani_caffe --gzip --archive="$backupDir\armani_caffe.archive.gz"
if ($LASTEXITCODE -ne 0) { throw 'MongoDB backup failed' }
Get-FileHash -Algorithm SHA256 "$backupDir\armani_caffe.archive.gz"
```

Use a maintenance pause or a production-grade snapshot strategy for consistency across MongoDB and MinIO; this local database-only dump is not an atomic cross-service snapshot. Never pass production credentials in shell history/process arguments; use the Database Tools secure configuration/secret mechanism. Keep the encryption keys and auth secrets in a **separate** protected secret backup, with key versions; losing `ENCRYPTION_KEY` can make stored provider/bridge credentials unreadable. Do not include secrets in the archive manifest.

Restore-test into a **separate empty replica set**, not the live database. Rename the namespace so a wrong URI cannot overwrite the source:

```powershell
$restoreMongoUri = 'mongodb://127.0.0.1:27028/admin?directConnection=true&replicaSet=rs0'
mongorestore --uri=$restoreMongoUri --gzip --archive="$backupDir\armani_caffe.archive.gz" --nsFrom='armani_caffe.*' --nsTo='armani_restore.*'
if ($LASTEXITCODE -ne 0) { throw 'MongoDB restore failed' }
```

Validate the **isolated** restore with the following checks, then compare collection counts and sampled order/invoice/outbox IDs and totals with the backup manifest:

```powershell
mongosh $restoreMongoUri --quiet --eval 'const d=db.getSiblingDB("armani_restore"); printjson({migrations:d._schema_migrations.countDocuments({}),orders:d.orders.countDocuments({}),invoices:d.invoices.countDocuments({})})'
$env:MONGODB_URI = 'mongodb://127.0.0.1:27028/armani_restore?directConnection=true&replicaSet=rs0'
npm run db:migrate:status
npm run db:smoke -- --apply
Remove-Item Env:MONGODB_URI
```

Confirm `_schema_migrations` contains the expected highest version and review indexes with `npm run db:indexes:plan` (this plan alone does not inspect the restored server). Do not run seed/bootstrap against restored business data. Only after the isolated restore passes should an operator plan a cutover to a new empty target database, update `MONGODB_URI`, restart processes, verify `/api/health/ready`, log in, and inspect a historical invoice plus outstanding work. Never use `mongorestore --drop` on the current live database as a routine repair.

## Backup: MinIO objects and configuration

The Compose `minio_data` volume contains the private bucket **and** MinIO system configuration. Capture it only while MinIO is stopped, after pausing uploads and confirming no in-flight finalizations. The following copies `/data/.` from the stopped container, including hidden `.minio.sys`, to the same restricted backup directory:

```powershell
docker compose -f infra/compose.yaml stop minio
$minioContainer = docker compose -f infra/compose.yaml ps --all -q minio
if (-not $minioContainer) { throw 'MinIO container not found' }
docker cp "${minioContainer}:/data/." "$backupDir\minio"
if ($LASTEXITCODE -ne 0) { throw 'MinIO backup failed' }
Get-ChildItem -Force "$backupDir\minio"
docker compose -f infra/compose.yaml start minio
```

Keep the matching MinIO image tag and root credentials in the protected recovery manifest. Test restoration to a **new empty volume/container** using the same pinned image; do not copy into the running production container. For a Compose rehearsal, choose unused ports (for example `MINIO_API_PORT=9100`, `MINIO_CONSOLE_PORT=9101`) and a distinct project name (`docker compose -p armani-restore ...`) so its volume is separate. Stop that new MinIO container, `docker cp` the backed-up `minio/.` into its empty `/data`, then start it. Confirm `http://127.0.0.1:9100/minio/health/ready` returns 200, the bucket exists, an anonymous request for a known object is denied, CORS matches the saved configuration, and a signed read of a historical media key returns the expected size/hash. Compare object count/size against the backup manifest. Re-run explicit MinIO initialization only after inspecting whether it would change the restored policy/CORS. If the image is unavailable, preserve the volume backup and resolve the supported storage image before any restore attempt; see [local infrastructure](local-infrastructure.md).

## Backup: bridge journal

Stop the bridge and ensure its lock is released. Copy the entire `BRIDGE_DATA_DIR/journal` directory (default `data/print-bridge/journal`) to restricted storage; do **not** copy only `acknowledged` entries. A stopped bridge and journal copy are required for a consistent snapshot. The simulated receipt directory may contain customer data and needs the same protection if retained.

```powershell
Copy-Item -LiteralPath 'data\print-bridge\journal' -Destination "$backupDir\bridge-journal" -Recurse -ErrorAction Stop
Get-ChildItem -LiteralPath "$backupDir\bridge-journal" -Filter '*.json' | Measure-Object
```

For a restore, keep the bridge stopped, restore into a new empty `BRIDGE_DATA_DIR`, retain the original backup, and run `npm run bridge:status` before reconnecting. Compare job IDs/states with server PrintJobs. A `printed`/`acknowledged` entry must prevent another adapter call; `received` is ambiguous and needs paper/spool inspection plus `bridge:resolve`, never automatic reprint. Do not restore a stale journal over a newer one without reconciling every job ID. After restart, verify one test job reaches server `printed` with one bridge `acknowledged` entry and no duplicate simulator/physical output.

## Verification matrix

Run `npm run test:reliability` for isolated reconnect, readiness, shutdown, payment, order, and print recovery tests; it uses a disposable MongoDB replica set and simulated queue. With **dedicated** MongoDB replica set, Redis, and MinIO test resources available, run `npm run test:integration` and `npm run test:printing:redis`; do not point destructive fault tests at development or live data. Browser E2E verifies visible offline/stale states but does not replace a real-service recovery drill. Repeat controlled outage and restore drills on a non-production stack, document elapsed recovery and backlog drain, then run the actual-printer acceptance checklist before unattended printing.

MongoDB Database Tools archive/namespace options: [mongodump](https://www.mongodb.com/docs/database-tools/mongodump/), [mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/). Docker volume recovery guidance: [Docker volumes](https://docs.docker.com/engine/storage/volumes/).
