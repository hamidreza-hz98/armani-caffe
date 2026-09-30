import { expect, test } from "vitest";

import { settingsDefaults } from "../../src/modules/settings/index.ts";
import { contactLinks } from "../../src/storefront/contact-links.ts";

test("storefront renders only approved contact destinations", () => {
  const contact = {
    ...settingsDefaults("contact"),
    phone: "+989121234567",
    instagramUrl: "https://www.instagram.com/armani.caffe",
    telegramUrl: "https://t.me/armani_support",
    mapProvider: "google" as const,
    latitude: 35.7,
    longitude: 51.4,
  };
  const links = contactLinks({ ...contact, mapUrl: null });
  expect(links.map((link) => link.kind)).toEqual([
    "phone",
    "whatsapp",
    "instagram",
    "telegram",
    "map",
  ]);
  expect(links[0].href).toBe("tel:+989121234567");
  expect(links[1].href).toBe("https://wa.me/989121234567");
  expect(links[4].href).toContain("api=1");
});

test("malformed legacy values cannot create executable contact links", () => {
  const contact = {
    ...settingsDefaults("contact"),
    phone: "javascript:alert(1)",
    instagramUrl: "https://www.instagram.com.evil.invalid/armani",
    telegramUrl: "https://t.me/armani?redirect=evil",
    mapProvider: "google" as const,
    latitude: Infinity,
    longitude: 51.4,
    mapUrl: "javascript:alert(1)",
  };
  expect(contactLinks(contact)).toEqual([]);
});
