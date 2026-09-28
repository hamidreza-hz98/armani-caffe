# Admin authentication and authorization

Task 14 adds server-verified `OWNER` and `CASHIER` identities. The capability map in `src/shared/admin-capabilities.ts` is the single role-policy source. Admin pages and API handlers check sessions, and privileged application services repeat authorization at the service boundary. Sensitive admin mutations also recheck authority inside the MongoDB transaction. Client-supplied IDs, roles, or forwarded-IP headers never establish identity.

## First owner and database rollout

Back up an existing database before applying migration 4 or indexes. It checks legacy password-hash format, fills required identity/version fields, revokes legacy admin sessions, and creates the owner coordination guard. If any legacy row has an unsupported hash or a nonempty admin collection has no active owner, it aborts for operator review. Neither migrations nor index sync run during normal requests.

```sh
npm run db:migrate:status
npm run db:migrate:up -- --apply
npm run db:indexes:plan
npm run db:indexes:apply -- --apply
```

Bootstrap is an explicit, one-time command for an **empty** admin collection. It requires the unique username/phone indexes and a JSON object on standard input with `username`, `displayName`, `phone`, `password`, and `role: "OWNER"`. Keep that JSON outside the repository in a private file, pipe it to `npm run admin:bootstrap -- --apply`, then remove it securely according to your operating-system policy. Do not pass the password as a command-line argument or store it in shell history. The command logs only the new admin ID and username, never the password. It refuses to create a second bootstrap owner. `AUTH_ADMIN_SESSION_SECRET` must be a separate high-entropy value from the customer secret; `npm run env:init` generates local development values.

After bootstrapping, visit `/admin/login`. The minimal Persian dashboard at `/admin` is guarded server-side; future admin pages must call the same page guard and privileged services must enforce capabilities independently. Only `OWNER` may create, edit, delete, or reset another admin. The final active owner cannot be disabled, demoted, or deleted, including under concurrent requests. Deletion is a soft deletion so audit history remains stable. Password reset, disablement, role/username change, and deletion revoke every existing session for that admin. The password-reset operation returns no secret or stored hash.

## Session and HTTP contract

- `POST /api/admin/auth/login`: username/password JSON, exact allowed `Origin`, generic credential errors.
- `GET /api/admin/auth/session`: current safe principal or unauthorized.
- `POST /api/admin/auth/rotate`: replace the token and revoke the old one without extending the original absolute expiry.
- `POST /api/admin/auth/logout`: revoke the session and clear the cookie.
- `GET/POST /api/admins`, `PATCH/DELETE /api/admins/[id]`, `POST /api/admins/[id]/password`: owner-only management; mutation routes require an exact allowed `Origin`.

Admin tokens are 32 random bytes; only a keyed HMAC digest is stored in MongoDB. Cookies are HTTP-only, `SameSite=Strict`, scoped to `/`, and `Secure` in production. The production cookie is `__Host-armani-admin`; the development cookie uses a distinct name. Neither collides with the customer cookie. A login rotates away any previous admin cookie, and session rotation invalidates the prior token. Absolute lifetime is eight hours; inactivity expires a session after 30 minutes. Logged-in status is rechecked against current admin status and authorization version on every resolution. Set-Cookie and auth responses are `no-store`.

Passwords use Node's memory-hard scrypt with a versioned salted hash. Unknown usernames incur dummy hash verification to avoid a trivial timing distinction. MongoDB-backed counters throttle each normalized account to five login attempts per 15-minute window. Because the app has no configured trusted proxy IP chain yet, the route also uses a conservative shared 300-attempt/15-minute network bucket; it deliberately ignores spoofable forwarded-IP headers. This shared limit may be too restrictive at scale and should be replaced by a deployment-specific trusted network identifier after proxy review. No Redis dependency is needed for the baseline throttle.

Login, logout, rotation, bootstrap, admin creation/update/deletion, and password reset append audit and outbox records in the same transaction as their state change. Rejected logins append a separate redacted failure audit; audit failure causes login to fail closed. No password, token, or credential is included in audit/event metadata. Password hashing and secret access remain server-only.

Production requires HTTPS for the `Secure` cookie and an appropriately configured `APP_URL`/`ADMIN_URL`. Local HTTP login is for `NODE_ENV=development`; do not disable the production cookie flag to make HTTP deployment work. Cross-origin admin hosting is not assumed: `SameSite=Strict` requires the application and admin flow to be on compatible sites.

## Verification

```sh
npx vitest run --project unit tests/unit/admin-security.test.ts
npx vitest run --project integration tests/integration/admin-security.test.ts
npm run test:e2e
```

Integration tests use an isolated MongoDB replica set and cover bootstrap, rate limits, credential errors, rotation/logout/revocation, inactive/expired sessions, owner concurrency, role policy, migration, cookies, and CSRF. Playwright covers the protected-page redirect and forged-header/CSRF rejection. The broader `npm run validate` also needs the real MinIO test service.
