import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance as nodePerformance } from "node:perf_hooks";

import mongoose from "mongoose";

import { expect, test } from "../fixtures/playwright.ts";

test.skip(!process.env.E2E_PRODUCT_FIXTURES, "Run with npm run test:performance");
test.setTimeout(120_000);

const catalogPrefix = "سنجش کارایی";
const firstProductName = `${catalogPrefix} محصول نخست`;
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

test("production menu cache, invalidation, browser transfer and café load budgets", async ({
  page,
  browser,
}, testInfo) => {
  const connection = await mongoose.createConnection(process.env.MONGODB_URI!).asPromise();
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  const createdAt = new Date();
  const categories = Array.from({ length: 3 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    name: `${catalogPrefix} دسته ${index + 1}`,
    slug: `performance-category-${index + 1}`,
    mediaId: null,
    sortOrder: index,
    status: "published",
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
    __v: 0,
  }));
  const media = await connection
    .db!.collection("media_assets")
    .findOne({ filename: "sample.webp" });
  expect(media).not.toBeNull();
  const products = Array.from({ length: 18 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    categoryId: categories[Math.floor(index / 6)]._id,
    name: index === 0 ? firstProductName : `${catalogPrefix} محصول ${index + 1}`,
    slug: `performance-product-${index + 1}`,
    description: "",
    excerpt: "نوشیدنی آزمایشی برای سنجش زمان بارگذاری",
    ingredients: "",
    basePriceToman: 80000 + index * 1000,
    mediaIds: [media!._id],
    status: "published",
    available: true,
    sortOrder: index % 6,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
    __v: 0,
  }));
  try {
    await connection.db!.collection("categories").insertMany(categories);
    await connection.db!.collection("products").insertMany(products);
    await page.goto("/dashboard/login");
    await page.locator("#admin-username").fill("e2e-owner");
    await page.locator("#admin-password").fill("dashboard-e2e-password-12345");
    await page.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    const initialUpdate = await page.evaluate(async (id) => {
      const response = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: 0, name: "سنجش کارایی محصول نخست" }),
      });
      return response.status;
    }, String(products[0]._id));
    expect(initialUpdate).toBe(200);
    await guestPage.route(/\/api\/media\/[a-f0-9]{24}\/file/u, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#9b7137"/></svg>',
      }),
    );
    await guestPage.addInitScript(() => {
      const sample = {
        lcp: 0,
        cls: 0,
        interactions: [] as number[],
        shifts: [] as { value: number; nodes: string[] }[],
      };
      Object.assign(window, { __armaniPerf: sample });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sample.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            hadRecentInput?: boolean;
            value: number;
            sources?: { node?: Element }[];
          };
          if (!shift.hadRecentInput) {
            sample.cls += shift.value;
            sample.shifts.push({
              value: shift.value,
              nodes: (shift.sources ?? []).map((source) =>
                source.node
                  ? `${source.node.tagName.toLowerCase()}.${String(source.node.className).slice(0, 80)}`
                  : "unknown",
              ),
            });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const interaction = entry as PerformanceEntry & {
              interactionId?: number;
              duration: number;
            };
            if (interaction.interactionId) sample.interactions.push(interaction.duration);
          }
        }).observe({
          type: "event",
          buffered: true,
          durationThreshold: 16,
        } as PerformanceObserverInit & { durationThreshold: number });
      } catch {
        // Event Timing is not available in every browser engine.
      }
    });
    await guestPage.goto("/");
    await expect(guestPage.getByRole("heading", { name: `${catalogPrefix} دسته 1` })).toBeVisible();
    await guestPage.waitForLoadState("networkidle");
    await guestPage.getByRole("link", { name: categories[1].name }).click();
    await expect(guestPage.getByRole("link", { name: categories[1].name })).toHaveAttribute(
      "aria-current",
      "location",
    );
    const browserMetrics = await guestPage.evaluate(() => {
      const sample = (
        window as unknown as Window & {
          __armaniPerf: {
            lcp: number;
            cls: number;
            interactions: number[];
            shifts: { value: number; nodes: string[] }[];
          };
        }
      ).__armaniPerf;
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      return {
        lcpMs: Math.round(sample.lcp),
        cls: sample.cls,
        inpCandidateMs: sample.interactions.length ? Math.max(...sample.interactions) : null,
        shifts: sample.shifts.sort((a, b) => b.value - a.value).slice(0, 5),
        scriptBytes: resources
          .filter((resource) => resource.name.includes(".js"))
          .reduce((total, resource) => total + resource.encodedBodySize, 0),
        imageBytes: resources
          .filter((resource) => /\.(?:svg|webp|png|jpe?g)(?:\?|$)/u.test(resource.name))
          .reduce((total, resource) => total + resource.encodedBodySize, 0),
        documentBytes: performance.getEntriesByType("navigation")[0]
          ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
              .encodedBodySize
          : 0,
      };
    });
    const firstHtml = await (
      await guestPage.request.get("/", { headers: { "Cache-Control": "no-cache" } })
    ).text();
    expect(firstHtml).toContain(firstProductName);
    await connection
      .db!.collection("products")
      .updateOne({ _id: products[0]._id }, { $set: { name: `${catalogPrefix} تغییر پنهان` } });
    const cachedHtml = await (
      await guestPage.request.get("/", { headers: { "Cache-Control": "no-cache" } })
    ).text();
    expect(cachedHtml).toContain(firstProductName);
    expect(cachedHtml).not.toContain(`${catalogPrefix} تغییر پنهان`);

    const updated = await page.evaluate(
      async ({ id }) => {
        const response = await fetch(`/api/products/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: 1, name: "سنجش کارایی نسخه تازه" }),
        });
        return { status: response.status, body: await response.json() };
      },
      { id: String(products[0]._id) },
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const freshHtml = await (
      await guestPage.request.get("/", { headers: { "Cache-Control": "no-cache" } })
    ).text();
    expect(freshHtml).toContain("سنجش کارایی نسخه تازه");
    expect(freshHtml).not.toContain(firstProductName);

    const base = new URL(testInfo.project.use.baseURL!);
    const durations: number[] = [];
    const statusCodes: number[] = [];
    await connection.db!.command({ profile: 2, slowms: 0 });
    const productNamespace = `${connection.db!.databaseName}.products`;
    const catalogQueriesBefore = await connection
      .db!.collection("system.profile")
      .countDocuments({ ns: productNamespace });
    for (let batch = 0; batch < 5; batch++) {
      await Promise.all(
        Array.from({ length: 10 }, async () => {
          const started = nodePerformance.now();
          const response = await fetch(base, { headers: { "Cache-Control": "no-cache" } });
          await response.arrayBuffer();
          durations.push(nodePerformance.now() - started);
          statusCodes.push(response.status);
        }),
      );
    }
    const catalogQueriesAfter = await connection
      .db!.collection("system.profile")
      .countDocuments({ ns: productNamespace });
    await connection.db!.command({ profile: 0 });
    const dashboardContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let dashboardScriptBytes = 0;
    const seenScripts = new Set<string>();
    const scriptReads: Promise<void>[] = [];
    dashboardContext.on("response", (response) => {
      if (response.request().resourceType() !== "script" || seenScripts.has(response.url())) return;
      seenScripts.add(response.url());
      scriptReads.push(
        response
          .body()
          .then((body) => {
            dashboardScriptBytes += body.byteLength;
          })
          .catch(() => undefined),
      );
    });
    try {
      const dashboardPage = await dashboardContext.newPage();
      await dashboardPage.goto("/dashboard/login");
      await dashboardPage.locator("#admin-username").fill("e2e-owner");
      await dashboardPage.locator("#admin-password").fill("dashboard-e2e-password-12345");
      await dashboardPage.getByRole("button", { name: "ورود به داشبورد مدیریت" }).click();
      await expect(dashboardPage).toHaveURL(/\/dashboard$/u);
      await expect(dashboardPage.getByRole("heading", { name: "نمای کلی" })).toBeVisible();
      await dashboardPage.waitForLoadState("networkidle");
      await Promise.all(scriptReads);
    } finally {
      await dashboardContext.close();
    }
    const report = {
      fixture: { categories: 3, products: 18, concurrency: 10, requests: 50 },
      browser: browserMetrics,
      dashboard: { scriptBytes: dashboardScriptBytes },
      server: {
        p50Ms: Math.round(percentile(durations, 0.5)),
        p95Ms: Math.round(percentile(durations, 0.95)),
        maxMs: Math.round(Math.max(...durations)),
        errors: statusCodes.filter((code) => code !== 200).length,
        catalogProductQueries: catalogQueriesAfter - catalogQueriesBefore,
      },
    };
    const output = join(testInfo.outputDir, "performance-report.json");
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    await testInfo.attach("performance-report", { path: output, contentType: "application/json" });
    console.log(`Production performance: ${JSON.stringify(report)}`);
    expect(report.server.errors).toBe(0);
    expect(report.server.catalogProductQueries).toBe(0);
    expect(report.server.p95Ms).toBeLessThan(1200);
    expect(report.browser.scriptBytes).toBeLessThan(350_000);
    expect(report.browser.documentBytes).toBeLessThan(60_000);
    expect(report.browser.cls).toBeLessThan(0.05);
    expect(report.browser.lcpMs).toBeLessThan(2500);
    if (report.browser.inpCandidateMs !== null)
      expect(report.browser.inpCandidateMs).toBeLessThan(200);
    expect(report.dashboard.scriptBytes).toBeLessThan(1_200_000);
  } finally {
    await guestContext.close();
    await connection.close();
  }
});
