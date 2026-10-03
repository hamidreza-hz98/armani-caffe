# Production performance baseline

Run `npm run test:performance` to build the production app, start it with an isolated MongoDB replica set, seed 3 categories and 18 products, and exercise the menu in Chromium. The test writes a non-secret JSON attachment under the ignored `test-results/` directory. Do not commit real customer data or runtime environment files with a report.

The initial small-café target is **10 simultaneous guest menu requests**, 50 complete responses total. This is an explicit working assumption, not a confirmed peak-traffic requirement. Revisit it with measured traffic before launch. The fixture is intentionally small; repeat with the actual catalog and concurrent checkout workload before capacity planning.

| Gate                                                 |   Budget | Baseline on local Windows/Chrome, 2026-10-03 |
| ---------------------------------------------------- | -------: | -------------------------------------------: |
| Guest menu transferred JavaScript                    | < 350 KB |                                       252 KB |
| Guest menu HTML transfer                             |  < 60 KB |                                      15.6 KB |
| Login + dashboard loaded JavaScript                  | < 1.2 MB |                                       868 KB |
| Menu LCP                                             |  < 2.5 s |                                       0.83 s |
| Menu CLS                                             |   < 0.05 |                                            0 |
| Sampled interaction duration                         | < 200 ms |                                        32 ms |
| 10-concurrent menu response p95                      |  < 1.2 s |                                       330 ms |
| Menu responses with non-200 status                   |        0 |                                         0/50 |
| Product collection queries on 50 warm-cache requests |        0 |                                            0 |

These are local lab results, not field Core Web Vitals. The interaction measurement is one Event Timing candidate, **not** a field INP percentile. Script sizes are browser-observed encoded transfer for the storefront and response-body bytes for the cold login/dashboard journey; they are not identical bundle-analysis measures. The test substitutes a tiny local image response because MinIO is unavailable on this workstation, so its image-byte measurement is not a real media budget. The intended production menu media budget is 25 KB per 88px product thumbnail, 400 KB total above the fold, to be measured with real optimized variants before release.

A separate Lighthouse 12.8.2 mobile run against `next start` is saved at `test-results/lighthouse-mobile-local.json` (ignored by Git). The final run scored 85 with 1.1 s FCP, 3.5 s LCP, **0 CLS**, and 250 ms total blocking time. **It is an outage-state audit, not a valid normal-menu baseline:** the local `.env.local` points MongoDB at `127.0.0.1:27018`, which was not running. Lighthouse identified the late offline notice as the LCP element. Before the notice was changed to a fixed, accessible status overlay, this audit had 0.063 CLS; the final rerun confirms that shift is gone. A Lighthouse rerun with a healthy full stack and real media is still required. The production Playwright fixture uses a healthy isolated MongoDB and is the source of the table above.

## Architecture and cache behavior

- The storefront route is dynamically rendered **intentionally**: the header reads the customer's cookie, name, and cart count. The catalog data itself is cached with `unstable_cache` under `storefront-menu-v1` for up to 30 seconds. Product/category mutations trigger immediate tag invalidation. The production test proves a direct database edit stays invisible on a warm hit, while the supported product mutation makes the new value visible; it also checks zero product queries over 50 subsequent warm requests. This does not prove zero settings/session queries.
- The menu and dashboard Server Components call application services directly. They do not make server-to-self HTTP requests. The menu streams a reserved-height skeleton so late content does not shift the footer. Dashboard sales-chart code and heavy product editors are dynamically imported.
- Product rows request `small` 320px WebP media variants with explicit 88px dimensions. Public media responses now use an ETag, a 60-second browser cache, and conditional 304 before object storage bytes are read. Owner-only media stays `private, no-store`. Visibility/deletion changes may take up to 60 seconds to disappear from a browser cache; do not treat browser caching as authorization for a previously downloaded public image.
- Vazirmatn is bundled via `@fontsource-variable/vazirmatn`; rendering requires no external font host. The realtime server caps inbound WebSocket messages at 8 KiB, disables compression, and refuses sends when a socket has over 1 MB buffered.
- Media uploads go directly from the browser to MinIO through presigned URLs, not through Next.js. The browser upload queue is limited to two simultaneous transfers. The JSON API refuses bodies over 64 KiB; bulk initiation/completion accepts at most five items and processes them sequentially. These are bounded-memory safeguards, **not** an observed application-server RSS result. Bulk-upload RSS must be measured against a running MinIO before release.

## Reproduce and extend

1. Run `npm run test:performance`; inspect `test-results/**/performance-report.json` and failed-test traces. The test builds and starts Next.js in production mode and uses disposable database names.
2. With the full local stack and representative images, run Lighthouse mobile against `npm run start:local`, record its JSON/HTML report in an ignored artifact directory, and compare LCP/CLS and image transfer with the table above. Also verify real-font load, 360/390/430px layouts, and interaction under a slower network/CPU profile.
3. Repeat a 10-concurrent mixed read/checkout workload with real Redis and MinIO, collect p50/p95/p99, MongoDB `explain` plans, process RSS, and queue lag. The current test measures warm menu reads only; it does not establish payment or upload capacity. Docker is not installed on the profiling workstation, so this full-stack run could not be performed there.

Performance regressions should fail a repeatable production-mode gate. Do not silently raise budgets to accommodate a new dependency or a larger catalog; record the new requirement and its measured effect first.
