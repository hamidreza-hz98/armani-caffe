# Typed singleton settings

Task 13 verification (2026-09-28): format/lint/types/server boundaries/architecture, 59 unit/client tests, 32 MongoDB integration tests (10 settings-specific), production build and 10 Playwright tests passed. Full `validate` failed at the real-MinIO suite setup because MinIO was unavailable on this host. Task 14 subsequently connected admin HTTP authentication; see [admin auth](admin-auth.md).

Settings owns five singletons identified by `kind`, not caller-supplied document IDs. `settings_kind_unique` enforces this. Browser-safe types/contracts are exported from `modules/settings`; server composition from `modules/settings/server`. No connection, encryption-key read or settings write happens at import/build time.

| Kind       | Defaults and fields                                                                                                | Visibility                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `business` | Persian title, legal/display identity, plain description, fixed `TOMAN`/`Asia/Tehran`, integer minimum order تومان | Public, cashier, owner                                                                                |
| `contact`  | Empty E.164 phone/email/address/social links; map disabled                                                         | Public, cashier, owner                                                                                |
| `seo`      | Persian title, description, one `%s` title-template token, indexing off                                            | Public metadata, owner; cashier denied                                                                |
| `payment`  | Fake disabled, default null, priority zero; Iranian gateway placeholder disabled, priority one, sandbox mode       | Owner configuration; cashier default/enabled summary; never public                                    |
| `printing` | Disabled, empty bridge ID, 80 mm paper, one copy, auto-print off, empty footer                                     | Owner configuration; cashier operational preferences without bridge ID/credential state; never public |

The fake provider cannot be enabled in production. The gateway placeholder cannot be enabled until Task 21 implements the chosen approved adapter and extends these contracts. Settings never accepts arbitrary provider endpoints or callback URLs: adapters own approved endpoints, and callback origins come from runtime configuration. This task does not perform payments/printing or implement admin UI. Business media references are not yet fields in this contract; the later identity/media UI must extend it using Media's reference lifecycle, not arbitrary untracked IDs/URLs.

## Validation and safe maps

Writes replace the complete typed `values` object. Unknown/missing fields, HTML/control characters, fractional/unsafe money, invalid revisions, inconsistent provider/default flags and invalid print states fail validation. Phone input uses canonical E.164, including landlines. Contact text is trimmed/NFC-normalized; opaque secrets are not trimmed. Social links accept only `https://www.instagram.com/<profile>` and `https://t.me/<profile>` without credentials, ports, queries or fragments.

Maps accept `none` with null coordinates or `google` with finite latitude ±90 and longitude ±180. Public reads generate a fixed Google Maps search navigation URL with `api=1` and the coordinates. No iframe HTML or caller-supplied URL is accepted or fetched. See [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). A later embedded preview requires separate provider/CSP review; this task adds no iframe permission.

## Transactions and caching

Missing rows read as independent defaults at revision `0`, without writes. Each mutation requires the last-read `revision` and a unique `Idempotency-Key` (8–128 ASCII alphanumeric/underscore/hyphen). Snapshot/majority transactions atomically CAS/advance the singleton revision and `__v`, store a safe receipt, append a settings audit and publish `settings.updated` to the transactional outbox. Conflicts return HTTP 409 and a safe Persian error. Reload, show the conflict and obtain a new key before resubmitting; no silent last-writer-wins.

Receipts are scoped to actor + mutation key. Identical retries return the original safe DTO without extra effects; different input/kind conflicts. Credential-bearing request fingerprints are keyed HMACs, not plaintext or unkeyed hashes. Receipts expire after seven days, but audit/outbox idempotency continues to prohibit key reuse. Audit/event metadata contains only kind and revision, never old/new configuration/contact/credentials.

The five-entry cache contains cloned safe DTOs only. Every hit checks the indexed singleton's DB revision. Local successful writes evict their entry; other instances detect changes on their next read without waiting for broadcasts. Public HTTP uses `Cache-Control: no-store`; metadata/page consumers should call `publicSettings()` without a second long-lived cache. The outbox event is available for later consumers; no no-op worker acknowledges unimplemented events. Database failure is an error, not stale/default success. Historical consumers (invoices) must snapshot their actual settings values rather than retain live references. Reading multiple kinds is not a transactionally atomic whole-store snapshot.

## Write-only credentials and rotation

Optional write fields: `secrets.gatewayCredential` for payment and `secrets.bridgeToken` for printing. Omitted/empty string means **unchanged**; non-empty bounded opaque strings replace; `null` explicitly clears. Enabled printing requires a stored bridge token; clearing it while still enabled fails. Owner reads and mutation responses contain only `{ configured, keyId, rotatedAt }`, never old or newly supplied secrets. Cashiers see no credential state. Public settings explicitly select only business/contact/SEO fields.

The server-only vault uses Node's [authenticated encryption APIs](https://nodejs.org/docs/latest-v24.x/api/crypto.html): AES-256-GCM, fresh 96-bit nonce, 128-bit tag, versioned envelope, encryption timestamp and deterministic 96-bit key ID. AAD binds kind, version, key ID and timestamp, preventing ciphertext relocation between payment and printing. `encryptedPayload` is excluded from Mongoose queries by default and explicitly projected out of native safe reads. Only credential writes, rotation and trusted server adapter callbacks load ciphertext. Crypto/parser/write-driver failures use static messages without secret-bearing exception causes.

Keys come from the existing `ENCRYPTION_KEY` (32-byte hex current key) and optional `ENCRYPTION_KEY_PREVIOUS` (one previous key); no package or environment secret is added. Rotation procedure:

1. Back up the database; retain the old key securely. Set the new current key and old previous key, then restart all processes.
2. As OWNER, submit each payment/printing singleton's current values/revision, `rotate: true` and a new mutation key. Rotation explicitly audits, advances revision and reencrypts configured credentials. Reads never silently rotate.
3. Verify key IDs. Keep the previous key until **all encrypted subsystems**, including Media, have rotated and at least the seven-day settings receipt window has expired.
4. Only then remove the previous key and restart. Unknown/retired keys fail closed; recover by restoring the retained key, not overwriting unreadable credentials with defaults.

Trusted payment/printing adapters can use the server-only repository's `withCredentials` callback to authenticate/sign provider requests. Such callbacks must never return/serialize/log credentials or place them in errors. This API is absent from `SettingsService`, browser exports and HTTP operations; no credential-reveal endpoint exists. Runtime bridge credentials/callback base URL remain deployment configuration and are not silently copied into DB settings.

## HTTP and authorization

- `GET /api/settings/public`: storefront-safe values, no admin authentication.
- `GET /api/settings/[kind]`: authenticated, role-projected values.
- `PATCH /api/settings/[kind]`: OWNER only, allowed exact app/admin Origin, JSON ≤16 KiB, Idempotency-Key; body `{ revision, values, secrets?, rotate? }`.

Actors are resolved from the verified admin session server-side, never from headers/JSON IDs/roles. Responses use no-store/nosniff, request IDs and the shared safe Persian error serializer. Integration tests also inject a trusted resolver to exercise OWNER/CASHIER policy.

## Explicit migration and tests

Review/backup existing databases, then run:

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Migration 3 validates recognized legacy primitive values merged with defaults and advances revision. Unknown/invalid legacy values or old ciphertext abort with operator-review errors; no data is logged or discarded. Conversion and ledger commit atomically. Requests refuse legacy format instead of migrating it. Receipt indexes are unique actor/mutation key and seven-day `createdAt` TTL. Apply intentionally, not via startup index sync.

```sh
npx vitest run --project unit tests/unit/settings.test.ts
npx vitest run --project integration tests/integration/settings.test.ts
npm run test:e2e
```

Settings integration uses an isolated real MongoDB replica set and does not touch development data. Coverage includes defaults, event atomicity, CAS/replay races, rollback, encryption/redaction/rotation, preserve/clear semantics, role/CSRF/bounded-body checks, cross-instance cache freshness and legacy migration refusal/conversion. Full `validate` still needs real MinIO for the existing storage integration suite.
