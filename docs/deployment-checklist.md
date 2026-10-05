# Production deployment decision checklist

No production deployment is performed by this document. The local Compose file and its defaults are **not** a production topology. The release owner must record owners, dates, evidence, rollback criteria, and sign-off for every item before changing external traffic or payment credentials.

## Infrastructure and identity

- [ ] Choose a supported, maintained S3-compatible private-object service/distribution (see [storage ADR](adr/0003-private-media-storage.md)); validate signed upload/download, CORS, lifecycle/aborted multipart cleanup, object backup and restore. Do not use the archived local MinIO image by default.
- [ ] Provision MongoDB as a transaction-capable replica set with authenticated TLS connections, explicit indexes, backup retention, restore tests, storage monitoring, and an agreed RPO/RTO. Review migration status and apply forward migrations/indexes in a maintenance window; never migrate implicitly on web requests.
- [ ] Provision protected Redis with AOF/restart durability, bounded memory/eviction policy, monitoring, and a dedicated queue namespace. Reconcile jobs from MongoDB after a mismatched Redis restore; do not clear a live print namespace.
- [ ] Set DNS, HTTPS/TLS certificates, HSTS at ingress, trusted proxy headers, secure cookies, and callback canonical origins. Test renewal and expiry alerts. Route WebSocket upgrades and heartbeat/idle timeouts through the TLS proxy (`wss://`) to the supervised realtime process.
- [ ] Store unique production auth, encryption, payment, storage and bridge credentials in a secret manager; restrict access, rotate with key-version coverage, and verify logs/HTML/browser bundles contain none. Preserve prior encryption keys while pending credentials, media tickets, receipts or callbacks still need them. Remove all local unsafe defaults.
- [ ] Define least-privilege OWNER/CASHIER accounts, private owner bootstrap and revocation process, operator access, audit retention, privacy/deletion policy, and a trusted ingress-specific auth rate-limit key. Never use the E2E fixture account.

## Application, data and operations

- [ ] Pin the reviewed Node/npm and image versions, perform `npm ci`, audit dependencies, and archive the build/test evidence. Run lint, format, types, architecture, unit, real-service integration, all browser journeys, performance, security/SEO/accessibility, and production start smoke against a staging-equivalent stack.
- [ ] Set public and server URLs before the production build; `NEXT_PUBLIC_*` values are build-time. Confirm no server-to-self HTTP calls and size/latency budgets from [performance](performance.md).
- [ ] Plan instance count and shared catalog cache/invalidation before scaling web processes. The current menu cache is process-local; do not assume one instance's invalidation reaches another. Ensure readiness gates traffic, while liveness does not depend on downstream services.
- [ ] Supervise the Next.js, realtime/print-dispatcher, bridge (on café hardware), and any actual outbox consumer/cleanup processes with restart policy and graceful-drain deadlines. The standalone `outbox:work` currently registers no handlers; do not use it as evidence of event delivery. Schedule `media:cleanup` with alerting.
- [ ] Configure structured log collection, request-ID correlation, redaction checks, queue/dead-letter/oldest-job alerts, payment-ambiguity alerts, dependency health, disk capacity, TLS expiry, backups, restore freshness, and operator on-call procedures. Test one controlled restart and partial dependency recovery before accepting traffic.
- [ ] Rehearse encrypted MongoDB/MinIO/bridge-journal backup and **isolated restore** from [recovery runbook](reliability-recovery.md); compare migration versions, counts, sampled invoices/orders, media hashes, journal IDs, and outstanding work. Keep secrets/key backups separate and protected.

## Payments and café printer

- [ ] Select the actual Iranian gateway(s), obtain and review official API/security documentation, implement and test each adapter's amount units, authoritative verification, idempotency/inquiry/refund rules and callback signatures. The current disabled placeholder and fake provider are not live payment capability. Set real credentials/callback allow-lists only after staging tests.
- [ ] Validate provider timeout/ambiguous-result operations: never show success or create an order from callback parameters alone. Reconcile pending payments authoritatively and verify one order, invoice, inventory deduction and print job under duplicate callbacks.
- [ ] Install the bridge on the café device with a restricted service account, persistent local journal, unique bridge identity/token, outbound WSS, supervised restart, printer driver/USB or LAN restriction, diagnostics and an operator reprint procedure. Protect journal and simulated receipt files as customer data.
- [ ] Complete the [actual-printer acceptance checklist](printing-resilience.md#manual-acceptance-checklist-for-the-actual-café-printer) for 58/80 mm Persian shaping, long lines, cutting, offline/reconnect, lost ACK, crash ambiguity, and manual reprint. Document the device's strongest observable success signal; spool acceptance is not paper emergence.

## Go/no-go

- [ ] Resolve or explicitly accept every finding in [local acceptance](local-acceptance.md), [security review](security-review.md), [accessibility audit](seo-rtl-accessibility-audit.md), and dependency audit. Confirm no secrets, test data, temporary artifacts, or missing required source files are in the release commit.
- [ ] Record a rollback plan that preserves accepted payments, invoices, outbox, print jobs and bridge journal; test it in staging. Designate a human owner for payment reconciliation and ambiguous physical prints. Do not turn on production traffic, credentials, or automatic printing until sign-off.
