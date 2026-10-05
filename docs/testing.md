# Test harness

Use the smallest test that proves behavior without hiding important boundaries:

| Layer                        | Runner                                               | Scope                                                                                        |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Pure unit                    | Vitest `unit` project (Node)                         | Value objects, domain rules, configuration, and small service collaborators                  |
| Service/database integration | Vitest `integration` project (Node)                  | Application/infrastructure collaboration and a real isolated MongoDB replica-set transaction |
| Interactive client component | Vitest `client` project (jsdom) with Testing Library | Only Client Components and user interactions, including MUI controls                         |
| Browser E2E                  | Playwright against `next build` + `next start`       | Routes, Server Components, browser errors, and axe accessibility                             |

Do **not** unit-render async Server Components. Exercise their routes in Playwright instead. The Vitest-only `server-only` alias is a test-runner stand-in; the real marker remains in application builds and `npm run check:boundaries` verifies source boundaries.

## Commands

```bash
npm ci
npx playwright install chromium
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:e2e
npm run test:e2e:storefront
npm run test:e2e:dashboard
npm run validate
```

These scripts are headless and non-interactive. The local runner caps Vitest at two workers (integration remains one) and Playwright at two workers; CI uses one Playwright worker. This avoids Windows native-module and browser-server contention without changing fixture isolation. If a test fails under load, keep its trace and report the original failure even if an isolated rerun passes.

For local investigation:

```bash
npm run test:unit:watch
npm run test:e2e:debug
npm run test:e2e:ui
npx playwright show-report
```

Playwright retains a trace and screenshot on failure in ignored `test-results/` and an HTML report in ignored `playwright-report/`. No artifacts are committed. Its console fixture fails tests on browser console errors or uncaught page errors. The example E2E test runs axe; automated scans complement, but do not replace, keyboard and screen-reader review.

The storefront command runs the complete critical journey set in Chromium. `storefront-journeys.spec.ts` also runs in the Playwright-managed WebKit engine for Safari/iOS relevance, covering 360px, 390px, and 430px layouts, slow and offline recovery, payment-result states, reloads, access control, console/hydration failures, and axe scans. WebKit is intentionally limited to this journey file so unrelated dashboard coverage is not duplicated.

The dashboard command runs authentication, overview, products, categories, media, admins, customers, orders, order details, inventory, payment settings, business settings, and shared-state accessibility journeys. Each module receives a newly generated database name and a fresh MongoDB replica set, so no file can depend on another file's side effects or execution order. Tests within a module create their own mutable data; they do not require a preceding test to run. The production build is reused after the first module. Use `npm run test:e2e:dashboard:smoke` for the fast owner/cashier, session-expiry, responsive-layout, metrics, filter-URL, and permission matrix.

## Isolation and cleanup

- `tests/fixtures/isolation.ts` creates unique `armani_test_*` MongoDB names, `armani-test-*` MinIO bucket names, and `armani:test:*:` Redis key prefixes. Factories, fixed clocks, and sequential ObjectIds are there too. Never reuse development resource names in tests.
- The database integration example launches an ephemeral single-node MongoDB replica set, connects to a unique database, explicitly creates its test index, drops the database, closes Mongoose, and stops the replica set. The integration project uses one worker; separate runs still have unique database names. It does not contact the development MongoDB service.
- E2E picks an unused local port and unique resource names. Its MongoDB URL points to an unreachable loopback port by default; suites using `--with-admin-db`, `--with-product-fixtures`, or `--with-media-fixtures` explicitly launch an isolated MongoDB replica set. Browser media-transfer tests mock the presigned object transfer; they do not create a MinIO bucket or Redis keys. Future fixtures must create only their unique names and delete those names in teardown.
- `tests/integration/minio-media.test.ts` and `tests/integration/redis-queue.test.ts` intentionally use real services. Start the container stack before the complete integration or coverage suite. They create random `armani-test-*` buckets and `armani:test:*` key prefixes and clean only those resources. Override dedicated test endpoints with `MINIO_TEST_*` and `REDIS_TEST_URL`; never point them at production.
- Browser authentication helpers can clear cookies or install an explicitly supplied session cookie. They do not fabricate a valid app session. Add real sign-in helpers when auth routes exist; never bypass authorization in production code for tests.
- Test secrets in `tests/fixtures/config.mjs` are synthetic and must never be used outside local tests. `run-e2e.mjs` overlays them on the environment. `npm run validate` does not require the development stack.

`mongodb-memory-server` needs a MongoDB binary. On Windows this harness uses an installed MongoDB 8.0 binary if present at `C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe`. On other machines it downloads a test binary; set `MONGOMS_SYSTEM_BINARY` to an installed `mongod` executable when downloads are unavailable. Playwright uses installed Chrome on this Windows host; CI uses Playwright Chromium after `npx playwright install chromium`. `E2E_BROWSER_CHANNEL` can override the channel. These binaries are outside Git.

Coverage is written to the ignored `coverage/` directory as text, JSON summary, and browsable HTML. Percentages are diagnostic, not a substitute for the invariant matrix in `docs/test-matrix.md`: adapters and framework entry points can appear uncovered in a unit-only run even though the real-service integration suite covers them. Review the combined `npm run test:coverage` report when changing a critical path.
