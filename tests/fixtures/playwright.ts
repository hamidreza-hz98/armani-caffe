import type { BrowserContext } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await use();
      expect(errors, "Browser console and page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// These helpers manipulate browser state only; they do not mint real sessions.
export async function setSessionCookie(
  context: BrowserContext,
  baseURL: string,
  name: string,
  value: string,
) {
  await context.addCookies([{ url: baseURL, name, value, httpOnly: true, sameSite: "Lax" }]);
}

export async function clearSession(context: BrowserContext) {
  await context.clearCookies();
}
