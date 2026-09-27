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
npm run test:e2e
npm run validate
```

These scripts are headless and non-interactive. For local investigation:

```bash
npm run test:unit:watch
npm run test:e2e:debug
npm run test:e2e:ui
npx playwright show-report
```

Playwright retains a trace and screenshot on failure in ignored `test-results/` and an HTML report in ignored `playwright-report/`. No artifacts are committed. Its console fixture fails tests on browser console errors or uncaught page errors. The example E2E test runs axe; automated scans complement, but do not replace, keyboard and screen-reader review.

## Isolation and cleanup

- `tests/fixtures/isolation.ts` creates unique `armani_test_*` MongoDB names, `armani-test-*` MinIO bucket names, and `armani:test:*:` Redis key prefixes. Factories, fixed clocks, and sequential ObjectIds are there too. Never reuse development resource names in tests.
- The database integration example launches an ephemeral single-node MongoDB replica set, connects to a unique database, explicitly creates its test index, drops the database, closes Mongoose, and stops the replica set. The integration project uses one worker; separate runs still have unique database names. It does not contact the development MongoDB service.
- E2E picks an unused local port and unique resource names. Its MongoDB URL points to an unreachable loopback port, so accidental database access fails closed until an explicit isolated E2E service fixture is added. The current E2E tests do not create a MinIO bucket or Redis keys; future fixtures must create only their unique names and delete those names in teardown.
- Browser authentication helpers can clear cookies or install an explicitly supplied session cookie. They do not fabricate a valid app session. Add real sign-in helpers when auth routes exist; never bypass authorization in production code for tests.
- Test secrets in `tests/fixtures/config.mjs` are synthetic and must never be used outside local tests. `run-e2e.mjs` overlays them on the environment. `npm run validate` does not require the development stack.

`mongodb-memory-server` needs a MongoDB binary. On Windows this harness uses an installed MongoDB 8.0 binary if present at `C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe`. On other machines it downloads a test binary; set `MONGOMS_SYSTEM_BINARY` to an installed `mongod` executable when downloads are unavailable. Playwright uses installed Chrome on this Windows host; CI uses Playwright Chromium after `npx playwright install chromium`. `E2E_BROWSER_CHANNEL` can override the channel. These binaries are outside Git.
