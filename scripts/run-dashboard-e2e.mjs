import { spawn } from "node:child_process";

const suites = [
  ["--with-admin-db", "dashboard-auth.spec.ts"],
  ["--with-admin-db", "dashboard-journeys.spec.ts"],
  ["--with-product-fixtures", "dashboard-products.spec.ts"],
  ["--with-product-fixtures", "dashboard-categories.spec.ts"],
  ["--with-media-fixtures", "dashboard-media.spec.ts"],
  ["--with-admin-db", "dashboard-admins.spec.ts"],
  ["--with-admin-db", "dashboard-customers.spec.ts"],
  ["--with-admin-db", "dashboard-orders.spec.ts"],
  ["--with-admin-db", "dashboard-order-detail.spec.ts"],
  ["--with-admin-db", "dashboard-inventory.spec.ts"],
  ["--with-admin-db", "dashboard-payment-settings.spec.ts"],
  ["--with-admin-db", "dashboard-business-settings.spec.ts"],
  ["--with-admin-db", "shared-states-accessibility.spec.ts"],
];

async function run(args, skipBuild) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/run-e2e.mjs", "--workers=1", ...args], {
      env: { ...process.env, E2E_SKIP_BUILD: skipBuild ? "1" : "0" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Dashboard E2E suite failed (${code})`)),
    );
  });
}

for (const [index, suite] of suites.entries()) {
  console.log(`\nDashboard E2E ${index + 1}/${suites.length}: ${suite.at(-1)}`);
  await run(suite, index > 0);
}
