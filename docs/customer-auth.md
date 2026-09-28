# Customer authentication

Task 15 provides API-only customer signup, password login, logout, session rotation, and self-service profile read/update. Storefront forms can use these contracts later. Customer identities belong to the Customers module; token/session handling belongs to Auth. Admin and customer sessions share the `sessions` collection but are isolated by principal kind, distinct HMAC secrets, token namespaces, cookie names, and authorization paths. An admin cookie or token never authorizes customer access, and vice versa.

## Database rollout

Back up existing data, then explicitly apply migration 5 and the new `customer_auth_throttle_expiry` index:

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Migration 5 refuses passwordless legacy customer records and unsupported hashes for operator review; it does **not** invent passwords or silently convert accounts. It initializes the auth version for compatible legacy records and revokes legacy customer sessions. No migration or index sync runs during ordinary requests. Existing customer data needs an explicit account-recovery/claiming policy before it can use password login. Keep `AUTH_SESSION_SECRET` independent of `AUTH_ADMIN_SESSION_SECRET`.

## HTTP contracts

- `POST /api/customer/auth/signup`: JSON `{ phone, password, displayName?, birthDate? }`; no cookie is issued automatically.
- `POST /api/customer/auth/login`: JSON `{ phone, password }`; sets the customer cookie.
- `GET /api/customer/auth/session`: current safe principal.
- `POST /api/customer/auth/rotate`: JSON `{}`; replaces the token without extending absolute expiry.
- `POST /api/customer/auth/logout`: JSON `{}`; revokes the token and clears the cookie.
- `GET /api/customer/profile`: safe profile DTO.
- `PATCH /api/customer/profile`: JSON `{ revision, displayName?, birthDate? }`; compare-and-swap update of provided fields.

The profile exposes normalized `+989…` phone, display name, canonical Gregorian `YYYY-MM-DD` birth date (or null), status, revision, and timestamps—never password hashes or token hashes. The phone is immutable in this API. Input accepts Persian/Arabic digits and common Iranian mobile prefixes, then stores one canonical E.164 value behind a unique index. Duplicate signups return a safe conflict. Password verification for an unknown number performs dummy scrypt work; credential failures use the same generic response as a wrong password or blocked account. Passwords require 12–128 non-control characters on signup and are hashed with salted scrypt. No password appears in audit/outbox metadata.

Birth dates are plain calendar dates represented in MongoDB as UTC midnight. `src/shared/jalali-date.ts` converts canonical Gregorian dates to/from Jalali **only at the UI boundary**; it never stores a Jalali string or local-midnight timestamp. Invalid calendar dates fail validation. The optimistic `revision` prevents lost profile updates.

Mutations require exact configured application/admin `Origin` and bounded JSON. Cookies are HTTP-only, `SameSite=Strict`, path `/`, and `Secure` in production. The production name is `__Host-armani-customer`, distinct from `__Host-armani-admin`; production requires HTTPS. Tokens are random 32-byte values; MongoDB stores only keyed HMAC digests. Sessions have a 30-day absolute lifetime and seven-day idle timeout. Login, logout, rotation, signup, and profile update commit audit/outbox records transactionally with state changes; rejected login attempts produce a separate redacted failure audit.

MongoDB-backed throttle counters allow five signup or login attempts per normalized phone per 15-minute window, plus a shared 300-attempt window. No forwarded-IP header is trusted. A deployment with a verified proxy chain may later replace the shared bucket with a trusted network identifier. The `CustomerProofVerifier` interface in Auth is an explicit OTP extension point; **no OTP delivery, verification implementation, or OTP login is included** in this task.

Run focused tests with `npx vitest run --project unit tests/unit/customer-auth.test.ts`, `npx vitest run --project integration tests/integration/customer-auth.test.ts`, and `npm run test:e2e`. The full integration suite additionally requires the real MinIO test service.
