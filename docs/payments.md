# Payment provider framework

The framework is ready for up to four Iranian gateway settings entries plus a development fake. No live gateway is selected or implemented yet: the `iranian-gateway` adapter is deliberately disabled and contains no invented endpoints, parameters, amount conversion or signature logic. Selecting actual gateways and approving their official documentation remains a later integration decision.

## Provider boundary and configuration

`PaymentProvider` defines create, callback parsing, authoritative verification, inquiry and optional refund. Results are normalized to integer تومان; a future documented Rial gateway adapter must perform an explicit, tested conversion at its boundary. Providers declare creation-idempotency guarantees, allowed callback methods/fields and fixed redirect origins in code. Refund is an extension point, not a public refund workflow in this task.

Register each documented factory once in `gatewayFactories` in `src/server/commerce/payments.ts`. The callback provider allowlist is derived from the same registration; checkout uses only `PaymentService.create(orderId, idempotencyKey, requestId)`. It does not know merchant credentials, gateway parameters or verification rules. Disabled/unregistered gateways cannot receive requests. Default selection uses the enabled configured default; otherwise lower priority wins, with provider ID as deterministic tie-breaker. Failure does not silently fail over to another gateway because the first remote operation may have occurred.

Owner-only, revision-checked Payment settings retain the existing fake/legacy disabled-gateway fields and add optional `providers`, maximum four entries:

```json
{
  "defaultProvider": "gateway-b",
  "providers": [
    { "id": "gateway-a", "enabled": true, "priority": 2, "mode": "sandbox" },
    { "id": "gateway-b", "enabled": true, "priority": 1, "mode": "sandbox" }
  ]
}
```

Merge these fields with the complete existing `settingsDefaults("payment")` values when writing settings. Provider IDs are code registration names, not arbitrary URLs. `secrets.providerCredentials` is a JSON-encoded string mapping provider IDs to opaque credentials (16–768 characters each, maximum four entries). This complete credential map replaces the previous map; blank input preserves it and null clears it. Keep credential input out of logs. Owner responses expose only configuration and credential-state metadata, never the map. Public settings expose no payment credentials. CASHIER gets the existing restricted visibility, not priorities, modes or secrets. Fake payments are forbidden in production by both settings and adapter composition.

Credential sets use the existing authenticated AES-256-GCM Settings vault. Each transaction retains its own encrypted credential snapshot and mode so pending payments are verified with the credentials that created them, even after settings change. Its callback key ID supports the primary/previous encryption-key rotation scheme. Retain previous keys while any settings, receipts or pending payment snapshots/callbacks still need them. Do not retire keys based only on settings rotation. Audit/outbox never include credentials, redirect URLs, callback state or raw provider response/error bodies. Adapter-factory, parsing and network errors are sanitized without copying upstream messages.

## Trusted creation and public callbacks

This task does **not** expose a public amount-taking payment creation route. The upcoming checkout workflow must supply a trusted intent port that reads and validates a durable, server-priced payable order inside the reservation transaction, and enforce customer ownership before invoking creation. Tests use real MongoDB payable order fixtures. The default callback composition deliberately refuses to create intents until checkout is wired. Cart totals or browser quote fields are not payment input.

`GET/POST /api/payments/callback/[provider]/[id]` supports allowlisted adapters only. The callback origin is the configured `PAYMENT_CALLBACK_BASE_URL`, which must be an origin (no path, credentials, query or fragment) and HTTPS in production. HMAC state binds the transaction and recorded callback key; the exact path/provider/authority must match. Generic POST transport accepts only bounded URL-encoded forms; each adapter must independently approve its documented method and fields. Duplicate fields across query/form and unknown fields are rejected. Fake accepts GET only. State is compared in constant time, and callback responses use no-store and no-referrer headers. Browser status/result hints are never verification evidence.

Success requires an authoritative adapter response containing the exact recorded authority, exact safe-integer amount and TOMAN currency, and a valid unique provider reference. Callback authority, reference and amount cannot overwrite expected values. Concurrent duplicate callbacks may return BUSY while another claim verifies; repeat callback/inquiry returns the eventual stable result. No callback requires trusting browser Origin headers as evidence of payment.

## State, leases and recovery

```text
durable payable intent → created → pending → succeeded → refunded (future workflow)
                           │          │
                           └→ failed ←┘  (only definitive provider rejection/failure)

timeout / unknown / mismatch → retain created or pending; reconcile, do not guess
```

The existing transaction state machine is enforced on each terminal transition. Unique indexes bind idempotency keys, provider authorities and references. A partial unique order index prevents multiple created/pending/succeeded/refunded attempts for one order; a definitively failed attempt permits a new key. Reusing a key for another order is a conflict. Successful/refunded transactions are not TTL-deleted; references remain globally unique within the provider namespace.

External calls never execute inside MongoDB transactions that can retry. A durable claim with a random fencing token, revision and 30-second lease precedes each call. Network calls have a five-second default deadline (maximum ten seconds) and AbortSignal; late results cannot update an expired/superseded claim. Lost processes leave recoverable leases. Reservation, claims, final transitions/unresolved results and required audit/outbox records commit together. Exactly one succeeded transition/event occurs under duplicate callbacks; downstream delivery remains the existing outbox's at-least-once contract.

Verification timeout/unknown stays pending with AMBIGUOUS_VERIFICATION. Amount/authority mismatches and reference collisions remain pending with explicit safe issues, never successful and never automatically refunded. Definitive failure is terminal; a contradictory delayed callback cannot revive it. Inquiry is a trusted worker/operator API, not an unauthenticated customer route. Creation uncertainty remains created with CREATION_AMBIGUOUS: automatic creation retry is allowed only when the adapter declares a documented idempotency guarantee. An unresolved non-idempotent creation needs provider-specific operator recovery; generic inquiry does not invent an authority or recovery API. No reconciler daemon is started automatically in this task.

```sh
npm run payment:inquire -- --id <transaction-id> --apply
```

## Deterministic development provider

Fake authorities derive deterministically from transaction ID + idempotency key; its MongoDB ledger survives process restarts. Creation is pending, not automatically paid. Verification/inquiry reads that independent server ledger and ignores browser success hints. Unit tests can inject a memory ledger. For local development, explicitly set a fake result and run authoritative inquiry:

```sh
npm run payment:fake:settle -- --id <transaction-id> --outcome success --apply
# Also supported: failed, pending, unknown
```

This command requires a non-production loopback database, a pending fake transaction and explicit opt-in. It cannot settle a real provider or accept a caller-supplied amount/reference. It prints only transaction ID/status/issue. Tests change ledger outcomes directly to exercise mismatches and ambiguous evidence; no HTTP endpoint can manipulate the fake ledger.

## Rollout and verification

Back up data and stop payment writers, then explicitly run:

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Migration 10 refuses legacy transactions without framework evidence; operators must reconcile/archive them deliberately rather than invent credentials, authorities or verification records. Also resolve any duplicate nonfailed order attempts before applying the partial unique order index. No runtime migration, index sync, historical order update or payment-provider network request occurs during static analysis. Order/invoice creation, inventory deduction and receipt/print effects belong to the next checkout/order tasks and consume verified outcomes through the outbox, not browser callbacks.

Tests cover deterministic fake creation, callback hints/forgery, concurrent/repeated callbacks, delayed authoritative evidence, failed/unknown/mismatched verification, provider reference collisions, multiple-provider selection, credential snapshots, timeouts, rollback and production restrictions:

```sh
npx vitest run --project unit tests/unit/payments.test.ts
npx vitest run --project integration tests/integration/payments.test.ts
npm run test:e2e -- tests/e2e/payments.spec.ts
```
