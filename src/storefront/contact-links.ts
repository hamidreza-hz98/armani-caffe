import type { PublicSettings } from "@/modules/settings";

export type ContactLink = Readonly<{
  label: string;
  detail: string;
  href: string;
  kind: "phone" | "instagram" | "telegram" | "whatsapp" | "map";
}>;

/** A second, display-boundary allowlist protects links even if stored data is legacy. */
export function contactLinks(contact: PublicSettings["contact"]): ContactLink[] {
  const links: ContactLink[] = [];
  if (/^\+\d{7,15}$/.test(contact.phone)) {
    links.push({
      label: "تماس با کافه",
      detail: contact.phone,
      href: `tel:${contact.phone}`,
      kind: "phone",
    });
    if (/^\+989\d{9}$/.test(contact.phone))
      links.push({
        label: "واتساپ",
        detail: "ارسال پیام",
        href: `https://wa.me/${contact.phone.slice(1)}`,
        kind: "whatsapp",
      });
  }
  for (const [kind, label, value, host] of [
    ["instagram", "اینستاگرام", contact.instagramUrl, "www.instagram.com"],
    ["telegram", "تلگرام", contact.telegramUrl, "t.me"],
  ] as const) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.hostname !== host ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/[A-Za-z0-9_][A-Za-z0-9_.]{0,63}\/?$/.test(url.pathname)
      )
        continue;
      links.push({ label, detail: url.pathname.slice(1), href: url.href, kind });
    } catch {
      // Absent and malformed legacy values are never rendered as links.
    }
  }
  if (contact.mapProvider === "google" && contact.latitude !== null && contact.longitude !== null) {
    const latitude = contact.latitude,
      longitude = contact.longitude;
    if (
      Number.isFinite(latitude) &&
      Math.abs(latitude) <= 90 &&
      Number.isFinite(longitude) &&
      Math.abs(longitude) <= 180
    )
      links.push({
        label: "مشاهده آدرس روی نقشه",
        detail: contact.address || "مسیریابی",
        href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`,
        kind: "map",
      });
  }
  return links;
}
